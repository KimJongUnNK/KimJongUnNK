"""Public buildings rebuilt from photos: Festspielhaus, Landhaus, Landesbibliothek, BG Gallus,
Bahnhof (incl. the new ÖBB timber building) and the Fischersteg.

The big modern complexes are built from a height field: every footprint cell gets a roof
height and a part id, walls appear wherever a neighbour is lower, so setbacks, terraces
and towers come out without gaps. Facades are pattern functions per part.
"""
from __future__ import annotations

import math

import numpy as np
import shapely
import shapely.ops
from scipy import ndimage

from . import buildings, config, data, geo, raster
from .blocks import B
from .signs import place_sign
from .vox import NONE, Vox
from .world import World

WL = config.WATER_LEVEL
DIRS4 = {"north": (0, -1), "south": (0, 1), "east": (1, 0), "west": (-1, 0)}


# ----------------------------------------------------------------- helpers
def _rows(kind: str, pred):
    return [r for r in data.overture(kind) if pred(r)]


def _named(kind: str, name: str):
    for r in data.overture(kind):
        if r["name"] == name and r["geom"].geom_type in ("Polygon", "MultiPolygon"):
            return r
    return None


def _bg(r):
    return raster.to_block_geom(r["geom"])


class Frame:
    """A rectangular block window [x0, x0+nx) x [z0, z0+nz) with masks indexed [x, z]."""

    def __init__(self, geom, pad: int = 4):
        minx, minz, maxx, maxz = geom.bounds
        self.x0, self.z0 = int(math.floor(minx)) - pad, int(math.floor(minz)) - pad
        self.nx = int(math.ceil(maxx)) - self.x0 + pad + 1
        self.nz = int(math.ceil(maxz)) - self.z0 + pad + 1
        self.X = np.arange(self.nx)[:, None] + self.x0 + np.zeros((1, self.nz), int)
        self.Z = np.arange(self.nz)[None, :] + self.z0 + np.zeros((self.nx, 1), int)

    def mask(self, poly) -> np.ndarray:
        out = np.zeros((self.nx, self.nz), bool)
        if poly is None or poly.is_empty:
            return out
        m, x0, z0 = raster.polygon_cells(poly)
        zz, xx = np.nonzero(m)
        xi, zi = xx + x0 - self.x0, zz + z0 - self.z0
        ok = (xi >= 0) & (xi < self.nx) & (zi >= 0) & (zi < self.nz)
        out[xi[ok], zi[ok]] = True
        return out

    def ground(self, world: World) -> np.ndarray:
        return world.h(self.X, self.Z).astype(int)


def _median_ground(world: World, fr: Frame, m) -> int:
    return int(round(np.median(fr.ground(world)[m])))


def _occupy(world: World, fr: Frame, m) -> None:
    g = world.grid
    X, Z = fr.X[m], fr.Z[m]
    ok = g.inside(X, Z)
    world.occupied[Z[ok] - g.z0, X[ok] - g.x0] = True


def _connected(cells: set, block: str) -> dict:
    """Fence/pane/bar states connected to their neighbours in `cells`."""
    out = {}
    for (x, z) in cells:
        props = ",".join(f"{d}={str((x + dx, z + dz) in cells).lower()}" for d, (dx, dz) in DIRS4.items())
        out[(x, z)] = f"{block}[{props}]"
    return out


def _put_cells(world: World, cells: set, block: str, y_of) -> None:
    for (x, z), st in _connected(cells, block).items():
        world.edits.set(x, y_of(x, z), z, st)


def mass(world: World, fr: Frame, H: np.ndarray, P: np.ndarray, base: int, wall_fn, roof_fn=None,
         floor_h: int = 4, floor_blk: str = "smooth_stone", parapet: str | None = "smooth_stone_slab[type=bottom]",
         foundation: str = "stone_bricks") -> Vox:
    """Height-field building. H[x,z] = roof level (0 = no building), P[x,z] = part id.
    wall_fn(X, Z, rel, P, face) -> block ids for the exposed wall cells of one layer (face: 0 n, 1 s, 2 e, 3 w).
    roof_fn(X, Z, P) -> block ids for the roof cells (default smooth stone)."""
    top = int(H.max())
    gnd = fr.ground(world)
    low = int(min(gnd[H > 0].min(), base)) - 1
    v = Vox(fr.x0, low, fr.z0, fr.nx, top - low + 4, fr.nz)
    a = v.a
    b = H > 0
    # foundation down to the terrain
    for x, z in zip(*np.nonzero(b)):
        if gnd[x, z] < base:
            a[x, gnd[x, z] - low + 1:base - low, z] = B(foundation)
    a[:, base - low, :][b] = B(floor_blk)
    pad = lambda s: np.pad(s, 1)  # noqa: E731
    LIGHT = B("light[level=14]")
    for y in range(base + 1, top + 1):
        s = H >= y
        if not s.any():
            continue
        sp = pad(s)
        nb = [sp[1:-1, :-2], sp[1:-1, 2:], sp[2:, 1:-1], sp[:-2, 1:-1]]  # n, s, e, w
        exposed = s & ~(nb[0] & nb[1] & nb[2] & nb[3])
        face = np.select([~nb[0], ~nb[1], ~nb[2]], [0, 1, 2], 3)
        rel = y - base
        layer = a[:, y - low, :]
        roof = s & (H == y)
        wall = exposed & ~roof
        inner = s & ~exposed & ~roof
        layer[inner] = 0
        if rel % floor_h == 0:
            layer[inner] = B(floor_blk)
        elif rel % floor_h == 2:
            lm = inner & (fr.X % 6 == 0) & (fr.Z % 6 == 0)
            layer[lm] = LIGHT
        if wall.any():
            layer[wall] = wall_fn(fr.X[wall], fr.Z[wall], rel, P[wall], face[wall])
        if roof.any():
            ids = roof_fn(fr.X[roof], fr.Z[roof], P[roof]) if roof_fn else np.full(roof.sum(), B("smooth_stone"), np.uint16)
            layer[roof] = ids
            if parapet:
                edge = roof & exposed
                up = a[:, y - low + 1, :]
                up[edge & (up == NONE)] = B(parapet)
    v.commit(world.edits)
    _occupy(world, fr, b)
    return v


def _ids(*names):
    return [B(n) for n in names]


# ============================================================ Festspielhaus
def festspielhaus(world: World) -> None:
    """Festspiel- und Kongresshaus: glass foyer on the plaza, beige stone fly tower and auditorium,
    elevated Verwaltung bar, dark Werkstattbühne with rust roof, cantilevered white glass box at the entrance."""
    r = _named("building", "Festspiel- und Kongresshaus Bregenz")
    if r is None:
        return
    fp = _bg(r)
    fr = Frame(fp, pad=8)
    foot = fr.mask(fp)
    base = _median_ground(world, fr, foot)
    H = np.where(foot, base + 9, 0)
    P = np.zeros(H.shape, np.int8)          # 0 podium/foyer
    parts = []
    for p in data.overture("building_part"):
        g = _bg(p)
        if g.geom_type not in ("Polygon", "MultiPolygon") or g.distance(fp) > 3:
            continue
        a = g.area
        if p["name"] == "Werkstattbühne":
            kind, h = 5, 15
        elif a > 4000:
            kind, h = 2, 18                   # Zuschauerhaus
        elif 2500 < a < 3500:
            kind, h = 3, 13                   # stage / backstage
        elif 1150 < a < 1300:
            kind, h = 6, 10                   # west service wing
        elif 900 < a < 1150:
            kind, h = 4, 15                   # Verwaltung bar
        elif 600 < a < 1000:
            kind, h = 1, 38                   # Bühnenturm
        elif 400 < a < 600:
            kind, h = 7, 12                   # Seestudio
        else:
            kind, h = 0, 10
        parts.append((h, kind, g))
    tower_c = None
    for h, kind, g in sorted(parts, key=lambda t: t[0]):
        m = fr.mask(g) & foot
        if kind == 1:
            tower_c = g.centroid
        H[m] = np.maximum(H[m], base + h)
        P[m & (H == base + h)] = kind
    # the auditorium roof rises towards the fly tower
    if tower_c is not None:
        d = np.hypot(fr.X - tower_c.x, fr.Z - tower_c.y)
        hall = P == 2
        if hall.any():
            dm = d[hall].max()
            H[hall] += np.round(4 * (1 - d[hall] / dm)).astype(int)
    # main entrance: the white glass box over the plaza
    box = shapely.Polygon([(-636, -11), (-625, -4), (-621, -11), (-630, -18)]).buffer(0.6) & fp.buffer(0.5)
    bm = fr.mask(box) & foot
    H[bm] = base + 14
    P[bm] = 8
    tc = (tower_c.x, tower_c.y) if tower_c is not None else (0, 0)
    G = _ids("smooth_sandstone", "cut_sandstone", "gray_stained_glass", "black_concrete", "black_stained_glass",
             "light_gray_concrete", "light_gray_stained_glass", "black_terracotta", "white_concrete", "gray_concrete")
    SS, CS, GL, BLK, BGL, LGC, LGL, DARK, WHITE, GC = G

    def wall(X, Z, rel, Pp, face):
        along = np.where(face < 2, X, Z)
        out = np.full(X.shape, SS, np.uint16)
        out[(rel % 4 == 0)] = CS
        foyer = (Pp == 0) | (Pp == 2) | (Pp == 3)
        open_side = (face == 0) | (face == 2)        # lake (north) and plaza (east)
        glass = foyer & open_side & (rel <= 8)
        out[glass] = GL
        out[glass & ((along % 4 == 0) | (rel == 4) | (rel == 8))] = BLK
        out[foyer & ~open_side & (rel == 3)] = LGL
        # fly tower: dark window band high up on the lake side
        out[(Pp == 1) & (face == 0) & ((rel == 27) | (rel == 28)) & (np.abs(X - tc[0]) < 9)] = BGL
        adm = Pp == 4
        out[adm] = LGC
        out[adm & (rel % 4 >= 2) & (rel > 4)] = LGL
        out[adm & (rel <= 4) & (along % 5 != 0)] = 0          # elevated on columns
        wk = Pp == 5
        out[wk] = DARK
        out[wk & (rel % 5 == 0)] = GC
        west = Pp == 6
        out[west] = LGC
        out[west & (rel % 4 == 2) & (along % 3 != 0)] = LGL
        st = Pp == 7
        out[st] = LGC
        out[st & (rel >= 7) & (rel <= 10)] = GL
        bx = Pp == 8
        out[bx] = GL
        out[bx & ((along % 4 == 0) | (rel == 10))] = BLK
        out[bx & ((rel == 6) | (rel == 14) | (rel == 7))] = WHITE
        return out

    def roof(X, Z, Pp):
        out = np.full(X.shape, B("smooth_stone"), np.uint16)
        wk = Pp == 5
        out[wk] = B("orange_terracotta")
        out[wk & (X % 6 == 0)] = B("light_blue_stained_glass")
        out[Pp == 8] = WHITE
        out[(Pp == 2) & ((X + Z) % 9 == 0)] = B("light_gray_concrete")
        return out

    v = mass(world, fr, H, P, base, wall, roof)
    # the box cantilevers 3 blocks out over the entrance
    ext = fr.mask(box.buffer(3.0)) & ~foot
    for x, z in zip(fr.X[ext], fr.Z[ext]):
        world.edits.set(int(x), base + 7, int(z), "white_concrete")
        world.edits.set(int(x), base + 14, int(z), "white_concrete")
        for y in range(base + 8, base + 14):
            world.edits.set(int(x), y, int(z), "gray_stained_glass" if (x + z) % 4 else "white_concrete")
    _occupy(world, fr, ext)
    # entrance doors on the plaza side of the box
    xs = fr.X[bm]
    if xs.size:
        ex = int(xs.max())
        for z in fr.Z[bm & (fr.X == ex)]:
            for y in (base + 1, base + 2):
                world.edits.set(ex, y, int(z), "air")
    _plaza_symphoniker(world, base)
    world.markers["Festspielhaus Bregenz"] = (-622, base + 1, -2)


def _plaza_symphoniker(world: World, base: int) -> None:
    """Platz der Wiener Symphoniker: light gravel, the golden 'Ready Maid', water mirror, chairs, umbrellas, light masts."""
    g = world.grid
    r = _named("land_use", "Platz der Wiener Symphoniker")
    if r is not None:
        pl = _bg(r)
        fr = Frame(pl, 0)
        m = fr.mask(pl)
        X, Z = fr.X[m], fr.Z[m]
        ok = g.inside(X, Z)
        X, Z = X[ok], Z[ok]
        free = ~world.occupied[Z - g.z0, X - g.x0] & ~world.road[Z - g.z0, X - g.x0]
        X, Z = X[free], Z[free]
        world.top[Z - g.z0, X - g.x0] = np.where((X * 7 + Z * 3) % 5 == 0, B("smooth_sandstone"), B("sand"))
        world.sub[Z - g.z0, X - g.x0] = B("sandstone")
        world.occupied[Z - g.z0, X - g.x0] = True
    art = None
    for rr in data.overture("infrastructure"):
        if rr["name"] == "Ready Maid":
            art = _bg(rr)
    if art is None:
        return
    c = art.centroid
    cx, cz = int(c.x), int(c.y)
    y0 = int(world.h(cx, cz))
    v = Vox(cx - 20, y0 - 2, cz - 20, 41, 22, 41)
    # shallow round water mirror
    for dx in range(-8, 9):
        for dz in range(-8, 9):
            d = math.hypot(dx, dz)
            if d <= 7.2:
                v.set(cx + dx, y0, cz + dz, "water")
                v.set(cx + dx, y0 - 1, cz + dz, "smooth_stone")
            elif d <= 8.2:
                v.set(cx + dx, y0, cz + dz, "smooth_stone")
    # Ready Maid: two bronze legs that lean together into one trunk (~13 m)
    fx, fz = cx - 7, cz
    for leg in (-2, 2):
        v.line((fx, y0 + 1, fz + leg), (fx + 1, y0 + 7, fz), "gold_block")
        v.set(fx, y0, fz + leg, "oxidized_copper")
    v.line((fx + 1, y0 + 7, fz), (fx + 2, y0 + 13, fz - 1), "gold_block")
    v.set(fx + 2, y0 + 14, fz - 1, "raw_gold_block")
    # loose rings of black chairs facing the water
    for k in range(18):
        ang = k / 18 * 2 * math.pi
        rad = 11 + (k % 3)
        x, z = int(round(cx + rad * math.cos(ang))), int(round(cz + rad * math.sin(ang)))
        dx, dz = cx - x, cz - z
        facing = ("east" if dx > 0 else "west") if abs(dx) > abs(dz) else ("south" if dz > 0 else "north")
        v.set(x, int(world.h(x, z)) + 1, z, f"polished_blackstone_stairs[facing={facing},half=bottom]")
    v.commit(world.edits)
    # closed white umbrellas of the café terrace and the tall light masts along the Seetribüne
    for k in range(10):
        x, z = -650 - (k % 2) * 3, -48 + k * 2
        if not world.occupied[min(max(z - g.z0, 0), g.nz - 1), min(max(x - g.x0, 0), g.nx - 1)]:
            h = int(world.h(x, z))
            world.edits.set(x, h + 1, z, "spruce_fence")
            world.edits.set(x, h + 2, z, "white_wool")
            world.edits.set(x, h + 3, z, "white_wool")
            world.edits.set(x, h + 4, z, "end_rod")
    for k, (x, z) in enumerate(((-628, -40), (-612, -34), (-596, -28))):
        h = int(world.h(x, z))
        for y in range(h + 1, h + 17):
            world.edits.set(x, y, z, "iron_bars")
        world.edits.set(x, h + 17, z, "lantern")
        world.edits.set(x, h + 16, z + 1, "sea_lantern")


# ================================================================== Landhaus
def landhaus(world: World) -> None:
    """Landhaus (Wilhelm Holzbauer, 1982): grey granite terraced office block stepping up to 7 floors,
    dark ribbon windows, stone stair towers, low green-roofed Landtag wing, atrium inside, forecourt with fountain."""
    r = _named("building", "Landhaus")
    if r is None:
        return
    fp = _bg(r)
    fr = Frame(fp, pad=6)
    foot = fr.mask(fp)
    base = _median_ground(world, fr, foot)
    edt = ndimage.distance_transform_edt(np.pad(foot, 1))[1:-1, 1:-1]
    west = foot & (fr.X < -128)
    east = foot & ~west
    H = np.zeros(foot.shape, int)
    P = np.zeros(foot.shape, np.int8)
    # clean rectangular setbacks: each tier is the previous one shrunk and opened (no jagged contours)
    floors = np.zeros(foot.shape, int)
    tier = east.copy()
    for k in range(2, 8):
        floors[tier] = k
        tier = ndimage.binary_opening(ndimage.binary_erosion(tier, iterations=4 if k > 2 else 6),
                                      structure=np.ones((7, 7)))
        if tier.sum() < 150:
            break
    H[east] = base + 4 * floors[east]
    H[west] = base + 9
    P[west] = 1
    # two granite stair towers
    ex, ez = np.nonzero(east & (edt >= 3) & (edt < 4))
    towers = []
    if ex.size:
        for key in (fr.X[ex, ez] + fr.Z[ex, ez], -(fr.X[ex, ez] + fr.Z[ex, ez])):
            i = int(np.argmin(key))
            towers.append((int(ex[i]), int(ez[i])))
    tmax = int(H.max()) + 4
    for tx, tz in towers:
        H[tx - 2:tx + 3, tz - 2:tz + 3] = np.where(foot[tx - 2:tx + 3, tz - 2:tz + 3], tmax, H[tx - 2:tx + 3, tz - 2:tz + 3])
        P[tx - 2:tx + 3, tz - 2:tz + 3] = np.where(foot[tx - 2:tx + 3, tz - 2:tz + 3], 2, P[tx - 2:tx + 3, tz - 2:tz + 3])
    STONE, PA, GL, BLK, LGL, SB = _ids("polished_andesite", "andesite", "gray_stained_glass", "black_concrete",
                                       "light_gray_stained_glass", "stone_bricks")

    def wall(X, Z, rel, Pp, face):
        along = np.where(face < 2, X, Z)
        out = np.full(X.shape, STONE, np.uint16)
        win = (rel % 4 >= 2)
        out[win] = GL
        out[win & (along % 3 == 0)] = BLK
        ground = rel <= 4
        out[ground] = LGL
        out[ground & (along % 5 == 0)] = STONE
        out[ground & (rel == 4)] = STONE
        lw = Pp == 1
        out[lw & (rel > 4)] = STONE
        out[lw & (rel > 4) & (rel % 9 == 6) & (along % 4 == 1)] = GL
        out[lw & (rel == 8)] = PA
        tw = Pp == 2
        out[tw] = SB
        out[tw & (along % 5 == 2) & (rel % 4 == 2)] = GL
        return out

    def roof(X, Z, Pp):
        out = np.full(X.shape, B("gravel"), np.uint16)
        lw = Pp == 1
        out[lw] = np.where((X * 3 + Z * 5) % 7 == 0, B("moss_block"), B("grass_block"))[lw]
        out[Pp == 2] = STONE
        return out

    mass(world, fr, H, P, base, wall, roof, parapet="polished_andesite_slab[type=bottom]")
    # light grey pergola grids on the terrace edges
    rails = set()
    Hp = np.pad(H, 1)
    for x, z in zip(*np.nonzero(east & (P == 0))):
        hh = H[x, z]
        if any(Hp[x + 1 + dx, z + 1 + dz] < hh for dx, dz in DIRS4.values()) and (fr.X[x, z] + fr.Z[x, z]) % 2 == 0:
            rails.add((int(fr.X[x, z]), int(fr.Z[x, z])))
    hmap = {(int(fr.X[x, z]), int(fr.Z[x, z])): int(H[x, z]) for x, z in zip(*np.nonzero(foot))}
    for (x, z) in rails:
        world.edits.set(x, hmap[(x, z)] + 2, z, "iron_bars")
    # skylight boxes on the green Landtag roof
    wx, wz = np.nonzero(west & (edt >= 4) & (fr.X % 10 == 0) & (fr.Z % 8 == 0))
    for x, z in zip(fr.X[wx, wz], fr.Z[wx, wz]):
        world.edits.fill(int(x) - 1, base + 10, int(z) - 1, int(x) + 1, base + 11, int(z) + 1, "white_concrete")
        world.edits.fill(int(x) - 1, base + 11, int(z) - 1, int(x) + 1, base + 11, int(z) + 1, "glass")
    # antennas on the highest roof
    hi = np.argwhere(east & (H == H[east].max()) & (P == 0))
    if len(hi):
        for k in (len(hi) // 3, 2 * len(hi) // 3):
            x, z = int(fr.X[tuple(hi[k])]), int(fr.Z[tuple(hi[k])])
            top = int(H[tuple(hi[k])])
            for y in range(top + 1, top + 13):
                world.edits.set(x, y, z, "iron_bars")
            world.edits.set(x, top + 13, z, "lightning_rod")
    _landhaus_atrium(world, fr, H, east, edt, base)
    _landhaus_forecourt(world, base)
    c = fp.centroid
    world.markers["Landhaus"] = (int(c.x), int(H.max()) + 1, int(c.y))


def _landhaus_atrium(world: World, fr: Frame, H, east, edt, base: int) -> None:
    """Full-height atrium: galleries with black glass railings, glazed roof, white floor, plants and sofas."""
    cand = east & (H >= base + 20)
    if cand.sum() < 200:
        return
    i = np.unravel_index(np.argmax(np.where(cand, edt, 0)), edt.shape)
    cx, cz = int(fr.X[i]), int(fr.Z[i])
    top = int(H[i])
    hx, hz = 5, 7
    E = world.edits
    E.fill(cx - hx, base + 1, cz - hz, cx + hx, top - 1, cz + hz, "air")
    E.fill(cx - hx, top, cz - hz, cx + hx, top, cz + hz, "glass")
    E.fill(cx - hx, base, cz - hz, cx + hx, base, cz + hz, "smooth_quartz")
    for k in range(4, top - base, 4):
        y = base + k + 1
        ring = set()
        for x in range(cx - hx - 1, cx + hx + 2):
            ring |= {(x, cz - hz - 1), (x, cz + hz + 1)}
        for z in range(cz - hz - 1, cz + hz + 2):
            ring |= {(cx - hx - 1, z), (cx + hx + 1, z)}
        for (x, z), st in _connected(ring, "black_stained_glass_pane").items():
            E.set(x, y, z, st)
        for x, z in ring:
            E.set(x, y - 1, z, "smooth_quartz")
            if (x + z) % 4 == 0:
                E.set(x, y + 2, z, "sea_lantern")
    # wide stair up to the first gallery
    for s in range(4):
        for o in (-1, 0, 1):
            E.set(cx + o, base + 1 + s, cz - hz + 1 + s, "quartz_stairs[facing=south,half=bottom]")
            for y in range(base + 1, base + 1 + s):
                E.set(cx + o, y, cz - hz + 1 + s, "smooth_quartz")
    # lounge: sofas around low tables, potted trees
    for gx, gz in ((cx - 3, cz + 3), (cx + 3, cz + 3)):
        for dx, dz, f in ((-1, 0, "east"), (1, 0, "west"), (0, 1, "north")):
            E.set(gx + dx, base + 1, gz + dz, f"spruce_stairs[facing={f},half=bottom]")
        E.set(gx, base + 1, gz, "spruce_slab[type=bottom]")
    for x, z in ((cx - hx, cz - hz), (cx + hx, cz - hz), (cx - hx, cz + hz), (cx + hx, cz + hz)):
        E.set(x, base + 1, z, "potted_flowering_azalea_bush")
    E.fill(cx - 2, top - 1, cz - 2, cx + 2, top - 1, cz + 2, "air")


def _landhaus_forecourt(world: World, base: int) -> None:
    """Forecourt: granite sett, fountain basin with a row of jets, stone light pillars, bollards, the big fir."""
    g = world.grid
    plaza = None
    for r in data.overture("land_use"):
        if r["class"] == "pedestrian" and _bg(r).distance(shapely.Point(-128, 380)) < 5:
            plaza = _bg(r)
    if plaza is not None:
        fr = Frame(plaza, 0)
        m = fr.mask(plaza)
        X, Z = fr.X[m], fr.Z[m]
        ok = g.inside(X, Z)
        X, Z = X[ok], Z[ok]
        free = ~world.occupied[Z - g.z0, X - g.x0]
        X, Z = X[free], Z[free]
        world.top[Z - g.z0, X - g.x0] = np.where((X + Z) % 2 == 0, B("polished_andesite"), B("andesite"))
        world.occupied[Z - g.z0, X - g.x0] = True
        # stone light pillars at the corners of the square
        rect = np.asarray(plaza.minimum_rotated_rectangle.exterior.coords)[:4]
        c = np.asarray(plaza.centroid.coords[0])
        for p in rect:
            q = p + (c - p) * 0.12
            x, z = int(q[0]), int(q[1])
            h = int(world.h(x, z))
            for y in range(h + 1, h + 6):
                world.edits.set(x, y, z, "polished_andesite")
            world.edits.set(x, h + 6, z, "sea_lantern")
            world.edits.set(x, h + 7, z, "polished_andesite_slab[type=bottom]")
        # bollards along the street edge
        for k, (x, z) in enumerate(zip(X, Z)):
            if world.dist_road[z - g.z0, x - g.x0] < 1.5 and (x + 2 * z) % 3 == 0:
                world.edits.set(int(x), int(world.h(x, z)) + 1, int(z), "polished_blackstone_wall")
        # the big fir in its planter
        fx, fz = int(c[0] + 6), int(c[1] + 4)
        h = int(world.h(fx, fz))
        world.edits.fill(fx - 1, h + 1, fz - 1, fx + 1, h + 1, fz + 1, "polished_andesite")
        world.edits.set(fx, h + 1, fz, "podzol")
        for y in range(h + 2, h + 15):
            world.edits.set(fx, y, fz, "spruce_log[axis=y]")
        for k in range(12):
            rr = max(0.6, (12 - k) * 0.33)
            for dx in range(-3, 4):
                for dz in range(-3, 4):
                    if (dx or dz) and math.hypot(dx, dz) <= rr:
                        world.edits.set(fx + dx, h + 4 + k, fz + dz, "spruce_leaves[persistent=true]")
        world.edits.set(fx, h + 16, fz, "spruce_leaves[persistent=true]")
    for r in data.overture("infrastructure"):
        if r["class"] != "fountain" or r["geom"].geom_type != "Polygon":
            continue
        fg = _bg(r)
        if fg.distance(shapely.Point(-139, 364)) > 5:
            continue
        fr = Frame(fg, 1)
        m = fr.mask(fg)
        per = m & ~ndimage.binary_erosion(m)
        h = int(np.median(fr.ground(world)[m]))
        for x, z in zip(fr.X[m], fr.Z[m]):
            world.edits.set(int(x), h, int(z), "polished_andesite")
        for x, z in zip(fr.X[per], fr.Z[per]):
            world.edits.set(int(x), h + 1, int(z), "polished_andesite")
            world.edits.set(int(x), h + 2, int(z), "polished_andesite_slab[type=bottom]")
        inner = m & ~per
        for x, z in zip(fr.X[inner], fr.Z[inner]):
            world.edits.set(int(x), h + 1, int(z), "water")
        long_v, hs, hl = buildings._orientation(fg)
        c = np.asarray(fg.centroid.coords[0])
        for t in np.linspace(-hl * 0.7, hl * 0.7, 6):
            p = c + long_v * t
            world.edits.set(int(p[0]), h + 3, int(p[1]), "water")   # jets falling back into the basin
        _occupy(world, fr, m)


# ======================================================= Landesbibliothek
def _circle_fit(pts):
    pts = np.asarray(pts, float)
    A = np.column_stack([2 * pts[:, 0], 2 * pts[:, 1], np.ones(len(pts))])
    b = (pts ** 2).sum(1)
    cx, cz, c = np.linalg.lstsq(A, b, rcond=None)[0]
    return cx, cz, math.sqrt(c + cx * cx + cz * cz)


def landesbibliothek(world: World) -> None:
    """Vorarlberger Landesbibliothek (former Gallusstift): white Kuppelsaal with a big verdigris dome on a drum and
    lantern, cream main building with brown mansard roof and dormers, neo-Gothic wing with stepped gables and tower."""
    r = _named("building", "Ehemaliges St.-Gallus-Stift")
    if r is None:
        return
    fp = _bg(r)
    co = np.asarray(fp.exterior.coords)
    seg = np.hypot(*np.diff(co, axis=0).T)
    # the rounded end: the run of short edges (<= 3.5 m)
    best, cur = [], []
    for i, s in enumerate(seg):
        if s <= 3.5:
            cur.append(i)
        else:
            if len(cur) > len(best):
                best = cur
            cur = []
    if len(cur) > len(best):
        best = cur
    pts = co[best[0]:best[-1] + 2] if best else co[:4]
    cx, cz, R = _circle_fit(pts)
    R = float(np.clip(R, 7.5, 11.5))
    cxi, czi = int(round(cx)), int(round(cz))
    rot = shapely.Point(cx, cz).buffer(R + 0.5)
    rest = fp.difference(rot.buffer(-0.5))
    if rest.geom_type == "MultiPolygon":
        rest = max(rest.geoms, key=lambda q: q.area)
    row = dict(r, id="landesbibliothek-main", **{"class": "library"})
    info = buildings.building(world, row, rest, dict(
        facade="smooth_sandstone", roof=("mud_bricks", "mud_brick_slab[type=bottom]"), flat=False, gable=False,
        pitch=1.8, roof_cap=5, height=19, wall_height=13, floor_h=4, windows="tall", frames=True, plinth=True,
        glass="glass_pane", foundation="stone_bricks", floor="spruce_planks"))
    if info:
        _dormers_and_gable(world, info, rest)
    # neo-Gothic wing with stepped gables and a corner tower
    for b in data.overture("building"):
        g = _bg(b)
        if b["name"] is None and 380 < g.area < 520 and g.distance(shapely.Point(-119, 1219)) < 15:
            _gothic_wing(world, b, g, fp)
    _kuppelsaal(world, cxi, czi, R, fp)
    world.markers["Vorarlberger Landesbibliothek (Kuppelsaal)"] = (cxi, int(world.h(cxi, czi)) + 1, czi)


def _dormers_and_gable(world: World, info, poly) -> None:
    m, x0, z0 = info["mask"], info["x0"], info["z0"]
    mT = m.T
    per = mT & ~ndimage.binary_erosion(mT, structure=np.ones((3, 3)))
    top = info["wall_top"]
    E = world.edits
    xs, zs = np.nonzero(per)
    straight = []
    for x, z in zip(xs, zs):
        nb = sum(1 for dx, dz in DIRS4.values() if 0 <= x + dx < mT.shape[0] and 0 <= z + dz < mT.shape[1] and per[x + dx, z + dz])
        if nb == 2 and (x + z) % 5 == 2:
            straight.append((x, z))
    for x, z in straight:
        X, Z = int(x + x0), int(z + z0)
        E.set(X, top + 1, Z, "glass")
        E.set(X, top + 2, Z, "glass")
        E.set(X, top + 3, Z, "mud_brick_slab[type=bottom]")
    # central curved gable with a round window on the longest facade (towards the street)
    door = info.get("door")
    if door:
        dx, by, dz, facing = door
        ox, oz = {"north": (0, -1), "south": (0, 1), "east": (1, 0), "west": (-1, 0)}[facing]
        tx, tz = -oz, ox
        for o in range(-5, 6):
            hh = int(round(math.sqrt(max(0, 30 - o * o)) * 1.0))
            for k in range(1, hh + 1):
                x, z = dx + tx * o, dz + tz * o
                E.set(x, top + k, z, "smooth_sandstone" if not (abs(o) <= 1 and 2 <= k <= 4) else "glass")
            E.set(dx + tx * o, top + hh + 1, dz + tz * o, "smooth_quartz_slab[type=bottom]")
        for k in range(1, 4):   # entrance steps
            for o in (-2, -1, 0, 1, 2):
                x, z = dx + ox * k + tx * o, dz + oz * k + tz * o
                E.set(x, by - 1 if k > 1 else by, z, "stone_brick_slab[type=bottom]" if k > 1 else "stone_bricks")


def _gothic_wing(world: World, r, g, main) -> None:
    info = buildings.building(world, dict(r, id="landesbibliothek-wing"), g, dict(
        facade="white_terracotta", roof=("deepslate_tiles", "deepslate_tile_slab[type=bottom]"), flat=False, gable=True,
        pitch=1.6, roof_cap=10, height=20, wall_height=12, floor_h=4, windows="tall", frames=True,
        glass="glass_pane", foundation="stone_bricks"))
    if not info:
        return
    long_v, hs, hl = buildings._orientation(g)
    c = np.asarray(g.centroid.coords[0])
    nrm = np.array([-long_v[1], long_v[0]])
    top = info["wall_top"]
    E = world.edits
    # stepped gables at both ends, standing proud of the roof
    for side in (-1, 1):
        for o in np.arange(-hs + 0.5, hs, 1.0):
            p = c + long_v * side * (hl - 0.5) + nrm * o
            rh = (hs - abs(o) + 0.5) * 1.6
            steps = int(2 * math.ceil(rh / 2)) + 1
            for k in range(1, steps + 1):
                E.set(int(math.floor(p[0])), top + k, int(math.floor(p[1])), "white_terracotta")
            E.set(int(math.floor(p[0])), top + steps + 1, int(math.floor(p[1])), "stone_brick_slab[type=bottom]")
        q = c + long_v * side * (hl - 0.5)
        E.set(int(q[0]), top + 4, int(q[1]), "glass")
    # corner tower on the corner farthest from the main building
    rect = np.asarray(g.minimum_rotated_rectangle.exterior.coords)[:4]
    corner = max(rect, key=lambda p: main.distance(shapely.Point(p)))
    tc = corner + (c - corner) / np.linalg.norm(c - corner) * 2.5
    tx, tz = int(tc[0]), int(tc[1])
    base = info["base"]
    th = top + 9
    v = Vox(tx - 4, base, tz - 4, 9, th - base + 12, 9)
    v.hollow(tx - 2, base + 1, tz - 2, tx + 2, th, tz + 2, "white_terracotta", None)
    for y in range(base + 1, th + 1):
        if (y - base) % 4 in (2, 3):
            for dx, dz in ((0, -2), (0, 2), (-2, 0), (2, 0)):
                v.set(tx + dx, y, tz + dz, "glass")
    v.fill(tx - 2, th, tz - 2, tx + 2, th, tz + 2, "stone_bricks")
    for k in range(7):
        rr = 3 - k // 2.5
        v.fill(int(tx - rr), th + 1 + k, int(tz - rr), int(tx + rr), th + 1 + k, int(tz + rr), "deepslate_tiles")
    v.set(tx, th + 8, tz, "lightning_rod")
    v.commit(world.edits)


def _kuppelsaal(world: World, cx: int, cz: int, R: float, footprint) -> None:
    """White rotunda, drum and verdigris dome with lantern; inside the reading room under the dome."""
    base = int(np.median([world.h(cx + dx, cz + dz) for dx in range(-3, 4) for dz in range(-3, 4)]))
    Ri = int(math.ceil(R))
    wall_top = base + 13
    Rd = R - 1.0
    drum_top = wall_top + 7
    dome_h = int(Rd * 1.05)
    top = drum_top + dome_h + 6
    v = Vox(cx - Ri - 3, base - 6, cz - Ri - 3, 2 * Ri + 7, top - base + 10, 2 * Ri + 7)
    gnd = world.h(np.arange(cx - Ri - 1, cx + Ri + 2)[:, None] + 0 * np.arange(2 * Ri + 3)[None, :],
                  np.arange(cz - Ri - 1, cz + Ri + 2)[None, :] + 0 * np.arange(2 * Ri + 3)[:, None])
    glass_cols = ("yellow_stained_glass", "light_blue_stained_glass", "orange_stained_glass", "white_stained_glass")
    for dx in range(-Ri - 1, Ri + 2):
        for dz in range(-Ri - 1, Ri + 2):
            d = math.hypot(dx, dz)
            x, z = cx + dx, cz + dz
            if d > R + 0.4:
                continue
            gh = int(gnd[dx + Ri + 1, dz + Ri + 1])
            for y in range(min(gh, base) + 1, base):
                v.set(x, y, z, "stone_bricks")
            # floor: beige stone tiles
            v.set(x, base, z, "smooth_sandstone" if (dx + dz) % 2 == 0 else "cut_sandstone")
            ang = (math.degrees(math.atan2(dz, dx)) + 360) % 360
            wall = d > R - 1.0
            for y in range(base + 1, wall_top + 1):
                rel = y - base
                if wall:
                    blk = "white_concrete"
                    if ang % 30 < 7 and 3 <= rel <= 10:          # tall arched coloured windows
                        blk = glass_cols[int(ang // 30) % 4] if rel < 10 else "white_stained_glass"
                    if rel == 6 and not (ang % 30 < 7):
                        blk = "smooth_quartz"
                    v.set(x, y, z, blk)
                elif d > R - 2.0 and rel not in (6,) and not (ang % 30 < 7):
                    v.set(x, y, z, "bookshelf")                   # shelves all round, below and on the gallery
                elif R - 5.0 < d <= R - 1.0 and rel == 6:
                    v.set(x, y, z, "spruce_planks")              # gallery ring
                else:
                    v.set(x, y, z, "air")
            # cornice and roof ring around the drum
            if d > Rd - 0.5:
                v.set(x, wall_top + 1, z, "smooth_quartz" if d > R - 0.6 else "light_gray_concrete")
            else:
                v.set(x, wall_top + 1, z, "air")
    # gallery railing of glass
    ring = set()
    for dx in range(-Ri, Ri + 1):
        for dz in range(-Ri, Ri + 1):
            if R - 5.6 < math.hypot(dx, dz) <= R - 4.6:
                ring.add((cx + dx, cz + dz))
    for (x, z), st in _connected(ring, "glass_pane").items():
        v.set(x, base + 7, z, st)
    # drum
    Rdi = int(math.ceil(Rd))
    for dx in range(-Rdi, Rdi + 1):
        for dz in range(-Rdi, Rdi + 1):
            d = math.hypot(dx, dz)
            if d > Rd + 0.3:
                continue
            for y in range(wall_top + 2, drum_top + 1):
                if d > Rd - 0.8:
                    ang = (math.degrees(math.atan2(dz, dx)) + 360) % 360
                    v.set(cx + dx, y, cz + dz, "glass" if (ang % 45 < 9 and y in (wall_top + 3, wall_top + 4)) else "white_concrete")
                else:
                    v.set(cx + dx, y, cz + dz, "air")
    # dome: copper shell outside, white stucco inside, oculus at the top
    for k in range(dome_h + 1):
        y = drum_top + 1 + k
        rr = Rd * math.sqrt(max(0.0, 1 - (k / (dome_h + 0.5)) ** 2))
        for dx in range(-Rdi, Rdi + 1):
            for dz in range(-Rdi, Rdi + 1):
                d = math.hypot(dx, dz)
                if d > rr + 0.4:
                    continue
                if d <= 1.6 and k >= dome_h - 1:
                    v.set(cx + dx, y, cz + dz, "glass")
                elif d > rr - 0.9:
                    ang = (math.degrees(math.atan2(dz, dx)) + 360) % 360
                    v.set(cx + dx, y, cz + dz, "oxidized_cut_copper" if ang % 45 < 6 else "oxidized_copper")
                elif d > rr - 1.9:
                    v.set(cx + dx, y, cz + dz, "white_concrete")
                else:
                    v.set(cx + dx, y, cz + dz, "air")
    # lantern
    ly = drum_top + dome_h + 1
    for dx in range(-2, 3):
        for dz in range(-2, 3):
            if max(abs(dx), abs(dz)) == 2 and not (abs(dx) == 2 and abs(dz) == 2):
                v.set(cx + dx, ly, cz + dz, "white_concrete")
                v.set(cx + dx, ly + 1, cz + dz, "glass" if (dx == 0 or dz == 0) else "white_concrete")
                v.set(cx + dx, ly + 2, cz + dz, "glass" if (dx == 0 or dz == 0) else "white_concrete")
    v.fill(cx - 1, ly + 3, cz - 1, cx + 1, ly + 3, cz + 1, "oxidized_cut_copper")
    v.set(cx, ly + 4, cz, "oxidized_cut_copper_slab[type=bottom]")
    v.set(cx, ly + 5, cz, "gold_block")
    v.set(cx, ly + 6, cz, "lightning_rod")
    # reading room: tables with lamps, rows of chairs, spiral stair to the gallery, pendant lights
    for row in (-3, 0, 3):
        for o in (-3, -2, -1, 1, 2, 3):
            v.set(cx + o, base + 1, cz + row, "spruce_stairs[facing=north,half=bottom]")
    for o in (-2, 2):
        v.set(cx + o, base + 1, cz - 5, "spruce_slab[type=top]")
        v.set(cx + o, base + 2, cz - 5, "lantern")
    sx, sz = cx + int(R - 3.5), cz
    spiral = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1)]
    for y in range(base + 1, base + 7):
        v.set(sx, y, sz, "stripped_spruce_log[axis=y]")
    for k, (dx, dz) in enumerate(spiral):
        v.set(sx + dx, base + 1 + k, sz + dz, "spruce_slab[type=top]")
        for y in range(base + 2 + k, base + 5 + k):
            if v.get(sx + dx, y, sz + dz) != B("bookshelf"):
                v.set(sx + dx, y, sz + dz, "air")
    for dx, dz in ((0, 0), (3, 3), (-3, 3), (3, -3), (-3, -3)):
        for y in range(base + 6, wall_top + 4):
            v.set(cx + dx, y, cz + dz, "chain[axis=y]")
        v.set(cx + dx, base + 5, cz + dz, "lantern[hanging=true]")
    # entrance from the main building side
    v.commit(world.edits)
    g = world.grid
    for dx in range(-Ri - 1, Ri + 2):
        for dz in range(-Ri - 1, Ri + 2):
            x, z = cx + dx, cz + dz
            if math.hypot(dx, dz) <= R + 0.4 and g.inside(x, z):
                world.occupied[z - g.z0, x - g.x0] = True


# ================================================================ BG Gallus
def _bg_rows():
    p = shapely.Point(-110, 520)
    return [r for r in data.overture("building") if r.get("class") == "school" and _bg(r).distance(p) < 60]


def is_bg_gallus(r) -> bool:
    return r.get("class") == "school" and r["name"] is None and _bg(r).distance(shapely.Point(-110, 520)) < 60


def bg_gallus(world: World) -> None:
    """BG Gallusstraße: ochre Jugendstil school with stone ground floor and round-arched windows, steep red tile
    roofs, curved gable with oculus, copper roof lantern and oriels; white frosted-glass annex next to the orange court."""
    rows = _bg_rows()
    for r in rows:
        g = _bg(r)
        if r.get("roof_shape") == "flat" or g.area < 1200:
            buildings.building(world, dict(r, id="bg-annex"), g, dict(
                facade="white_stained_glass", flat=True, height=14, wall_height=13, floor_h=4, windows="normal",
                glass="light_gray_stained_glass_pane", frames=False, plinth=False, trim=False, green_roof=False,
                parapet_block="white_concrete"))
            continue
        info = buildings.building(world, dict(r, id="bg-main"), g, dict(
            facade="yellow_terracotta", roof=("bricks", "brick_slab[type=bottom]"), flat=False, gable=False,
            pitch=1.4, roof_cap=8, height=22, wall_height=15, floor_h=4, windows="tall", frames=True,
            glass="glass_pane", foundation="stone_bricks", plinth=False))
        if not info:
            continue
        m, x0, z0 = info["mask"], info["x0"], info["z0"]
        mT = m.T
        per = mT & ~ndimage.binary_erosion(mT, structure=np.ones((3, 3)))
        base, top = info["base"], info["wall_top"]
        E = world.edits
        for x, z in zip(*np.nonzero(per)):
            X, Z = int(x + x0), int(z + z0)
            along = X + Z
            for rel in range(1, 5):          # grey stone ground floor with round-arched windows
                win = along % 4 in (1, 2) and rel in (2, 3)
                if rel == 4 and along % 4 in (1, 2):
                    E.set(X, base + rel, Z, "stone_brick_slab[type=top]")
                elif not win:
                    E.set(X, base + rel, Z, "stone_bricks")
            E.set(X, base + 5, Z, "smooth_stone")          # cornice over the stone base
        door = info.get("door")
        if door:
            dx, by, dz, facing = door
            ox, oz = DIRS4[facing]
            tx, tz = -oz, ox
            # big curved gable with an oculus
            for o in range(-6, 7):
                hh = int(round(math.sqrt(max(0, 42 - o * o)) * 1.25))
                for k in range(1, hh + 1):
                    blk = "yellow_terracotta"
                    if math.hypot(o, k - 5) <= 1.6:
                        blk = "glass"
                    elif math.hypot(o, k - 5) <= 2.4:
                        blk = "smooth_stone"
                    E.set(dx + tx * o, top + k, dz + tz * o, blk)
                E.set(dx + tx * o, top + hh + 1, dz + tz * o, "brick_slab[type=bottom]")
            # two oriels with copper caps beside the gable
            for side in (-9, 9):
                for o in (-1, 0, 1):
                    x, z = dx + tx * (side + o) + ox, dz + tz * (side + o) + oz
                    for y in range(base + 6, top + 1):
                        E.set(x, y, z, "glass" if o == 0 or (y - base) % 4 in (1, 2) else "yellow_terracotta")
                    E.set(x, base + 5, z, "smooth_stone")
                    E.set(x, top + 1, z, "oxidized_cut_copper_slab[type=bottom]")
        # green copper roof lantern on the ridge
        rx, rz = np.argwhere(mT)[len(np.argwhere(mT)) // 2]
        cxl, czl = int(rx + x0), int(rz + z0)
        ry = info["roof_top"]
        v = Vox(cxl - 3, ry - 3, czl - 3, 7, 14, 7)
        v.hollow(cxl - 1, ry - 2, czl - 1, cxl + 1, ry + 2, czl + 1, "oxidized_copper", None)
        for dx_, dz_ in ((0, -1), (0, 1), (-1, 0), (1, 0)):
            v.set(cxl + dx_, ry + 1, czl + dz_, "glass")
        v.fill(cxl - 2, ry + 3, czl - 2, cxl + 2, ry + 3, czl + 2, "oxidized_cut_copper_slab[type=bottom]")
        v.fill(cxl - 1, ry + 4, czl - 1, cxl + 1, ry + 4, czl + 1, "oxidized_cut_copper")
        v.set(cxl, ry + 5, czl, "oxidized_cut_copper")
        v.set(cxl, ry + 6, czl, "lightning_rod")
        v.commit(world.edits)
    world.markers["BG Gallus"] = (-92, int(world.h(-92, 540)) + 1, 540)


# ================================================================== Bahnhof
def is_station_part(r) -> bool:
    return r["name"] == "Bregenz Busbahnhof"


def bahnhof(world: World) -> None:
    """Bahnhof Bregenz (1988): white upper storey with teal ribbon windows under green copper roofs, brick-red
    base, central glass hall, west wing with glazed barrel vaults, house-platform canopy, platform canopies with
    glazed ridges, the long glazed footbridge to the Seestadt, the new timber ÖBB building with its lift tower."""
    g = world.grid
    r = _named("building", "Bregenz Busbahnhof")
    if r is None:
        return
    fp = _bg(r)
    fr = Frame(fp, pad=10)
    foot = fr.mask(fp)
    base = int(np.percentile(fr.ground(world)[foot & (fr.Z > 226)], 50))
    south = foot & (fr.Z > 226)              # station building between the tracks and the bus station
    canopy = foot & ~south                   # house platform roof along the tracks
    H = np.zeros(foot.shape, int)
    P = np.zeros(foot.shape, np.int8)
    west = south & (fr.X < -540)
    main = south & (fr.X >= -540) & (fr.X < -503)
    gap = south & (fr.X >= -503) & (fr.X < -488)
    obb = south & (fr.X >= -488)
    H[west], P[west] = base + 6, 1
    H[main], P[main] = base + 11, 2
    H[gap], P[gap] = base + 11, 2
    H[obb], P[obb] = base + 9, 4
    hall = None
    for p in data.overture("building_part"):
        gp = _bg(p)
        if 180 < gp.area < 240 and gp.distance(fp) < 2:
            hall = gp
    hm = fr.mask(hall) & south if hall is not None else np.zeros_like(foot)
    H[hm], P[hm] = base + 14, 3
    WH, TEAL, BR, CY, GL, BIRCH, RED, LOGV = _ids("white_concrete", "oxidized_cut_copper", "terracotta", "cyan_terracotta",
                                                 "light_blue_stained_glass", "stripped_birch_log[axis=y]",
                                                 "red_terracotta", "birch_planks")

    def wall(X, Z, rel, Pp, face):
        along = np.where(face < 2, X, Z)
        out = np.full(X.shape, WH, np.uint16)
        low = rel <= 5
        out[low] = BR
        out[low & (rel >= 2) & (rel <= 4) & (along % 4 != 0)] = GL       # shop windows
        out[(rel == 6)] = CY
        out[(rel >= 8) & (rel <= 9) & (along % 3 != 0)] = GL            # teal ribbon windows upstairs
        out[(rel >= 8) & (rel <= 9) & (along % 3 == 0)] = CY
        w = Pp == 1
        out[w & (rel >= 2) & (rel <= 4)] = np.where(along[w & (rel >= 2) & (rel <= 4)] % 5 == 0, BR, GL)
        out[w & (rel == 6)] = TEAL
        hl_ = Pp == 3
        out[hl_ & (rel > 5)] = GL
        out[hl_ & (rel > 5) & (along % 3 == 0)] = TEAL
        ob = Pp == 4
        if ob.any():
            ground = ob & (rel <= 4)
            out[ground] = np.where(along[ground] % 4 == 0, BIRCH, B("glass"))
            out[ob & (rel <= 4) & (along % 11 < 3)] = RED                  # dark red panel by the entrance
            out[ob & (rel == 5)] = LOGV                                     # timber fascia (ÖBB logo)
            out[ob & (rel >= 6)] = RED                                      # red cladding upstairs
            out[ob & (rel >= 6) & (rel <= 7) & (along % 5 == 2)] = B("glass")
        return out

    def roof(X, Z, Pp):
        out = np.full(X.shape, B("gravel"), np.uint16)
        out[Pp == 3] = GL
        out[(Pp == 3) & (X % 3 == 0)] = TEAL
        out[Pp == 4] = B("smooth_stone")
        return out

    mass(world, fr, np.where(south, H, 0), P, base, wall, roof, parapet=None)
    E = world.edits
    # green copper mansard band all round the roof edges (main + west wing)
    sp = np.pad(south & (P != 4) & (P != 3), 1)
    for x, z in zip(*np.nonzero(south & (P != 4) & (P != 3))):
        X, Z = int(fr.X[x, z]), int(fr.Z[x, z])
        top = int(H[x, z])
        for dname, (dx, dz) in DIRS4.items():
            if not sp[x + 1 + dx, z + 1 + dz]:
                opp = {"north": "south", "south": "north", "east": "west", "west": "east"}[dname]
                E.set(X, top, Z, f"oxidized_cut_copper_stairs[facing={opp},half=bottom]")
                if P[x, z] == 2:
                    E.set(X, top - 1, Z, "oxidized_cut_copper")
                break
    # main building: green copper hipped roof over the white upper storey
    mainm = south & (P == 2)
    ed = ndimage.distance_transform_edt(np.pad(mainm, 1))[1:-1, 1:-1]
    for x, z in zip(*np.nonzero(mainm)):
        X, Z = int(fr.X[x, z]), int(fr.Z[x, z])
        top = int(H[x, z])
        rise = int(min(ed[x, z] - 1, 4))
        for k in range(1, rise + 1):
            E.set(X, top + k, Z, "oxidized_cut_copper")
        if rise >= 4:
            E.set(X, top + 5, Z, "oxidized_cut_copper_slab[type=bottom]")
    # west wing: three glazed barrel vaults + small white roof domes
    wx = fr.X[west]
    if wx.size:
        for k, xc in enumerate(np.linspace(wx.min() + 8, wx.max() - 8, 3)):
            xc = int(xc)
            col = west & (np.abs(fr.X - xc) <= 2)
            for x, z in zip(fr.X[col], fr.Z[col]):
                d = abs(int(x) - xc)
                E.set(int(x), base + 7 + (2 - d) // 1 - (1 if d == 2 else 0), int(z), "light_blue_stained_glass" if d < 2 else "oxidized_cut_copper")
        dm = west & (fr.X % 9 == 4) & (fr.Z % 7 == 3) & (np.abs(fr.X - np.round((fr.X - wx.min()) / 1)) >= 0)
        for x, z in zip(fr.X[dm], fr.Z[dm]):
            if all(abs(int(x) - xc) > 3 for xc in np.linspace(wx.min() + 8, wx.max() - 8, 3)):
                E.set(int(x), base + 7, int(z), "white_concrete")
                E.set(int(x), base + 8, int(z), "white_concrete_powder")
    # house-platform canopy (part of the footprint along the tracks)
    _canopy_cells(world, fr.X[canopy], fr.Z[canopy], base + 5)
    _occupy(world, fr, canopy)
    # platform canopies (OSM "roof" footprints)
    st = shapely.Point(*geo.place(47.502944, 9.739917)).buffer(90)
    for b in data.overture("building"):
        if b.get("class") != "roof":
            continue
        p = _bg(b)
        if not p.intersects(st) or p.area < 200:
            continue
        m, x0, z0 = raster.polygon_cells(p)
        zz, xx = np.nonzero(m)
        X, Z = xx + x0, zz + z0
        ok = g.inside(X, Z)
        if not ok.any():
            continue
        y = int(np.median(world.h(X[ok], Z[ok]))) + 5
        _canopy_cells(world, X[ok], Z[ok], y, p)
    _obb_building(world, fr, obb, base)
    _footbridge(world, base)
    world.markers["Bahnhof Bregenz"] = (-512, base + 1, 258)


def _canopy_cells(world: World, X, Z, y: int, poly=None) -> None:
    """Teal copper canopy with a raised glazed ridge, slender teal columns and lights underneath."""
    if len(X) == 0:
        return
    if poly is None:
        poly = shapely.MultiPoint(list(zip(X.tolist(), Z.tolist()))).convex_hull
    long_v, hs, hl = buildings._orientation(poly)
    c = np.asarray(poly.centroid.coords[0])
    nrm = np.array([-long_v[1], long_v[0]])
    E = world.edits
    for x, z in zip(X, Z):
        q = np.array([x + 0.5, z + 0.5]) - c
        across = abs(q @ nrm)
        along = q @ long_v
        if across < hs * 0.35:
            E.set(int(x), y + 1, int(z), "white_stained_glass")
            E.set(int(x), y + 2, int(z), "oxidized_cut_copper_slab[type=bottom]" if int(round(along)) % 6 == 0 else "air")
        elif across < hs - 0.6:
            E.set(int(x), y + 1, int(z), "oxidized_cut_copper_slab[type=bottom]")
        else:
            E.set(int(x), y, int(z), "oxidized_cut_copper_slab[type=top]")
        if across < 0.8 and int(round(along)) % 9 == 0:
            for yy in range(int(world.h(x, z)) + 1, y + 1):
                E.set(int(x), yy, int(z), "oxidized_copper")
        if across < 0.8 and int(round(along)) % 9 == 4:
            E.set(int(x), y, int(z), "sea_lantern")


def _obb_building(world: World, fr: Frame, obb, base: int) -> None:
    """New ÖBB building: timber ground floor with the red ÖBB logo, red cladding upstairs behind a timber lattice,
    timber lift tower with a glass shaft, black bicycle shelter."""
    if not obb.any():
        return
    E = world.edits
    X, Z = fr.X[obb], fr.Z[obb]
    x0, x1, z0, z1 = int(X.min()), int(X.max()), int(Z.min()), int(Z.max())
    # timber lattice screen one block in front of the red upper floor (east and south faces)
    lattice = set()
    for z in range(z0 - 1, z1 + 2):
        lattice.add((x1 + 1, z))
    for x in range(x0, x1 + 2):
        lattice.add((x, z1 + 1))
    for (x, z), st in _connected(lattice, "birch_fence").items():
        for y in (base + 6, base + 8, base + 9):
            E.set(x, y, z, st)
        if (x + z) % 2 == 0:
            E.set(x, base + 7, z, "birch_fence")
    for x, z in lattice:
        E.set(x, base + 10, z, "birch_slab[type=bottom]")
    # ÖBB logo: red glowing text on the timber fascia (east face)
    zm = (z0 + z1) // 2
    E.set(x1 + 1, base + 5, zm, "birch_wall_sign[facing=east]")
    from . import nbt
    msgs = nbt.List(['{"text":""}', '{"text":"ÖBB","bold":true}', '{"text":""}', '{"text":""}'], nbt.TAG_STRING)
    E.block_entity({"id": "minecraft:sign", "x": nbt.Int(x1 + 1), "y": nbt.Int(base + 5), "z": nbt.Int(zm),
                    "keepPacked": nbt.Byte(0), "is_waxed": nbt.Byte(1),
                    "front_text": {"messages": msgs, "color": "red", "has_glowing_text": nbt.Byte(1)},
                    "back_text": {"messages": msgs, "color": "red", "has_glowing_text": nbt.Byte(1)}})
    # lift tower: timber clad with a glass shaft, up to the footbridge level
    tx, tz = x0 - 3, z1 - 3
    top = base + 14
    v = Vox(tx - 3, base, tz - 3, 7, top - base + 4, 7)
    v.hollow(tx - 2, base + 1, tz - 2, tx + 2, top, tz + 2, "birch_planks", "air")
    for y in range(base + 1, top):
        for dz in (-1, 0, 1):
            v.set(tx + 2, y, tz + dz, "glass")
        v.set(tx - 2, y, tz, "glass")
    v.fill(tx - 2, top + 1, tz - 2, tx + 2, top + 1, tz + 2, "birch_slab[type=bottom]")
    v.set(tx, base + 1, tz + 2, "air")
    v.set(tx, base + 2, tz + 2, "air")
    v.commit(E)
    # bicycle shelter: black steel roof on posts, racks underneath
    bx, bz = x1 + 4, z1 + 3
    for dx in range(0, 10):
        for dz in range(0, 4):
            E.set(bx + dx, base + 4, bz + dz, "polished_blackstone_slab[type=bottom]")
            if dz in (1, 2) and dx % 2 == 0:
                E.set(bx + dx, int(world.h(bx + dx, bz + dz)) + 1, bz + dz, "iron_bars")
    for dx, dz in ((0, 0), (9, 0), (0, 3), (9, 3)):
        for y in range(int(world.h(bx + dx, bz + dz)) + 1, base + 4):
            E.set(bx + dx, y, bz + dz, "polished_blackstone_wall")
    g = world.grid
    for dx in range(-1, 11):
        for dz in range(-1, 5):
            if g.inside(bx + dx, bz + dz):
                world.occupied[bz + dz - g.z0, bx + dx - g.x0] = True


def _footbridge(world: World, base: int) -> None:
    """The glazed teal footbridge: from the lake-side platforms over all tracks, through the station and over
    the road to the Seestadt, with stair towers on the platforms."""
    g = world.grid
    br = None
    for r in data.overture("infrastructure"):
        if r["class"] == "bridge" and r["geom"].geom_type == "Polygon":
            p = _bg(r)
            if p.distance(shapely.Point(-500, 220)) < 10 and p.length > 150:
                br = p
    if br is None:
        return
    rect = br.minimum_rotated_rectangle
    long_v, hs, hl = buildings._orientation(br)
    c = np.asarray(rect.centroid.coords[0])
    nrm = np.array([-long_v[1], long_v[0]])
    # deck clears the catenary over the highest ground under the bridge
    hmax = max(int(world.h(int(p[0]), int(p[1]))) for p in (c + long_v * t for t in np.arange(-hl, hl, 2.0)))
    deck = max(base + 9, hmax + 8)
    E = world.edits
    for t in np.arange(-hl + 1, hl - 1, 0.5):
        for o in np.arange(-2.0, 2.01, 0.5):
            p = c + long_v * t + nrm * o
            x, z = int(math.floor(p[0])), int(math.floor(p[1]))
            if not g.inside(x, z):
                continue
            edge = abs(o) >= 1.9
            E.set(x, deck, z, "smooth_stone" if not edge else "oxidized_cut_copper")
            for y in (deck + 1, deck + 2, deck + 3):
                E.set(x, y, z, ("light_blue_stained_glass" if y > deck + 1 else "oxidized_cut_copper") if edge else "air")
            E.set(x, deck + 4, z, "oxidized_cut_copper_slab[type=bottom]" if abs(o) > 0.9 else "oxidized_cut_copper")
            E.set(x, deck + 5, z, "oxidized_cut_copper_slab[type=bottom]" if abs(o) <= 0.9 else "air")
        if int(t * 2) % 20 == 0:
            for o in (-2.0, 2.0):
                p = c + long_v * t + nrm * o
                x, z = int(math.floor(p[0])), int(math.floor(p[1]))
                if g.inside(x, z) and not world.occupied[z - g.z0, x - g.x0]:
                    for y in range(int(world.h(x, z)) + 1, deck):
                        E.set(x, y, z, "white_concrete")
    # stair towers where OSM has small building parts along the bridge (platform stairs / lifts)
    for p in data.overture("building_part"):
        gp = _bg(p)
        if gp.area < 20 or gp.area > 80 or gp.distance(br) > 3:
            continue
        cc = gp.centroid
        x, z = int(cc.x), int(cc.y)
        h = int(world.h(x, z))
        v = Vox(x - 3, h, z - 3, 7, deck - h + 8, 7)
        v.hollow(x - 2, h + 1, z - 2, x + 2, deck + 3, z + 2, "oxidized_copper", "air")
        for y in range(h + 2, deck + 3):
            for dz in (-1, 0, 1):
                v.set(x - 2, y, z + dz, "light_blue_stained_glass")
                v.set(x + 2, y, z + dz, "light_blue_stained_glass")
        for k in range(min(deck - h - 1, 12)):
            v.set(x - 1 + (k // 4) % 3, h + 1 + k, z - 1 + (k % 4 > 1), "oxidized_cut_copper_slab[type=top]")
        v.fill(x - 2, deck + 4, z - 2, x + 2, deck + 4, z + 2, "oxidized_cut_copper")
        v.set(x, deck + 5, z, "oxidized_cut_copper_slab[type=bottom]")
        for y in (deck + 1, deck + 2):
            for dx in (-2, 2):
                v.set(x + dx, y, z, "air")
        v.commit(E)
    # stairs down at the Seestadt end
    end = c + long_v * hl * (1 if (c + long_v * hl)[1] > (c - long_v * hl)[1] else -1)
    ux = long_v if (c + long_v * hl)[1] > (c - long_v * hl)[1] else -long_v
    for k in range(deck - int(world.h(int(end[0]), int(end[1])))):
        p = end + ux * k
        for o in (-1, 0, 1):
            q = p + nrm * o
            x, z = int(math.floor(q[0])), int(math.floor(q[1]))
            if g.inside(x, z):
                E.set(x, deck - k, z, "smooth_stone_slab[type=top]")
    world.markers["Bahnhof Steg"] = (int(c[0]), deck + 1, int(c[1]))


# ============================================================= Fischersteg
def fischersteg(world: World) -> None:
    """Fischersteg: plank deck on dark timber piles with a white railing, white octagonal pavilion with
    braced posts, shingled roof and finial at the lake end; white sun sails along the promenade."""
    from .landmarks import _row
    r = _row("infrastructure", "Fischersteg")
    if r is None:
        return
    p = _bg(r)
    long_v, hs, hl = buildings._orientation(p)
    c = np.asarray(p.centroid.coords[0])
    a, b = c - long_v * hl, c + long_v * hl
    if world.is_water(int(a[0]), int(a[1])) and not world.is_water(int(b[0]), int(b[1])):
        a, b = b, a
    u = (b - a) / np.linalg.norm(b - a)
    nrm = np.array([-u[1], u[0]])
    L = float(np.linalg.norm(b - a)) + 4           # reach a little further onto the lake
    deck = WL + 2
    pc = a + u * (L + 3.5)                          # pavilion centre beyond the walkway
    E = world.edits
    g = world.grid
    rail = set()
    occ = []
    for t in np.arange(-2.0, L + 0.01, 0.5):
        for o in np.arange(-1.5, 1.51, 0.5):
            q = a + u * t + nrm * o
            x, z = int(math.floor(q[0])), int(math.floor(q[1]))
            E.set(x, deck, z, "oak_planks")
            occ.append((x, z))
        for o in (-2.0, 2.0):
            q = a + u * t + nrm * o
            rail.add((int(math.floor(q[0])), int(math.floor(q[1]))))
        if int(t * 2) % 8 == 0:                       # dark timber piles in pairs
            for o in (-1.5, 1.5):
                q = a + u * t + nrm * o
                x, z = int(math.floor(q[0])), int(math.floor(q[1]))
                for y in range(int(world.h(x, z)) + 1, deck):
                    E.set(x, y, z, "dark_oak_log[axis=y]")
    # octagonal pavilion platform
    R = 4.6
    px, pz = pc
    plat = set()
    for dx in range(-6, 7):
        for dz in range(-6, 7):
            if abs(dx) + abs(dz) <= R * 1.42 and max(abs(dx), abs(dz)) <= R:
                x, z = int(px) + dx, int(pz) + dz
                plat.add((x, z))
                E.set(x, deck, z, "oak_planks")
                occ.append((x, z))
                if (dx % 3 == 0 and dz % 3 == 0):
                    for y in range(int(world.h(x, z)) + 1, deck):
                        E.set(x, y, z, "dark_oak_log[axis=y]")
    edge = {(x, z) for (x, z) in plat if any((x + dx, z + dz) not in plat for dx, dz in DIRS4.values())}
    rail = {q for q in rail if q not in plat} | edge
    # leave the opening towards the walkway
    entry = a + u * (L + 0.2)
    rail = {q for q in rail if math.hypot(q[0] + 0.5 - entry[0], q[1] + 0.5 - entry[1]) > 2.2 or q not in edge}
    for (x, z), st in _connected(rail, "birch_fence").items():
        E.set(x, deck + 1, z, st)
    for (x, z) in rail:
        if (x + z) % 3 == 0:
            E.set(x, deck + 1, z, "white_concrete")      # white posts with banners between
            E.set(x, deck + 2, z, "white_carpet")
    # pavilion: 8 white posts with brackets, white frieze, shingled octagonal roof, finial
    cx, cz = int(px), int(pz)
    posts = [(3, 0), (-3, 0), (0, 3), (0, -3), (2, 2), (-2, 2), (2, -2), (-2, -2)]
    for dx, dz in posts:
        for y in range(deck + 1, deck + 5):
            E.set(cx + dx, y, cz + dz, "diorite_wall")
    ring = set()
    for dx in range(-3, 4):
        for dz in range(-3, 4):
            d = max(abs(dx), abs(dz)) + 0.5 * min(abs(dx), abs(dz))
            if 2.5 <= d <= 3.6:
                ring.add((cx + dx, cz + dz))
    for (x, z) in ring:
        E.set(x, deck + 5, z, "white_concrete")
    for (x, z) in ring:
        if (x - cx, z - cz) not in posts:
            dx, dz = x - cx, z - cz
            f = ("west" if dx > 0 else "east") if abs(dx) >= abs(dz) else ("north" if dz > 0 else "south")
            E.set(x, deck + 4, z, f"quartz_stairs[facing={f},half=top]")   # diagonal braces under the frieze
    for k in range(9):
        rr = 4.6 - k * 0.55
        y = deck + 6 + k // 2
        slab = "deepslate_tile_slab[type=bottom]" if k % 2 == 0 else "deepslate_tile_slab[type=top]"
        for dx in range(-5, 6):
            for dz in range(-5, 6):
                d = max(abs(dx), abs(dz)) + 0.42 * min(abs(dx), abs(dz))
                if rr - 0.6 < d <= rr:
                    E.set(cx + dx, y, cz + dz, slab)
    E.set(cx, deck + 10, cz, "deepslate_tiles")
    E.set(cx, deck + 11, cz, "iron_bars")
    E.set(cx, deck + 12, cz, "lightning_rod")
    E.set(cx, deck + 5, cz, "lantern[hanging=true]")
    # bar counter and two white umbrellas inside
    for dz in (-1, 0, 1):
        E.set(cx - 1, deck + 1, cz + dz, "white_concrete")
        E.set(cx - 1, deck + 2, cz + dz, "smooth_quartz_slab[type=bottom]")
    for dx, dz in ((1, -1), (1, 1)):
        E.set(cx + dx, deck + 1, cz + dz, "birch_fence")
        E.set(cx + dx, deck + 2, cz + dz, "white_carpet")
    # white sun sails along the promenade next to the pier
    shore = a - nrm * 0
    for k in range(7):
        q = shore - u * 5 + nrm * (6 + k * 5)
        x, z = int(q[0]), int(q[1])
        if not g.inside(x, z) or world.is_water(x, z) or world.road[z - g.z0, x - g.x0] or world.occupied[z - g.z0, x - g.x0]:
            q = shore - u * 5 - nrm * (6 + k * 5)
            x, z = int(q[0]), int(q[1])
            if not g.inside(x, z) or world.is_water(x, z) or world.occupied[z - g.z0, x - g.x0]:
                continue
        h = int(world.h(x, z))
        for y in range(h + 1, h + 4):
            E.set(x, y, z, "iron_bars")
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                E.set(x + dx, h + 4 + (1 if dx + dz > 0 else 0), z + dz, "white_wool" if dx + dz <= 0 else "white_carpet")
        world.occupied[z - g.z0, x - g.x0] = True
    for (x, z) in set(occ) | rail:
        if g.inside(x, z):
            world.occupied[z - g.z0, x - g.x0] = True
    world.markers["Fischersteg"] = (cx, deck + 1, cz)


# ================================================================== Rathaus
def rathaus(world: World) -> None:
    """Rathaus Bregenz (Rathausstrasse): cream four-storey palace on a grey rusticated ground floor with barred
    windows, dark roof with dormers, central tower with stepped baroque gable, clock and a green copper
    double onion helm; stone balcony; inside the oak-panelled council chamber."""
    r = _named("building", "Rathaus")
    if r is None:
        return
    poly = _bg(r)
    info = buildings.building(world, dict(r, id="rathaus"), poly, dict(
        facade="smooth_sandstone", roof=("deepslate_tiles", "deepslate_tile_slab[type=bottom]"), flat=False, gable=False,
        pitch=1.2, roof_cap=6, height=23, wall_height=17, floor_h=4, windows="normal", frames=True, plinth=False,
        glass="glass_pane", foundation="stone_bricks", floor="oak_planks", shop=False))
    if not info:
        return
    m, x0, z0 = info["mask"], info["x0"], info["z0"]
    mT = m.T
    per = mT & ~ndimage.binary_erosion(mT, structure=np.ones((3, 3)))
    inner = mT & ~per
    base, top = info["base"], info["wall_top"]
    E = world.edits
    for x, z in zip(*np.nonzero(per)):
        X, Z = int(x + x0), int(z + z0)
        along = X + Z
        for rel in range(1, 5):                  # grey rusticated ground floor, barred windows
            if along % 4 in (1, 2) and rel in (2, 3):
                E.set(X, base + rel, Z, "iron_bars")
            else:
                E.set(X, base + rel, Z, "stone_bricks" if rel % 2 else "polished_andesite")
        E.set(X, base + 5, Z, "smooth_stone")
        E.set(X, top, Z, "smooth_quartz")         # dark cornice line under the roof
    # dormers along the eaves
    for x, z in zip(*np.nonzero(per)):
        X, Z = int(x + x0), int(z + z0)
        nb = sum(1 for dx, dz in DIRS4.values() if 0 <= x + dx < mT.shape[0] and 0 <= z + dz < mT.shape[1] and per[x + dx, z + dz])
        if nb == 2 and (X + Z) % 6 == 3:
            E.set(X, top + 1, Z, "glass")
            E.set(X, top + 2, Z, "glass")
            E.set(X, top + 3, Z, "deepslate_tile_slab[type=bottom]")
    door = info.get("door")
    if door:
        dx, by, dz, facing = door
        ox, oz = DIRS4[facing]
        tx, tz = -oz, ox
        # risalit with stepped baroque gable, clock and coat of arms
        for o in range(-4, 5):
            steps = 9 - (abs(o) // 2) * 2
            for k in range(1, steps + 1):
                blk = "smooth_sandstone"
                if abs(o) <= 1 and 3 <= k <= 5:
                    blk = "white_concrete" if (o, k) != (0, 4) else "black_concrete"   # clock face
                if o == 0 and k == 2:
                    blk = "gold_block"                                                   # coat of arms
                E.set(dx + tx * o, top + k, dz + tz * o, blk)
            E.set(dx + tx * o, top + steps + 1, dz + tz * o, "smooth_quartz_slab[type=bottom]")
        # octagonal dark belfry and green copper double onion with spire, standing on the gable
        cx, cz = dx - ox * 3, dz - oz * 3
        y0 = top + 10
        v = Vox(cx - 4, y0, cz - 4, 9, 26, 9)
        for y in range(y0, y0 + 6):
            for ddx in range(-2, 3):
                for ddz in range(-2, 3):
                    if abs(ddx) + abs(ddz) <= 3:
                        edge = abs(ddx) == 2 or abs(ddz) == 2 or abs(ddx) + abs(ddz) == 3
                        win = edge and (ddx == 0 or ddz == 0) and y - y0 in (2, 3)
                        v.set(cx + ddx, y, cz + ddz, "glass" if win else ("blackstone" if edge else "air"))
        prof = [2.6, 3.0, 2.6, 1.8, 1.0, 1.4, 1.8, 1.4, 0.8, 0.5]
        for k, rr in enumerate(prof):
            for ddx in range(-3, 4):
                for ddz in range(-3, 4):
                    if math.hypot(ddx, ddz) <= rr:
                        v.set(cx + ddx, y0 + 6 + k, cz + ddz, "oxidized_cut_copper" if k % 4 else "oxidized_copper")
        for k in range(4):
            v.set(cx, y0 + 16 + k, cz, "lightning_rod" if k == 3 else "iron_bars")
        v.commit(E)
        # stone balcony over the entrance on the first floor
        for o in range(-4, 5):
            for k in (1, 2):
                x, z = dx + ox * k + tx * o, dz + oz * k + tz * o
                E.set(x, base + 5, z, "smooth_stone_slab[type=top]")
                if k == 2 or abs(o) == 4:
                    E.set(x, base + 6, z, "diorite_wall")
            E.set(dx + ox + tx * o, base + 4, dz + oz + tz * o, "stone_brick_stairs[facing=%s,half=top]" % facing
                  if abs(o) in (1, 3) else "air")
        for k in range(-1, 2):
            E.set(dx + tx * k, base + 6, dz + tz * k, "glass")
            E.set(dx + tx * k, base + 7, dz + tz * k, "glass")
        # "RATHAUS" lettering above the second floor windows
        sx, sz = dx + ox, dz + oz
        E.set(sx, base + 12, sz, f"dark_oak_wall_sign[facing={facing}]")
        from . import nbt
        msgs = nbt.List(['{"text":""}', '{"text":"RATHAUS","bold":true}', '{"text":""}', '{"text":""}'], nbt.TAG_STRING)
        E.block_entity({"id": "minecraft:sign", "x": nbt.Int(sx), "y": nbt.Int(base + 12), "z": nbt.Int(sz),
                        "keepPacked": nbt.Byte(0), "is_waxed": nbt.Byte(1),
                        "front_text": {"messages": msgs, "color": "white", "has_glowing_text": nbt.Byte(1)},
                        "back_text": {"messages": msgs, "color": "white", "has_glowing_text": nbt.Byte(1)}})
    _council_chamber(world, mT, inner, x0, z0, base + 4)
    c = poly.centroid
    world.markers["Rathaus Bregenz"] = (int(c.x), base + 5, int(c.y))


def _council_chamber(world: World, mT, inner, x0, z0, fy: int) -> None:
    """Sitzungssaal on the first floor: oak panelling, parquet, U-shaped grey tables with red-brown chairs, the
    mayor's desk under the coat of arms, white ceiling with pendant lamps."""
    E = world.edits
    xs, zs = np.nonzero(inner)
    if xs.size < 40:
        return
    ring = inner & ~ndimage.binary_erosion(inner)
    for x, z in zip(xs, zs):
        X, Z = int(x + x0), int(z + z0)
        E.set(X, fy, Z, "oak_planks" if (X + Z) % 4 < 2 else "spruce_planks")       # herringbone-ish parquet
        E.set(X, fy + 4, Z, "white_concrete")                                          # white ceiling
        for y in (fy + 1, fy + 2, fy + 3):
            E.set(X, y, Z, "air")
    for x, z in zip(*np.nonzero(ring)):
        X, Z = int(x + x0), int(z + z0)
        E.set(X, fy + 1, Z, "stripped_oak_log[axis=y]" if (X + Z) % 4 == 0 else "oak_planks")
        E.set(X, fy + 2, Z, "stripped_oak_log[axis=y]" if (X + Z) % 4 == 0 else "oak_planks")
        E.set(X, fy + 3, Z, "oak_slab[type=bottom]")
    # U of tables along the long axis
    cxm, czm = xs.mean(), zs.mean()
    along_x = (xs.max() - xs.min()) >= (zs.max() - zs.min())
    half = int(((xs.max() - xs.min()) if along_x else (zs.max() - zs.min())) / 2) - 3
    for t in range(-half + 2, half - 1):
        for side in (-2, 2):
            if along_x:
                X, Z = int(cxm + t + x0), int(czm + side + z0)
                E.set(X, fy + 1, Z, "smooth_stone_slab[type=top]")
                E.set(X, fy + 1, Z + int(np.sign(side)), "mangrove_stairs[facing=%s,half=bottom]" % ("north" if side > 0 else "south"))
            else:
                X, Z = int(cxm + side + x0), int(czm + t + z0)
                E.set(X, fy + 1, Z, "smooth_stone_slab[type=top]")
                E.set(X + int(np.sign(side)), fy + 1, Z, "mangrove_stairs[facing=%s,half=bottom]" % ("west" if side > 0 else "east"))
    # mayor's desk + coat of arms at the head of the room
    hx, hz = (int(cxm + half + x0), int(czm + z0)) if along_x else (int(cxm + x0), int(czm + half + z0))
    for o in (-1, 0, 1):
        X, Z = (hx, hz + o) if along_x else (hx + o, hz)
        E.set(X, fy + 1, Z, "oak_planks")
        E.set(X, fy + 2, Z, "oak_slab[type=bottom]")
    X, Z = (hx + 1, hz) if along_x else (hx, hz + 1)
    E.set(X, fy + 1, Z, "mangrove_stairs[facing=%s,half=bottom]" % ("west" if along_x else "north"))
    X, Z = (hx + 2, hz) if along_x else (hx, hz + 2)
    E.set(X, fy + 2, Z, "black_wool")
    E.set(X, fy + 3, Z, "white_wool")
    # pendant lamps
    for x, z in zip(xs, zs):
        if (x + x0) % 4 == 0 and (z + z0) % 4 == 0 and not ring[x, z]:
            E.set(int(x + x0), fy + 3, int(z + z0), "lantern[hanging=true]")


# ============================================================ Kornmarktplatz
def kornmarkt_rows():
    r = _named("land_use", "Kornmarktplatz")
    return _bg(r) if r is not None else None


_KORNMARKT = None


def on_kornmarkt(r) -> bool:
    """Small structures OSM places on the open square (stalls, sheds): the real square is open."""
    global _KORNMARKT
    if _KORNMARKT is None:
        _KORNMARKT = kornmarkt_rows() or shapely.Point(1e9, 1e9)
    g = _bg(r)
    return g.area < 150 and _KORNMARKT.contains(g.centroid)


def kornmarkt(world: World) -> None:
    """Kornmarktplatz: open square in pale warm beige with grey gutter lines, plane trees in planted islands
    ringed by curved wooden benches, lamp masts; the round Nepomukkapelle at the corner."""
    g = world.grid
    pl = kornmarkt_rows()
    if pl is not None:
        fr = Frame(pl, 0)
        m = fr.mask(pl)
        X, Z = fr.X[m], fr.Z[m]
        ok = g.inside(X, Z)
        X, Z = X[ok], Z[ok]
        free = ~world.occupied[Z - g.z0, X - g.x0]
        X, Z = X[free], Z[free]
        pal = np.where((X * 5 + Z * 3) % 7 == 0, B("cut_sandstone"), B("smooth_sandstone"))
        pal = np.where((X - Z) % 23 == 0, B("polished_andesite"), pal)           # grey drainage channels
        world.top[Z - g.z0, X - g.x0] = pal
        world.sub[Z - g.z0, X - g.x0] = B("sandstone")
        world.occupied[Z - g.z0, X - g.x0] = True
        # the two gravel circles with the big plane trees, ringed by curved wooden benches
        edt = ndimage.distance_transform_edt(m)
        cand = np.argwhere(edt >= 10)
        isl = []
        for i in np.argsort(-edt[tuple(cand.T)]):
            x, z = cand[i]
            p = (int(fr.X[x, z]), int(fr.Z[x, z]))
            if all(math.hypot(p[0] - q[0], p[1] - q[1]) > 30 for q in isl):
                isl.append(p)
            if len(isl) == 2:
                break
        E = world.edits
        for ix, iz in isl:
            h = int(world.h(ix, iz))
            ring = set()
            for dx in range(-10, 11):
                for dz in range(-10, 11):
                    d = math.hypot(dx, dz)
                    if d <= 8.5:
                        world.top[iz + dz - g.z0, ix + dx - g.x0] = B("gravel")
                    elif d <= 9.5:
                        ring.add((ix + dx, iz + dz))
            for (x, z) in ring:
                dx, dz = x - ix, z - iz
                f = ("east" if dx > 0 else "west") if abs(dx) >= abs(dz) else ("south" if dz > 0 else "north")
                if (x * 3 + z) % 13:
                    E.set(x, h + 1, z, f"spruce_stairs[facing={_opp(f)},half=bottom]")   # sit facing outwards
            for k, (tx, tz) in enumerate(((ix - 3, iz - 2), (ix + 3, iz + 2), (ix + 1, iz - 4), (ix - 2, iz + 4))):
                _plane_tree(world, tx, tz, h, 12 + k % 3)
        # lamp masts
        for x, z in zip(X[::97], Z[::97]):
            h = int(world.h(x, z))
            for y in range(h + 1, h + 8):
                world.edits.set(int(x), y, int(z), "iron_bars")
            world.edits.set(int(x), h + 8, int(z), "lantern")
    _nepomuk(world)


def _opp(f):
    return {"north": "south", "south": "north", "east": "west", "west": "east"}[f]


def _plane_tree(world: World, x: int, z: int, h: int, height: int) -> None:
    """Big plane tree: mottled trunk, wide crown."""
    E = world.edits
    for y in range(h + 1, h + height):
        E.set(x, y, z, "birch_log[axis=y]" if y % 3 else "stripped_birch_log[axis=y]")
    for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        E.set(x + dx, h + height - 3, z + dz, "birch_log[axis=%s]" % ("x" if dx else "z"))
    for dy in range(-3, 4):
        rr = 5.6 - abs(dy - 0.5) * 0.9
        for dx in range(-5, 6):
            for dz in range(-5, 6):
                if math.hypot(dx, dz) <= rr and (dx * 7 + dz * 3 + dy) % 11:
                    E.set(x + dx, h + height + dy, z + dz, "oak_leaves[persistent=true]")


def _nepomuk(world: World) -> None:
    """Nepomukkapelle: small round white baroque chapel with round-arched windows and a dark domed roof."""
    r = _named("building", "Nepomukkapelle")
    if r is None:
        return
    c = _bg(r).centroid
    cx, cz = int(round(c.x)), int(round(c.y))
    R = max(4.0, math.sqrt(_bg(r).area / math.pi))
    base = int(world.h(cx, cz))
    Ri = int(math.ceil(R)) + 1
    v = Vox(cx - Ri - 1, base - 4, cz - Ri - 1, 2 * Ri + 3, 22, 2 * Ri + 3)
    for dx in range(-Ri, Ri + 1):
        for dz in range(-Ri, Ri + 1):
            d = math.hypot(dx, dz)
            if d > R + 0.4:
                continue
            x, z = cx + dx, cz + dz
            for y in range(int(world.h(x, z)) + 1, base):
                v.set(x, y, z, "stone_bricks")
            v.set(x, base, z, "polished_andesite" if (dx + dz) % 2 else "smooth_stone")
            ang = (math.degrees(math.atan2(dz, dx)) + 360) % 360
            for y in range(base + 1, base + 8):
                rel = y - base
                if d > R - 0.9:
                    win = ang % 72 < 14 and 2 <= rel <= 6
                    pil = 30 <= ang % 72 < 40               # flat pilasters between the windows
                    blk = "glass" if win and rel < 6 else ("white_stained_glass" if win else "white_concrete")
                    if pil and not win:
                        blk = "smooth_quartz"
                    if rel == 1 and not win:
                        blk = "light_gray_concrete"           # grey base course
                    v.set(x, y, z, blk)
                else:
                    v.set(x, y, z, "air")
            v.set(x, base + 8, z, "smooth_quartz" if d > R - 0.9 else "white_concrete")
    # door to the square
    for y in (base + 1, base + 2):
        v.set(cx, y, cz + int(R), "air")
    v.set(cx, base + 1, cz + int(R) - 1, "air")
    # dark domed roof with lantern and cross
    for k in range(int(R) + 1):
        rr = R * math.sqrt(max(0.0, 1 - (k / (R + 0.5)) ** 2)) + 0.4
        for dx in range(-Ri - 1, Ri + 2):
            for dz in range(-Ri - 1, Ri + 2):
                if math.hypot(dx, dz) <= rr:
                    v.set(cx + dx, base + 9 + k, cz + dz, "bricks" if math.hypot(dx, dz) > rr - 1.2 else "white_concrete")
    lt = base + 9 + int(R)
    for k in range(3):                                  # open copper lantern
        for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            v.set(cx + dx, lt + k, cz + dz, "oxidized_copper" if k != 1 else "glass")
        v.set(cx, lt + k, cz, "air" if k else "white_concrete")
    v.fill(cx - 1, lt + 3, cz - 1, cx + 1, lt + 3, cz + 1, "oxidized_cut_copper_slab[type=bottom]")
    v.set(cx, lt + 3, cz, "oxidized_cut_copper")
    v.set(cx, lt + 4, cz, "oxidized_copper")
    v.set(cx, lt + 5, cz, "iron_bars")
    v.set(cx, lt + 6, cz, "lightning_rod")
    # small altar inside
    v.set(cx, base + 1, cz - int(R) + 2, "quartz_bricks")
    v.set(cx, base + 2, cz - int(R) + 2, "candle[candles=3,lit=true]")
    v.set(cx, base + 4, cz, "lantern[hanging=true]")
    for y in range(base + 5, base + 9):
        v.set(cx, y, cz, "chain[axis=y]")
    v.commit(world.edits)
    g = world.grid
    for dx in range(-Ri, Ri + 1):
        for dz in range(-Ri, Ri + 1):
            if math.hypot(dx, dz) <= R + 0.5 and g.inside(cx + dx, cz + dz):
                world.occupied[cz + dz - g.z0, cx + dx - g.x0] = True
    world.markers["Nepomukkapelle"] = (cx, base + 1, cz + int(R) + 2)


# ========================================================== Theater am Kornmarkt
def theater(world: World) -> None:
    """Vorarlberger Landestheater (former Kornhaus, 1838): light plastered granary under a big dark hipped roof,
    sandstone arcade of round arches at the front towards the square, pediment with a green copper edge."""
    r = _named("building", "Theater am Kornmarkt")
    if r is None:
        return
    poly = _bg(r)
    info = buildings.building(world, dict(r, id="landestheater"), poly, dict(
        facade="white_concrete", roof=("dark_oak_planks", "dark_oak_slab[type=bottom]"), flat=False, gable=False,
        pitch=0.9, roof_cap=9, height=22, wall_height=13, floor_h=4, windows="normal", frames=False, plinth=True,
        glass="glass_pane", shop=False, foundation="stone_bricks"))
    if not info:
        return
    long_v, hs, hl = buildings._orientation(poly)
    c = np.asarray(poly.centroid.coords[0])
    nrm = np.array([-long_v[1], long_v[0]])
    sq = kornmarkt_rows()
    side = 1
    if sq is not None:
        tgt = np.asarray(sq.centroid.coords[0])
        side = 1 if (tgt - c) @ long_v > 0 else -1
    base, top = info["base"], info["wall_top"]
    E = world.edits
    out = long_v * side
    end = c + out * (hl - 0.5)
    piers = np.linspace(-hs + 1.0, hs - 1.0, 4)
    for o in np.arange(-hs + 1.0, hs - 0.99, 0.5):
        for depth in (0.0, 1.0, 2.0, 3.0):
            p = end - out * depth + nrm * o
            x, z = int(math.floor(p[0])), int(math.floor(p[1]))
            pier = depth == 0.0 and min(abs(o - q) for q in piers) < 0.8
            for rel in range(1, 6):
                if pier:
                    E.set(x, base + rel, z, "cut_sandstone" if rel < 5 else "smooth_sandstone")
                elif depth == 0.0 and rel == 5:
                    E.set(x, base + rel, z, "white_concrete")
                elif rel < 5 or (rel == 5 and depth > 0 and min(abs(o - q) for q in piers) > 2.2):
                    E.set(x, base + rel, z, "air")
            E.set(x, base, z, "smooth_stone")
    # pediment over the front with a green copper edge
    for o in np.arange(-hs, hs + 0.01, 0.5):
        p = end + nrm * o
        x, z = int(math.floor(p[0])), int(math.floor(p[1]))
        hh = int((hs - abs(o)) * 0.6)
        for k in range(1, hh + 1):
            E.set(x, top + k, z, "white_concrete")
        E.set(x, top + hh + 1, z, "oxidized_cut_copper_slab[type=bottom]")
    world.markers["Landestheater"] = (int(end[0] + out[0] * 3), base + 1, int(end[1] + out[1] * 3))
