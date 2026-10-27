"""Streets, paths, bridges and the railway from the Overture transportation layer."""
from __future__ import annotations

import numpy as np
import shapely
from scipy import ndimage
from shapely import ops

from . import data, geo, raster
from .blocks import B
from .world import World

# class -> (width, top block, priority)
ROAD_STYLE = {
    "motorway": (11, "gray_concrete", 9),
    "trunk": (10, "gray_concrete", 9),
    "primary": (9, "gray_concrete", 8),
    "secondary": (8, "gray_concrete", 7),
    "tertiary": (7, "gray_concrete", 6),
    "unclassified": (6, "gray_concrete", 5),
    "residential": (6, "gray_concrete", 5),
    "living_street": (5, "andesite", 4),
    "pedestrian": (6, "stone_bricks", 4),
    "service": (4, "gray_concrete", 3),
    "unknown": (4, "gray_concrete", 3),
    "track": (3, "coarse_dirt", 2),
    "cycleway": (2, "smooth_stone", 2),
    "footway": (2, "polished_andesite", 1),
    "steps": (2, "stone_bricks", 1),
    "path": (2, "dirt_path", 0),
}
MARKED = {"motorway", "trunk", "primary", "secondary", "tertiary"}
TUNNEL_CLASSES = {"motorway", "trunk", "primary", "secondary", "tertiary"}
OUTSIDE_PORTAL_Y = 410  # portals beyond the map edge (Pfändertunnel north portal, Hörbranz)


def _ranges_without(row, flag, key="road_flags"):
    """Fractions [a, b] of the segment that do NOT carry `flag`."""
    bad = sorted(data.has_flag(row, flag, key))
    keep, pos = [], 0.0
    for a, b in bad:
        if a > pos:
            keep.append((pos, a))
        pos = max(pos, b)
    if pos < 1.0:
        keep.append((pos, 1.0))
    return [(a, b) for a, b in keep if b - a > 1e-6]


def _split(line, ranges):
    out = []
    for a, b in ranges:
        if a <= 0 and b >= 1:
            out.append(line)
        else:
            s = ops.substring(line, a, b, normalized=True)
            if s.geom_type == "LineString" and s.length > 0:
                out.append(s)
    return out


def _sample(line_block, step=0.5):
    n = max(2, int(line_block.length / step) + 1)
    d = np.linspace(0, line_block.length, n)
    pts = shapely.line_interpolate_point(line_block, d)
    xy = shapely.get_coordinates(pts)
    return xy[:, 0], xy[:, 1], d


def _cells4(line_block):
    """4-connected cell path along a line (needed for rails)."""
    xs, zs, _ = _sample(line_block, 0.25)
    cx, cz = np.floor(xs).astype(int), np.floor(zs).astype(int)
    out = [(cx[0], cz[0])]
    for x, z in zip(cx[1:], cz[1:]):
        px, pz = out[-1]
        if (x, z) == (px, pz):
            continue
        if x != px and z != pz:
            out.append((x, pz))
        out.append((x, z))
    return out


def build(world: World, log=print) -> dict:
    g = world.grid
    segs = data.overture("segment")
    roads_by_class: dict[str, list] = {}
    bridges: list[tuple[str, object]] = []
    rails: list = []
    rail_bridges: list = []
    tunnels: list = []
    for r in segs:
        line = r["geom"]
        if line.geom_type != "LineString":
            continue
        if r["subtype"] == "rail":
            vals = set().union(*[v for v, _ in data.flags(r, "rail_flags")]) if r.get("rail_flags") else set()
            if vals & {"is_abandoned", "is_disused"}:
                continue
            parts = _split(line, _ranges_without(r, "is_tunnel", "rail_flags"))
            for p in parts:
                (rail_bridges if data.has_flag(r, "is_bridge", "rail_flags") else rails).append(raster.to_block_geom(p))
            continue
        if r["subtype"] != "road":
            continue
        cls = r["class"] or "unknown"
        if cls not in ROAD_STYLE:
            cls = "unknown"
        rflags = set().union(*[v for v, _ in data.flags(r)]) if r.get("road_flags") else set()
        if "is_indoor" in rflags or "is_under_construction" in rflags:
            continue
        keep = _ranges_without(r, "is_tunnel")
        if cls in TUNNEL_CLASSES:
            for a, b in data.has_flag(r, "is_tunnel"):
                if (b - a) * line.length * 75000 > 40:  # ~metres; skip short underpasses
                    tunnels.append((cls, line, a, b))
        for a, b in keep:
            sub = _split(line, [(a, b)])
            if not sub:
                continue
            seg = sub[0]
            br = [(max(a, x), min(b, y)) for x, y in data.has_flag(r, "is_bridge") if min(b, y) > max(a, x)]
            if br:
                # split this piece into bridge / non-bridge parts (fractions relative to the full line)
                cuts = sorted({a, b, *[v for p in br for v in p]})
                for u, v in zip(cuts[:-1], cuts[1:]):
                    piece = _split(line, [(u, v)])
                    if not piece:
                        continue
                    is_br = any(x <= u + 1e-9 and v <= y + 1e-9 for x, y in br)
                    (bridges.append((cls, piece[0])) if is_br else roads_by_class.setdefault(cls, []).append(piece[0]))
            else:
                roads_by_class.setdefault(cls, []).append(seg)

    # ---- road surface: smooth the terrain along roads, then pave
    log(f"roads: {sum(len(v) for v in roads_by_class.values())} segments, {len(bridges)} bridges, {len(rails)} rail parts")
    allmask = np.zeros((g.nz, g.nx), dtype=np.uint8)
    for cls, (w, blk, pr) in sorted(ROAD_STYLE.items(), key=lambda kv: kv[1][2]):
        geoms = roads_by_class.get(cls)
        if not geoms:
            continue
        m = raster.lines(geoms, g, w).astype(bool)
        allmask[m] = pr + 1
    road = allmask > 0
    road &= ~(world.wtop > world.H)  # never pave over water
    H = world.H.astype(np.float32)
    wsum = ndimage.gaussian_filter(road.astype(np.float32), 2.5)
    hs = ndimage.gaussian_filter(np.where(road, H, 0), 2.5) / np.maximum(wsum, 1e-3)
    newH = np.where(road, np.round(hs), world.H).astype(np.int16)
    # soften the edges: cells right next to a road blend towards it
    edge = ndimage.binary_dilation(road, iterations=2) & ~road & ~(world.wtop > world.H)
    near = ndimage.grey_dilation(np.where(road, newH, -9999), size=5)
    blend = np.where(edge, np.round((world.H.astype(np.float32) + near) / 2), newH).astype(np.int16)
    world.H[:] = np.where(edge & (np.abs(world.H - near) <= 3), blend, newH)
    for cls, (w, blk, pr) in ROAD_STYLE.items():
        sel = road & (allmask == pr + 1)
        if cls in roads_by_class:
            m = raster.lines(roads_by_class[cls], g, w).astype(bool) & sel
            world.top[m] = B(blk)
            world.sub[m] = B("stone") if blk != "dirt_path" else B("dirt")
    world.road |= road

    # centre line markings
    for cls in MARKED:
        for line in roads_by_class.get(cls, []):
            lb = raster.to_block_geom(line)
            xs, zs, d = _sample(lb, 0.5)
            dash = (d % 8) < 4
            ix = np.floor(xs[dash]).astype(int) - g.x0
            iz = np.floor(zs[dash]).astype(int) - g.z0
            ok = (ix >= 0) & (ix < g.nx) & (iz >= 0) & (iz < g.nz)
            ix, iz = ix[ok], iz[ok]
            onroad = road[iz, ix]
            world.top[iz[onroad], ix[onroad]] = B("white_concrete")

    # ---- bridges: decks interpolated between their ends
    nb = 0
    for cls, line in bridges:
        w = ROAD_STYLE[cls][0]
        lb = raster.to_block_geom(line)
        if lb.length < 2:
            continue
        xs, zs, d = _sample(lb, 0.5)
        h0 = float(world.surface(int(np.floor(xs[0])), int(np.floor(zs[0]))) - 1)
        h1 = float(world.surface(int(np.floor(xs[-1])), int(np.floor(zs[-1]))) - 1)
        deck = h0 + (h1 - h0) * d / max(d[-1], 1e-6)
        # overpasses: keep 6 blocks of headroom above any road passing underneath
        ix_ = np.clip(np.floor(xs).astype(int) - g.x0, 0, g.nx - 1)
        iz_ = np.clip(np.floor(zs).astype(int) - g.z0, 0, g.nz - 1)
        under = road[iz_, ix_] & (d > 4) & (d < d[-1] - 4)
        if under.any():
            need = world.H[iz_, ix_].astype(float) + 7
            need[~under] = -1e9
            k = int(np.argmax(need))
            ramp = need[k] - 0.12 * np.abs(d - d[k])
            deck = np.maximum(deck, ramp)
        deck = np.round(deck).astype(int)
        # perpendicular offsets
        dx, dz = np.gradient(xs), np.gradient(zs)
        nrm = np.hypot(dx, dz) + 1e-9
        px, pz = -dz / nrm, dx / nrm
        half = w / 2.0
        cells = {}
        for off in np.arange(-half, half + 0.01, 0.5):
            cx = np.floor(xs + px * off).astype(int)
            cz = np.floor(zs + pz * off).astype(int)
            rail = abs(off) > half - 0.6
            for x, z, y in zip(cx, cz, deck):
                k = (x, z)
                if k not in cells or (not rail and cells[k][1]):
                    cells[k] = (y, rail)
        for (x, z), (y, rail) in cells.items():
            if not g.inside(x, z):
                continue
            iz, ix = z - g.z0, x - g.x0
            if world.H[iz, ix] >= y - 1 and world.wtop[iz, ix] <= world.H[iz, ix]:
                world.H[iz, ix] = y
                world.top[iz, ix] = B(ROAD_STYLE[cls][1])
                world.road[iz, ix] = True
                continue
            world.edits.set(x, y, z, "smooth_stone" if w >= 4 else "spruce_planks")
            if rail:
                world.edits.set(x, y + 1, z, "stone_bricks" if w >= 4 else "spruce_fence")
            else:
                for yy in range(y + 1, y + 4):
                    world.edits.set(x, yy, z, "air")
            world.road[iz, ix] = True
        nb += 1

    # ---- tunnels (Citytunnel, Pfändertunnel, ...)
    ntun = 0
    for cls, line, a, b in tunnels:
        if _tunnel(world, cls, line, a, b):
            ntun += 1
    log(f"roads: {ntun} tunnels carved")

    # ---- railway
    nrail = _railway(world, rails, rail_bridges, log)
    _platforms(world)
    world.roads_by_class = roads_by_class
    return {"bridges": nb, "rail_cells": nrail, "tunnels": ntun}


def _tunnel(world: World, cls: str, line, a: float, b: float) -> bool:
    """Carve a road tunnel: floor interpolated between the portals, vaulted concrete tube with lights,
    portal walls where the tube enters the hill and retaining walls in the open approach cut."""
    g = world.grid
    full = raster.to_block_geom(line)
    L = full.length
    if L <= 0:
        return False
    da, db = a * L, b * L

    def road_y(dist):
        p = full.interpolate(min(max(dist, 0), L))
        x, z = int(np.floor(p.x)), int(np.floor(p.y))
        if not g.inside(x, z):
            return float(OUTSIDE_PORTAL_Y)
        return float(world.H[z - g.z0, x - g.x0])

    y0 = road_y(da - 12)
    y1 = road_y(db + 12)
    piece = ops.substring(full, da, db)
    if piece.length < 2:
        return False
    xs, zs, d = _sample(piece, 0.5)
    floor = np.round(y0 + (y1 - y0) * d / d[-1]).astype(int)
    w = ROAD_STYLE[cls][0]
    half = w / 2.0
    dx, dz = np.gradient(xs), np.gradient(zs)
    nrm = np.hypot(dx, dz) + 1e-9
    px, pz = -dz / nrm, dx / nrm
    ix = np.floor(xs).astype(int) - g.x0
    iz = np.floor(zs).astype(int) - g.z0
    inside = (ix >= 0) & (ix < g.nx) & (iz >= 0) & (iz < g.nz)
    if not inside.any():
        return False
    ground = np.where(inside, world.H[np.clip(iz, 0, g.nz - 1), np.clip(ix, 0, g.nx - 1)], -9999)
    covered = ground > floor + 8
    E = world.edits
    portals = set()
    if covered.any():
        idx = np.nonzero(covered & inside)[0]
        if idx.size:
            portals = {int(idx[0]), int(idx[-1])}
    for i in range(len(xs)):
        if not inside[i]:
            continue
        y = int(floor[i])
        if covered[i]:
            for o in np.arange(-half - 1.5, half + 1.51, 0.5):
                x = int(np.floor(xs[i] + px[i] * o))
                z = int(np.floor(zs[i] + pz[i] * o))
                ao = abs(o)
                ceil = y + 6 - int(round(2.0 * (min(ao, half) / half) ** 2))
                if ao <= half:
                    E.set(x, y, z, "white_concrete" if (abs(o) < 0.3 and int(d[i]) % 8 < 4) else "gray_concrete")
                    for yy in range(y + 1, ceil + 1):
                        E.set(x, yy, z, "air")
                    E.set(x, ceil + 1, z, "light_gray_concrete")
                    if abs(o) < 0.3 and int(d[i]) % 10 == 0:
                        E.set(x, ceil, z, "light[level=15]")
                        E.set(x, ceil + 1, z, "sea_lantern")
                else:
                    for yy in range(y, y + 7):
                        E.set(x, yy, z, "smooth_stone")
            if i in portals:  # portal wall across the opening
                for o in np.arange(-half - 5, half + 5.01, 0.5):
                    x = int(np.floor(xs[i] + px[i] * o))
                    z = int(np.floor(zs[i] + pz[i] * o))
                    top_ = max(int(world.h(x, z)), y + 9)
                    for yy in range(y, min(top_, y + 12) + 1):
                        opening = abs(o) <= half and yy <= y + 6 - int(round(2.0 * (abs(o) / half) ** 2))
                        if not opening:
                            E.set(x, yy, z, "light_gray_concrete" if abs(abs(o) - half) > 1 or yy > y + 6 else "white_concrete")
        elif ground[i] > y:
            # open approach cut with retaining walls
            for o in np.arange(-half - 1.5, half + 1.51, 0.5):
                x = int(np.floor(xs[i] + px[i] * o))
                z = int(np.floor(zs[i] + pz[i] * o))
                gtop = int(world.h(x, z))
                if abs(o) <= half:
                    E.set(x, y, z, "gray_concrete")
                    for yy in range(y + 1, max(gtop, y) + 1):
                        E.set(x, yy, z, "air")
                else:
                    for yy in range(y, gtop + 1):
                        E.set(x, yy, z, "smooth_stone")
    return True


def _railway(world: World, rails, rail_bridges, log) -> int:
    g = world.grid
    if not rails and not rail_bridges:
        return 0
    bed = raster.lines([shapely.transform(l, lambda c: np.column_stack(geo.to_lonlat(c[:, 0], c[:, 1]))) for l in rails],
                       g, 4).astype(bool) & ~(world.wtop > world.H)
    H = world.H.astype(np.float32)
    wsum = ndimage.gaussian_filter(bed.astype(np.float32), 6)
    hs = ndimage.gaussian_filter(np.where(bed, H, 0), 6) / np.maximum(wsum, 1e-3)
    world.H[:] = np.where(bed, np.round(hs), world.H).astype(np.int16)
    world.top[bed] = B("gravel")
    world.sub[bed] = B("gravel")
    world.road |= bed
    cells: dict[tuple[int, int], int] = {}
    for line in rails:
        for x, z in _cells4(line):
            if g.inside(x, z):
                cells[(x, z)] = int(world.h(x, z)) + 1
    for line in rail_bridges:  # rail bridges: deck between the ends
        path = _cells4(line)
        if not path:
            continue
        a = float(world.surface(*path[0]) - 1)
        b = float(world.surface(*path[-1]) - 1)
        n_ = len(path)
        lin = np.array([a + (b - a) * i / max(n_ - 1, 1) for i in range(n_)])
        # rail over road: at least 6 blocks of headroom (ramps at 12 %)
        under = np.array([g.inside(x, z) and world.road[z - g.z0, x - g.x0] and not bed[z - g.z0, x - g.x0]
                          and 4 < i < n_ - 4 for i, (x, z) in enumerate(path)])
        if under.any():
            need = np.array([float(world.h(x, z)) + 7 for x, z in path])
            need[~under] = -1e9
            k = int(np.argmax(need))
            lin = np.maximum(lin, need[k] - 0.12 * np.abs(np.arange(n_) - k))
        for i, (x, z) in enumerate(path):
            y = int(round(lin[i]))
            if not g.inside(x, z):
                continue
            for o in (-1, 0, 1):
                for ox, oz in ((o, 0), (0, o)):
                    if world.h(x + ox, z + oz) < y:
                        world.edits.set(x + ox, y, z + oz, "stone_bricks")
            cells[(x, z)] = y + 1
    # smooth heights so that neighbours differ by at most one block
    for _ in range(4):
        for (x, z), y in list(cells.items()):
            for nx, nz in ((x + 1, z), (x - 1, z), (x, z + 1), (x, z - 1)):
                ny = cells.get((nx, nz))
                if ny is not None and ny - y > 1:
                    cells[(nx, nz)] = y + 1
    dirs = {"north": (0, -1), "south": (0, 1), "east": (1, 0), "west": (-1, 0)}
    for (x, z), y in cells.items():
        nb = [d for d, (dx, dz) in dirs.items() if (x + dx, z + dz) in cells]
        s = set(nb)
        if {"north", "south"} <= s:
            shape = "north_south"
        elif {"east", "west"} <= s:
            shape = "east_west"
        elif len(s) >= 2:
            a, b = sorted(s, key=["north", "south", "east", "west"].index)[:2]
            shape = f"{a}_{b}" if a in ("north", "south") and b in ("east", "west") else "north_south"
        elif s & {"east", "west"}:
            shape = "east_west"
        else:
            shape = "north_south"
        if shape in ("north_south", "east_west"):
            for d in (("north", "south") if shape == "north_south" else ("east", "west")):
                dx, dz = dirs[d]
                if cells.get((x + dx, z + dz), y) == y + 1:
                    shape = f"ascending_{d}"
                    break
        # ballast; on bridges (nothing below) gravel would fall, so use stone bricks
        world.edits.set(x, y - 1, z, "gravel" if int(world.h(x, z)) >= y - 2 else "stone_bricks")
        world.edits.set(x, y, z, f"rail[shape={shape}]")
        world.edits.set(x, y + 1, z, "air")
        world.edits.set(x, y + 2, z, "air")
    log(f"roads: {len(cells)} rail blocks")
    return len(cells)


def _platforms(world: World) -> None:
    g = world.grid
    for r in data.overture("infrastructure"):
        if r["class"] != "platform":
            continue
        geom = r["geom"]
        if geom.geom_type in ("LineString", "MultiLineString"):
            m = raster.lines([geom], g, 3).astype(bool)
        elif geom.geom_type in ("Polygon", "MultiPolygon"):
            m = raster.polygons([geom], g).astype(bool)
        else:
            continue
        iz, ix = np.nonzero(m)
        for z, x in zip(iz + g.z0, ix + g.x0):
            h = int(world.h(x, z))
            world.edits.set(int(x), h + 1, int(z), "smooth_stone")
        world.occupied |= m


def _street_lamp(world: World, x: int, z: int) -> None:
    h = int(world.h(x, z))
    for y in range(h + 1, h + 4):
        world.edits.set(x, y, z, "dark_oak_fence")
    world.edits.set(x, h + 4, z, "lantern")


def street_lamps(world: World) -> int:
    """Lamp posts from OSM plus one every ~28 blocks along town streets (run after buildings)."""
    roads_by_class = world.roads_by_class
    g = world.grid
    placed = 0
    for r in data.overture("infrastructure"):
        if r["class"] == "street_lamp" and r["geom"].geom_type == "Point":
            x, z = geo.to_block(r["geom"].x, r["geom"].y)
            x, z = int(np.floor(x)), int(np.floor(z))
            if g.inside(x, z) and not world.road[z - g.z0, x - g.x0] and not world.occupied[z - g.z0, x - g.x0]:
                _street_lamp(world, x, z)
                placed += 1
    for cls in ("primary", "secondary", "tertiary", "residential", "pedestrian", "living_street"):
        w = ROAD_STYLE[cls][0]
        for line in roads_by_class.get(cls, []):
            lb = raster.to_block_geom(line)
            if lb.length < 20:
                continue
            xs, zs, d = _sample(lb, 1.0)
            dx, dz = np.gradient(xs), np.gradient(zs)
            nrm = np.hypot(dx, dz) + 1e-9
            for i in range(10, len(xs), 28):
                off = w / 2 + 1.0
                x = int(np.floor(xs[i] - dz[i] / nrm[i] * off))
                z = int(np.floor(zs[i] + dx[i] / nrm[i] * off))
                if not g.inside(x, z):
                    continue
                iz, ix = z - g.z0, x - g.x0
                if world.road[iz, ix] or world.occupied[iz, ix] or world.wtop[iz, ix] > world.H[iz, ix]:
                    continue
                _street_lamp(world, x, z)
                world.occupied[iz, ix] = True
                placed += 1
    return placed
