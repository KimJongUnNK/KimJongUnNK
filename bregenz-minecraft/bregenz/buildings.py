"""Generic buildings from the real footprints (Overture / OpenStreetMap).

Every footprint becomes a hollow building: foundation on the slope, one floor
every 3 blocks, window bands, a door towards the nearest street, invisible
light blocks inside (no mob spawning) and a hipped, gabled or flat roof.
A `style` dict can override every decision (used for landmarks).
"""
from __future__ import annotations

import math
import zlib

import numpy as np
from scipy import ndimage

from . import config, data, raster
from .blocks import B
from .vox import Vox
from .world import World

FACADES_TOWN = [("white_terracotta", 4), ("white_concrete", 3), ("smooth_sandstone", 3), ("calcite", 2),
                ("light_gray_concrete", 1), ("yellow_terracotta", 1), ("smooth_quartz", 1)]
FACADES_RURAL = [("white_terracotta", 3), ("white_concrete", 2), ("spruce_planks", 3), ("stripped_spruce_log[axis=y]", 1),
                 ("smooth_sandstone", 1)]
FACADES_WORK = [("light_gray_concrete", 3), ("smooth_stone", 2), ("gray_concrete", 1), ("white_concrete", 1)]
ROOFS = [(("bricks", "brick_slab[type=bottom]"), 4), (("deepslate_tiles", "deepslate_tile_slab[type=bottom]"), 3),
         (("red_nether_bricks", "red_nether_brick_slab[type=bottom]"), 1), (("spruce_planks", "spruce_slab[type=bottom]"), 1),
         (("mud_bricks", "mud_brick_slab[type=bottom]"), 1)]
ROOF_STAIRS = {"bricks": "brick_stairs", "deepslate_tiles": "deepslate_tile_stairs", "red_nether_bricks": "red_nether_brick_stairs",
               "spruce_planks": "spruce_stairs", "mud_bricks": "mud_brick_stairs", "granite": "granite_stairs",
               "dark_oak_planks": "dark_oak_stairs", "oxidized_cut_copper": "oxidized_cut_copper_stairs",
               "oak_planks": "oak_stairs"}
WORK = {"industrial", "commercial", "retail", "warehouse", "office", "service", "garages", "garage", "sports_hall",
        "school", "hospital", "parking", "transportation", "public", "civic"}
SMALL = {"garage", "shed", "hut", "carport", "kiosk", "shelter", "cabin", "toilets"}
DEFAULT_HEIGHT = {"house": 8, "detached": 8, "residential": 10, "apartments": 13, "garage": 3, "garages": 3, "shed": 3,
                  "hut": 3, "kiosk": 3, "shelter": 3, "carport": 3, "commercial": 10, "retail": 7, "industrial": 9,
                  "office": 14, "school": 11, "church": 14, "chapel": 7, "farm_auxiliary": 6, "barn": 8}


def _pick(options, key: int):
    total = sum(w for _, w in options)
    r = key % total
    for v, w in options:
        if r < w:
            return v
        r -= w
    return options[-1][0]


def _key(r) -> int:
    return zlib.crc32((r.get("id") or str(r["geom"].bounds)).encode())


def build(world: World, exclude, styles=None, log=print) -> dict:
    """exclude: shapely geometry (block coords) of areas where landmarks replace generic buildings.
    styles: callable(row) -> style dict or None."""
    g = world.grid
    dist_road = ndimage.distance_transform_edt(~world.road)
    world.dist_road = dist_road
    n_ok = n_skip = 0
    rows = sorted(data.overture("building"), key=lambda r: -(r["geom"].area))  # big first, annexes later
    for r in rows:
        if r.get("is_underground"):
            continue
        poly = raster.to_block_geom(r["geom"])
        if poly.geom_type not in ("Polygon", "MultiPolygon") or poly.area < 6:
            continue
        minx, minz, maxx, maxz = poly.bounds
        if maxx < g.x0 or minx > g.x1 - 1 or maxz < g.z0 or minz > g.z1 - 1:
            continue
        style = styles(r) if styles else None
        if style is None and exclude is not None and poly.intersects(exclude) \
                and poly.intersection(exclude).area > 0.3 * poly.area:
            n_skip += 1
            continue
        if style is not None and style.get("skip"):
            n_skip += 1
            continue
        if building(world, r, poly, style or {}):
            n_ok += 1
    log(f"buildings: {n_ok} built, {n_skip} replaced by landmarks")
    return {"buildings": n_ok, "replaced": n_skip}


def _orientation(poly):
    """Unit vector of the long axis and the half short side of the min. rotated rectangle."""
    rect = poly.minimum_rotated_rectangle
    c = np.asarray(rect.exterior.coords)[:4]
    e1, e2 = c[1] - c[0], c[2] - c[1]
    l1, l2 = np.hypot(*e1), np.hypot(*e2)
    long_v = e1 / l1 if l1 >= l2 else e2 / l2
    return long_v, min(l1, l2) / 2.0, max(l1, l2) / 2.0


def building(world: World, r: dict, poly, style: dict) -> dict | bool:
    g = world.grid
    dist_road = world.dist_road
    m, x0, z0 = raster.polygon_cells(poly)
    if m.sum() < 4:
        return False
    mz, mx = np.nonzero(m)
    X, Z = mx + x0, mz + z0
    ok = g.inside(X, Z)
    if not ok.any():
        return False
    iz, ix = np.clip(Z - g.z0, 0, g.nz - 1), np.clip(X - g.x0, 0, g.nx - 1)
    hs = world.H[iz, ix].astype(int)
    wet = world.wtop[iz, ix] > world.H[iz, ix]
    if world.fade_water[iz, ix].mean() > 0.2 and not style:
        return False  # the map edge sank this ground into the lake
    key = _key(r)
    cls = r.get("class") or ""
    sub = r.get("subtype") or ""
    area = float(m.sum())

    # ---- heights
    if "base" in style:
        base = int(style["base"])
    elif wet.mean() > 0.5:
        base = config.WATER_LEVEL + 1
    else:
        base = int(round(np.median(hs[~wet]) if (~wet).any() else hs.mean()))
    h = style.get("height") or r.get("height")
    if not h and r.get("num_floors"):
        h = r["num_floors"] * 3.2 + 1.5
    if not h:
        h = DEFAULT_HEIGHT.get(cls, 3 if area < 25 else 9)
    h = float(np.clip(h, 3, 120))
    roof_shape = r.get("roof_shape")
    small = (cls in SMALL or area < 30) and not style
    if cls == "roof" and not style:
        return _canopy(world, X, Z, base, h)
    if "flat" in style:
        flat = style["flat"]
    else:
        flat = roof_shape in ("flat", "skillion") or (roof_shape is None and (
            cls in WORK or sub in ("industrial", "commercial") or area > 1800 or h > 20 or (key >> 8) % 7 == 0))
    rect_fill = area / max(poly.minimum_rotated_rectangle.area, 1)
    gable = style.get("gable", roof_shape in ("gabled", "saltbox") or (roof_shape is None and rect_fill > 0.85 and (key >> 17) % 2 == 0))
    pitch = style.get("pitch", 0.75)

    edt = ndimage.distance_transform_edt(np.pad(m, 1))[1:-1, 1:-1]  # [z, x]
    long_v, half_short, _ = _orientation(poly)
    if flat or small:
        roof_surface = None
        roof_h = 0.0
    else:
        if gable:
            n = np.array([-long_v[1], long_v[0]])
            c = np.asarray(poly.centroid.coords[0])
            px = (np.arange(m.shape[1]) + x0 + 0.5)[None, :] - c[0]
            pz = (np.arange(m.shape[0]) + z0 + 0.5)[:, None] - c[1]
            dperp = np.abs(px * n[0] + pz * n[1])
            roof_surface = np.clip((half_short - dperp + 0.5) * pitch, 0, None)
        else:
            roof_surface = (edt - 1.0) * pitch
        cap = style.get("roof_cap", min(h * 0.5, 14.0))
        roof_surface = np.minimum(roof_surface, cap)
        roof_h = float(roof_surface[m].max())
    wall_top = base + max(2, int(round(h - roof_h)) - 1)
    if "wall_height" in style:
        wall_top = base + int(style["wall_height"])

    # ---- materials
    rural = base > 470
    if cls in WORK or sub in ("industrial", "commercial"):
        facade = _pick(FACADES_WORK, key)
    else:
        facade = _pick(FACADES_RURAL if rural else FACADES_TOWN, key)
    if small:
        facade = _pick([("spruce_planks", 3), ("dark_oak_planks", 1), (facade, 2)], key >> 3)
    roof_blk, roof_slab = _pick(ROOFS, key >> 5)
    if rural and (key >> 11) % 3 == 0:
        roof_blk, roof_slab = "spruce_planks", "spruce_slab[type=bottom]"
    facade = style.get("facade", facade)
    roof_blk, roof_slab = style.get("roof", (roof_blk, roof_slab))
    floor_blk = style.get("floor", "spruce_planks" if cls not in WORK else "smooth_stone")
    foundation = style.get("foundation", "stone_bricks" if not rural else "cobblestone")
    windows = style.get("windows", "normal")
    shop = style.get("shop", (cls in ("retail", "commercial")) or (
        not rural and float(dist_road[iz, ix].min()) < 3 and h > 9))
    floor_h = int(style.get("floor_h", 3))

    # ---- canvas  (a is [x, y, z])
    top_y = wall_top + 3 + int(math.ceil(roof_h)) + 1
    low = int(min(hs.min(), base)) - 1
    v = Vox(x0, low, z0, m.shape[1], top_y - low + 2, m.shape[0])
    a = v.a
    mT = m.T
    per = mT & ~ndimage.binary_erosion(mT, structure=np.ones((3, 3)))  # 8-connected: no diagonal cracks
    inner = mT & ~per
    yb = base - low
    yt = wall_top - low

    # ground: foundation below base (stilts over water)
    col_h = np.full(mT.shape, base, dtype=int)
    col_h[mx, mz] = hs
    over_water = base == config.WATER_LEVEL + 1 and wet.mean() > 0.5
    STILT, FOUND = B("stripped_spruce_log[axis=y]"), B(foundation)
    for cx, cz in zip(mx, mz):
        hh = col_h[cx, cz]
        if hh < base:
            if over_water:
                if per[cx, cz] and (cx + cz) % 3 == 0:
                    a[cx, max(hh - low + 1, 0):yb, cz] = STILT
            else:
                a[cx, max(hh - low + 1, 0):yb, cz] = FOUND
    F = B(facade)
    a[:, yb, :][mT] = B(floor_blk)
    if not over_water:
        a[:, yb, :][per] = FOUND
    wall = np.zeros(a.shape, dtype=bool)
    wall[:, yb + 1:yt + 1, :] = per[:, None, :]
    a[wall] = F
    interior = np.zeros(a.shape, dtype=bool)
    interior[:, yb + 1:yt + 1, :] = inner[:, None, :]
    a[interior] = 0
    gx = np.arange(mT.shape[0])[:, None] + x0
    gz = np.arange(mT.shape[1])[None, :] + z0
    lights = inner & (gx % 6 == 0) & (gz % 6 == 0)
    LIGHT = B("light[level=13]")
    floors = list(range(yb, yt, floor_h))
    for fy in floors:
        if fy > yb and style.get("floors", True):
            a[:, fy, :][inner] = B(floor_blk)
        if fy + 2 <= yt:
            a[:, fy + 2, :][lights] = LIGHT

    # straight wall pieces
    px = np.pad(per, 1)
    ew = px[2:, 1:-1] & px[:-2, 1:-1] & per            # wall runs east-west
    ns = px[1:-1, 2:] & px[1:-1, :-2] & per & ~ew      # wall runs north-south
    along = gx + gz
    pane_ew = B(style.get("glass", "glass_pane") + "[east=true,west=true]")
    pane_ns = B(style.get("glass", "glass_pane") + "[north=true,south=true]")

    # half-timbering (Fachwerk)
    if style.get("fachwerk"):
        beam = B("dark_oak_planks")
        post = B("stripped_dark_oak_log[axis=y]")
        for fy in floors + [yt]:
            a[:, min(fy, yt), :][per] = beam
        posts = per & ((along % 3 == 0) | ~(ew | ns))
        a[:, yb + 1:yt + 1, :][np.broadcast_to(posts[:, None, :], a[:, yb + 1:yt + 1, :].shape)] = post

    # shutters on part of the homes (typical for Vorarlberg)
    if windows == "normal" and cls in ("house", "detached", "residential", "apartments", "") and not small \
            and (key >> 23) % 3 == 0 and "shutter" not in style:
        windows = "shutters"
        style = dict(style, shutter=_pick([("green_terracotta", 3), ("brown_terracotta", 2), ("gray_terracotta", 1)], key >> 25))
    if windows != "none":
        for fy in floors:
            if windows == "tall":
                rows = range(fy + 2, min(yt - 1, fy + floor_h - 1) + 1)
            else:
                rows = [y for y in (fy + 1, fy + 2) if y <= yt and y < fy + floor_h]
            for wy in rows:
                if windows == "shutters":
                    cols = along % 4 == 2
                    sh = (along % 4 == 1) | (along % 4 == 3)
                    a[:, wy, :][(ew | ns) & sh] = B(style.get("shutter", "lime_terracotta"))
                elif windows == "tall":
                    cols = along % 5 == 2
                elif shop and fy == yb:
                    cols = along % 4 != 0
                else:
                    cols = (along % 4 == 1) | (along % 4 == 2)
                a[:, wy, :][ew & cols] = pane_ew
                a[:, wy, :][ns & cols] = pane_ns

    # cornice band on plastered houses
    plastered = facade in ("white_terracotta", "white_concrete", "smooth_sandstone", "calcite", "yellow_terracotta",
                           "smooth_quartz", "light_gray_concrete")
    if plastered and not small and not style.get("fachwerk") and style.get("trim", True) and h > 7:
        trim = "stone_bricks" if facade != "smooth_sandstone" else "sandstone"
        row = a[:, yt, :]
        row[per & (row == F)] = B(trim)

    # metal lamella screen (vertical fins) over the upper floors
    if style.get("lamellas"):
        fins = (ew | ns) & (along % 2 == 0)
        a[:, yb + 4:yt + 1, :][np.broadcast_to(fins[:, None, :], a[:, yb + 4:yt + 1, :].shape)] = B("iron_bars")

    # door towards the nearest street
    straight = ew | ns
    door = None
    if straight.any() and style.get("door", True):
        sx, sz = np.nonzero(straight)
        d = dist_road[np.clip(sz + z0 - g.z0, 0, g.nz - 1), np.clip(sx + x0 - g.x0, 0, g.nx - 1)]
        i = int(np.argmin(d))
        dxi, dzi = int(sx[i]), int(sz[i])

        def inside(cx, cz):
            return 0 <= cx < mT.shape[0] and 0 <= cz < mT.shape[1] and mT[cx, cz]
        if ew[dxi, dzi]:
            facing = "south" if not inside(dxi, dzi + 1) else "north"
        else:
            facing = "east" if not inside(dxi + 1, dzi) else "west"
        a[dxi, yb + 1, dzi] = B(f"spruce_door[facing={facing},half=lower,hinge=left]")
        a[dxi, yb + 2, dzi] = B(f"spruce_door[facing={facing},half=upper,hinge=left]")
        if yb + 3 <= yt:
            a[dxi, yb + 3, dzi] = F
        door = (int(dxi + x0), int(base + 1), int(dzi + z0), facing)

    # roof
    ry0 = yt + 1
    if roof_surface is None:
        a[:, ry0, :][mT] = B(style.get("flat_roof", "smooth_stone" if not small else "spruce_slab[type=bottom]"))
        if not small:
            if style.get("green_roof", (key >> 13) % 7 == 0 and area > 120):
                core = ndimage.binary_erosion(mT, iterations=2)
                a[:, ry0, :][inner] = B("gravel")
                a[:, ry0, :][core] = B("moss_block")
                tufts = core & ((np.arange(mT.shape[0])[:, None] * 7 + np.arange(mT.shape[1])[None, :] * 3) % 11 == 0)
                a[:, ry0 + 1, :][tufts] = B("short_grass")
            if style.get("parapet", True):
                a[:, ry0 + 1, :][per] = B(style.get("parapet_block", "stone_brick_slab[type=bottom]"))
            # roof furniture: AC boxes, skylights, stair/elevator housing
            ins = np.argwhere(ndimage.binary_erosion(mT, iterations=2))
            if len(ins):
                rng = np.random.default_rng(key & 0xFFFF)
                for k in range(min(4, len(ins) // 40 + 1)):
                    cx, cz = ins[rng.integers(len(ins))]
                    a[cx, ry0 + 1, cz] = B("iron_block" if k % 2 == 0 else "light_gray_concrete")
                    if k % 2 == 0 and cx + 1 < mT.shape[0] and mT[cx + 1, cz]:
                        a[cx + 1, ry0 + 1, cz] = B("iron_block")
                for k in range(min(3, len(ins) // 60)):
                    cx, cz = ins[rng.integers(len(ins))]
                    a[cx, ry0, cz] = B("glass")
                if len(ins) > 120 and h > 12:
                    cx, cz = ins[len(ins) // 2]
                    a[max(cx - 1, 0):cx + 2, ry0 + 1:ry0 + 3, max(cz - 1, 0):cz + 2] = B("light_gray_concrete")
    else:
        rz = roof_surface.T
        R = np.floor(rz).astype(int)
        R[~mT] = -10
        RB, RS = B(roof_blk), B(roof_slab)
        stair_name = ROOF_STAIRS.get(roof_blk, roof_blk.split("[")[0] + "_stairs")
        Rp = np.pad(R, 1, constant_values=-10)
        nb = {"east": Rp[2:, 1:-1], "west": Rp[:-2, 1:-1], "south": Rp[1:-1, 2:], "north": Rp[1:-1, :-2]}
        for cx, cz in zip(mx, mz):
            full = int(R[cx, cz])
            if per[cx, cz] and full > 0:  # gable / end walls up to the roof
                a[cx, ry0:ry0 + full, cz] = F
            inside_nb = [int(arr[cx, cz]) for arr in nb.values() if int(arr[cx, cz]) > -10]
            low_nb = min(inside_nb) if inside_nb else full
            lo = max(0, min(full - 1, low_nb))
            a[cx, ry0 + lo:ry0 + full + 1, cz] = RB
            # smooth the steps: a stair climbing towards the higher neighbour
            best, bdir = full, None
            for dname, arr in nb.items():
                hv = int(arr[cx, cz])
                if hv > best:
                    best, bdir = hv, dname
            if bdir is not None:
                a[cx, ry0 + full + 1, cz] = B(f"{stair_name}[facing={bdir},half=bottom]")
            elif rz[cx, cz] - full >= 0.5:
                a[cx, ry0 + full + 1, cz] = RS
        # eaves: upside-down stairs one block out from the walls
        out = ndimage.binary_dilation(mT, structure=[[0, 1, 0], [1, 1, 1], [0, 1, 0]]) & ~mT
        ex_, ez_ = np.nonzero(out)
        for cx, cz in zip(ex_, ez_):
            gx_, gz_ = cx + x0, cz + z0
            if g.inside(gx_, gz_) and world.occupied[gz_ - g.z0, gx_ - g.x0]:
                continue
            for dname, (ddx, ddz) in (("east", (1, 0)), ("west", (-1, 0)), ("south", (0, 1)), ("north", (0, -1))):
                qx, qz = cx + ddx, cz + ddz
                if 0 <= qx < mT.shape[0] and 0 <= qz < mT.shape[1] and mT[qx, qz] and R[qx, qz] == 0:
                    a[cx, ry0, cz] = B(f"{stair_name}[facing={dname},half=bottom]")
                    break
        # chimney near the ridge
        if area > 40 and (key >> 19) % 3 != 0:
            cand = np.argwhere(mT & (R >= max(1, R.max() - 2)) & ~per)
            if len(cand):
                cx, cz = cand[(key >> 7) % len(cand)]
                top_c = ry0 + int(R[cx, cz]) + 3
                a[cx, ry0:top_c + 1, cz] = B("bricks")
                a[cx, top_c, cz] = B("stone_brick_slab[type=bottom]")
    v.commit(world.edits)
    world.occupied[iz[ok], ix[ok]] = True
    return {"base": base, "wall_top": wall_top, "roof_top": wall_top + 1 + int(math.ceil(roof_h)), "door": door,
            "x0": x0, "z0": z0, "mask": m, "long_axis": long_v}


def _canopy(world: World, X, Z, base, h) -> bool:
    g = world.grid
    y = base + int(max(3, min(h, 6)))
    world.edits.put(X, np.full(X.shape, y), Z, B("smooth_stone_slab[type=bottom]"))
    for cx in (X.min(), X.max()):
        for cz in (Z.min(), Z.max()):
            hh = int(world.h(cx, cz))
            n = y - hh - 1
            if n > 0:
                world.edits.put(np.full(n, cx), np.arange(hh + 1, y), np.full(n, cz), B("iron_bars"))
    ok = g.inside(X, Z)
    world.occupied[(Z - g.z0)[ok], (X - g.x0)[ok]] = True
    return True
