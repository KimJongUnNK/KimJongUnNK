"""Hafen Bregenz: passenger ships at the landing piers, boats in the marinas and the
twin steel harbour lights at the mole heads."""
from __future__ import annotations

import math

import numpy as np
import shapely

from . import config, data, raster
from .blocks import B
from .world import World

WL = config.WATER_LEVEL


def _water_ok(world: World, cells, min_depth=2) -> bool:
    g = world.grid
    for x, z in cells:
        if not g.inside(x, z):
            return False
        iz, ix = z - g.z0, x - g.x0
        if world.occupied[iz, ix] or world.wtop[iz, ix] != WL or WL - world.H[iz, ix] < min_depth:
            return False
    return True


def _occupy(world: World, cells) -> None:
    g = world.grid
    for x, z in cells:
        if g.inside(x, z):
            world.occupied[z - g.z0, x - g.x0] = True


def _footprint(c, u, length, width, bow=8.0):
    """Cells of a boat hull centred at c, long axis u. Returns list of (x, z, s, t)."""
    n = np.array([-u[1], u[0]])
    out = {}
    for s in np.arange(-length / 2, length / 2 + 0.01, 0.5):
        # pointed bow at +s, rounded stern
        rem = length / 2 - s
        half = width / 2 * (min(1.0, rem / bow) ** 0.6 if rem < bow else 1.0)
        for t in np.arange(-half, half + 0.01, 0.5):
            p = c + u * s + n * t
            k = (int(math.floor(p[0])), int(math.floor(p[1])))
            out[k] = (s, t, half)
    return [(x, z, s, t, h) for (x, z), (s, t, h) in out.items()]


def ship(world: World, c, u, length=46, width=9, kind="classic", name="") -> list:
    fp = _footprint(np.asarray(c, float), np.asarray(u, float), length, width, bow=10)
    hull = "white_concrete"
    for x, z, s, t, half in fp:
        edge = abs(t) > half - 1.0
        rel = s + length / 2  # 0 at stern
        for y in range(WL - 2, WL + 1):
            world.edits.set(x, y, z, hull)
        world.edits.set(x, WL + 1, z, ("red_concrete" if kind == "classic" else "black_concrete") if edge else "spruce_planks")
        if kind == "classic":
            cab = abs(t) < half - 1.5 and 4 < rel < length - 9
            up = abs(t) < half - 2.5 and 8 < rel < length - 14
            if edge:
                world.edits.set(x, WL + 2, z, "white_concrete")
            if cab:
                win = "light_blue_stained_glass" if (abs(t) > half - 2.6 and int(rel) % 3) else "white_concrete"
                world.edits.set(x, WL + 2, z, win)
                world.edits.set(x, WL + 3, z, win)
                world.edits.set(x, WL + 4, z, "green_concrete")
            if up:
                world.edits.set(x, WL + 5, z, "light_blue_stained_glass" if abs(t) > half - 3.6 else "white_concrete")
                world.edits.set(x, WL + 6, z, "green_concrete")
        else:  # Sonnenkönigin: sleek silver / black glass
            cab = abs(t) < half - 1.0 and 3 < rel < length - 6
            up = abs(t) < half - 2.0 and 7 < rel < length - 12
            if edge:
                world.edits.set(x, WL + 2, z, "light_gray_concrete")
            if cab:
                for y in (WL + 2, WL + 3):
                    world.edits.set(x, y, z, "black_stained_glass" if abs(t) > half - 2.1 else "light_gray_concrete")
                world.edits.set(x, WL + 4, z, "iron_block" if abs(t) > half - 2.1 else "light_gray_concrete")
            if up:
                world.edits.set(x, WL + 5, z, "black_stained_glass" if abs(t) > half - 3.1 else "light_gray_concrete")
                world.edits.set(x, WL + 6, z, "white_concrete")
    # mast / funnel
    cu = np.asarray(c, float) + np.asarray(u, float) * (length * 0.1)
    mx, mz = int(math.floor(cu[0])), int(math.floor(cu[1]))
    top = WL + (7 if kind == "classic" else 7)
    for y in range(top, top + 5):
        world.edits.set(mx, y, mz, "iron_bars" if kind == "classic" else "white_concrete")
    world.edits.set(mx, top + 5, mz, "lantern")
    # Austrian flag at the stern
    st = np.asarray(c, float) - np.asarray(u, float) * (length / 2 - 1)
    sx, sz = int(math.floor(st[0])), int(math.floor(st[1]))
    world.edits.set(sx, WL + 2, sz, "white_concrete")
    for y in range(WL + 3, WL + 6):
        world.edits.set(sx, y, sz, "iron_bars")
    world.edits.set(sx, WL + 6, sz, "red_wool")
    world.edits.set(sx, WL + 7, sz, "white_wool")
    world.edits.set(sx, WL + 8, sz, "red_wool")
    cells = [(x, z) for x, z, *_ in fp]
    _occupy(world, cells)
    return cells


def small_boat(world: World, c, u, kind: int) -> bool:
    fp = _footprint(np.asarray(c, float), np.asarray(u, float), 7, 3, bow=3)
    cells = [(x, z) for x, z, *_ in fp]
    if not _water_ok(world, cells, 1):
        return False
    hull = ["white_concrete", "white_concrete", "light_blue_concrete", "blue_concrete"][kind % 4]
    for x, z, s, t, half in fp:
        world.edits.set(x, WL, z, hull)
        world.edits.set(x, WL + 1, z, "spruce_slab[type=bottom]" if abs(t) < half - 0.6 else "white_concrete")
    mid = np.asarray(c, float)
    mx, mz = int(math.floor(mid[0])), int(math.floor(mid[1]))
    if kind % 2 == 0:  # sailboat: tall white mast
        for y in range(WL + 2, WL + 11):
            world.edits.set(mx, y, mz, "end_rod[facing=up]")
    else:  # motorboat: little cabin
        world.edits.set(mx, WL + 2, mz, "white_stained_glass")
        world.edits.set(mx, WL + 3, mz, "white_concrete")
    _occupy(world, cells)
    return True


def harbour_light(world: World, x: int, z: int, axis=(1, 0)) -> None:
    """The twin steel columns with a light on top, like at the Bregenz mole heads."""
    y0 = int(world.surface(x, z))
    for k in (-1, 1):
        px, pz = x + axis[0] * k, z + axis[1] * k
        hh = int(world.h(px, pz))
        for y in range(min(hh + 1, y0), y0 + 18):
            world.edits.set(px, y, pz, "iron_block")
    world.edits.set(x, y0 + 17, z, "iron_block")
    world.edits.set(x, y0 + 16, z, "sea_lantern")
    world.edits.set(x, y0 + 18, z, "lightning_rod")
    _occupy(world, [(x, z), (x + axis[0], z + axis[1]), (x - axis[0], z - axis[1])])


def build(world: World, log=print) -> dict:
    g = world.grid
    marinas = [raster.to_block_geom(r["geom"]) for r in data.overture("land_use") if r["class"] == "marina"]
    harbours = [raster.to_block_geom(r["geom"]) for r in data.overture("water")
                if r["name"] == "Hafen Bregenz" and r["geom"].geom_type in ("Polygon", "MultiPolygon")]
    piers = []
    for r in data.overture("infrastructure"):
        if r["class"] == "pier" and r["name"] not in ("Seebühne Bregenz", "Fischersteg"):
            gb = raster.to_block_geom(r["geom"])
            for part in getattr(gb, "geoms", [gb]):
                if part.geom_type in ("Polygon", "LineString") and not part.is_empty:
                    piers.append(part)

    # ---- the wide paved quay between harbour basin and railway (Hafenpromenade)
    paved = 0
    if harbours:
        from scipy import ndimage as ndi
        hm = raster.polygons([r["geom"] for r in data.overture("water") if r["name"] == "Hafen Bregenz"
                              and r["geom"].geom_type in ("Polygon", "MultiPolygon")], g).astype(bool)
        d = ndi.distance_transform_edt(~hm)
        quay = (d > 0) & (d <= 30) & ~world.occupied & ~world.road & (world.wtop <= world.H) & ~world.forest_mask
        zz, xx = np.nonzero(quay)
        pat = np.where(((xx // 3) + (zz // 3)) % 2 == 0, B("smooth_stone"), B("polished_andesite")).astype(np.uint16)
        world.top[zz, xx] = pat
        world.sub[zz, xx] = B("stone")
        world.park_mask[zz, xx] = False
        world.meadow_mask[zz, xx] = False
        paved = int(zz.size)

    # ---- passenger ships along the long landing piers in the main harbour basin
    ships = 0
    kinds = ["classic", "classic", "modern", "classic"]
    if harbours:
        basin = harbours[0].buffer(30)
        landing = [p for p in piers if p.within(basin) and p.geom_type == "Polygon"]
        landing.sort(key=lambda p: -p.minimum_rotated_rectangle.length)
        for p in landing:
            if ships >= 4:
                break
            rect = np.asarray(p.minimum_rotated_rectangle.exterior.coords)[:4]
            e1, e2 = rect[1] - rect[0], rect[2] - rect[1]
            u = e1 if np.hypot(*e1) >= np.hypot(*e2) else e2
            plen = float(np.hypot(*u))
            pwid = float(min(np.hypot(*e1), np.hypot(*e2)))
            if plen < 35:
                continue
            u = u / plen
            n = np.array([-u[1], u[0]])
            c = np.asarray(p.centroid.coords[0])
            length = min(48.0, plen - 4)
            for side in (1, -1):
                if ships >= 4:
                    break
                for extra in (0.5, 1.5, 2.5):
                    cc = c + n * side * (pwid / 2 + 4.5 + extra)
                    fp = _footprint(cc, u, length, 9, bow=10)
                    if _water_ok(world, [(x, z) for x, z, *_ in fp]):
                        ship(world, cc, u, length, 9, kinds[ships])
                        ships += 1
                        break

    # ---- small boats at the finger piers of the marinas
    boats = 0
    marina_u = shapely.union_all(marinas) if marinas else None
    if marina_u is not None:
        k = 0
        inner = marina_u.buffer(-2)
        for p in piers:
            if not p.intersects(marina_u) or (p.geom_type == "Polygon" and p.area > 300):
                continue
            line = p if p.geom_type == "LineString" else p.minimum_rotated_rectangle.exterior
            if line.length < 6:
                continue
            coords = np.asarray(line.coords)
            for a, b in zip(coords[:-1], coords[1:]):
                seg = b - a
                L = float(np.hypot(*seg))
                if L < 6:
                    continue
                u = seg / L
                n = np.array([-u[1], u[0]])
                for s in np.arange(3, L - 2, 4.0):
                    base = a + u * s
                    for side in (1, -1):
                        k += 1
                        if (k * 2654435761) % 100 < 40:  # leave some berths empty
                            continue
                        bc = base + n * side * 5.5
                        if not inner.contains(shapely.Point(bc)):
                            continue
                        if small_boat(world, bc, n * side, k):
                            boats += 1

    # ---- twin harbour lights: tip of the mole and end of the marina breakwater
    lights = 0
    box = shapely.box(-120, -460, 40, -140)
    land = []
    for z in range(-460, -140):
        for x in range(-120, 40):
            if g.inside(x, z) and not world.is_water(x, z):
                land.append((z, x))
                break
        if land:
            break
    if land:
        z, x = land[0]
        harbour_light(world, x, z + 1, (1, 0))
        lights += 1
    bw = [p for p in piers if p.geom_type == "Polygon" and p.area > 600 and marina_u is not None and p.intersects(marina_u)]
    for p in bw[:1]:
        pts = np.asarray(p.exterior.coords)
        i = int(np.argmin(pts[:, 0]))
        harbour_light(world, int(pts[i, 0]) + 2, int(pts[i, 1]) + 1, (0, 1))
        lights += 1
    log(f"harbour: {ships} ships, {boats} boats, {lights} harbour lights, {paved} m2 quay paved")
    return {"ships": ships, "boats": boats, "harbour_lights": lights, "quay_m2": paved}
