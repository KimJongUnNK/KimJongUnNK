"""Street-name and place-name signs, so you always know where you are.

* Every named street gets a blue Austrian-style name sign (warped sign, white glowing
  text, readable from both sides) on a dark post at both ends and about every 80 blocks.
* Named squares, parks and water bodies get an oak sign near their centre.
"""
from __future__ import annotations

import math

import numpy as np
import shapely
import shapely.ops

from . import data, nbt, raster
from .roads import ROAD_STYLE
from .world import World

STREET_CLASSES = {"primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "pedestrian",
                  "service", "unknown", "track", "footway", "cycleway", "path", "steps"}
SPACING = 80          # blocks between two signs of the same street
MIN_DIST = 35         # never two signs of the same name closer than this
SUFFIXES = ("straße", "strasse", "gasse", "weg", "platz", "allee", "ufer", "steig", "promenade", "brücke", "berg")


def wrap(name: str, width: int = 15, lines: int = 4) -> list[str]:
    """Split a name into sign lines (max ~15 characters); long compounds break before -straße etc."""
    words = []
    for w in name.split():
        if len(w) > width:
            low = w.lower()
            for suf in SUFFIXES:
                if low.endswith(suf) and len(w) > len(suf) + 2:
                    words += [w[:-len(suf)] + "-", w[-len(suf):]]
                    break
            else:
                words += [w[:width - 1] + "-", w[width - 1:]]
        else:
            words.append(w)
    out: list[str] = []
    for w in words:
        if out and len(out[-1]) + 1 + len(w) <= width and not out[-1].endswith("-"):
            out[-1] += " " + w
        elif out and out[-1].endswith("-") and len(out[-1]) + len(w) <= width:
            out[-1] += w
        else:
            out.append(w)
    return out[:lines]


def _text(t: str) -> str:
    return '{"text":"%s"}' % t.replace("\\", "\\\\").replace('"', '\\"')


def place_sign(world: World, x: int, y: int, z: int, lines: list[str], rotation: int, kind: str = "warped",
               color: str = "white", glow: bool = True, both: bool = True) -> None:
    """Standing sign with text on the front (and the back, so it reads from both sides)."""
    world.edits.set(x, y, z, f"{kind}_sign[rotation={rotation}]")
    pad = (lines + ["", "", "", ""])[:4]
    if len(lines) <= 2:   # centre short names vertically
        pad = ([""] + lines + ["", ""])[:4]
    msgs = nbt.List([_text(t) for t in pad], nbt.TAG_STRING)
    empty = nbt.List([_text("")] * 4, nbt.TAG_STRING)
    side = lambda m: {"messages": m, "color": color, "has_glowing_text": nbt.Byte(1 if glow else 0)}  # noqa: E731
    world.edits.block_entity({
        "id": "minecraft:sign", "x": nbt.Int(x), "y": nbt.Int(y), "z": nbt.Int(z), "keepPacked": nbt.Byte(0),
        "is_waxed": nbt.Byte(1), "front_text": side(msgs), "back_text": side(msgs if both else empty),
    })


def _rotation(dx: float, dz: float) -> int:
    """Rotation (0..15) whose front faces direction (dx, dz)."""
    ang = math.degrees(math.atan2(-dx, dz)) % 360
    return int(round(ang / 22.5)) % 16


def _ok(world: World, x: int, z: int) -> bool:
    g = world.grid
    if not g.inside(x, z):
        return False
    iz, ix = z - g.z0, x - g.x0
    return not (world.road[iz, ix] or world.occupied[iz, ix] or world.wtop[iz, ix] > world.H[iz, ix])


def _street_sign(world: World, x: int, z: int, name_lines, facing) -> bool:
    if not _ok(world, x, z):
        return False
    g = world.grid
    y = int(world.H[z - g.z0, x - g.x0])
    world.edits.set(x, y + 1, z, "polished_blackstone_wall")
    world.edits.set(x, y + 2, z, "polished_blackstone_wall")
    place_sign(world, x, y + 3, z, name_lines, _rotation(*facing))
    world.occupied[z - g.z0, x - g.x0] = True
    return True


def streets(world: World) -> int:
    g = world.grid
    by_name: dict[str, list] = {}
    width: dict[str, float] = {}
    for r in data.overture("segment"):
        if r["subtype"] != "road" or not r["name"] or r["geom"].geom_type != "LineString":
            continue
        cls = r["class"] or "unknown"
        if cls not in STREET_CLASSES:
            continue
        lb = raster.to_block_geom(r["geom"])
        minx, minz, maxx, maxz = lb.bounds
        if maxx < g.x0 or minx > g.x1 or maxz < g.z0 or minz > g.z1:
            continue
        by_name.setdefault(r["name"], []).append(lb)
        width[r["name"]] = max(width.get(r["name"], 0), ROAD_STYLE.get(cls, ROAD_STYLE["unknown"])[0])
    placed = 0
    for name, lines in sorted(by_name.items()):
        text = wrap(name)
        merged = shapely.ops.linemerge(shapely.MultiLineString(lines))
        parts = list(merged.geoms) if hasattr(merged, "geoms") else [merged]
        done: list[tuple[float, float]] = []
        off = width[name] / 2 + 1.5
        for line in sorted(parts, key=lambda p: -p.length):
            L = line.length
            if L < 12:
                continue
            n = max(1, int(L // SPACING))
            ts = sorted({min(6.0, L / 2), max(L - 6.0, L / 2)} | {L * (k + 0.5) / n for k in range(n)} if L > 2 * SPACING
                        else {min(6.0, L / 2), max(L - 6.0, L / 2)})
            for t in ts:
                p = line.interpolate(t)
                q = line.interpolate(min(L, t + 1.0))
                q0 = line.interpolate(max(0.0, t - 1.0))
                dx, dz = q.x - q0.x, q.y - q0.y
                nrm = math.hypot(dx, dz) or 1.0
                nx_, nz_ = -dz / nrm, dx / nrm
                if any(math.hypot(p.x - a, p.y - b) < MIN_DIST for a, b in done):
                    continue
                for side in (1, -1, 2, -2):   # right side first, then left, then a bit further out
                    o = off * (1 if abs(side) == 1 else 1.6) * (1 if side > 0 else -1)
                    x, z = int(math.floor(p.x + nx_ * o)), int(math.floor(p.y + nz_ * o))
                    # sign faces the street (front towards the road, back readable from the pavement)
                    if _street_sign(world, x, z, text, (-nx_ * np.sign(o), -nz_ * np.sign(o))):
                        done.append((p.x, p.y))
                        placed += 1
                        break
    return placed


def areas(world: World) -> int:
    """Named squares, parks, playgrounds and ponds: a wooden sign near the middle."""
    g = world.grid
    placed = 0
    seen: dict[str, list] = {}
    for kind, classes in (("land_use", {"plaza", "pedestrian", "park", "playground", "cemetery", "recreation_ground",
                                       "garden", "stadium", "zoo", "school", "marina", "camp_site", "pitch"}),
                          ("water", {"lake", "pond", "river", "stream", "basin", "reservoir"})):
        for r in data.overture(kind):
            if not r["name"] or r.get("class") not in classes:
                continue
            geom = raster.to_block_geom(r["geom"])
            if geom.is_empty:
                continue
            c = geom.representative_point() if geom.geom_type in ("Polygon", "MultiPolygon") else geom.interpolate(0.5, normalized=True)
            if not g.inside(int(c.x), int(c.y)):
                continue
            if any(math.hypot(c.x - a, c.y - b) < 120 for a, b in seen.get(r["name"], [])):
                continue
            spot = _spot(world, int(c.x), int(c.y), 25 if kind == "land_use" else 60)
            if spot is None:
                continue
            x, z = spot
            y = int(world.H[z - g.z0, x - g.x0])
            world.edits.set(x, y + 1, z, "spruce_fence")
            place_sign(world, x, y + 2, z, wrap(r["name"]), _rotation(c.x - x, c.y - z) if (x, z) != (int(c.x), int(c.y)) else 0,
                       kind="spruce", color="white", glow=True)
            world.occupied[z - g.z0, x - g.x0] = True
            seen.setdefault(r["name"], []).append((c.x, c.y))
            placed += 1
    return placed


def _spot(world: World, x: int, z: int, r: int):
    for d in range(0, r):
        for dx, dz in ((0, 0), (d, 0), (-d, 0), (0, d), (0, -d), (d, d), (-d, -d), (d, -d), (-d, d)):
            if _ok(world, x + dx, z + dz):
                return x + dx, z + dz
    return None


def build(world: World, log=print) -> dict:
    s = streets(world)
    a = areas(world)
    log(f"signs: {s} street-name signs, {a} place signs")
    return {"street_signs": s, "place_signs": a}
