"""Hand-built Bregenz landmarks at their real positions.

Footprints come from OpenStreetMap (via Overture) wherever they exist; the
coordinates supplied for the project are used where OSM has no footprint.
"""
from __future__ import annotations

import math

import numpy as np
import shapely
from scipy import ndimage

from . import buildings, config, data, geo, raster
from .blocks import B
from .vox import Vox
from .world import World

WL = config.WATER_LEVEL


# ----------------------------------------------------------------- helpers
def _row(kind: str, name: str, cls_filter=None):
    for r in data.overture(kind):
        if r["name"] == name and (cls_filter is None or r.get("class") == cls_filter) \
                and r["geom"].geom_type != "Point":
            return r
    return None


def _bgeom(r):
    return raster.to_block_geom(r["geom"])


def _ground(world: World, x, z) -> int:
    return int(world.h(int(x), int(z)))


def _mark(world: World, name: str, x, y, z) -> None:
    world.markers[name] = (int(x), int(y), int(z))


def sign(world: World, x: int, z: int, lines: list[str], rotation: int = 0, y: int | None = None) -> None:
    """Standing oak sign with up to 4 lines (1.21.4 block-entity format, upgraded by the game)."""
    if y is None:
        y = int(world.surface(x, z))
    x, y, z = int(x), int(y), int(z)
    world.edits.set(x, y, z, f"oak_sign[rotation={rotation}]")
    g = world.grid
    if g.inside(x, z):
        world.occupied[z - g.z0, x - g.x0] = True
    msgs = [f'{{"text":"{t}"}}' for t in (lines + ["", "", "", ""])[:4]]
    empty = ['{"text":""}'] * 4
    from . import nbt
    world.edits.block_entity({
        "id": "minecraft:sign", "x": nbt.Int(x), "y": nbt.Int(y), "z": nbt.Int(z), "keepPacked": nbt.Byte(0),
        "is_waxed": nbt.Byte(1),
        "front_text": {"messages": nbt.List(msgs, nbt.TAG_STRING), "color": "black", "has_glowing_text": nbt.Byte(0)},
        "back_text": {"messages": nbt.List(empty, nbt.TAG_STRING), "color": "black", "has_glowing_text": nbt.Byte(0)},
    })


def _rot_towards(dx: float, dz: float) -> int:
    """Sign rotation (0..15) so the text faces a viewer standing in direction (dx, dz)."""
    ang = math.degrees(math.atan2(-dx, dz)) % 360  # 0 = south
    return int(round(ang / 22.5)) % 16


def _free_spot_near(world: World, x, z, r=12):
    g = world.grid
    best = None
    for d in range(2, r):
        for dx, dz in ((d, 0), (-d, 0), (0, d), (0, -d), (d, d), (-d, -d), (d, -d), (-d, d)):
            px, pz = int(x + dx), int(z + dz)
            if not g.inside(px, pz):
                continue
            iz, ix = pz - g.z0, px - g.x0
            if not world.occupied[iz, ix] and world.wtop[iz, ix] <= world.H[iz, ix]:
                return px, pz
    return best


def label(world: World, name: str, x, z, lines: list[str]) -> None:
    spot = _free_spot_near(world, x, z, 18)
    if spot is None:
        return
    sx, sz = spot
    # text faces away from the landmark: you read the sign with the building behind it
    sign(world, sx, sz, lines, _rot_towards(sx - x, sz - z))
    _mark(world, name, sx, world.surface(sx, sz), sz)


def fence_ring(world: World, cells: set[tuple[int, int]], block: str, height: int = 1) -> None:
    for (x, z) in cells:
        props = {d: str((x + dx, z + dz) in cells).lower() for d, (dx, dz) in
                 {"north": (0, -1), "south": (0, 1), "east": (1, 0), "west": (-1, 0)}.items()}
        st = f"{block}[" + ",".join(f"{k}={v}" for k, v in props.items()) + "]"
        y = int(world.surface(x, z))
        for k in range(height):
            world.edits.set(x, y + k, z, st)
        g = world.grid
        if g.inside(x, z):
            world.occupied[z - g.z0, x - g.x0] = True


def _ring_cells(poly_block) -> set[tuple[int, int]]:
    m, x0, z0 = raster.polygon_cells(poly_block)
    per = m & ~ndimage.binary_erosion(m, structure=[[0, 1, 0], [1, 1, 1], [0, 1, 0]])
    zz, xx = np.nonzero(per)
    return {(int(x + x0), int(z + z0)) for x, z in zip(xx, zz)}


# -------------------------------------------------------- style overrides
STYLES = {
    "Festspiel- und Kongresshaus Bregenz": dict(facade="light_gray_concrete", flat=True, height=24, glass="light_gray_stained_glass_pane",
                                                 shop=True, green_roof=False, parapet_block="smooth_stone_slab[type=bottom]", floor_h=4),
    "Theater am Kornmarkt": dict(facade="smooth_stone", roof=("deepslate_tiles", "deepslate_tile_slab[type=bottom]"), gable=True,
                                 flat=False, height=19, pitch=0.5, windows="tall", floor_h=6, foundation="polished_andesite"),
    "Deuringschlößle": dict(facade="white_concrete", roof=("bricks", "brick_slab[type=bottom]"), flat=False, gable=False,
                            pitch=1.0, height=20, windows="shutters", shutter="green_terracotta"),
    "Altes Rathaus": dict(facade="white_concrete", roof=("bricks", "brick_slab[type=bottom]"), flat=False, gable=True,
                          pitch=1.1, height=17, fachwerk=True),
    "Unteres Tor": dict(facade="smooth_sandstone", roof=("deepslate_tiles", "deepslate_tile_slab[type=bottom]"), flat=False,
                        gable=False, pitch=1.0, height=18, windows="none", door=False),
    "Martinskapelle": dict(facade="smooth_sandstone", roof=("bricks", "brick_slab[type=bottom]"), flat=False, gable=True,
                           height=14, windows="tall", floor_h=12, floors=False),
    "Nostalgiebad Mili": dict(facade="dark_oak_planks", roof=("spruce_planks", "spruce_slab[type=bottom]"), flat=False,
                              gable=False, pitch=0.6, height=8, windows="shutters", shutter="lime_terracotta",
                              base=WL + 2, floor="spruce_planks"),
    "Stadtpfarrkirche St. Gallus": dict(facade="smooth_sandstone", roof=("bricks", "brick_slab[type=bottom]"), flat=False,
                                        gable=True, pitch=0.9, height=24, wall_height=12, windows="tall", floor_h=12,
                                        floors=False),
    "Wallfahrtskirche Hl. Gebhard": dict(facade="smooth_sandstone", roof=("deepslate_tiles", "deepslate_tile_slab[type=bottom]"),
                                         flat=False, gable=True, height=13, windows="tall", floor_h=10, floors=False),
    "Burgrestaurant Gebhardsberg": dict(facade="stone_bricks", roof=("deepslate_tiles", "deepslate_tile_slab[type=bottom]"),
                                        flat=False, gable=False, height=11, foundation="mossy_stone_bricks"),
    "St. Antonius": dict(facade="white_concrete", roof=("deepslate_tiles", "deepslate_tile_slab[type=bottom]"), flat=False,
                         gable=True, height=15, windows="tall", floor_h=10, floors=False),
    "Pfarrkirche St. Wendelin": dict(facade="white_concrete", roof=("deepslate_tiles", "deepslate_tile_slab[type=bottom]"),
                                     flat=False, gable=True, height=13, windows="tall", floor_h=10, floors=False),
    "Talstation": dict(facade="light_gray_concrete", flat=True, height=12, glass="light_blue_stained_glass_pane", shop=True,
                       green_roof=False),
    "Bergstation": dict(facade="light_gray_concrete", flat=True, height=9, glass="light_blue_stained_glass_pane", shop=True,
                        green_roof=False),
    "vorarlberg museum": dict(skip=True),       # custom
    "Kunsthaus Bregenz": dict(skip=True),       # custom
    "Martinsturm Bregenz": dict(skip=True),     # custom
    "Sender Pfänder": dict(skip=True),          # custom
    "Haupttribüne": dict(skip=True),            # custom
    "Herz Jesu-Kirche": dict(skip=True),        # custom
    "Post Filiale 6900": dict(skip=True),       # custom (Hauptpost am Hafen)
}


def styles_for(world: World):
    kapuziner = shapely.Point(*geo.place(47.49961, 9.74654)).buffer(6)

    harb = [raster.to_block_geom(r["geom"]) for r in data.overture("water") if r["name"] == "Hafen Bregenz"
            and r["geom"].geom_type in ("Polygon", "MultiPolygon")]
    hzone = harb[0].buffer(45) if harb else None

    def style(r):
        s = STYLES.get(r["name"])
        if s is not None:
            return dict(s)
        if hzone is not None and (r.get("roof_shape") == "pyramidal" or (r.get("class") in ("retail", "kiosk") and r["name"] is None)):
            p = raster.to_block_geom(r["geom"])
            if p.within(hzone) and 100 < p.area < 900:
                # harbour buildings: white walls, green copper roof (as seen from the lake)
                return dict(facade="white_concrete", roof=("oxidized_cut_copper", "oxidized_cut_copper_slab[type=bottom]"),
                            flat=False, gable=False, pitch=0.8, height=10, windows="shutters", shutter="green_terracotta")
        if r["name"] is None and raster.to_block_geom(r["geom"]).intersects(kapuziner):
            return dict(facade="white_concrete", roof=("deepslate_tiles", "deepslate_tile_slab[type=bottom]"),
                        flat=False, gable=True, height=11, windows="shutters", shutter="gray_terracotta")
        return None
    return style


def exclusion_zones() -> shapely.Geometry:
    """Areas where generic buildings are removed (stage, Fischersteg, Sendemast surroundings ...)."""
    zones = []
    for kind, name in (("infrastructure", "Seebühne Bregenz"), ("infrastructure", "Fischersteg")):
        r = _row(kind, name)
        if r is not None:
            zones.append(_bgeom(r).buffer(2))
    return shapely.union_all(zones) if zones else None


# ------------------------------------------------------------- the builds
def build(world: World, log=print) -> dict:
    done, failed = [], []
    for fn in (kunsthaus, vorarlberg_museum, martinsturm, seebuehne, fischersteg, piers, mili_bridge, st_gallus_tower,
               unteres_tor_passage, herz_jesu, hauptpost, gebhardsberg_ruin, pfaenderbahn, sender, gipfelkreuz, wildpark, pfaenderdohle,
               harbour_detail):
        try:
            fn(world)
            done.append(fn.__name__)
        except Exception as e:  # one landmark must never kill the whole world (e.g. outside a test bbox)
            log(f"landmark {fn.__name__} skipped: {e!r}")
            failed.append(fn.__name__)
    _labels(world)
    log(f"landmarks: {', '.join(done)}")
    return {"landmarks": done, "landmarks_failed": failed}


def kunsthaus(world: World) -> None:
    """KUB (Peter Zumthor): a frosted glass cube with a concrete core, ~30 m."""
    r = _row("building", "Kunsthaus Bregenz")
    poly = _bgeom(r)
    long_v, hs, hl = buildings._orientation(poly)
    c = poly.centroid
    m, x0, z0 = raster.polygon_cells(poly)
    kx, kz = np.nonzero(m.T)
    base = int(np.median(world.h(kx + x0, kz + z0)))
    top = base + 30
    v = Vox(x0, base - 2, z0, m.shape[1], 36, m.shape[0])
    mT = m.T
    per = mT & ~ndimage.binary_erosion(mT, structure=[[0, 1, 0], [1, 1, 1], [0, 1, 0]])
    inner = mT & ~per
    core = ndimage.binary_erosion(mT, iterations=2)
    for y in range(base, top + 1):
        rel = y - base
        layer = v.a[:, y - v.y0, :]
        layer[mT] = 0
        # glass skin; the floor slabs shimmer through as a slightly darker band
        skin = "light_gray_stained_glass" if rel % 7 == 0 else "white_stained_glass"
        layer[per] = B(skin)
        layer[core & ~ndimage.binary_erosion(core)] = B("light_gray_concrete")
        if rel % 7 == 0:
            layer[core] = B("polished_andesite")
        if rel % 7 == 4:
            layer[core & ((np.arange(mT.shape[0])[:, None] + np.arange(mT.shape[1])[None, :]) % 6 == 0)] = B("light[level=15]")
    v.a[:, top - v.y0 + 1, :][mT] = B("white_concrete")
    # entrance
    v.a[:, base - v.y0, :][mT] = B("polished_andesite")
    ent = np.argwhere(per)
    ex, ez = ent[np.argmin(ent[:, 1])]
    for dx in (-1, 0, 1):
        for y in (base + 1, base + 2, base + 3):
            if 0 <= ex + dx < mT.shape[0]:
                v.a[ex + dx, y - v.y0, ez] = 0
    v.commit(world.edits)
    _occupy(world, poly)
    _mark(world, "Kunsthaus Bregenz (KUB)", c.x, top + 1, c.y)


def vorarlberg_museum(world: World) -> None:
    """vorarlberg museum: white facade with the round relief pattern, golden ground floor panel."""
    r = _row("building", "vorarlberg museum")
    poly = _bgeom(r)
    info = buildings.building(world, r, poly, dict(facade="white_concrete", flat=True, height=21, windows="none",
                                                     parapet=False, green_roof=False, floor_h=5, door=True))
    if not info:
        return
    m, x0, z0 = info["mask"], info["x0"], info["z0"]
    mT = m.T
    per = mT & ~ndimage.binary_erosion(mT, structure=[[0, 1, 0], [1, 1, 1], [0, 1, 0]])
    xs, zs = np.nonzero(per)
    base, top = info["base"], info["wall_top"]
    for x, z in zip(xs + x0, zs + z0):
        for y in range(base + 4, top + 1):
            # relief: concrete "flowers" (PET bottle bottoms) as a dotted pattern
            if (x + z + 2 * y) % 5 == 0 and (y - x) % 3 == 0:
                world.edits.set(int(x), y, int(z), "white_concrete_powder")
    # golden panel + glass at the ground floor corner closest to the Kornmarkt (south-west)
    k = np.argmin((xs + x0) - (zs + z0) * 0.2)
    gx, gz = int(xs[k] + x0), int(zs[k] + z0)
    for i, (x, z) in enumerate(sorted(zip(xs + x0, zs + z0), key=lambda p: abs(p[0] - gx) + abs(p[1] - gz))[:14]):
        for y in range(base + 1, base + 4):
            world.edits.set(int(x), y, int(z), "gold_block" if i < 8 else "tinted_glass")
    # one big window high up (like the photo)
    hx, hz = sorted(zip(xs + x0, zs + z0), key=lambda p: p[1])[len(xs) // 2]
    for dx in range(-3, 4):
        for y in range(top - 5, top - 1):
            world.edits.set(int(hx + dx), y, int(hz), "black_stained_glass")
    _mark(world, "vorarlberg museum", poly.centroid.x, top + 1, poly.centroid.y)


def martinsturm(world: World) -> None:
    """Martinsturm: white tower with arcaded belfry and the largest onion dome in Central Europe (1602)."""
    r = _row("building", "Martinsturm Bregenz")
    poly = _bgeom(r)
    c = poly.centroid
    cx, cz = int(round(c.x)), int(round(c.y))
    base = _ground(world, cx, cz)
    half = 5  # 11 x 11 tower
    body_top = base + 24
    v = Vox(cx - 12, base - 6, cz - 12, 25, 50, 25)
    # foundation & body
    v.fill(cx - half, base - 6, cz - half, cx + half, base, cz + half, "stone_bricks")
    v.hollow(cx - half, base + 1, cz - half, cx + half, body_top, cz + half, "smooth_sandstone", "air")
    for y in (base + 8, base + 16, body_top - 6):  # cornices & floors
        v.fill(cx - half, y, cz - half, cx + half, y, cz + half, "stone_bricks")
        v.fill(cx - half + 1, y, cz - half + 1, cx + half - 1, y, cz + half - 1, "spruce_planks")
    # small windows
    for y in (base + 4, base + 12):
        for d in (-2, 2):
            v.set(cx + d, y, cz - half, "glass_pane[east=true,west=true]")
            v.set(cx + d, y, cz + half, "glass_pane[east=true,west=true]")
            v.set(cx - half, y, cz + d, "glass_pane[north=true,south=true]")
            v.set(cx + half, y, cz + d, "glass_pane[north=true,south=true]")
    # belfry: three round-arched openings per side
    for y in range(body_top - 5, body_top - 1):
        for d in (-3, 0, 3):
            for e in (d - 1, d, d + 1) if y < body_top - 2 else (d,):
                v.set(cx + e, y, cz - half, "air")
                v.set(cx + e, y, cz + half, "air")
                v.set(cx - half, y, cz + e, "air")
                v.set(cx + half, y, cz + e, "air")
    v.set(cx, body_top - 4, cz, "bell[attachment=ceiling,facing=north]")
    v.fill(cx, body_top - 3, cz, cx, body_top - 1, cz, "dark_oak_fence")
    v.fill(cx - half, body_top, cz - half, cx + half, body_top, cz + half, "stone_bricks")
    # onion dome: bulges out to radius 7.5, then pulls in to a lantern and a spire
    profile = [6.5, 7.2, 7.6, 7.8, 7.6, 7.2, 6.5, 5.6, 4.6, 3.6, 2.7, 2.0, 1.4, 1.0, 0.8, 0.6]
    y = body_top + 1
    for rr in profile:
        v.disk(cx, cz, y, rr, "spruce_planks", filled=False)
        v.disk(cx, cz, y, rr - 1.0, "dark_oak_planks", filled=False) if rr > 2 else None
        y += 1
    lantern = y
    v.fill(cx - 1, lantern, cz - 1, cx + 1, lantern + 2, cz + 1, "dark_oak_planks")
    for d in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        v.set(cx + d[0], lantern + 1, cz + d[1], "air")
    v.set(cx, lantern + 1, cz, "lantern")
    v.disk(cx, cz, lantern + 3, 1.2, "spruce_planks")
    v.fill(cx, lantern + 4, cz, cx, lantern + 7, cz, "lightning_rod")
    v.set(cx, lantern + 8, cz, "gold_block")
    v.commit(world.edits)
    _occupy(world, shapely.Point(cx, cz).buffer(8))
    _mark(world, "Martinsturm", cx, lantern + 9, cz)


def seebuehne(world: World) -> None:
    """Seebühne + Seetribüne: stage on the lake, giant clown head and balloon (Rigoletto), 7000 seats."""
    r = _row("infrastructure", "Seebühne Bregenz")
    stage = _bgeom(r)
    sc = stage.centroid
    m, x0, z0 = raster.polygon_cells(stage)
    mT = m.T
    deck = WL + 2
    v = Vox(x0 - 40, WL - 20, z0 - 40, m.shape[1] + 80, 80, m.shape[0] + 80)
    xs, zs = np.nonzero(mT)
    for x, z in zip(xs + x0, zs + z0):
        hh = _ground(world, x, z)
        if (x % 4 == 0 and z % 4 == 0):
            v.column(x, z, hh + 1, deck - 1, "dark_oak_log[axis=y]")
        v.set(x, deck, z, "dark_oak_planks")
    # round central stage platform
    scx, scz = int(round(sc.x)), int(round(sc.y))
    v.disk(scx, scz, deck + 1, 11, "polished_blackstone")
    v.disk(scx, scz, deck + 1, 11, "gold_block", filled=False)
    # giant clown head facing the tribune, red nose, eyes, grin, striped hat (Rigoletto 2019/21)
    trib = _row("building", "Haupttribüne")
    tc = _bgeom(trib).centroid if trib is not None else shapely.Point(scx + 50, scz)
    f = np.array([tc.x - scx, tc.y - scz], dtype=float)
    f /= np.linalg.norm(f) + 1e-9
    p = np.array([-f[1], f[0]])
    hx, hz = int(round(scx - f[0] * 4)), int(round(scz - f[1] * 4))
    hy = deck + 18
    R = 13
    for dx in range(-R, R + 1):
        for dz in range(-R, R + 1):
            fw = dx * f[0] + dz * f[1]          # towards the audience
            sd = dx * p[0] + dz * p[1]          # sideways
            for dy in range(-R, R + 1):
                d = math.sqrt(dx * dx + (dy * 1.1) ** 2 + dz * dz)
                if not (R - 1.6 <= d <= R):
                    continue
                blk = "white_concrete"
                if fw > 9 and abs(sd) <= 2.2 and -2 <= dy <= 1:
                    blk = "red_concrete"                                   # nose
                elif fw > 7 and 3 <= dy <= 6 and 2.5 <= abs(sd) <= 7.5:
                    blk = "black_concrete" if 3.5 <= abs(sd) <= 6.5 and dy in (4, 5) else "light_blue_concrete"
                elif fw > 6 and -8 <= dy <= -5 and abs(sd) <= 7.5:
                    blk = "red_concrete"                                   # grin
                elif dy > 8:
                    blk = "lime_concrete" if int((sd + 20) // 3) % 2 == 0 else "yellow_concrete"  # hat
                v.set(hx + dx, hy + dy, hz + dz, blk)
    v.fill(hx - 2, deck + 1, hz - 2, hx + 2, hy - R + 1, hz + 2, "gray_concrete")
    # hot-air balloon (striped yellow/green) next to the head
    bx, bz, by = int(round(scx + p[0] * 20)), int(round(scz + p[1] * 20)), deck + 26
    for dx in range(-9, 10):
        for dy in range(-11, 10):
            for dz in range(-9, 10):
                d = math.sqrt(dx * dx + (dy * (0.82 if dy < 0 else 1.0)) ** 2 + dz * dz)
                if 7.6 <= d <= 9.0:
                    ang = math.atan2(dz, dx)
                    v.set(bx + dx, by + dy, bz + dz, "yellow_concrete" if int((ang + math.pi) / (math.pi / 6)) % 2 else "green_concrete")
    v.fill(bx - 1, by - 13, bz - 1, bx + 1, by - 12, bz + 1, "spruce_planks")
    for ddx, ddz in ((-1, -1), (1, 1), (-1, 1), (1, -1)):
        v.line((bx + ddx, by - 12, bz + ddz), (bx + ddx * 5, by - 8, bz + ddz * 5), "chain")
    v.column(bx, bz, deck + 1, by - 14, "dark_oak_fence")
    # light towers left and right
    for side in (-1, 1):
        lx, lz = int(round(scx + p[0] * 26 * side)), int(round(scz + p[1] * 26 * side))
        v.column(lx, lz, _ground(world, lx, lz) + 1, deck + 22, "iron_block")
        v.fill(lx - 1, deck + 22, lz - 1, lx + 1, deck + 23, lz + 1, "sea_lantern")
    v.commit(world.edits)
    _occupy(world, stage)
    _mark(world, "Seebühne", scx, deck + 1, scz)
    _tribune(world, (scx, scz))


def _tribune(world: World, stage_c) -> None:
    r = _row("building", "Haupttribüne")
    if r is None:
        return
    poly = _bgeom(r)
    m, x0, z0 = raster.polygon_cells(poly)
    mT = m.T
    xs, zs = np.nonzero(mT)
    X, Z = xs + x0, zs + z0
    d = np.hypot(X - stage_c[0], Z - stage_c[1])
    dmin = d.min()
    base = int(np.median(world.h(X, Z)))
    top = base + 26
    v = Vox(x0, base - 8, z0, m.shape[1], 50, m.shape[0])
    for x, z, dd in zip(X, Z, d):
        rise = int((dd - dmin) * 0.42)
        y = base + 1 + rise
        hh = _ground(world, x, z)
        v.column(x, z, hh + 1, y - 1, "light_gray_concrete")
        # the seat faces the stage: the stair's back (facing) points away from it
        vx, vz = x - stage_c[0], z - stage_c[1]
        facing = ("east" if vx > 0 else "west") if abs(vx) > abs(vz) else ("south" if vz > 0 else "north")
        v.set(x, y, z, f"blue_terracotta" if (int(dd) % 7 == 0) else f"dark_oak_stairs[facing={facing},half=bottom]")
        v.column(x, z, y + 1, top + 2, "air")
    # roof/backstage wall (Festspielhaus side) and light poles
    per = mT & ~ndimage.binary_erosion(mT)
    far = d > np.percentile(d, 92)
    for x, z in zip(X[far], Z[far]):
        v.column(x, z, base + 1, base + 2 + int((d.max() - dmin) * 0.42) + 3, "light_gray_concrete")
    v.commit(world.edits)
    _occupy(world, poly)
    _mark(world, "Seetribüne", poly.centroid.x, base + 1, poly.centroid.y)


def fischersteg(world: World) -> None:
    """Fischersteg: wooden pier from the promenade with a white pavilion at its end."""
    r = _row("infrastructure", "Fischersteg")
    p = _bgeom(r)
    c = p.centroid
    px, pz = int(round(c.x)), int(round(c.y))
    # find the shore: nearest dry land cell
    g = world.grid
    best = None
    for rad in range(1, 120):
        for ang in np.linspace(0, 2 * np.pi, 8 * rad, endpoint=False):
            x, z = int(round(px + rad * np.cos(ang))), int(round(pz + rad * np.sin(ang)))
            if g.inside(x, z) and not world.is_water(x, z):
                best = (x, z)
                break
        if best:
            break
    sx, sz = best
    deck = WL + 2
    v = Vox(min(px, sx) - 12, WL - 20, min(pz, sz) - 12, abs(px - sx) + 25, 40, abs(pz - sz) + 25)
    # walkway (3 wide) with railings
    L = int(math.hypot(px - sx, pz - sz))
    ux, uz = (px - sx) / max(L, 1), (pz - sz) / max(L, 1)
    nx_, nz_ = -uz, ux
    for t in range(0, L + 1):
        bx, bz = sx + ux * t, sz + uz * t
        for o in (-1, 0, 1):
            x, z = int(round(bx + nx_ * o)), int(round(bz + nz_ * o))
            v.set(x, deck, z, "spruce_planks")
            if t % 4 == 0 and o != 0:
                v.column(x, z, _ground(world, x, z) + 1, deck - 1, "stripped_spruce_log[axis=y]")
        for o in (-2, 2):
            x, z = int(round(bx + nx_ * o)), int(round(bz + nz_ * o))
            v.set(x, deck, z, "spruce_planks")
            v.set(x, deck + 1, z, "white_wool" if False else "birch_fence")
    # platform 11x11 at the end
    for dx in range(-5, 6):
        for dz in range(-5, 6):
            v.set(px + dx, deck, pz + dz, "spruce_planks")
            if (dx % 4 == 0 and dz % 4 == 0):
                v.column(px + dx, pz + dz, _ground(world, px + dx, pz + dz) + 1, deck - 1, "stripped_spruce_log[axis=y]")
            if max(abs(dx), abs(dz)) == 5:
                v.set(px + dx, deck + 1, pz + dz, "birch_fence")
    # pavilion: 8 white posts, pyramid roof, lantern
    for dx, dz in ((-3, -3), (3, -3), (-3, 3), (3, 3), (0, -3), (0, 3), (-3, 0), (3, 0)):
        v.column(px + dx, pz + dz, deck + 1, deck + 4, "birch_fence")
    for k, y in enumerate(range(deck + 5, deck + 9)):
        rr = 4 - k
        for dx in range(-rr, rr + 1):
            for dz in range(-rr, rr + 1):
                if max(abs(dx), abs(dz)) == rr:
                    v.set(px + dx, y, pz + dz, "white_concrete" if k < 2 else "light_gray_concrete")
    v.set(px, deck + 9, pz, "white_concrete")
    v.set(px, deck + 10, pz, "lantern")
    v.set(px, deck + 4, pz, "lantern[hanging=true]")
    # white sun umbrellas on the platform
    for dx, dz in ((-4, 4), (4, 4), (4, -4), (-4, -4)):
        v.column(px + dx, pz + dz, deck + 1, deck + 2, "birch_fence")
        for ex in (-1, 0, 1):
            for ez in (-1, 0, 1):
                v.set(px + dx + ex, deck + 3, pz + dz + ez, "white_wool" if ex == 0 or ez == 0 else "white_carpet")
    v.commit(world.edits)
    _occupy(world, shapely.LineString([(sx, sz), (px, pz)]).buffer(3).union(shapely.Point(px, pz).buffer(7)))
    _mark(world, "Fischersteg", px, deck + 1, pz)


def piers(world: World) -> None:
    """All other piers / jetties / breakwaters from OSM."""
    skip = {"Seebühne Bregenz", "Fischersteg"}
    g = world.grid
    pts = []
    for r in data.overture("infrastructure"):
        if r["class"] not in ("pier", "breakwater") or r["name"] in skip:
            continue
        geom = r["geom"]
        if geom.geom_type in ("LineString", "MultiLineString"):
            m = raster.lines([geom], g, 3 if r["class"] == "pier" else 5).astype(bool)
        elif geom.geom_type in ("Polygon", "MultiPolygon"):
            m = raster.polygons([geom], g).astype(bool)
        else:
            continue
        iz, ix = np.nonzero(m)
        X, Z = ix + g.x0, iz + g.z0
        wet = world.wtop[iz, ix] > world.H[iz, ix]
        if r["class"] == "breakwater":
            for x, z, w, hh in zip(X, Z, wet, world.H[iz, ix]):
                for y in range(int(hh) + 1, WL + 2):
                    world.edits.set(int(x), y, int(z), "cobblestone" if (x + z) % 3 else "stone")
            continue
        for x, z, w, hh in zip(X, Z, wet, world.H[iz, ix]):
            if w:
                world.edits.set(int(x), WL + 1, int(z), "spruce_planks")
                if x % 4 == 0 and z % 4 == 0:
                    for y in range(int(hh) + 1, WL + 1):
                        world.edits.set(int(x), y, int(z), "stripped_spruce_log[axis=y]")
        world.occupied |= m & (world.wtop > world.H)


def mili_bridge(world: World) -> None:
    """Access bridge from the shore to the Mili bathhouse (the building itself is styled generically)."""
    r = _row("building", "Nostalgiebad Mili")
    if r is None:
        return
    p = _bgeom(r)
    c = p.centroid
    g = world.grid
    # walk from the centroid towards the closest shore
    best = None
    for rad in range(1, 150):
        for ang in np.linspace(0, 2 * np.pi, 8 * rad, endpoint=False):
            x, z = int(round(c.x + rad * np.cos(ang))), int(round(c.y + rad * np.sin(ang)))
            if g.inside(x, z) and not world.is_water(x, z) and not world.occupied[z - g.z0, x - g.x0]:
                best = (x, z)
                break
        if best:
            break
    if not best:
        return
    sx, sz = best
    deck = WL + 2
    L = int(math.hypot(c.x - sx, c.y - sz))
    ux, uz = (c.x - sx) / max(L, 1), (c.y - sz) / max(L, 1)
    for t in range(0, L + 1):
        bx, bz = sx + ux * t, sz + uz * t
        if p.contains(shapely.Point(bx, bz).buffer(1.5)):
            break
        for o in (-1, 0, 1):
            x, z = int(round(bx - uz * o)), int(round(bz + ux * o))
            world.edits.set(x, deck, z, "spruce_planks")
            world.edits.set(x, deck + 1, z, "air")
        for o in (-2, 2):
            x, z = int(round(bx - uz * o)), int(round(bz + ux * o))
            world.edits.set(x, deck, z, "spruce_planks")
            world.edits.set(x, deck + 1, z, "spruce_fence")
    # flower boxes under the windows: poppies on top of the shutters row would float; use potted flowers
    _mark(world, "Mili (Militärbad)", c.x, deck + 1, c.y)


def st_gallus_tower(world: World) -> None:
    """Bell tower of St. Gallus: stone shaft, clock, saddle roof with stepped pinnacles and a lantern."""
    r = _row("building", "Stadtpfarrkirche St. Gallus")
    if r is None:
        return
    poly = _bgeom(r)
    long_v, hs, hl = buildings._orientation(poly)
    c = np.asarray(poly.centroid.coords[0])
    ends = [c + long_v * (hl + 3), c - long_v * (hl + 3)]
    # tower at the end that faces the town (north / Oberstadt side)
    end = min(ends, key=lambda e: e[1])
    tx, tz = int(round(end[0])), int(round(end[1]))
    base = _ground(world, tx, tz)
    half = 4
    top = base + 34
    v = Vox(tx - 8, base - 6, tz - 8, 17, 60, 17)
    v.fill(tx - half, base - 6, tz - half, tx + half, base, tz + half, "stone_bricks")
    v.hollow(tx - half, base + 1, tz - half, tx + half, top, tz + half, "smooth_sandstone", "air")
    for y in (base + 11, base + 22):
        v.fill(tx - half, y, tz - half, tx + half, y, tz + half, "sandstone")
    # entrance arch
    for y in range(base + 1, base + 5):
        for e in (-1, 0, 1):
            v.set(tx + e, y, tz + half, "air")
            v.set(tx + e, y, tz - half, "air")
    # belfry windows and clock faces on all four sides
    for (ax, az, nx_, nz_) in ((1, 0, 0, -1), (1, 0, 0, 1), (0, 1, -1, 0), (0, 1, 1, 0)):
        fx, fz = tx + nx_ * half, tz + nz_ * half
        for y in range(top - 6, top - 2):
            v.set(fx, y, fz, "air")
        v.set(fx, top - 3, fz, "dark_oak_fence")
        cy = top - 10
        for d1 in (-1, 0, 1):
            for d2 in (-1, 0, 1):
                v.set(fx + ax * d1, cy + d2, fz + az * d1, "lime_terracotta" if (d1, d2) != (0, 0) else "gold_block")
        v.set(fx + ax * 0, cy + 1, fz + az * 0, "gold_block")
    v.set(tx, top - 4, tz, "bell[attachment=ceiling,facing=north]")
    v.fill(tx, top - 3, tz, tx, top - 1, tz, "dark_oak_fence")
    # saddle roof along x with stepped gables and pinnacles
    for k in range(0, half + 1):
        y = top + 1 + k
        v.fill(tx - half, y, tz - half + k, tx + half, y, tz + half - k, "deepslate_tiles")
        if k < half:
            v.fill(tx - half + 1, y, tz - half + k + 1, tx + half - 1, y, tz + half - k - 1, "air")
    for gx in (tx - half, tx + half):
        for k in range(0, half + 1):
            v.fill(gx, top + 1, tz - half + k, gx, top + 1 + k, tz + half - k, "smooth_sandstone")
        for dz in (-half, half):
            v.column(gx, tz + dz, top + 1, top + 3, "sandstone_wall")
    # small lantern dome on the ridge
    v.fill(tx, top + half + 1, tz, tx, top + half + 3, tz, "oxidized_copper")
    v.set(tx, top + half + 4, tz, "oxidized_cut_copper")
    v.fill(tx, top + half + 5, tz, tx, top + half + 7, tz, "lightning_rod")
    v.commit(world.edits)
    _occupy(world, shapely.Point(tx, tz).buffer(6))
    _mark(world, "St. Gallus", tx, top + half + 8, tz)


def _rot_cells(c, a, n, s0, s1, t0, t1):
    """Integer cells of a rotated rectangle [s0,s1] x [t0,t1] in the frame (a = along, n = across)."""
    out = set()
    for s_ in np.arange(s0, s1 + 0.01, 0.5):
        for t_ in np.arange(t0, t1 + 0.01, 0.5):
            p = c + a * s_ + n * t_
            out.add((int(math.floor(p[0])), int(math.floor(p[1]))))
    return out


def herz_jesu(world: World) -> None:
    """Herz-Jesu-Kirche (1908): red-brick neo-Gothic basilica, twin towers with green copper spires, rose window."""
    r = _row("building", "Herz Jesu-Kirche")
    if r is None:
        return
    poly = _bgeom(r)
    g = world.grid
    # dominant wall direction of the footprint
    pts = np.asarray(poly.exterior.coords)
    seg = np.diff(pts, axis=0)
    ang = np.arctan2(seg[:, 1], seg[:, 0]) % (np.pi / 2)
    w = np.hypot(seg[:, 0], seg[:, 1])
    th = math.atan2((w * np.sin(4 * ang)).sum(), (w * np.cos(4 * ang)).sum()) / 4
    axes = [np.array([math.cos(th), math.sin(th)]), np.array([-math.sin(th), math.cos(th)])]
    c = np.asarray(poly.centroid.coords[0])
    m, x0, z0 = raster.polygon_cells(poly)
    zz, xx = np.nonzero(m)
    P = np.column_stack([xx + x0 + 0.5, zz + z0 + 0.5]) - c
    # the front (towers) is the end of the footprint that faces the closest street
    best = None
    for ax in axes:
        for sgn in (1, -1):
            a = ax * sgn
            ext = float((P @ a).max())
            e = c + a * (ext + 4)
            ex, ez = int(e[0]), int(e[1])
            d = float(world.dist_road[np.clip(ez - g.z0, 0, g.nz - 1), np.clip(ex - g.x0, 0, g.nx - 1)])
            if best is None or d < best[0]:
                best = (d, a, ext)
    _, a, ext = best
    n = np.array([-a[1], a[0]])
    front = P[(P @ a) > ext - 10]
    half_w = float(np.abs(front @ n).max())
    # nave + transept as a styled building (tall Gothic windows, brick, steep tile roof)
    buildings.building(world, r, poly, dict(facade="bricks", roof=("granite", "granite_slab[type=bottom]"), flat=False,
                                            gable=True, pitch=1.0, height=30, wall_height=15, windows="tall",
                                            floor_h=15, floors=False, glass="light_blue_stained_glass_pane",
                                            door=False, foundation="stone_bricks"))
    base = int(np.median(world.h(xx + x0, zz + z0)))
    v = Vox(int(c[0]) - 60, base - 6, int(c[1]) - 60, 121, 90, 121)
    tw = 4.5           # tower half size
    brick_top = base + 44
    spire_top = brick_top + 24
    fc = c + a * (ext - tw)
    for side in (-1, 1):
        tc = fc + n * side * (half_w - tw)
        cells = _rot_cells(tc, a, n, -tw, tw, -tw, tw)
        inner = _rot_cells(tc, a, n, -tw + 1, tw - 1, -tw + 1, tw - 1)
        for (x, z) in cells:
            hh = _ground(world, x, z)
            v.column(x, z, min(hh, base) - 4, base, "stone_bricks")
            v.column(x, z, base + 1, brick_top, "bricks")
        for (x, z) in inner:
            v.column(x, z, base + 1, brick_top - 1, "air")
        for y in (base + 14, base + 28, brick_top):  # floors / cornices
            for (x, z) in inner:
                v.set(x, y, z, "spruce_planks" if y != brick_top else "bricks")
        # tall twin lancet openings (belfry) and smaller windows below on the outer faces
        for face in (a, n * side, -n * side):
            for off in (-1.5, 1.5):
                p = tc + face * (tw + 0.01) + np.array([-face[1], face[0]]) * off
                x, z = int(math.floor(p[0] - face[0] * 0.5)), int(math.floor(p[1] - face[1] * 0.5))
                for y in range(brick_top - 11, brick_top - 2):
                    v.set(x, y, z, "black_stained_glass")
                for y in range(base + 18, base + 24):
                    v.set(x, y, z, "light_blue_stained_glass")
        # clock on the front face
        p = tc + a * (tw + 0.01)
        x, z = int(math.floor(p[0] - a[0] * 0.5)), int(math.floor(p[1] - a[1] * 0.5))
        v.set(x, base + 27, z, "white_concrete")
        # octagonal copper spire
        for k in range(0, spire_top - brick_top):
            rr = tw * (1 - k / (spire_top - brick_top)) + 0.3
            for (x, z) in _rot_cells(tc, a, n, -rr, rr, -rr, rr):
                q = np.array([x + 0.5, z + 0.5]) - tc
                if abs(q @ a) + abs(q @ n) <= rr * 1.42:
                    v.set(x, brick_top + 1 + k, z, "oxidized_copper" if (k + x + z) % 5 else "weathered_copper")
        tx, tz = int(math.floor(tc[0])), int(math.floor(tc[1]))
        v.column(tx, tz, spire_top + 1, spire_top + 3, "lightning_rod")
    # facade between the towers: gable wall, rose window, portal
    gc = c + a * (ext - 0.5)
    for t_ in np.arange(-(half_w - 2 * tw), (half_w - 2 * tw) + 0.01, 0.5):
        p = gc + n * t_
        x, z = int(math.floor(p[0])), int(math.floor(p[1]))
        for y in range(base + 1, base + 26):
            v.set(x, y, z, "bricks")
        rel = abs(t_)
        # rose window: disc of stained glass centred at base + 17
        for y in range(base + 12, base + 23):
            if math.hypot(rel, y - (base + 17)) <= 4.6:
                v.set(x, y, z, ["purple_stained_glass", "blue_stained_glass", "yellow_stained_glass"][int(math.hypot(rel, y - base - 17)) % 3])
        if rel <= 1.6:
            for y in range(base + 1, base + 6):
                v.set(x, y, z, "air" if y < base + 5 or rel < 1 else "bricks")
    v.commit(world.edits)
    _occupy(world, poly.buffer(1))
    _mark(world, "Herz-Jesu-Kirche", fc[0], spire_top + 4, fc[1])


def hauptpost(world: World) -> None:
    """Hauptpost Bregenz (1893-95): yellow historicist palace, dark mansard roofs, corner pavilions,
    central clock tower with antenna mast facing the harbour."""
    r = _row("building", "Post Filiale 6900")
    if r is None:
        return
    poly = _bgeom(r)
    info = buildings.building(world, r, poly, dict(
        facade="smooth_sandstone", roof=("deepslate_tiles", "deepslate_tile_slab[type=bottom]"), flat=False, gable=False,
        pitch=1.6, roof_cap=6, height=24, wall_height=16, floor_h=5, windows="normal", shop=False,
        foundation="polished_andesite", floor="spruce_planks"))
    if not info:
        return
    m, x0, z0 = info["mask"], info["x0"], info["z0"]
    base, top = info["base"], info["wall_top"]
    mT = m.T
    per = mT & ~ndimage.binary_erosion(mT, structure=[[0, 1, 0], [1, 1, 1], [0, 1, 0]])
    xs, zs = np.nonzero(per)
    X, Z = xs + x0, zs + z0
    v = Vox(x0 - 2, base - 2, z0 - 2, m.shape[1] + 4, top - base + 40, m.shape[0] + 4)
    # white cornices and rustica ground floor
    for x, z in zip(X, Z):
        for y in (base + 5, base + 10, top):
            v.set(x, y, z, "smooth_quartz")
        if (x + z) % 2 == 0:
            v.set(x, base + 1, z, "sandstone")
    # corner pavilions with steep mansard caps
    cells = list(zip(X, Z))
    corners = [max(cells, key=lambda p: p[0] + p[1]), min(cells, key=lambda p: p[0] + p[1]),
               max(cells, key=lambda p: p[0] - p[1]), min(cells, key=lambda p: p[0] - p[1])]
    for cx, cz in corners:
        sx = -1 if cx > x0 + m.shape[1] / 2 else 1
        sz = -1 if cz > z0 + m.shape[0] / 2 else 1
        px, pz = cx + sx * 3, cz + sz * 3
        v.fill(px - 3, top + 1, pz - 3, px + 3, top + 3, pz + 3, "smooth_sandstone")
        v.fill(px - 3, top + 3, pz - 3, px + 3, top + 3, pz + 3, "smooth_quartz")
        for k in range(6):
            rr = 3 - k * 0.5
            v.fill(int(px - rr), top + 4 + k, int(pz - rr), int(px + rr), top + 4 + k, int(pz + rr), "deepslate_tiles")
        v.set(px, top + 2, pz - 3 if sz > 0 else pz + 3, "glass")
    # central tower on the harbour (north) side
    north = [p for p in cells if p[1] <= min(c[1] for c in cells) + 1]
    mx = int(np.median([p[0] for p in north]))
    nz = min(p[1] for p in north)
    tz0, tz1 = nz, nz + 8
    v.fill(mx - 6, top + 1, tz0, mx + 6, top + 6, tz1, "smooth_sandstone")
    v.fill(mx - 6, top + 6, tz0, mx + 6, top + 6, tz1, "smooth_quartz")
    for k in range(8):
        v.fill(mx - 6 + k // 2, top + 7 + k, tz0 + k // 2, mx + 6 - k // 2, top + 7 + k, tz1 - k // 2, "deepslate_tiles")
    v.fill(mx - 2, top + 15, tz0 + 4, mx + 2, top + 15, tz1 - 4, "iron_block")
    # clock face towards the lake
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            v.set(mx + dx, top + 4 + dy, tz0 - 1, "white_concrete" if (dx, dy) != (0, 0) else "black_concrete")
    v.set(mx, top + 5, tz0 - 1, "black_concrete")
    # columns in front of the central risalit + arched entrances
    for dx in (-5, -2, 2, 5):
        for y in range(base + 6, top):
            v.set(mx + dx, y, nz - 1, "quartz_pillar[axis=y]")
    for dx in (-2, -1, 1, 2):
        for y in (base + 1, base + 2, base + 3):
            v.set(mx + dx, y, nz, "air")
    # antenna mast
    mz_ = (tz0 + tz1) // 2
    for y in range(top + 16, top + 31):
        v.set(mx, y, mz_, "iron_bars")
        if y % 4 == 0:
            v.set(mx + 1, y, mz_, "iron_bars")
            v.set(mx - 1, y, mz_, "iron_bars")
    v.commit(world.edits)
    _mark(world, "Hauptpost", mx, top + 16, nz)


def unteres_tor_passage(world: World) -> None:
    """Cut the gate passage through the Unteres Tor (the street climbs into the Oberstadt here)."""
    r = _row("building", "Unteres Tor")
    if r is None:
        return
    poly = _bgeom(r)
    long_v, hs, hl = buildings._orientation(poly)
    c = poly.centroid
    base = _ground(world, c.x, c.y)
    # passage runs across the short side
    n = np.array([-long_v[1], long_v[0]])
    for t in np.arange(-hs - 2, hs + 2.01, 0.5):
        for o in (-1.5, -0.5, 0.5, 1.5):
            x = int(math.floor(c.x + n[0] * t + long_v[0] * o))
            z = int(math.floor(c.y + n[1] * t + long_v[1] * o))
            hh = _ground(world, x, z)
            world.edits.set(x, hh, z, "cobblestone")
            for y in range(hh + 1, hh + 5):
                world.edits.set(x, y, z, "air")
    _mark(world, "Unteres Tor (Stadttor)", c.x, base + 1, c.y)


def gebhardsberg_ruin(world: World) -> None:
    """Burgruine Hohenbregenz on the Gebhardsberg: broken curtain wall around the summit."""
    px, pz = geo.place(47.49001, 9.74734)
    g = world.grid
    rnd = np.random.default_rng(598)
    R = 42
    for ang in np.linspace(0, 2 * np.pi, int(2 * np.pi * R * 1.4), endpoint=False):
        x = int(round(px + R * math.cos(ang) * 1.15))
        z = int(round(pz + R * math.sin(ang)))
        if not g.inside(x, z) or world.occupied[z - g.z0, x - g.x0]:
            continue
        hh = _ground(world, x, z)
        hgt = int(max(0, 7 * math.sin(ang * 3.0) + rnd.integers(-2, 5)))
        for y in range(hh + 1, hh + 1 + hgt):
            world.edits.set(x, y, z, ["stone_bricks", "mossy_stone_bricks", "cracked_stone_bricks", "cobblestone"][rnd.integers(0, 4)])
        if hgt:
            world.occupied[z - g.z0, x - g.x0] = True
    # a ruined keep stump
    kx, kz = px + 20, pz - 18
    hh = _ground(world, kx, kz)
    v = Vox(kx - 5, hh - 3, kz - 5, 11, 20, 11)
    v.hollow(kx - 4, hh - 2, kz - 4, kx + 4, hh + 9, kz + 4, "mossy_stone_bricks", "air")
    for _ in range(40):
        v.set(kx + rnd.integers(-4, 5), hh + rnd.integers(5, 10), kz + rnd.integers(-4, 5), "air")
    v.commit(world.edits)
    _mark(world, "Burgruine Hohenbregenz / Gebhardsberg", px, _ground(world, px, pz) + 1, pz)


def pfaenderbahn(world: World) -> None:
    """Pfänderbahn: aerial tramway Talstation -> Bergstation with its two pylons and two cabins."""
    rows = [r for r in data.overture("infrastructure") if r["class"] == "cable_car" and r["name"] == "Pfänderbahn"]
    if not rows:
        return
    line = _bgeom(rows[0])
    pts = [tuple(p) for p in np.asarray(line.coords)]
    supports = []
    for i, (x, z) in enumerate(pts):
        gnd = _ground(world, x, z)
        if i == 0:
            y = gnd + 11            # rope leaves the Talstation roof level
        elif i == len(pts) - 1:
            y = gnd + 9
        else:
            y = gnd + 34            # pylons
        supports.append([x, y, z, gnd])
    # make sure every span clears the ground by at least 10 blocks (raise pylons if needed)
    for _ in range(3):
        for i in range(len(supports) - 1):
            a, b = supports[i], supports[i + 1]
            L = math.hypot(b[0] - a[0], b[2] - a[2])
            for t in np.linspace(0, 1, int(L) + 1):
                x = a[0] + (b[0] - a[0]) * t
                z = a[2] + (b[2] - a[2]) * t
                y = a[1] + (b[1] - a[1]) * t - 4 * L * 0.02 * t * (1 - t)
                need = _ground(world, x, z) + 10
                if y < need and 0 < i + 1 < len(supports) - 1:
                    supports[i + 1][1] += int(need - y) + 1
                elif y < need and i > 0:
                    supports[i][1] += int(need - y) + 1
    # ropes: two parallel track ropes 3 blocks apart
    dx_all = pts[-1][0] - pts[0][0]
    dz_all = pts[-1][1] - pts[0][1]
    Lall = math.hypot(dx_all, dz_all)
    nx_, nz_ = -dz_all / Lall, dx_all / Lall
    axis = "x" if abs(dx_all) >= abs(dz_all) else "z"
    rope_pts = {-1.5: [], 1.5: []}
    for i in range(len(supports) - 1):
        a, b = supports[i], supports[i + 1]
        L = math.hypot(b[0] - a[0], b[2] - a[2])
        for t in np.linspace(0, 1, int(L * 1.5) + 2):
            x = a[0] + (b[0] - a[0]) * t
            z = a[2] + (b[2] - a[2]) * t
            y = a[1] + (b[1] - a[1]) * t - 4 * L * 0.02 * t * (1 - t)
            for o in rope_pts:
                rx, rz = int(math.floor(x + nx_ * o)), int(math.floor(z + nz_ * o))
                world.edits.set(rx, int(round(y)), rz, f"chain[axis={axis}]")
                rope_pts[o].append((rx, int(round(y)), rz))
    # pylons: white A-frame with a cross beam
    for (x, y, z, gnd) in supports[1:-1]:
        x, z = int(round(x)), int(round(z))
        v = Vox(x - 8, gnd - 2, z - 8, 17, y - gnd + 6, 17)
        for side in (-1, 1):
            v.line((x - nx_ * 6 * side, gnd + 1, z - nz_ * 6 * side), (x - nx_ * 2.5 * side, y - 1, z - nz_ * 2.5 * side), "white_concrete")
            v.line((x - nx_ * 6 * side + 1, gnd + 1, z - nz_ * 6 * side), (x - nx_ * 2.5 * side + 1, y - 1, z - nz_ * 2.5 * side), "white_concrete")
            v.fill(int(x - nx_ * 6 * side) - 1, gnd - 2, int(z - nz_ * 6 * side) - 1, int(x - nx_ * 6 * side) + 1, gnd, int(z - nz_ * 6 * side) + 1, "gray_concrete")
        v.line((x - nx_ * 3, y - 1, z - nz_ * 3), (x + nx_ * 3, y - 1, z + nz_ * 3), "light_gray_concrete")
        v.line((x - nx_ * 4, y - 12, z - nz_ * 4), (x + nx_ * 4, y - 12, z + nz_ * 4), "white_concrete")
        v.set(x, y + 1, z, "red_concrete")
        v.commit(world.edits)
    # two cabins (they meet in the middle in reality; here one low, one high)
    for o, frac in ((-1.5, 0.28), (1.5, 0.62)):
        rp = rope_pts[o]
        cx, cy, cz = rp[int(len(rp) * frac)]
        v = Vox(cx - 4, cy - 14, cz - 4, 9, 16, 9)
        v.column(cx, cz, cy - 5, cy - 1, "iron_bars")
        v.fill(cx - 1, cy - 1, cz - 1, cx + 1, cy - 1, cz + 1, "iron_block")
        top_y, bot_y = cy - 6, cy - 11
        v.hollow(cx - 2, bot_y, cz - 3, cx + 2, top_y, cz + 3, "white_concrete", "air")
        v.fill(cx - 2, bot_y + 1, cz - 3, cx + 2, bot_y + 1, cz + 3, "blue_concrete")
        v.hollow(cx - 2, bot_y + 1, cz - 3, cx + 2, bot_y + 1, cz + 3, "blue_concrete", None)
        for y in (bot_y + 2, bot_y + 3):
            for d in (-2, -1, 0, 1, 2):
                v.set(cx + d, y, cz - 3, "light_blue_stained_glass")
                v.set(cx + d, y, cz + 3, "light_blue_stained_glass")
            for d in (-2, -1, 0, 1, 2):
                v.set(cx - 2, y, cz + d, "light_blue_stained_glass")
                v.set(cx + 2, y, cz + d, "light_blue_stained_glass")
        v.fill(cx - 1, bot_y + 1, cz - 2, cx + 1, bot_y + 1, cz + 2, "air")
        v.fill(cx - 1, bot_y, cz - 2, cx + 1, bot_y, cz + 2, "gray_concrete")
        v.commit(world.edits)
    a, b = supports[0], supports[-1]
    _mark(world, "Pfänderbahn Talstation", a[0], a[3] + 1, a[2])
    _mark(world, "Pfänderbahn Bergstation", b[0], b[3] + 1, b[2])


def sender(world: World) -> None:
    """Sender Pfänder (94.7 m): concrete shaft, equipment platform, red-white antenna."""
    r = _row("building", "Sender Pfänder")
    poly = _bgeom(r)
    c = poly.centroid
    x, z = int(round(c.x)), int(round(c.y))
    base = _ground(world, x, z)
    top = base + 95
    v = Vox(x - 9, base - 4, z - 9, 19, 104, 19)
    v.fill(x - 7, base - 4, z - 7, x + 7, base, z + 7, "gray_concrete")
    for y in range(base + 1, base + 62):
        r_ = 4.0 if y < base + 20 else 3.2
        v.disk(x, z, y, r_, "light_gray_concrete", filled=False)
    v.fill(x - 1, base + 1, z - 4, x + 1, base + 3, z - 4, "air")
    v.set(x, base + 1, z - 4, "iron_door[facing=north,half=lower]")
    v.set(x, base + 2, z - 4, "iron_door[facing=north,half=upper]")
    for y in range(base + 62, base + 68):
        v.disk(x, z, y, 7.5 if y in (base + 62, base + 67) else 7.0, "light_gray_concrete" if y in (base + 62, base + 67) else "gray_stained_glass", filled=y in (base + 62, base + 67))
    for y in range(base + 68, top + 1):
        rel = y - base - 68
        v.set(x, y, z, "red_concrete" if (rel // 4) % 2 == 0 else "white_concrete")
        if rel % 9 == 0:
            for d in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                v.set(x + d[0], y, z + d[1], "iron_bars")
    v.set(x, top + 1, z, "redstone_lamp[lit=true]")
    v.set(x, top + 2, z, "lightning_rod")
    v.commit(world.edits)
    _occupy(world, shapely.Point(x, z).buffer(8))
    _mark(world, "Sender Pfänder", x, top + 3, z)


def gipfelkreuz(world: World) -> None:
    """Summit cross at the highest point of the Pfänder (1062 m)."""
    g = world.grid
    px, pz = geo.place(47.50737, 9.7802)
    # snap to the true high point within 40 blocks
    iz0, ix0 = pz - g.z0, px - g.x0
    sub = world.H[iz0 - 40:iz0 + 41, ix0 - 40:ix0 + 41]
    oz, ox = np.unravel_index(int(np.argmax(sub)), sub.shape)
    x, z = px - 40 + int(ox), pz - 40 + int(oz)
    if world.occupied[z - g.z0, x - g.x0]:
        x, z = px, pz
    h = _ground(world, x, z)
    v = Vox(x - 3, h - 1, z - 3, 7, 14, 7)
    v.fill(x - 1, h, z - 1, x + 1, h, z + 1, "cobblestone")
    v.column(x, z, h + 1, h + 10, "dark_oak_log[axis=y]")
    v.fill(x - 3, h + 7, z, x + 3, h + 7, z, "dark_oak_log[axis=x]")
    v.set(x, h + 11, z, "dark_oak_slab[type=bottom]")
    v.commit(world.edits)
    sign(world, x + 2, z + 2, ["Pfänder", "1062 m", "Gipfel"], 2, y=h + 1)
    _occupy(world, shapely.Point(x, z).buffer(3))
    _mark(world, "Pfänder Gipfelkreuz", x, h + 1, z)


def wildpark(world: World) -> None:
    """Alpenwildpark Pfänder: fenced enclosures with feeding huts."""
    for r in data.overture("land_use"):
        if r["class"] != "zoo":
            continue
        poly = _bgeom(r)
        ring = _ring_cells(poly)
        g = world.grid
        ring = {(x, z) for (x, z) in ring if g.inside(x, z) and not world.occupied[z - g.z0, x - g.x0]
                and not world.road[z - g.z0, x - g.x0]}
        fence_ring(world, ring, "spruce_fence", 2)
        c = poly.centroid
        for k, (ox, oz) in enumerate(((0, 0), (-35, 40), (40, -30))):
            hx, hz = int(c.x + ox), int(c.y + oz)
            hh = _ground(world, hx, hz)
            v = Vox(hx - 3, hh - 1, hz - 3, 7, 8, 7)
            v.hollow(hx - 2, hh + 1, hz - 2, hx + 2, hh + 3, hz + 2, "spruce_planks", "air")
            v.fill(hx - 2, hh + 1, hz - 2, hx + 2, hh + 2, hz - 2, "air")
            v.fill(hx - 3, hh + 4, hz - 3, hx + 3, hh + 4, hz + 3, "spruce_slab[type=bottom]")
            v.set(hx, hh + 1, hz + 1, "hay_block")
            v.commit(world.edits)
        _mark(world, "Alpenwildpark Pfänder", c.x, _ground(world, c.x, c.y) + 1, c.y)


def pfaenderdohle(world: World) -> None:
    """Berggasthaus Pfänderdohle (no OSM footprint: placed at the project coordinates)."""
    x, z = geo.place(47.5055, 9.7820)
    g = world.grid
    if world.occupied[z - g.z0, x - g.x0]:
        spot = _free_spot_near(world, x, z, 30)
        if not spot:
            return
        x, z = spot
    poly = shapely.box(x - 9, z - 6, x + 9, z + 6)
    row = {"id": "pfaenderdohle", "geom": None, "name": "Pfänderdohle"}
    info = buildings.building(world, row, poly, dict(facade="spruce_planks", roof=("dark_oak_planks", "dark_oak_slab[type=bottom]"),
                                                       flat=False, gable=True, pitch=0.6, height=11, windows="shutters",
                                                       shutter="green_terracotta", foundation="cobblestone"))
    if info:
        _mark(world, "Pfänderdohle (Berggasthaus)", x, info["base"] + 1, z)


def harbour_detail(world: World) -> None:
    """Ships, marina boats and the twin harbour lights (see harbour.py)."""
    from . import harbour
    world.harbour_stats = harbour.build(world)


# --------------------------------------------------------------- labels
LABELS = [
    ("Kunsthaus Bregenz", "building", "Kunsthaus Bregenz", ["Kunsthaus", "Bregenz", "(KUB)"]),
    ("vorarlberg museum", "building", "vorarlberg museum", ["vorarlberg", "museum"]),
    ("Landestheater", "building", "Theater am Kornmarkt", ["Vorarlberger", "Landestheater"]),
    ("Festspielhaus", "building", "Festspiel- und Kongresshaus Bregenz", ["Festspielhaus", "Bregenz"]),
    ("Altes Rathaus", "building", "Altes Rathaus", ["Altes", "Rathaus"]),
    ("Deuring-Schlössle", "building", "Deuringschlößle", ["Deuring-", "Schlössle"]),
    ("Martinsturm", "building", "Martinsturm Bregenz", ["Martinsturm", "1602"]),
    ("Pfarrkirche St. Gallus", "building", "Stadtpfarrkirche St. Gallus", ["Pfarrkirche", "St. Gallus"]),
    ("Mili", "building", "Nostalgiebad Mili", ["Militärbad", "Mili"]),
    ("Hauptpost (Schild)", "building", "Post Filiale 6900", ["Hauptpost", "Bregenz", "1895"]),
    ("Herz-Jesu-Kirche (Schild)", "building", "Herz Jesu-Kirche", ["Herz-Jesu-", "Kirche", "1908"]),
    ("Seebühne", "infrastructure", "Seebühne Bregenz", ["Seebühne", "Bregenzer", "Festspiele"]),
    ("Fischersteg", "infrastructure", "Fischersteg", ["Fischersteg"]),
    ("Bahnhof", "building", None, None),
    ("Wallfahrtskirche Gebhardsberg", "building", "Wallfahrtskirche Hl. Gebhard", ["Gebhardsberg", "Burg", "Hohenbregenz"]),
    ("Pfänderbahn Talstation", "building", "Talstation", ["Pfänderbahn", "Talstation"]),
    ("Pfänderbahn Bergstation", "building", "Bergstation", ["Pfänderbahn", "Bergstation", "1022 m"]),
    ("St. Wendelin (Fluh)", "building", "Pfarrkirche St. Wendelin", ["Fluh", "St. Wendelin"]),
    ("Sender Pfänder", "building", "Sender Pfänder", ["Sender", "Pfänder"]),
]


def _labels(world: World) -> None:
    for key, kind, name, lines in LABELS:
        if name is None:
            continue
        r = _row(kind, name)
        if r is None:
            continue
        c = _bgeom(r).centroid
        label(world, key, c.x, c.y, lines)
    x, z = geo.place(47.49961, 9.74654)
    label(world, "Kapuzinerkloster", x, z, ["Kapuziner-", "kloster", "St. Antonius"])
    # Bahnhof: platform of Bregenz Bahnhof
    for r in data.overture("infrastructure"):
        if r["name"] == "Bregenz Bahnhof" and r["class"] == "bus_station":
            c = _bgeom(r).centroid
            label(world, "Bahnhof Bregenz", c.x, c.y, ["Bahnhof", "Bregenz"])
            break
    x, z = geo.place(47.4897, 9.7618)
    _mark(world, "Fluh (Projekt-Koordinate)", x, world.surface(x, z), z)


def _occupy(world: World, geom) -> None:
    g = world.grid
    m, x0, z0 = raster.polygon_cells(geom)
    zz, xx = np.nonzero(m)
    X, Z = xx + x0, zz + z0
    ok = g.inside(X, Z)
    world.occupied[(Z - g.z0)[ok], (X - g.x0)[ok]] = True
