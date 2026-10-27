#!/usr/bin/env python3
"""Generate the Bregenz 1:1 Minecraft world.

    python -m bregenz.fetch          # once: download elevation + map data (cached in data/raw)
    python generate.py               # build the world into output/Bregenz_1zu1
    python generate.py --bbox 9.735 47.497 9.755 47.508 --out output/test   # small test area
"""
from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import os
import shutil
import sys
import time
import zipfile
from pathlib import Path

import numpy as np

from bregenz import anvil, buildings, config, details, geo, landmarks, level, mapitems, render, roads, terrain, vegetation
from bregenz.world import BIOMES, World, build_chunk_blocks, chunk_biome_grid

ROOT = Path(__file__).resolve().parent
_W = None
_E = None


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def _write_region(args) -> tuple[int, int, int, int]:
    rx, rz, chunks, out_dir = args
    w = anvil.RegionWriter(out_dir / f"r.{rx}.{rz}.mca")
    for cx, cz in chunks:
        blocks = build_chunk_blocks(_W, _E, cx, cz)
        bio = chunk_biome_grid(_W, cx, cz)
        raw = anvil.chunk_bytes(cx, cz, blocks, BIOMES, bio, _E.bes.get((cx, cz)))
        w.add(cx, cz, raw)
    w.write()
    return rx, rz, len(chunks), (out_dir / f"r.{rx}.{rz}.mca").stat().st_size


def spawn_point(world: World) -> tuple[int, int, int]:
    """On the lake promenade between harbour and Kornmarkt, looking at the KUB."""
    g = world.grid
    x, z = geo.place(47.5058, 9.7468)
    for r in range(0, 60):
        for dx in range(-r, r + 1):
            for dz in (-r, r):
                for px, pz in ((x + dx, z + dz), (x + dz, z + dx)):
                    if not g.inside(px, pz):
                        continue
                    iz, ix = pz - g.z0, px - g.x0
                    if not world.occupied[iz, ix] and world.wtop[iz, ix] <= world.H[iz, ix]:
                        return px, int(world.H[iz, ix]) + 1, pz
    return x, int(world.surface(x, z)), z


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(ROOT / "output" / "Bregenz_1zu1"))
    ap.add_argument("--bbox", nargs=4, type=float, default=None, help="lon_min lat_min lon_max lat_max")
    ap.add_argument("--workers", type=int, default=os.cpu_count() or 4)
    ap.add_argument("--no-zip", action="store_true")
    ap.add_argument("--previews", default=str(ROOT / "previews"))
    args = ap.parse_args(argv)

    t0 = time.time()
    bbox = tuple(args.bbox) if args.bbox else config.WORLD_BBOX
    grid = geo.Grid.from_bbox(bbox)
    log(f"grid {grid.nx} x {grid.nz} blocks, {grid.nx * grid.nz // 256} chunks, origin = vorarlberg museum")
    world = World(grid)
    stats = {"grid": [grid.x0, grid.z0, grid.nx, grid.nz]}
    stats.update(terrain.build(world, log))
    stats.update(roads.build(world, log))
    stats.update(buildings.build(world, landmarks.exclusion_zones(), landmarks.styles_for(world), log))
    stats.update(landmarks.build(world, log))
    stats["street_lamps"] = roads.street_lamps(world)
    stats.update(details.build(world, log))
    stats.update(vegetation.build(world, log))
    log(f"edits: {world.edits.count:,} block placements, sorting by chunk")
    edits = world.edits.finalize(grid)
    stats["edits"] = int(edits.xs.size)
    stats["block_states"] = len(anvil.REG)

    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    (out / "region").mkdir(parents=True)
    level.write_datapack(out)
    spawn = spawn_point(world)
    border = (grid.x0 + grid.nx / 2, grid.z0 + grid.nz / 2, float(max(grid.nx, grid.nz)))
    level.write_level(out, spawn, border)
    stats["spawn"] = spawn

    # ---- chunks, one process per region file
    regions: dict[tuple[int, int], list] = {}
    for cx, cz in grid.chunks():
        regions.setdefault((cx >> 5, cz >> 5), []).append((cx, cz))
    jobs = [(rx, rz, ch, out / "region") for (rx, rz), ch in sorted(regions.items())]
    global _W, _E
    _W, _E = world, edits
    log(f"writing {sum(len(j[2]) for j in jobs)} chunks in {len(jobs)} region files with {args.workers} workers")
    done = 0
    total_bytes = 0
    ctx = mp.get_context("fork")
    with ctx.Pool(args.workers) as pool:
        for rx, rz, n, size in pool.imap_unordered(_write_region, jobs):
            done += 1
            total_bytes += size
            if done % 10 == 0 or done == len(jobs):
                log(f"  regions {done}/{len(jobs)} ({total_bytes / 1e6:.0f} MB)")
    stats["world_mb"] = round(total_bytes / 1e6, 1)

    # ---- previews, icon, markers
    prev = Path(args.previews)
    prev.mkdir(parents=True, exist_ok=True)
    log("rendering previews")
    full = render.map_image(world, edits, scale=1)
    icon = full.resize((64, 64 * full.height // full.width)).crop((0, 0, 64, 64)) if full.width >= full.height else full
    icon = full.copy()
    icon.thumbnail((64, 64))
    canvas = render.Image.new("RGB", (64, 64), (58, 143, 176))
    canvas.paste(icon, ((64 - icon.width) // 2, (64 - icon.height) // 2))
    canvas.save(out / "icon.png")
    overview = full.resize((full.width // 3, full.height // 3), render.Image.LANCZOS)
    render.annotate(overview, world, 3).save(prev / "map_overview.png")
    # 1:1 detail renders
    crops = {
        "map_innenstadt_1zu1.png": (-820, -380, 520, 520),      # Seebühne .. Oberstadt
        "map_oberstadt_1zu1.png": (-60, 300, 360, 800),
        "map_pfaender_gipfel_1zu1.png": (2150, -520, 2750, 120),
    }
    for name, (x0, z0, x1, z1) in crops.items():
        x0, x1 = max(x0, grid.x0), min(x1, grid.x1)
        z0, z1 = max(z0, grid.z0), min(z1, grid.z1)
        if x1 - x0 < 50 or z1 - z0 < 50:
            continue
        img = render.map_image(world, edits, 1, (x0, z0, x1, z1))
        img = img.resize((img.width * 2, img.height * 2), render.Image.NEAREST)
        render.annotate(img, world, 0.5, offset=(x0 - grid.x0, z0 - grid.z0)).save(prev / name)
    plan = ROOT / "data" / "plan" / "bregenz_minecraft_topographie.csv"
    try:
        render.profile_chart(world, prev / "profil_see_pfaender.png", plan)
    except Exception as e:  # chart is a nice-to-have
        log(f"profile chart skipped: {e!r}")
    markers = {k: list(map(int, v)) for k, v in sorted(world.markers.items(), key=lambda kv: kv[1][0])}
    stats["markers"] = markers
    # starter kit: rendered maps + teleport book in the inventory, datapack keeps the map there
    log("maps, teleport book and /function teleports")
    maps = mapitems.render_maps(world, edits, out / "data")
    targets = mapitems.teleport_targets(world.markers)
    mapitems.write_functions(out / "datapacks" / "bregenz", targets, len(maps))
    level.write_level(out, spawn, border, mapitems.inventory(maps, targets))
    (prev / "stats.json").write_text(json.dumps(stats, indent=2, ensure_ascii=False, default=lambda o: o.item() if hasattr(o, "item") else str(o)))
    (out / "KOORDINATEN.txt").write_text(
        "Bregenz 1:1 - Teleports (Y = Meter ueber Adria, 0/0 = vorarlberg museum)\n"
        "Alle Orte: /function bregenz:hilfe   |   alle Karten: /function bregenz:karten\n"
        "Im Inventar: Karten + Buch 'Bregenz Teleporter' (Eintrag anklicken = teleportieren)\n\n"
        + "\n".join(f"{name:42s} /function bregenz:tp/{sl:38s} /tp @s {x} {y} {z}" for name, sl, (x, y, z) in targets)
        + "\n", encoding="utf-8")

    if not args.no_zip:
        zpath = out.parent / f"{out.name}.zip"
        log(f"zipping to {zpath}")
        with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
            for p in sorted(out.rglob("*")):
                if p.is_file():
                    z.write(p, Path(out.name) / p.relative_to(out))
        stats["zip_mb"] = round(zpath.stat().st_size / 1e6, 1)
    log(f"done in {time.time() - t0:.0f}s: {json.dumps({k: stats[k] for k in ('buildings', 'trees', 'world_mb') if k in stats})}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
