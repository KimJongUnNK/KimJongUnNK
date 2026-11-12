"""Keep the player's own changes when the world is regenerated.

    python -m bregenz.useredits extract <played world dir or .zip> [--baseline baseline/<version>] [--out data/user_edits]
    python generate.py --keep-edits data/user_edits

`extract` compares the played world with the exact world the generator produced (the baseline) and stores
every block the player placed or broke, the block entities they changed (sign texts, chest contents ...),
whole chunks they built in outside the map, and their own files (player, inventory, statistics, entities,
extra maps and datapacks). `generate.py --keep-edits` lays all of it over the newly generated world, so
improvements to the generator and the player's building end up in the same world.
"""
from __future__ import annotations

import argparse
import gzip
import json
import multiprocessing as mp
import re
import shutil
import struct
import sys
import tempfile
import zipfile
import zlib
from pathlib import Path

import numpy as np

from . import anvil, config, level, nbt

ROOT = Path(__file__).resolve().parent.parent
REGION_RE = re.compile(r"r\.(-?\d+)\.(-?\d+)\.mca$")
SECTION_BLOCKS = 4096
# blocks that change on their own once the game runs (not the player's work)
FLOWING = re.compile(r"^minecraft:(water|lava)\[.*level=[1-9]")
OWN_FILES = ("level.dat", "playerdata", "stats", "advancements", "entities", "poi")


# ------------------------------------------------------------------ region i/o
def read_chunks(path: Path, raw_only: bool = False) -> dict[tuple[int, int], bytes]:
    """All chunks of a region file as compressed blobs (raw_only) or as decompressed NBT bytes.
    Handles every storage the game uses: gzip, zlib, uncompressed, LZ4 and oversized external .mcc files."""
    data = path.read_bytes()
    m = REGION_RE.search(path.name)
    rx, rz = int(m.group(1)), int(m.group(2))
    out = {}
    for i in range(1024):
        loc = struct.unpack(">I", data[4 * i:4 * i + 4])[0]
        if not loc:
            continue
        off = (loc >> 8) * 4096
        if off + 5 > len(data):
            continue
        length, comp = struct.unpack(">IB", data[off:off + 5])
        blob = data[off + 5:off + 4 + length]
        lx, lz = i % 32, i // 32
        cx, cz = rx * 32 + lx, rz * 32 + lz
        if comp & 128:                                       # stored next to the region file
            ext = path.parent / f"c.{cx}.{cz}.mcc"
            if not ext.exists():
                continue
            blob = ext.read_bytes()
            comp &= 127
        if raw_only:
            out[(cx, cz)] = bytes([comp]) + blob
            continue
        out[(cx, cz)] = _decompress(comp, blob)
    return out


def _decompress(comp: int, blob: bytes) -> bytes:
    if comp == 1:
        return gzip.decompress(blob)
    if comp == 2:
        return zlib.decompress(blob)
    if comp == 3:
        return blob
    if comp == 4:
        try:
            import lz4.frame
        except ImportError as e:
            raise RuntimeError("region uses LZ4 compression: pip install lz4") from e
        return lz4.frame.decompress(blob)
    raise ValueError(f"unknown chunk compression {comp}")


def _state(entry: dict) -> str:
    props = entry.get("Properties")
    if props:
        return entry["Name"] + "[" + ",".join(f"{k}={v}" for k, v in sorted(props.items())) + "]"
    return entry["Name"]


def section_states(sec: dict) -> tuple[list[str], np.ndarray] | None:
    bs = sec.get("block_states")
    if bs is None:
        return None
    pal = [_state(e) for e in bs["palette"]]
    if "data" not in bs or len(pal) == 1:
        return pal, np.zeros(SECTION_BLOCKS, dtype=np.int64)
    idx = anvil.unpack(np.asarray(bs["data"], dtype=np.int64), anvil.bits_for_blocks(len(pal)), SECTION_BLOCKS)
    return pal, idx


def chunk_blocks(ch: dict) -> dict[int, np.ndarray]:
    """Section Y -> array of 4096 state strings (object array, [y, z, x] order)."""
    out = {}
    for sec in ch.get("sections", []):
        st = section_states(sec)
        if st is None:
            continue
        pal, idx = st
        out[int(sec["Y"])] = np.asarray(pal, dtype=object)[idx]
    return out


def _outside_column() -> np.ndarray:
    """What the flat generator puts outside the map, per absolute Y (index y - MIN_Y)."""
    col = []
    for block, h in level.OUTSIDE_LAYERS:
        col += [block] * h
    col += ["minecraft:air"] * (config.HEIGHT - len(col))
    return np.asarray(col[:config.HEIGHT], dtype=object)


# ------------------------------------------------------------------ extract
def _diff_region(args):
    user_path, base_path = args
    user_raw = read_chunks(Path(user_path), raw_only=True)
    base_raw = read_chunks(Path(base_path), raw_only=True) if base_path and Path(base_path).exists() else {}
    outside = _outside_column()
    blocks, bes, extra, stats = [], [], {}, {}
    for key, ublob in user_raw.items():
        bblob = base_raw.get(key)
        if bblob is not None and bblob == ublob:
            continue                                   # never loaded by the game: unchanged
        uch = nbt.decode(_decompress(ublob[0], ublob[1:]))[1]
        if str(uch.get("Status", "")).split(":")[-1] not in ("full", ""):
            continue                                   # half-generated border chunk
        cx, cz = key
        ublocks = chunk_blocks(uch)
        if bblob is None:
            # a chunk the game generated outside the map: keep it only if the player built there
            touched = False
            for sy, arr in ublocks.items():
                y0 = sy * 16 - config.MIN_Y
                if y0 < 0 or y0 + 16 > config.HEIGHT:
                    continue
                exp = np.repeat(outside[y0:y0 + 16], 256)
                if (arr != exp).any():
                    touched = True
                    break
            if touched:
                extra[key] = _decompress(ublob[0], ublob[1:])
            continue
        bch = nbt.decode(_decompress(bblob[0], bblob[1:]))[1]
        bblocks = chunk_blocks(bch)
        changed_pos = set()
        for sy, uarr in ublocks.items():
            barr = bblocks.get(sy)
            if barr is None:
                barr = np.full(SECTION_BLOCKS, "minecraft:air", dtype=object)
            diff = np.nonzero(uarr != barr)[0]
            for i in diff:
                new, old = uarr[i], barr[i]
                if FLOWING.match(new) and old == "minecraft:air":
                    continue
                y = sy * 16 + i // 256
                z = cz * 16 + (i // 16) % 16
                x = cx * 16 + i % 16
                blocks.append((x, y, z, new))
                changed_pos.add((x, y, z))
                nm = new.split("[")[0].split(":")[-1]
                stats[nm] = stats.get(nm, 0) + 1
        # block entities: keep the player's version where the block changed, where there was none before,
        # where a sign reads differently, or where a container now holds items
        base_be = {(int(b["x"]), int(b["y"]), int(b["z"])): b for b in bch.get("block_entities", [])}
        for be in uch.get("block_entities", []):
            pos = (int(be["x"]), int(be["y"]), int(be["z"]))
            old = base_be.get(pos)
            keep = pos in changed_pos or old is None or bool(be.get("Items")) or bool(be.get("item"))
            if not keep and "front_text" in be:
                keep = _sign_text(be) != _sign_text(old)
            if keep:
                bes.append(nbt.encode(be))
    return blocks, bes, extra, stats


def _plain(s) -> str:
    s = str(s)
    try:
        j = json.loads(s)
    except (ValueError, TypeError):
        return s
    if isinstance(j, str):
        return j
    if isinstance(j, dict):
        return str(j.get("text", "")) + "".join(_plain(json.dumps(e)) for e in j.get("extra", []))
    if isinstance(j, list):
        return "".join(_plain(json.dumps(e)) for e in j)
    return s


def _sign_text(be) -> tuple:
    if be is None:
        return ()
    out = []
    for side in ("front_text", "back_text"):
        msgs = (be.get(side) or {}).get("messages", [])
        out.append(tuple(_plain(m) for m in msgs))
    return tuple(out)


def _open_world(path: Path, tmp: Path) -> Path:
    if path.is_file() and path.suffix == ".zip":
        with zipfile.ZipFile(path) as z:
            for info in z.infolist():
                target = (tmp / info.filename).resolve()
                if not str(target).startswith(str(tmp.resolve())):
                    raise ValueError(f"unsafe path in zip: {info.filename}")
            z.extractall(tmp)
        path = tmp
    found = sorted(p.parent for p in path.rglob("level.dat"))
    if not found:
        raise FileNotFoundError(f"no level.dat in {path}")
    return min(found, key=lambda p: len(p.parts))


def extract(user: Path, baseline: Path, out: Path, workers: int = 4, log=print) -> dict:
    with tempfile.TemporaryDirectory(dir=out.parent if out.parent.exists() else None) as tmpd:
        world = _open_world(user, Path(tmpd))
        regions = sorted((world / "region").glob("r.*.mca"))
        jobs = [(str(p), str(baseline / "region" / p.name)) for p in regions]
        log(f"comparing {len(jobs)} region files of {world} with {baseline}")
        allb, allbe, extra, stats = [], [], {}, {}
        with mp.get_context("fork").Pool(workers) as pool:
            for k, (b, be, ex, st) in enumerate(pool.imap_unordered(_diff_region, jobs)):
                allb += b
                allbe += be
                extra.update(ex)
                for n, c in st.items():
                    stats[n] = stats.get(n, 0) + c
                if (k + 1) % 20 == 0:
                    log(f"  {k + 1}/{len(jobs)} regions, {len(allb)} changed blocks so far")
        # earlier rounds: the baseline already contains them, so this round's changes are added on top
        prev_extra = {}
        if (out / "blocks.npz").exists():
            parr, pstates, pbes = load(out)
            seen = {(x, y, z) for x, y, z, _ in allb}
            allb = [(int(x), int(y), int(z), pstates[int(k)]) for x, y, z, k in parr if (int(x), int(y), int(z)) not in seen] + allb
            newpos = set()
            for raw in allbe:
                b = nbt.decode(raw)[1]
                newpos.add((int(b["x"]), int(b["y"]), int(b["z"])))
            allbe = [nbt.encode(b) for b in pbes if (int(b["x"]), int(b["y"]), int(b["z"])) not in newpos] + allbe
            for f in (out / "extra_chunks").glob("c.*.nbt"):
                _, cx, cz, _ = f.name.split(".")
                prev_extra[(int(cx), int(cz))] = zlib.decompress(f.read_bytes())
            log(f"merged with {len(parr)} blocks kept from earlier rounds")
        prev_extra.update(extra)
        extra = prev_extra
        if out.exists():
            shutil.rmtree(out)
        out.mkdir(parents=True)
        states = sorted({s for *_, s in allb})
        sidx = {s: i for i, s in enumerate(states)}
        arr = np.array([(x, y, z, sidx[s]) for x, y, z, s in allb], dtype=np.int64).reshape(-1, 4)
        np.savez_compressed(out / "blocks.npz", xyz_state=arr, states=np.array(states, dtype=object))
        with open(out / "block_entities.nbt", "wb") as f:
            for raw in allbe:
                f.write(struct.pack(">I", len(raw)) + raw)
        (out / "extra_chunks").mkdir()
        for (cx, cz), raw in extra.items():
            (out / "extra_chunks" / f"c.{cx}.{cz}.nbt").write_bytes(zlib.compress(raw))
        # the player's own files
        (out / "files").mkdir()
        for name in OWN_FILES:
            src = world / name
            if src.is_dir():
                shutil.copytree(src, out / "files" / name)
            elif src.is_file():
                shutil.copy2(src, out / "files" / name)
        if (world / "data").is_dir():
            shutil.copytree(world / "data", out / "files" / "data")
        if (world / "datapacks").is_dir():
            for dp in (world / "datapacks").iterdir():
                if dp.name != "bregenz":
                    dst = out / "files" / "datapacks" / dp.name
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    (shutil.copytree if dp.is_dir() else shutil.copy2)(dp, dst)
        summary = {"changed_blocks": len(allb), "block_entities": len(allbe), "extra_chunks": len(extra),
                   "by_block": dict(sorted(stats.items(), key=lambda kv: -kv[1])), "baseline": str(baseline),
                   "source": str(user)}
        (out / "summary.json").write_text(json.dumps(summary, indent=1, ensure_ascii=False))
        log(f"user edits: {len(allb)} blocks, {len(allbe)} block entities, {len(extra)} extra chunks -> {out}")
        return summary


# ------------------------------------------------------------------ apply
def load(path: Path):
    z = np.load(path / "blocks.npz", allow_pickle=True)
    arr, states = z["xyz_state"], list(z["states"])
    bes = []
    raw = (path / "block_entities.nbt").read_bytes() if (path / "block_entities.nbt").exists() else b""
    i = 0
    while i < len(raw):
        n = struct.unpack(">I", raw[i:i + 4])[0]
        bes.append(nbt.decode(raw[i + 4:i + 4 + n])[1])
        i += 4 + n
    return arr, states, bes


def apply_blocks(world, path: Path, log=print) -> int:
    """Lay the player's blocks and block entities over the generated world (they win over everything)."""
    from .blocks import REG
    arr, states, bes = load(path)
    if len(arr):
        ids = np.array([REG.id(s) for s in states], dtype=np.uint16)
        world.edits.put(arr[:, 0], arr[:, 1], arr[:, 2], ids[arr[:, 3]])
    pos = {(int(b["x"]), int(b["y"]), int(b["z"])) for b in bes}
    changed = {(int(x), int(y), int(z)) for x, y, z, _ in arr} | pos
    world.edits.block_entities = [b for b in world.edits.block_entities
                                  if (int(b["x"]), int(b["y"]), int(b["z"])) not in changed]
    for b in bes:
        world.edits.block_entity(b)
    log(f"user edits: {len(arr)} blocks and {len(bes)} block entities of the player kept")
    return len(arr)


def apply_files(out: Path, path: Path, log=print) -> None:
    """Chunks built outside the map, and the player's files (level.dat, inventory, stats, entities, maps)."""
    extra = sorted((path / "extra_chunks").glob("c.*.nbt")) if (path / "extra_chunks").exists() else []
    by_region: dict[tuple[int, int], list] = {}
    for f in extra:
        _, cx, cz, _ = f.name.split(".")
        cx, cz = int(cx), int(cz)
        by_region.setdefault((cx >> 5, cz >> 5), []).append((cx, cz, zlib.decompress(f.read_bytes())))
    for (rx, rz), chunks in by_region.items():
        rp = out / "region" / f"r.{rx}.{rz}.mca"
        w = anvil.RegionWriter(rp)
        if rp.exists():
            for (cx, cz), raw in read_chunks(rp).items():
                w.add(cx, cz, raw)
        for cx, cz, raw in chunks:
            if (cx & 31, cz & 31) not in w.chunks:     # never over a chunk of the generated map
                w.add(cx, cz, raw)
        w.write()
    files = path / "files"
    if files.exists():
        ours_maps = {p.name for p in (out / "data").glob("map_*.dat")} if (out / "data").exists() else set()
        for src in files.iterdir():
            dst = out / src.name
            if src.name == "data":
                dst.mkdir(exist_ok=True)
                for f in src.iterdir():
                    if f.name in ours_maps:
                        continue                         # our freshly rendered maps of the new world
                    if f.name == "idcounts.dat" and (dst / f.name).exists():
                        continue
                    (shutil.copytree if f.is_dir() else shutil.copy2)(f, dst / f.name, **({"dirs_exist_ok": True} if f.is_dir() else {}))
            elif src.is_dir():
                shutil.copytree(src, dst, dirs_exist_ok=True)
            else:
                shutil.copy2(src, dst)
    log(f"user edits: {len(extra)} chunks outside the map and the player's files restored")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("extract")
    e.add_argument("world", type=Path, help="the played world folder or the .zip of it")
    e.add_argument("--baseline", type=Path, default=None, help="the generated world it started from")
    e.add_argument("--out", type=Path, default=ROOT / "data" / "user_edits")
    e.add_argument("--workers", type=int, default=4)
    a = ap.parse_args(argv)
    base = a.baseline
    if base is None:
        cands = sorted((ROOT / "baseline").glob("*/level.dat"))
        if not cands:
            print("no baseline world found (baseline/<version>/)", file=sys.stderr)
            return 2
        base = cands[-1].parent
    extract(a.world, base, a.out, a.workers)
    return 0


if __name__ == "__main__":
    sys.exit(main())
