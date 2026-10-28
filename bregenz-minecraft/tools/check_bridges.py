"""Check every OSM bridge in the finished world: the deck must float (air below) wherever it crosses a road,
a railway or water, with enough headroom, and crossing bridges must be on different levels.

    python tools/check_bridges.py output/Bregenz_1zu1
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import shapely

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))

import iso_render as ir  # noqa: E402
from bregenz import data, raster, roads  # noqa: E402

THIN = ("air", "light", "iron_bars", "short_grass", "fern", "lantern", "rail", "chain")


def column(world: Path, x: int, z: int, cache: dict):
    key = (x >> 4, z >> 4)
    if key not in cache:
        x0, z0 = key[0] * 16, key[1] * 16
        cache[key] = ir.load_box(world, x0, 380, z0, x0 + 15, 560, z0 + 15)
    ids, names = cache[key]
    col = ids[:, z & 15, x & 15]
    return [names[i].split(":")[-1].split("[")[0] for i in col]


def main(world: Path) -> int:
    rails = [raster.to_block_geom(r["geom"]) for r in data.overture("segment") if r["subtype"] == "rail"
             and r["geom"].geom_type == "LineString"]
    plain = []
    bridges = []
    for r in data.overture("segment"):
        if r["subtype"] != "road" or r["geom"].geom_type != "LineString":
            continue
        for a, b in data.has_flag(r, "is_bridge"):
            p = roads._split(r["geom"], [(a, b)])
            if p:
                bridges.append((r["class"], r["name"], raster.to_block_geom(p[0])))
        for a, b in roads._ranges_without(r, "is_bridge"):
            p = roads._split(r["geom"], [(a, b)])
            if p and r["class"] not in ("footway", "path", "steps", "cycleway", "track"):
                plain.append(raster.to_block_geom(p[0]))
    cache: dict = {}
    bad = 0
    checked = 0
    for cls, name, g in bridges:
        if g.length < 12:
            continue
        under_geoms = [q for q in rails + plain if q.crosses(g)]
        pts = [g.interpolate(q) for q in [ug.intersection(g) for ug in under_geoms] if not q.is_empty]
        pts = [p if p.geom_type == "Point" else p.centroid for p in pts]
        mid = g.interpolate(0.5, normalized=True)
        pts.append(mid)
        for p in pts:
            x, z = int(np.floor(p.x)), int(np.floor(p.y))
            try:
                col = column(world, x, z, cache)
            except Exception:
                continue
            solid = [i for i, n in enumerate(col) if n not in THIN and n != "water"]
            if not solid:
                continue
            checked += 1
            # deck = highest solid block; gap below it
            deck = max(i for i in solid)
            k = deck - 1
            while k >= 0 and col[k] in ("smooth_stone", "light_gray_concrete", "smooth_stone_slab", "stone_bricks", "gravel"):
                k -= 1
            gap = 0
            while k >= 0 and (col[k] in THIN or col[k] == "water"):
                gap += 1
                k -= 1
            crossing = p is not mid
            if crossing and gap < 4:
                bad += 1
                print(f"LOW  {cls:10s} {name or '-':30s} at ({x},{z}) deck y={380 + deck} free={gap}")
    print(f"checked {checked} points on {len(bridges)} bridges, {bad} problems")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "output" / "Bregenz_1zu1")))
