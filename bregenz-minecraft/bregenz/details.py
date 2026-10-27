"""Street furniture and small details from OpenStreetMap: benches, bins, bus shelters, fountains,
hedges, walls, fences, zebra crossings, bollards, traffic lights, power pylons with lines,
railway catenary masts, sports pitches with lines and goals, playgrounds and bike racks."""
from __future__ import annotations

import math

import numpy as np
import shapely
from scipy import ndimage

from . import data, geo, raster
from .blocks import B
from .world import World

DIRS = {"north": (0, -1), "south": (0, 1), "east": (1, 0), "west": (-1, 0)}


def _pt(r):
    x, z = geo.to_block(r["geom"].x, r["geom"].y)
    return int(math.floor(float(x))), int(math.floor(float(z)))


def _free(world: World, x, z, allow_road=False) -> bool:
    g = world.grid
    if not g.inside(x, z):
        return False
    iz, ix = z - g.z0, x - g.x0
    if world.occupied[iz, ix] or world.wtop[iz, ix] > world.H[iz, ix]:
        return False
    return allow_road or not world.road[iz, ix]


def _claim(world: World, x, z) -> None:
    g = world.grid
    if g.inside(x, z):
        world.occupied[z - g.z0, x - g.x0] = True


def _towards_road(world: World, x, z) -> str:
    """Compass direction from (x, z) towards the nearest road (via the distance field gradient)."""
    g = world.grid
    d = world.dist_road
    best, bd = "north", 1e9
    for name, (dx, dz) in DIRS.items():
        px, pz = x + dx * 2, z + dz * 2
        if g.inside(px, pz):
            v = d[pz - g.z0, px - g.x0]
            if v < bd:
                best, bd = name, v
    return best


OPP = {"north": "south", "south": "north", "east": "west", "west": "east"}


def _connected(world: World, cells: set, block: str, y_of, height=1) -> None:
    """Place fence-like blocks with correct north/south/east/west connections."""
    for (x, z) in cells:
        props = ",".join(f"{d}={str((x + dx, z + dz) in cells).lower()}" for d, (dx, dz) in DIRS.items())
        y = y_of(x, z)
        for k in range(height):
            world.edits.set(x, y + k, z, f"{block}[{props}]")
        _claim(world, x, z)


def _line_cells(geom_block) -> set:
    out = set()
    parts = geom_block.geoms if hasattr(geom_block, "geoms") else [geom_block]
    for line in parts:
        if line.geom_type == "Polygon":
            line = line.exterior
        if line.length < 1:
            continue
        prev = None
        for dist in np.arange(0, line.length + 0.01, 0.3):
            p = line.interpolate(dist)
            c = (int(math.floor(p.x)), int(math.floor(p.y)))
            if prev is not None and c[0] != prev[0] and c[1] != prev[1]:
                out.add((c[0], prev[1]))  # keep it 4-connected
            out.add(c)
            prev = c
    return out


def build(world: World, log=print) -> dict:
    g = world.grid
    E = world.edits
    stats = {k: 0 for k in ("benches", "bins", "bus_shelters", "fountains", "hedges", "walls", "fences", "crossings",
                            "bollards", "signals", "pylons", "masts", "pitches", "playgrounds", "bike_racks")}
    surf = lambda x, z: int(world.surface(x, z))  # noqa: E731
    # points first (pylons must exist before their power lines are strung)
    infra = sorted(data.overture("infrastructure"), key=lambda r: r["geom"].geom_type != "Point")

    for r in infra:
        cls = r["class"]
        geom = r["geom"]
        if geom.geom_type == "Point":
            x, z = _pt(r)
            if cls == "bench" and _free(world, x, z):
                face = _towards_road(world, x, z)
                E.set(x, surf(x, z), z, f"spruce_stairs[facing={OPP[face]},half=bottom]")
                _claim(world, x, z)
                stats["benches"] += 1
            elif cls in ("waste_basket", "recycling") and _free(world, x, z):
                E.set(x, surf(x, z), z, "cauldron" if cls == "waste_basket" else "green_concrete")
                _claim(world, x, z)
                stats["bins"] += 1
            elif cls == "bus_stop" and _free(world, x, z):
                if _bus_shelter(world, x, z):
                    stats["bus_shelters"] += 1
            elif cls in ("fountain", "drinking_water") and _free(world, x, z):
                _fountain(world, x, z, big=(cls == "fountain"))
                stats["fountains"] += 1
            elif cls == "bollard" and _free(world, x, z, allow_road=True):
                E.set(x, surf(x, z), z, "andesite_wall")
                stats["bollards"] += 1
            elif cls == "traffic_signals":
                spot = _edge_spot(world, x, z)
                if spot:
                    sx, sz = spot
                    y = surf(sx, sz)
                    for k in range(4):
                        E.set(sx, y + k, sz, "iron_bars")
                    E.set(sx, y + 4, sz, "black_concrete")
                    E.set(sx, y + 5, sz, "black_concrete")
                    _claim(world, sx, sz)
                    stats["signals"] += 1
            elif cls == "crossing":
                if _zebra(world, x, z):
                    stats["crossings"] += 1
            elif cls == "power_tower" and g.inside(x, z):
                _power_pylon(world, x, z)
                stats["pylons"] += 1
            elif cls == "catenary_mast" and _free(world, x, z, allow_road=True):
                y = surf(x, z)
                for k in range(7):
                    E.set(x, y + k, z, "iron_bars")
                E.set(x, y + 7, z, "polished_blackstone")
                stats["masts"] += 1
            elif cls == "bicycle_parking" and _free(world, x, z):
                for k in range(-2, 3):
                    if _free(world, x + k, z):
                        E.set(x + k, surf(x + k, z), z, "iron_bars[north=true,south=true]")
                stats["bike_racks"] += 1
        else:
            gb = raster.to_block_geom(geom)
            if cls == "hedge":
                cells = _line_cells(gb) if geom.geom_type != "Polygon" else _poly_cells(gb)
                for (x, z) in cells:
                    if _free(world, x, z):
                        y = surf(x, z)
                        E.set(x, y, z, "oak_leaves[persistent=true]")
                        E.set(x, y + 1, z, "oak_leaves[persistent=true]")
                        _claim(world, x, z)
                stats["hedges"] += 1
            elif cls in ("wall", "retaining_wall") and geom.geom_type == "LineString":
                for (x, z) in _line_cells(gb):
                    if _free(world, x, z):
                        y = surf(x, z)
                        E.set(x, y, z, "stone_bricks" if cls == "wall" else "andesite")
                        E.set(x, y + 1, z, "stone_brick_slab[type=bottom]")
                        _claim(world, x, z)
                stats["walls"] += 1
            elif cls == "fence" and geom.geom_type == "LineString":
                cells = {c for c in _line_cells(gb) if _free(world, *c)}
                _connected(world, cells, "spruce_fence", surf)
                stats["fences"] += 1
            elif cls == "power_line":
                _power_line(world, gb)

    for r in data.overture("land_use"):
        if r["class"] in ("pitch",):
            if _pitch(world, raster.to_block_geom(r["geom"])):
                stats["pitches"] += 1
        elif r["class"] == "playground":
            if _playground(world, raster.to_block_geom(r["geom"])):
                stats["playgrounds"] += 1
    log("details: " + ", ".join(f"{v} {k}" for k, v in stats.items()))
    return {"details": stats}


def _poly_cells(gb) -> set:
    m, x0, z0 = raster.polygon_cells(gb)
    zz, xx = np.nonzero(m)
    return {(int(x + x0), int(z + z0)) for x, z in zip(xx, zz)}


def _edge_spot(world: World, x, z):
    """A free cell right next to a road near (x, z) (for poles that OSM places on the road)."""
    for rad in range(0, 8):
        for dx in range(-rad, rad + 1):
            for dz in (-rad, rad):
                for px, pz in ((x + dx, z + dz), (x + dz, z + dx)):
                    if _free(world, px, pz):
                        return px, pz
    return None


def _bus_shelter(world: World, x, z) -> bool:
    face = _towards_road(world, x, z)
    fx, fz = DIRS[face]
    ax, az = -fz, fx  # along the road
    cells = [(x + ax * k + fx * j, z + az * k + fz * j) for k in (-1, 0, 1) for j in (-1, 0)]
    if not all(_free(world, cx, cz) for cx, cz in cells):
        return False
    y = max(int(world.surface(cx, cz)) for cx, cz in cells)
    E = world.edits
    for k in (-1, 0, 1):
        bx, bz = x + ax * k - fx, z + az * k - fz  # back wall (away from the road)
        for yy in (y, y + 1, y + 2):
            E.set(bx, yy, bz, "light_blue_stained_glass" if yy > y else "iron_bars")
        E.set(x + ax * k, y, z + az * k, "air")
    for cx, cz in cells:
        E.set(cx, y + 3, cz, "smooth_stone_slab[type=bottom]")
        _claim(world, cx, cz)
    E.set(x, y, z, f"spruce_stairs[facing={OPP[face]},half=bottom]")
    E.set(x + ax, y, z + az, f"spruce_stairs[facing={OPP[face]},half=bottom]")
    E.set(x - ax, y + 2, z - az, "lantern[hanging=true]")
    return True


def _fountain(world: World, x, z, big: bool) -> None:
    E = world.edits
    r = 2 if big else 0
    y = int(world.surface(x, z))
    if r == 0:
        E.set(x, y, z, "stone_brick_wall")
        E.set(x, y + 1, z, "water_cauldron[level=3]")
        _claim(world, x, z)
        return
    for dx in range(-r, r + 1):
        for dz in range(-r, r + 1):
            edge = max(abs(dx), abs(dz)) == r
            E.set(x + dx, y - 1, z + dz, "stone_bricks")
            E.set(x + dx, y, z + dz, "stone_brick_slab[type=bottom]" if edge else "water")
            _claim(world, x + dx, z + dz)
    E.set(x, y, z, "chiseled_stone_bricks")
    E.set(x, y + 1, z, "stone_brick_wall")
    E.set(x, y + 2, z, "lantern")


def _zebra(world: World, x, z) -> bool:
    g = world.grid
    if not g.inside(x, z) or not world.road[z - g.z0, x - g.x0]:
        return False
    # road axis from the local road mask (principal direction of nearby road cells)
    r = 6
    sub = world.road[max(z - r - g.z0, 0):z + r + 1 - g.z0, max(x - r - g.x0, 0):x + r + 1 - g.x0]
    zz, xx = np.nonzero(sub)
    if len(xx) < 6:
        return False
    pts = np.column_stack([xx, zz]).astype(float)
    pts -= pts.mean(axis=0)
    _, _, vt = np.linalg.svd(pts, full_matrices=False)
    t = vt[0]          # along the road
    n = np.array([-t[1], t[0]])
    WHITE, GREY = B("white_concrete"), B("gray_concrete")
    for o in np.arange(-6, 6.01, 0.5):
        for a in np.arange(-1.5, 1.51, 0.5):
            px = int(math.floor(x + n[0] * o + t[0] * a))
            pz = int(math.floor(z + n[1] * o + t[1] * a))
            if g.inside(px, pz) and world.road[pz - g.z0, px - g.x0] and world.top[pz - g.z0, px - g.x0] in (WHITE, GREY):
                world.top[pz - g.z0, px - g.x0] = WHITE if int(math.floor(o)) % 2 == 0 else GREY
    return True


def _power_pylon(world: World, x, z) -> None:
    """High-voltage lattice pylon (~30 m)."""
    E = world.edits
    y0 = int(world.h(x, z)) + 1
    top = y0 + 30
    for sx in (-1, 1):
        for sz in (-1, 1):
            for k in range(0, 31):
                f = k / 30
                w = 3 * (1 - f) + 0.6 * f
                px = int(round(x + sx * w))
                pz = int(round(z + sz * w))
                E.set(px, y0 + k, pz, "iron_bars")
    for k in (10, 18, 24):
        for d in range(-6, 7):
            E.set(x + d, y0 + k, z, "iron_bars[east=true,west=true]")
    E.set(x, top + 1, z, "iron_bars")
    world.pylon_tops = getattr(world, "pylon_tops", {})
    world.pylon_tops[(x, z)] = y0 + 24
    _claim(world, x, z)


def _power_line(world: World, gb) -> None:
    """Conductors between consecutive pylons, with sag."""
    coords = np.asarray(gb.coords) if gb.geom_type == "LineString" else None
    if coords is None or len(coords) < 2:
        return
    tops = getattr(world, "pylon_tops", {})
    g = world.grid
    for (x0, z0), (x1, z1) in zip(coords[:-1], coords[1:]):
        def top_at(x, z):
            best = None
            for (px, pz), y in tops.items():
                if abs(px - x) < 4 and abs(pz - z) < 4:
                    best = y
            if best is None and g.inside(int(x), int(z)):
                best = int(world.h(int(x), int(z))) + 24
            return best
        ya, yb = top_at(x0, z0), top_at(x1, z1)
        if ya is None or yb is None:
            continue
        L = math.hypot(x1 - x0, z1 - z0)
        axis = "x" if abs(x1 - x0) >= abs(z1 - z0) else "z"
        for t in np.linspace(0, 1, int(L) + 1):
            x = x0 + (x1 - x0) * t
            z = z0 + (z1 - z0) * t
            y = int(round(ya + (yb - ya) * t - L * 0.03 * 4 * t * (1 - t) / 4))
            for off in (-5, 5):
                px = int(math.floor(x + (0 if axis == "x" else off)))
                pz = int(math.floor(z + (off if axis == "x" else 0)))
                if g.inside(px, pz) and world.h(px, pz) < y - 3:
                    world.edits.set(px, y, pz, f"chain[axis={axis}]")


def _pitch(world: World, gb) -> bool:
    if gb.geom_type != "Polygon" or gb.area < 300:
        return False
    g = world.grid
    m, x0, z0 = raster.polygon_cells(gb)
    per = m & ~ndimage.binary_erosion(m, structure=np.ones((3, 3)))
    zz, xx = np.nonzero(m)
    X, Z = xx + x0, zz + z0
    ok = g.inside(X, Z)
    if ok.mean() < 0.9:
        return False
    X, Z = X[ok], Z[ok]
    if world.wtop[Z - g.z0, X - g.x0].max() > world.H[Z - g.z0, X - g.x0].min() + 50:
        return False
    # flat green turf
    h = int(np.median(world.H[Z - g.z0, X - g.x0]))
    world.H[Z - g.z0, X - g.x0] = h
    world.top[Z - g.z0, X - g.x0] = B("grass_block")
    world.occupied[Z - g.z0, X - g.x0] = True
    pz_, px_ = np.nonzero(per)
    world.top[pz_ + z0 - g.z0, px_ + x0 - g.x0] = B("white_concrete")
    long_v, hs, hl = _axes(gb)
    c = np.asarray(gb.centroid.coords[0])
    n = np.array([-long_v[1], long_v[0]])
    for o in np.arange(-hs, hs + 0.01, 0.5):  # halfway line + centre circle
        p = c + n * o
        if g.inside(int(p[0]), int(p[1])):
            world.top[int(p[1]) - g.z0, int(p[0]) - g.x0] = B("white_concrete")
    for ang in np.linspace(0, 2 * np.pi, 60):
        p = c + 6 * np.array([math.cos(ang), math.sin(ang)])
        if g.inside(int(p[0]), int(p[1])):
            world.top[int(p[1]) - g.z0, int(p[0]) - g.x0] = B("white_concrete")
    # goals at both ends
    for side in (-1, 1):
        gc = c + long_v * side * (hl - 1.5)
        for o in (-3, 3):
            p = gc + n * o
            x, z = int(p[0]), int(p[1])
            world.edits.set(x, h + 1, z, "white_concrete")
            world.edits.set(x, h + 2, z, "white_concrete")
        for o in np.arange(-3, 3.01, 0.5):
            p = gc + n * o
            world.edits.set(int(p[0]), h + 3, int(p[1]), "white_concrete")
    return True


def _axes(gb):
    rect = np.asarray(gb.minimum_rotated_rectangle.exterior.coords)[:4]
    e1, e2 = rect[1] - rect[0], rect[2] - rect[1]
    l1, l2 = np.hypot(*e1), np.hypot(*e2)
    long_v = e1 / l1 if l1 >= l2 else e2 / l2
    return long_v, min(l1, l2) / 2, max(l1, l2) / 2


def _playground(world: World, gb) -> bool:
    if gb.geom_type != "Polygon" or gb.area < 40:
        return False
    g = world.grid
    cells = [c for c in _poly_cells(gb) if g.inside(*c)]
    if not cells:
        return False
    for x, z in cells:
        if not world.occupied[z - g.z0, x - g.x0] and not world.road[z - g.z0, x - g.x0]:
            world.top[z - g.z0, x - g.x0] = B("sand")
    c = gb.centroid
    x, z = int(c.x), int(c.y)
    if not _free(world, x, z):
        return True
    y = int(world.surface(x, z))
    E = world.edits
    # swing: two A-posts, beam, chains, seats
    for dx in (-2, 2):
        for k in range(4):
            E.set(x + dx, y + k, z, "spruce_fence")
    for dx in range(-2, 3):
        E.set(x + dx, y + 4, z, "spruce_slab[type=bottom]")
    for dx in (-1, 1):
        E.set(x + dx, y + 3, z, "chain")
        E.set(x + dx, y + 2, z, "chain")
        E.set(x + dx, y + 1, z, "spruce_trapdoor[half=bottom]")
    # slide
    sx, sz = x + 5, z
    for k in range(3):
        E.set(sx, y + k, sz - 3, "ladder[facing=south]")
        E.set(sx, y + k, sz - 4, "spruce_planks")
    E.set(sx, y + 3, sz - 3, "spruce_slab[type=bottom]")
    for k in range(3):
        E.set(sx, y + 2 - k, sz - 2 + k, "smooth_quartz_stairs[facing=north,half=bottom]")
    for (cx, cz) in [(x + d, z) for d in range(-3, 4)] + [(sx, sz - k) for k in range(-1, 5)]:
        _claim(world, cx, cz)
    return True
