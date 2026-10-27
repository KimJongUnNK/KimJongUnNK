"""Hand-built Bregenz landmarks at their real positions.

Footprints come from OpenStreetMap (via Overture) wherever they exist; the
coordinates supplied for the project are used where OSM has no footprint.
"""
from __future__ import annotations

import math

import numpy as np
import shapely
import shapely.ops
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
    "Martinskapelle": dict(tower=False, baroque=True, facade="smooth_sandstone", roof=("bricks", "brick_slab[type=bottom]"), flat=False, gable=True,
                           height=14, windows="tall", floor_h=12, floors=False),
    "Nostalgiebad Mili": dict(facade="dark_oak_planks", roof=("spruce_planks", "spruce_slab[type=bottom]"), flat=False,
                              gable=False, pitch=0.6, height=8, windows="shutters", shutter="lime_terracotta",
                              base=WL + 2, floor="spruce_planks"),
    "Stadtpfarrkirche St. Gallus": dict(tower=False, baroque=True, facade="smooth_sandstone", roof=("bricks", "brick_slab[type=bottom]"), flat=False,
                                        gable=True, pitch=0.9, height=24, wall_height=12, windows="tall", floor_h=12,
                                        floors=False),
    "Wallfahrtskirche Hl. Gebhard": dict(tower="turret", baroque=True, facade="smooth_sandstone", roof=("deepslate_tiles", "deepslate_tile_slab[type=bottom]"),
                                         flat=False, gable=True, height=13, windows="tall", floor_h=10, floors=False),
    "Burgrestaurant Gebhardsberg": dict(facade="stone_bricks", roof=("deepslate_tiles", "deepslate_tile_slab[type=bottom]"), windows="shutters", shutter="dark_oak_planks",
                                        flat=False, gable=False, height=11, foundation="mossy_stone_bricks"),
    "St. Antonius": dict(tower="turret", facade="white_concrete", roof=("deepslate_tiles", "deepslate_tile_slab[type=bottom]"), flat=False,
                         gable=True, height=15, windows="tall", floor_h=10, floors=False),
    "Pfarrkirche St. Wendelin": dict(tower="tower", spire="oxidized_cut_copper", facade="white_concrete", roof=("deepslate_tiles", "deepslate_tile_slab[type=bottom]"),
                                     flat=False, gable=True, height=13, windows="tall", floor_h=10, floors=False),
    "Talstation": dict(facade="light_gray_concrete", flat=True, height=12, glass="light_blue_stained_glass_pane", shop=True,
                       green_roof=False),
    "Bergstation": dict(skip=True),             # custom (pfaenderbahn)
    "vorarlberg museum": dict(skip=True),       # custom
    "Kunsthaus Bregenz": dict(skip=True),       # custom
    "Martinsturm Bregenz": dict(skip=True),     # custom
    "Sender Pfänder": dict(skip=True),          # custom
    "Haupttribüne": dict(skip=True),            # custom
    "Herz Jesu-Kirche": dict(skip=True),        # custom
    "Post Filiale 6900": dict(skip=True),       # custom (Hauptpost am Hafen)
    "Bregenz Busbahnhof": dict(skip=True),     # custom: bus canopy + station building (bahnhof())
    "Haus am Hafen": dict(skip=True),           # custom (Sutterlüty cubes, kreisverkehr_schillerstrasse)
    "Casino Bregenz": dict(skip=True),          # custom (two domes)
}


def styles_for(world: World):
    kapuziner = shapely.Point(*geo.place(47.49961, 9.74654)).buffer(6)

    harb = [raster.to_block_geom(r["geom"]) for r in data.overture("water") if r["name"] == "Hafen Bregenz"
            and r["geom"].geom_type in ("Polygon", "MultiPolygon")]
    hzone = harb[0].buffer(45) if harb else None
    station = shapely.Point(*geo.place(47.502944, 9.739917)).buffer(90)
    roundabout = shapely.Point(*geo.place(47.505944, 9.749500))

    stadiums = [raster.to_block_geom(r["geom"]) for r in data.overture("land_use") if r["class"] == "stadium"]

    def style(r):
        s = STYLES.get(r["name"])
        if s is not None:
            return dict(s)
        if r.get("class") in ("stadium", "grandstand") and stadiums:
            p = raster.to_block_geom(r["geom"])
            near = min(stadiums, key=lambda sg: sg.distance(p))
            if near.distance(p) < 15:
                return dict(grandstand=near)
        if r.get("class") == "roof" and station is not None and raster.to_block_geom(r["geom"]).intersects(station):
            return dict(skip=True)  # platform canopies: built by bahnhof()
        if r.get("class") == "school" and r["name"] is None and raster.to_block_geom(r["geom"]).distance(roundabout) < 40:
            # HTL Bregenz: grey building behind a metal lamella screen
            return dict(facade="light_gray_concrete", flat=True, height=18, glass="light_gray_stained_glass_pane",
                        green_roof=False, lamellas=True)
        if r.get("class") == "office" and raster.to_block_geom(r["geom"]).distance(roundabout) < 45:
            return dict(facade="light_gray_concrete", flat=True, height=11, glass="glass_pane", shop=True, green_roof=False)
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
               unteres_tor_passage, herz_jesu, hauptpost, bahnhof, casino, kreisverkehr_schillerstrasse, gebhardsberg_ruin, pfaenderbahn, sender, gipfelkreuz, wildpark, pfaenderdohle,
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
    buildings.building(world, r, poly, dict(tower=False, facade="bricks", roof=("granite", "granite_slab[type=bottom]"), flat=False,
                                            gable=True, pitch=1.0, height=30, wall_height=15, windows="tall",
                                            floor_h=15, floors=False, glass="light_blue_stained_glass_pane",
                                            door=False, foundation="stone_bricks"))
    base = int(np.median(world.h(xx + x0, zz + z0)))
    v = Vox(int(c[0]) - 60, base - 6, int(c[1]) - 60, 121, 90, 121)
    tw = 4.5           # tower half size
    brick_top = base + 40
    spire_top = base + 62
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


def bahnhof(world: World) -> None:
    """Bahnhof Bregenz: platform canopies with teal (copper) roofs and the footbridge over the tracks."""
    g = world.grid
    station = shapely.Point(*geo.place(47.502944, 9.739917)).buffer(90)
    n = 0
    for r in data.overture("building"):
        if r.get("class") != "roof":
            continue
        p = _bgeom(r)
        if not p.intersects(station) or p.area < 200:
            continue
        m, x0, z0 = raster.polygon_cells(p)
        zz, xx = np.nonzero(m)
        X, Z = xx + x0, zz + z0
        ok = g.inside(X, Z)
        X, Z = X[ok], Z[ok]
        base = int(np.median(world.h(X, Z)))
        y = base + 5
        long_v, hs, hl = buildings._orientation(p)
        c = np.asarray(p.centroid.coords[0])
        nrm = np.array([-long_v[1], long_v[0]])
        for x, z in zip(X, Z):
            q = np.array([x + 0.5, z + 0.5]) - c
            across = abs(q @ nrm)
            # gently arched roof: higher along the middle
            world.edits.set(int(x), y + (1 if across < hs * 0.45 else 0), int(z),
                            "oxidized_cut_copper_slab[type=bottom]" if across < hs * 0.8 else "white_concrete")
            along = q @ long_v
            if across < 0.8 and int(round(along)) % 9 == 0:
                for yy in range(int(world.h(x, z)) + 1, y + 1):
                    world.edits.set(int(x), yy, int(z), "white_concrete")
        n += 1
    # bus station: open canopy on white columns + the station building (white, teal roofs) next to the tracks
    bb = _row("building", "Bregenz Busbahnhof")
    if bb is not None:
        p = _bgeom(bb)
        m, x0, z0 = raster.polygon_cells(p)
        zz, xx = np.nonzero(m)
        X, Z = xx + x0, zz + z0
        ok = g.inside(X, Z)
        X, Z = X[ok], Z[ok]
        base = int(np.median(world.h(X, Z)))
        for x, z in zip(X, Z):
            world.edits.set(int(x), base + 7, int(z), "oxidized_cut_copper_slab[type=bottom]")
            if x % 10 == 0 and z % 10 == 0:
                for yy in range(int(world.h(x, z)) + 1, base + 7):
                    world.edits.set(int(x), yy, int(z), "white_concrete")
        rails = [raster.to_block_geom(r["geom"]) for r in data.overture("segment") if r["subtype"] == "rail"]
        rl = shapely.union_all(rails) if rails else None
        if rl is not None:
            q = shapely.ops.nearest_points(rl, p.centroid)[0]
            cpt = shapely.ops.nearest_points(p, q)[0]
            sc = np.asarray(cpt.coords[0]) + (np.asarray(p.centroid.coords[0]) - np.asarray(cpt.coords[0])) * 0.25
            seg = max(getattr(rl, "geoms", [rl]), key=lambda l: -l.distance(q))
            d0 = seg.project(q)
            a_ = np.asarray(seg.interpolate(max(d0 - 10, 0)).coords[0])
            b_ = np.asarray(seg.interpolate(min(d0 + 10, seg.length)).coords[0])
            t = (b_ - a_) / (np.linalg.norm(b_ - a_) + 1e-9)
            box = shapely.Polygon([tuple(sc + t * u + np.array([-t[1], t[0]]) * w) for u, w in
                                   ((-17, -8), (17, -8), (17, 8), (-17, 8))])
            row = {"id": "bahnhof-empfang", "geom": None, "name": "Bahnhof Bregenz"}
            buildings.building(world, row, box, dict(facade="white_concrete", roof=("oxidized_cut_copper", "oxidized_cut_copper_slab[type=bottom]"),
                                                     flat=False, gable=False, pitch=0.6, height=15, wall_height=10,
                                                     glass="light_blue_stained_glass_pane", shop=True, windows="normal"))
        _occupy(world, p)

    # footbridge across the tracks, from the station building towards the lake side
    if bb is not None:
        rails = [raster.to_block_geom(r["geom"]) for r in data.overture("segment") if r["subtype"] == "rail"
                 and r["geom"].intersects(shapely.box(9.7385, 47.5022, 9.7415, 47.5037))]
        if rails:
            rl = shapely.union_all(rails)
            sc = _bgeom(bb).centroid
            near = shapely.ops.nearest_points(sc, rl)[1]
            # local track direction
            seg = max(getattr(rl, "geoms", [rl]), key=lambda l: -l.distance(near))
            d0 = seg.project(near)
            a_ = np.asarray(seg.interpolate(max(d0 - 10, 0)).coords[0])
            b_ = np.asarray(seg.interpolate(min(d0 + 10, seg.length)).coords[0])
            t = (b_ - a_) / (np.linalg.norm(b_ - a_) + 1e-9)
            nrm = np.array([-t[1], t[0]])
            start = np.asarray(near.coords[0])
            if (np.asarray(sc.coords[0]) - start) @ nrm > 0:
                nrm = -nrm
            start = start - nrm * 14  # start on the station side
            L = 46
            # clear the tracks and the catenary: highest ground below the bridge + 10
            hmax = max(int(world.h(int(p_[0]), int(p_[1]))) for p_ in (start + nrm * k for k in range(0, L, 2)))
            deck = hmax + 10
            for k in np.arange(0, L, 0.5):
                for o in (-1.5, -0.5, 0.5, 1.5):
                    p_ = start + nrm * k + t * o
                    x, z = int(math.floor(p_[0])), int(math.floor(p_[1]))
                    world.edits.set(x, deck, z, "smooth_stone")
                    world.edits.set(x, deck + 4, z, "oxidized_cut_copper_slab[type=bottom]")
                    edge = abs(o) > 1
                    for yy in (deck + 1, deck + 2, deck + 3):
                        world.edits.set(x, yy, z, "light_blue_stained_glass" if edge and yy > deck + 1 else
                                        ("oxidized_cut_copper" if edge else "air"))
                if int(k * 2) % 24 == 0:
                    for o in (-1.5, 1.5):
                        p_ = start + nrm * k + t * o
                        x, z = int(math.floor(p_[0])), int(math.floor(p_[1]))
                        for yy in range(int(world.h(x, z)) + 1, deck):
                            world.edits.set(x, yy, z, "white_concrete")
            # stair tower at the lake end (round glass tower in the aerial photo)
            e = start + nrm * L
            ex, ez = int(e[0]), int(e[1])
            hh = int(world.h(ex, ez))
            v = Vox(ex - 5, hh - 1, ez - 5, 11, deck - hh + 8, 11)
            for yy in range(hh + 1, deck + 4):
                v.disk(ex, ez, yy, 4, "light_blue_stained_glass" if (yy - hh) % 4 else "white_concrete", filled=False)
            v.disk(ex, ez, deck + 4, 4, "oxidized_cut_copper")
            v.commit(world.edits)
    sx, sz = geo.place(47.502944, 9.739917)
    _mark(world, "Bahnhof Bregenz (Bahnsteige)", sx, world.surface(sx, sz), sz)


def casino(world: World) -> None:
    """Casino Bregenz next to the Festspielhaus: low building with two shallow grey domes."""
    r = _row("building", "Casino Bregenz")
    if r is None:
        return
    p = _bgeom(r)
    info = buildings.building(world, r, p, dict(facade="light_gray_concrete", flat=True, height=12, green_roof=False,
                                                glass="gray_stained_glass_pane", shop=True))
    if not info:
        return
    top = info["wall_top"]
    long_v, hs, hl = buildings._orientation(p)
    c = np.asarray(p.centroid.coords[0])
    for side in (-1, 1):
        dc = c + long_v * side * hl * 0.45
        cx, cz = int(dc[0]), int(dc[1])
        R = min(11.0, hs * 0.8)
        v = Vox(cx - 13, top, cz - 13, 27, 14, 27)
        for dy in range(0, int(R * 0.55) + 1):
            rr = math.sqrt(max(R * R - (dy / 0.55) ** 2, 0))
            v.disk(cx, cz, top + 1 + dy, rr, "light_gray_concrete" if dy % 3 else "gray_stained_glass", filled=False)
        v.disk(cx, cz, top + 1 + int(R * 0.55), 2, "glass")
        v.commit(world.edits)
    _mark(world, "Casino Bregenz", c[0], top + 2, c[1])


def kreisverkehr_schillerstrasse(world: World) -> None:
    """Roundabout at Schillerstrasse: planted island; Sutterlüty ground floor (pink posters) at the Haus am Hafen."""
    x, z = geo.place(47.505944, 9.749500)
    g = world.grid
    rnd = np.random.default_rng(7)
    for dx in range(-6, 7):
        for dz in range(-6, 7):
            d = math.hypot(dx, dz)
            px, pz = x + dx, z + dz
            if d <= 5.5 and g.inside(px, pz):
                iz, ix = pz - g.z0, px - g.x0
                world.top[iz, ix] = B("grass_block")
                world.road[iz, ix] = False
                world.occupied[iz, ix] = True
                hh = int(world.H[iz, ix])
                k = rnd.random()
                if d > 4.4:
                    world.edits.set(px, hh, pz, "stone_bricks")  # kerb
                elif k < 0.25:
                    world.edits.set(px, hh + 1, pz, "flowering_azalea")
                elif k < 0.6:
                    world.edits.set(px, hh + 1, pz, ["red_tulip", "pink_tulip", "allium", "oxeye_daisy"][int(k * 40) % 4])
                else:
                    world.edits.set(px, hh + 1, pz, "short_grass")
    world.edits.set(x, int(world.h(x, z)) + 1, z, "azalea")
    _sutterluety(world)
    _mark(world, "Kreisverkehr Schillerstrasse", x, int(world.h(x, z)) + 1, z)


def _sutterluety(world: World) -> None:
    """Haus am Hafen: green-tinted glass ground floor (Sutterlüty Ländlemarkt) under dark wood-clad cubes on
    columns, strip windows with blinds, shrubs on the roofs."""
    r = _row("building", "Haus am Hafen")
    if r is None:
        return
    poly = _bgeom(r)
    long_v, hs_, hl = buildings._orientation(poly)
    c = np.asarray(poly.centroid.coords[0])
    m, x0, z0 = raster.polygon_cells(poly)
    mT = m.T
    xs, zs = np.nonzero(mT)
    X, Z = xs + x0, zs + z0
    base = int(np.median(world.h(X, Z)))
    per = mT & ~ndimage.binary_erosion(mT, structure=[[0, 1, 0], [1, 1, 1], [0, 1, 0]])
    along = (np.column_stack([X + 0.5, Z + 0.5]) - c) @ long_v
    # the upper storeys are separate cubes ~26 long with 7-block gaps; the cube edges are their own walls
    seg = np.floor((along + hl) / 33).astype(int)
    pos = (along + hl) - seg * 33
    in_cube = pos < 26
    cube_id = np.where(in_cube, seg, -1)
    cmap = np.full(mT.shape, -1, dtype=int)
    cmap[xs, zs] = cube_id
    pc = np.pad(cmap, 1, constant_values=-1)
    cube_edge = in_cube & ((pc[2:, 1:-1][xs, zs] != cube_id) | (pc[:-2, 1:-1][xs, zs] != cube_id) |
                           (pc[1:-1, 2:][xs, zs] != cube_id) | (pc[1:-1, :-2][xs, zs] != cube_id))
    v = Vox(x0 - 2, base - 3, z0 - 2, m.shape[1] + 4, 30, m.shape[0] + 4)
    g1, top = base + 5, base + 18
    for i, (x, z) in enumerate(zip(X, Z)):
        edge = per[x - x0, z - z0]
        v.column(x, z, int(world.h(x, z)) + 1, base - 1, "stone")
        v.set(x, base, z, "polished_andesite")
        # ground floor: green glass curtain wall, columns every 8 blocks
        for y in range(base + 1, g1):
            if edge:
                v.set(x, y, z, "light_gray_concrete" if int(pos[i]) % 8 == 0 else "green_stained_glass")
            else:
                v.set(x, y, z, "light[level=15]" if (y == base + 4 and x % 6 == 0 and z % 6 == 0) else "air")
        v.set(x, g1, z, "gray_concrete")
        if not in_cube[i]:
            v.set(x, g1 + 1, z, "smooth_stone" if not edge else "gray_concrete")
            continue
        # dark wood cubes with strip windows + blinds
        for y in range(g1 + 1, top):
            rel = y - g1
            if cube_edge[i]:
                if rel % 4 == 2:
                    blk = "gray_stained_glass" if int(pos[i]) % 5 else "dark_oak_planks"
                elif rel % 4 == 3:
                    blk = "iron_bars" if int(pos[i]) % 5 else "dark_oak_planks"
                else:
                    blk = "dark_oak_planks"
            else:
                blk = "spruce_planks" if rel % 4 == 0 else ("light[level=13]" if (rel % 4 == 2 and x % 6 == 0 and z % 6 == 0) else "air")
            v.set(x, y, z, blk)
        v.set(x, top, z, "smooth_stone" if not cube_edge[i] else "dark_oak_planks")
        if cube_edge[i] and (x + z) % 3 == 0:
            v.set(x, top + 1, z, "azalea_leaves[persistent=true]")
            if (x + z) % 6 == 0:
                v.set(x, top + 2, z, "azalea_leaves[persistent=true]")
    v.commit(world.edits)
    _occupy(world, poly)
    _mark(world, "Sutterlüty / Haus am Hafen", c[0], top + 1, c[1])


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
    """Burgruine Hohenbregenz on the Gebhardsberg (598 m): the ring wall follows the edge of the rock
    plateau, with breaches, merlon remnants and a gate where the path comes up; a ruined palas wing
    next to the pilgrimage church (which was built into the old palas) and the terrace of the
    Burgrestaurant looking out over the lake."""
    g = world.grid
    px, pz = geo.place(47.49001, 9.74734)
    rnd = np.random.default_rng(598)
    R = 95
    xa, xb = max(px - R - g.x0, 0), min(px + R - g.x0, g.nx)
    za, zb = max(pz - R - g.z0, 0), min(pz + R - g.z0, g.nz)
    if not g.inside(px, pz):
        return
    H = world.H[za:zb, xa:xb].astype(int)
    cz_, cx_ = pz - g.z0 - za, px - g.x0 - xa
    ph = int(H[max(cz_ - 25, 0):cz_ + 25, max(cx_ - 25, 0):cx_ + 25].max())
    # plateau = the connected area near the top (castle hill), plus the church and restaurant
    plateau = H >= ph - 7
    lab, _ = ndimage.label(plateau)
    sub = lab[max(cz_ - 25, 0):cz_ + 25, max(cx_ - 25, 0):cx_ + 25]
    ids = np.unique(sub[sub > 0])
    plateau = np.isin(lab, ids)
    for name in ("Wallfahrtskirche Hl. Gebhard", "Burgrestaurant Gebhardsberg"):
        r = _row("building", name)
        if r is not None:
            m, x0, z0 = raster.polygon_cells(_bgeom(r).buffer(4))
            zz, xx = np.nonzero(m)
            zz, xx = zz + z0 - g.z0 - za, xx + x0 - g.x0 - xa
            ok = (zz >= 0) & (zz < plateau.shape[0]) & (xx >= 0) & (xx < plateau.shape[1])
            plateau[zz[ok], xx[ok]] = True
    plateau = ndimage.binary_closing(plateau, iterations=3)
    plateau = ndimage.binary_fill_holes(plateau)
    ring = plateau & ~ndimage.binary_erosion(plateau, structure=np.ones((3, 3)), iterations=2)
    # open castle courtyard: meadow with gravel paths instead of forest
    yard = plateau & ~ring
    yz, yx = np.nonzero(yard)
    gz_, gx_ = yz + za, yx + xa
    keep = ~world.occupied[gz_, gx_]
    gz_, gx_ = gz_[keep], gx_[keep]
    world.top[gz_, gx_] = np.where((gx_ + gz_) % 7 == 0, B("gravel"), B("grass_block")).astype(np.uint16)
    world.occupied[gz_, gx_] = True
    rz, rx = np.nonzero(ring)
    X, Z = rx + xa + g.x0, rz + za + g.z0
    ang = np.arctan2(Z - pz, X - px)
    mats = ["stone_bricks"] * 6 + ["mossy_stone_bricks"] * 5 + ["cracked_stone_bricks"] * 3 + \
           ["cobblestone"] * 3 + ["mossy_cobblestone"] * 2 + ["andesite"]
    roads = world.road
    gate = None
    n_wall = 0
    for x, z, a in zip(X, Z, ang):
        iz, ix = z - g.z0, x - g.x0
        if world.occupied[iz, ix]:
            continue
        if roads[iz, ix]:
            gate = gate or (int(x), int(z))
            continue
        hh = int(world.H[iz, ix])
        wave = 5.5 + 3.0 * math.sin(a * 3.0 + 0.7) + 1.5 * math.sin(a * 7.0)
        hgt = int(max(0, wave + rnd.integers(-1, 2)))
        if math.sin(a * 5.0 + 2.0) < -0.82:  # breaches
            hgt = int(rnd.integers(0, 2))
        for y in range(hh - 2, hh + 1 + hgt):
            world.edits.set(int(x), y, int(z), mats[rnd.integers(len(mats))])
        if hgt >= 5 and (x + z) % 3 == 0:  # merlon remnants
            world.edits.set(int(x), hh + 1 + hgt, int(z), mats[rnd.integers(len(mats))])
        if hgt <= 1:
            world.edits.set(int(x), hh + 1 + hgt, int(z), "gravel" if rnd.random() < 0.5 else "mossy_cobblestone")
        world.occupied[iz, ix] = True
        n_wall += 1
    # gate where the path comes up: two pillars and a round arch
    if gate:
        gx, gz = gate
        hh = int(world.h(gx, gz))
        v = Vox(gx - 6, hh - 2, gz - 6, 13, 14, 13)
        for dx, dz in ((-3, 0), (3, 0), (0, -3), (0, 3)):
            if not world.road[min(max(gz + dz - g.z0, 0), g.nz - 1), min(max(gx + dx - g.x0, 0), g.nx - 1)]:
                v.column(gx + dx, gz + dz, hh - 2, hh + 7, "stone_bricks")
                v.set(gx + dx, hh + 8, gz + dz, "mossy_stone_bricks")
        for dx in range(-3, 4):
            for dz in range(-3, 4):
                if abs(dx) == 3 or abs(dz) == 3:
                    if abs(dx) + abs(dz) >= 5:
                        v.set(gx + dx, hh + 6, gz + dz, "stone_brick_stairs[facing=north,half=top]")
        v.commit(world.edits)
    # ruined palas wing beside the church: tall wall with empty arched windows
    r = _row("building", "Wallfahrtskirche Hl. Gebhard")
    if r is not None:
        cp = _bgeom(r)
        long_v, hs, hl = buildings._orientation(cp)
        c = np.asarray(cp.centroid.coords[0])
        nrm = np.array([-long_v[1], long_v[0]])
        start = c + long_v * (hl + 1)
        base = int(world.h(int(start[0]), int(start[1])))
        for k in range(0, 18):
            for side in (-1, 1):
                p = start + long_v * k + nrm * side * (hs + 0.5)
                x, z = int(math.floor(p[0])), int(math.floor(p[1]))
                if not g.inside(x, z) or world.occupied[z - g.z0, x - g.x0]:
                    continue
                top = base + 10 - int(k * 0.45) - int(rnd.integers(0, 3))
                for y in range(int(world.h(x, z)) - 1, top):
                    window = 4 <= y - base <= 6 and k % 5 in (2, 3)
                    world.edits.set(x, y, z, "air" if window else mats[rnd.integers(len(mats))])
                world.occupied[z - g.z0, x - g.x0] = True
    # restaurant terrace on the lake side with tables, chairs and parasols
    r = _row("building", "Burgrestaurant Gebhardsberg")
    if r is not None:
        rp = _bgeom(r)
        c = np.asarray(rp.centroid.coords[0])
        lake = np.argwhere(world.lake_mask[za:zb, xa:xb])
        if len(lake):
            lz, lx = lake.mean(axis=0)
            d = np.array([lx + xa + g.x0 - c[0], lz + za + g.z0 - c[1]])
        else:
            d = np.array([-1.0, -1.0])
        d /= np.linalg.norm(d) + 1e-9
        nrm = np.array([-d[1], d[0]])
        long_v, hs, hl = buildings._orientation(rp)
        edge = max(hs, hl)
        base = int(np.median(world.h(*np.round(c).astype(int))))
        cells = set()
        for a in np.arange(edge * 0.6, edge * 0.6 + 9, 0.5):
            for o in np.arange(-edge * 0.8, edge * 0.8, 0.5):
                p = c + d * a + nrm * o
                cells.add((int(math.floor(p[0])), int(math.floor(p[1]))))
        cells = {cl for cl in cells if g.inside(*cl) and not world.occupied[cl[1] - g.z0, cl[0] - g.x0]}
        for (x, z) in cells:
            hh = int(world.h(x, z))
            for y in range(min(hh, base) - 1, base):
                world.edits.set(x, y, z, "stone_bricks")
            world.edits.set(x, base, z, "smooth_stone")
            for y in range(base + 1, max(hh, base) + 3):
                world.edits.set(x, y, z, "air")
        border = {cl for cl in cells if any((cl[0] + dx, cl[1] + dz) not in cells for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)))}
        for (x, z) in border:
            props = ",".join(f"{dn}={str((x + ddx, z + ddz) in border).lower()}" for dn, (ddx, ddz) in
                             (("north", (0, -1)), ("south", (0, 1)), ("east", (1, 0)), ("west", (-1, 0))))
            world.edits.set(x, base + 1, z, f"iron_bars[{props}]")
        inner = sorted(cells - border)
        for i, (x, z) in enumerate(inner[::23]):
            world.edits.set(x, base + 1, z, "spruce_fence")
            world.edits.set(x, base + 2, z, "spruce_pressure_plate")
            for k, (dx, dz, f) in enumerate(((1, 0, "west"), (-1, 0, "east"))):
                if (x + dx, z + dz) in cells and (x + dx, z + dz) not in border:
                    world.edits.set(x + dx, base + 1, z + dz, f"spruce_stairs[facing={f},half=bottom]")
            if i % 2 == 0:
                world.edits.set(x, base + 3, z, "spruce_fence")
                for ex in (-1, 0, 1):
                    for ez in (-1, 0, 1):
                        world.edits.set(x + ex, base + 4, z + ez, "white_wool" if ex == 0 or ez == 0 else "white_carpet")
        for (x, z) in cells:
            world.occupied[z - g.z0, x - g.x0] = True
    _mark(world, "Burgruine Hohenbregenz / Gebhardsberg", px, _ground(world, px, pz) + 1, pz)
    world.gebhardsberg_wall = n_wall


def _lattice_line(v, p0, p1, block="waxed_exposed_copper_grate", thick=2):
    """A square lattice member between two points (thick x thick cross-section)."""
    for dx in range(thick):
        for dz in range(thick):
            v.line((p0[0] + dx, p0[1], p0[2] + dz), (p1[0] + dx, p1[1], p1[2] + dz), block)


def _pylon(world: World, x: int, z: int, gnd: int, top: int, n, half_top: float) -> None:
    """Pfänderbahn support: brown steel lattice portal, legs splayed across the line, wide cross beam on top."""
    spread = half_top + (top - gnd) * 0.18
    v = Vox(x - 16, gnd - 4, z - 16, 33, top - gnd + 10, 33)
    for side in (-1, 1):
        b = (int(round(x + n[0] * spread * side)), gnd - 2, int(round(z + n[1] * spread * side)))
        t = (int(round(x + n[0] * (half_top - 1) * side)), top - 1, int(round(z + n[1] * (half_top - 1) * side)))
        v.fill(b[0] - 1, gnd - 3, b[2] - 1, b[0] + 2, gnd, b[2] + 2, "gray_concrete")  # footing
        _lattice_line(v, b, t)
    # horizontal braces every 7 blocks + X bracing between the legs
    for y in range(gnd + 7, top - 2, 7):
        f = (y - gnd) / max(top - gnd, 1)
        w = spread + (half_top - 1 - spread) * f
        a = (x - n[0] * w, y, z - n[1] * w)
        c = (x + n[0] * w, y, z + n[1] * w)
        v.line(a, c, "waxed_exposed_copper_grate")
    # cross beam with rope saddles
    w = half_top + 2
    for k in (0, 1):
        v.line((x - n[0] * w, top + k, z - n[1] * w), (x + n[0] * w, top + k, z + n[1] * w), "waxed_exposed_copper_grate")
    for o in (-3, -2, 2, 3):
        v.set(int(round(x + n[0] * o)), top + 2, int(round(z + n[1] * o)), "polished_blackstone")
    v.set(x, top + 2, z, "white_wool")  # wind sock post
    v.column(x, z, top + 2, top + 4, "iron_bars")
    v.set(x, top + 5, z, "red_wool")
    v.commit(world.edits)
    _occupy(world, shapely.Point(x, z).buffer(spread + 3))


def _cabin(world: World, cx: int, cy: int, cz: int, along_x: bool) -> None:
    """Pfänderbahn cabin: dark carriage on the ropes, curved cream hanger, blue/white glazed cabin."""
    def P(a, b):  # a along the line, b across
        return (cx + a, cz + b) if along_x else (cx + b, cz + a)
    for a in (-2, -1, 0, 1, 2):
        for b in (-2, 2):
            x, z = P(a, b)
            world.edits.set(x, cy - 1, z, "polished_blackstone")
    for a in (-1, 0, 1):
        x, z = P(a, 0)
        world.edits.set(x, cy - 1, z, "polished_blackstone")
    # hanger: single arm that splits into an inverted V onto the cabin roof
    for y in range(cy - 7, cy - 1):
        x, z = P(0, 0)
        world.edits.set(x, y, z, "smooth_sandstone")
    for k, y in enumerate(range(cy - 10, cy - 7)):
        for a in (-(k + 1), k + 1):
            x, z = P(a + (1 if a > 0 else -1) * 0, 0)
            world.edits.set(x, y, z, "smooth_sandstone")
    roof = cy - 11
    floor = roof - 5
    for a in range(-5, 6):
        for b in range(-2, 3):
            x, z = P(a, b)
            edge_a, edge_b = abs(a) == 5, abs(b) == 2
            for y in range(floor, roof + 1):
                if y == roof:
                    blk = "white_concrete"
                elif y == floor:
                    blk = "gray_concrete"
                elif edge_a or edge_b:
                    if y == floor + 1:
                        blk = "blue_concrete" if a < 2 else "white_concrete"
                    else:
                        blk = "light_blue_stained_glass" if a < 2 else "glass"
                else:
                    blk = "air"
                world.edits.set(x, y, z, blk)


def _bergstation(world: World, u) -> tuple[int, int, int] | None:
    """Bergstation: white cube with a glazed cable hall towards the lake, larch-shingle middle floor,
    roof viewing terrace with railing and an outside stair."""
    r = _row("building", "Bergstation")
    if r is None:
        return None
    poly = _bgeom(r)
    m, x0, z0 = raster.polygon_cells(poly)
    mT = m.T
    xs, zs = np.nonzero(mT)
    X, Z = xs + x0, zs + z0
    hs = world.h(X, Z)
    base = int(hs.min())
    top = base + 13
    per = mT & ~ndimage.binary_erosion(mT, structure=[[0, 1, 0], [1, 1, 1], [0, 1, 0]])
    c = np.asarray(poly.centroid.coords[0])
    # cells within 7 blocks of the face the cable arrives at (-u side)
    hall = ((np.column_stack([X + 0.5, Z + 0.5]) - c) @ (-np.asarray(u))) > (np.ptp(X) / 2 - 7)
    v = Vox(x0 - 4, base - 6, z0 - 4, m.shape[1] + 8, 30, m.shape[0] + 8)
    for i, (x, z) in enumerate(zip(X, Z)):
        v.column(x, z, min(int(hs[i]), base) - 4, base, "stone_bricks")
        v.set(x, base, z, "smooth_stone")
        edge = per[x - x0, z - z0]
        for y in range(base + 1, top + 1):
            rel = y - base
            if not edge:
                blk = "air"
                if rel in (5, 9):
                    blk = "smooth_stone" if not hall[i] else "air"
            elif hall[i] and rel >= 5:
                blk = "light_gray_stained_glass" if rel < 12 else "white_concrete"
            elif rel in (5, 9, 13):
                blk = "white_concrete"
            elif 6 <= rel <= 8:  # larch-shingle clad restaurant floor with a window band
                blk = "glass" if rel == 7 and (x + z) % 4 in (1, 2) else "oak_planks"
            elif rel in (2, 3, 11) and (x + z) % 4 in (1, 2):
                blk = "glass"
            else:
                blk = "white_concrete"
            v.set(x, y, z, blk)
        v.set(x, top + 1, z, "smooth_stone_slab[type=bottom]")
    # roof terrace railing + blue "Pfänderbahn" band on the lake-facing upper wall
    ring = {(int(x), int(z)) for x, z in zip(X, Z) if per[x - x0, z - z0]}
    for (x, z) in ring:
        props = {d: str((x + dx, z + dz) in ring).lower() for d, (dx, dz) in
                 {"north": (0, -1), "south": (0, 1), "east": (1, 0), "west": (-1, 0)}.items()}
        v.set(x, top + 2, z, "iron_bars[" + ",".join(f"{k}={vv}" for k, vv in props.items()) + "]")
    lake_face = [(x, z) for (x, z) in ring if ((np.array([x + 0.5, z + 0.5]) - c) @ np.array([-1.0, 0.0])) > np.ptp(X) / 2 - 1.5]
    for x, z in lake_face[2:-2]:
        v.set(x, top - 2, z, "blue_concrete")
    # outside stair to the terrace on the far side
    far = max(ring, key=lambda p: (np.array([p[0] + 0.5, p[1] + 0.5]) - c) @ np.asarray(u))
    fx, fz = far
    sdir = (0, 1) if abs(u[0]) >= abs(u[1]) else (1, 0)
    out = (1, 0) if abs(u[0]) >= abs(u[1]) else (0, 1)
    out = (out[0] * (1 if u[0] >= 0 else -1), out[1] * (1 if u[1] >= 0 else -1))
    facing = {(0, 1): "south", (0, -1): "north", (1, 0): "east", (-1, 0): "west"}[(-sdir[0], -sdir[1])]
    for k in range(0, top - base + 1):
        sx = fx + out[0] - sdir[0] * k
        sz = fz + out[1] - sdir[1] * k
        y = base + 1 + k
        v.set(sx, y, sz, f"polished_andesite_stairs[facing={facing},half=bottom]")
        v.set(sx + out[0], y + 1, sz + out[1], "iron_bars")
    v.commit(world.edits)
    _occupy(world, poly.buffer(2))
    rope_x, rope_z = int(round(c[0] - u[0] * (np.ptp(X) / 2 - 2))), int(round(c[1] - u[1] * (np.ptp(Z) / 2 - 2)))
    return rope_x, base + 10, rope_z


def pfaenderbahn(world: World) -> None:
    """Pfänderbahn (1927, 1964): aerial tramway Talstation -> Bergstation with two lattice supports and two cabins."""
    rows = [r for r in data.overture("infrastructure") if r["class"] == "cable_car" and r["name"] == "Pfänderbahn"]
    if not rows:
        return
    line = _bgeom(rows[0])
    pts = [tuple(p) for p in np.asarray(line.coords)]
    d_all = np.array(pts[-1]) - np.array(pts[0])
    u = d_all / np.linalg.norm(d_all)
    n = np.array([-u[1], u[0]])
    along_x = abs(u[0]) >= abs(u[1])
    axis = "x" if along_x else "z"
    top_end = _bergstation(world, u)
    supports = []
    for i, (x, z) in enumerate(pts):
        gnd = _ground(world, x, z)
        if i == 0:
            supports.append([x, gnd + 13, z, gnd])            # leaves the Talstation hall
        elif i == len(pts) - 1:
            if top_end:
                supports.append([top_end[0], top_end[1], top_end[2], gnd])
            else:
                supports.append([x, gnd + 9, z, gnd])
        else:
            h = 34 if i == 1 else 21                          # tall mid-slope support, short portal near the top
            supports.append([x, gnd + h, z, gnd])
    # every span keeps at least 8 blocks of clearance (raise supports if the terrain is in the way)
    for _ in range(3):
        for i in range(len(supports) - 1):
            a, b = supports[i], supports[i + 1]
            L = math.hypot(b[0] - a[0], b[2] - a[2])
            for t in np.linspace(0, 1, int(L) + 1):
                x = a[0] + (b[0] - a[0]) * t
                z = a[2] + (b[2] - a[2]) * t
                y = a[1] + (b[1] - a[1]) * t - L * 0.06 * t * (1 - t)
                need = _ground(world, x, z) + 8
                if y < need:
                    j = i + 1 if 0 < i + 1 < len(supports) - 1 else i
                    if 0 < j < len(supports) - 1:
                        supports[j][1] += int(need - y) + 1
    # track ropes: two lanes (one per cabin), two ropes each
    lane_pts = {-2.5: [], 2.5: []}
    for i in range(len(supports) - 1):
        a, b = supports[i], supports[i + 1]
        L = math.hypot(b[0] - a[0], b[2] - a[2])
        for t in np.linspace(0, 1, int(L * 1.5) + 2):
            x = a[0] + (b[0] - a[0]) * t
            z = a[2] + (b[2] - a[2]) * t
            y = int(round(a[1] + (b[1] - a[1]) * t - L * 0.06 * t * (1 - t)))
            for lane in lane_pts:
                for o in (lane - 0.5, lane + 0.5):
                    rx, rz = int(math.floor(x + n[0] * o)), int(math.floor(z + n[1] * o))
                    world.edits.set(rx, y, rz, f"chain[axis={axis}]")
                lane_pts[lane].append((int(math.floor(x + n[0] * lane)), y, int(math.floor(z + n[1] * lane))))
    for (x, y, z, gnd) in supports[1:-1]:
        _pylon(world, int(round(x)), int(round(z)), gnd, int(y) - 2, n, 4.0)
    # cabins: one just below the Bergstation, one lower down the other lane
    for lane, frac in ((-2.5, 0.93), (2.5, 0.35)):
        lp = lane_pts[lane]
        cx, cy, cz = lp[int(len(lp) * frac)]
        _cabin(world, cx, cy, cz, along_x)
    a, b = supports[0], supports[-1]
    _mark(world, "Pfänderbahn Talstation", a[0], a[3] + 1, a[2])
    _mark(world, "Pfänderbahn Bergstation", b[0], b[3] + 1, b[2])
    for k, (x, y, z, gnd) in enumerate(supports[1:-1], 1):
        _mark(world, f"Pfänderbahn Stütze {k}", x, gnd + 1, z)


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
