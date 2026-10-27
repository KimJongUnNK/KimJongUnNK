#!/usr/bin/env python3
"""Isometric render of a box of a generated world, read back from the .mca region files.

This doubles as an end-to-end check of the written chunk format (region header,
zlib, NBT, palettes, bit packing): what you see is decoded exactly the way the
game reads it.

    python tools/iso_render.py output/Bregenz_1zu1 x0 y0 z0 x1 y1 z1 out.png [--scale 3]
"""
from __future__ import annotations

import argparse
import struct
import sys
import zlib
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from bregenz import anvil, nbt  # noqa: E402
from bregenz.render import BASE_COLORS, WORD_COLORS  # noqa: E402

TRANSPARENT = ("air", "light", "cave_air", "void_air", "barrier")


def read_chunk(region_dir: Path, cx: int, cz: int) -> dict | None:
    p = region_dir / f"r.{cx >> 5}.{cz >> 5}.mca"
    if not p.exists():
        return None
    with open(p, "rb") as f:
        hdr = f.read(4096)
        i = 4 * ((cx & 31) + 32 * (cz & 31))
        loc = struct.unpack(">I", hdr[i:i + 4])[0]
        if not loc:
            return None
        f.seek((loc >> 8) * 4096)
        length, comp = struct.unpack(">IB", f.read(5))
        assert comp == 2
        return nbt.decode(zlib.decompress(f.read(length - 1)))[1]


def color(name: str) -> tuple[int, int, int] | None:
    base = name.split("[")[0].split(":")[-1]
    if base in TRANSPARENT:
        return None
    if base in BASE_COLORS:
        return BASE_COLORS[base]
    for w, c in WORD_COLORS:
        if w in base:
            return c
    return (128, 128, 128)


def load_box(world: Path, x0, y0, z0, x1, y1, z1):
    """Dense array of palette names indices for the inclusive box; returns (ids, names)."""
    names: list[str] = ["minecraft:air"]
    index = {"minecraft:air": 0}
    sx, sy, sz = x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1
    out = np.zeros((sy, sz, sx), dtype=np.int32)
    for cz in range(z0 >> 4, (z1 >> 4) + 1):
        for cx in range(x0 >> 4, (x1 >> 4) + 1):
            ch = read_chunk(world / "region", cx, cz)
            if ch is None:
                continue
            for sec in ch["sections"]:
                sy0 = sec["Y"] * 16
                if sy0 + 15 < y0 or sy0 > y1:
                    continue
                pal, idx = anvil.decode_section_blocks(sec)
                gid = np.array([index.setdefault(n, len(index)) for n in pal])
                for n in pal:
                    if n not in names:
                        names.append(n)
                blk = gid[idx]  # [y, z, x]
                ya, yb = max(y0, sy0), min(y1, sy0 + 15)
                za, zb = max(z0, cz * 16), min(z1, cz * 16 + 15)
                xa, xb = max(x0, cx * 16), min(x1, cx * 16 + 15)
                out[ya - y0:yb - y0 + 1, za - z0:zb - z0 + 1, xa - x0:xb - x0 + 1] = \
                    blk[ya - sy0:yb - sy0 + 1, za - cz * 16:zb - cz * 16 + 1, xa - cx * 16:xb - cx * 16 + 1]
    inv = [None] * len(index)
    for n, i in index.items():
        inv[i] = n
    return out, inv


def render(ids: np.ndarray, names: list[str], scale: int = 2) -> Image.Image:
    cols = [color(n) for n in names]
    solid_lut = np.array([c is not None for c in cols])
    col_lut = np.array([c if c is not None else (0, 0, 0) for c in cols], dtype=np.float32)
    solid = solid_lut[ids]
    # keep only voxels with at least one non-solid neighbour
    p = np.pad(solid, 1, constant_values=False)
    enclosed = (p[2:, 1:-1, 1:-1] & p[:-2, 1:-1, 1:-1] & p[1:-1, 2:, 1:-1] & p[1:-1, :-2, 1:-1]
                & p[1:-1, 1:-1, 2:] & p[1:-1, 1:-1, :-2])
    vis = solid & ~enclosed
    y, z, x = np.nonzero(vis)
    c = col_lut[ids[y, z, x]]
    s = scale
    X = (x - z) * s
    Y = (x + z) * s // 2 - y * s
    X -= X.min()
    Y -= Y.min()
    W, H = int(X.max()) + 2 * s + 2, int(Y.max()) + 2 * s + 2
    order = np.argsort((x + z).astype(np.int64) * 4096 + y, kind="stable")
    X, Y, c = X[order], Y[order], c[order]
    img = np.full((H, W, 3), 245, dtype=np.float32)
    # sprite: top face (light), left side (dark), right side (medium)
    for dy in range(2 * s):
        for dx in range(2 * s):
            shade = 1.08 if dy < s else (0.68 if dx < s else 0.86)
            img[Y + dy, X + dx] = np.clip(c * shade, 0, 255)
    return Image.fromarray(img.astype(np.uint8))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("world")
    ap.add_argument("box", nargs=6, type=int)
    ap.add_argument("out")
    ap.add_argument("--scale", type=int, default=3)
    a = ap.parse_args(argv)
    x0, y0, z0, x1, y1, z1 = a.box
    ids, names = load_box(Path(a.world), min(x0, x1), min(y0, y1), min(z0, z1), max(x0, x1), max(y0, y1), max(z0, z1))
    render(ids, names, a.scale).save(a.out)
    print(f"{a.out}: {len(names)} block states in box")
    return 0


if __name__ == "__main__":
    sys.exit(main())
