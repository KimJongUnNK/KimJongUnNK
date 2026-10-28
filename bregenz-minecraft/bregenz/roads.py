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


def _level(row, a: float, b: float, default: int = 0) -> int:
    """OSM layer of the part [a, b] of a segment (Overture level_rules; bridges default to 1)."""
    mid = (a + b) / 2
    for rule in row.get("level_rules") or []:
        btw = rule.get("between")
        if btw is None or btw[0] - 1e-9 <= mid <= btw[1] + 1e-9:
            return int(rule["value"])
    return default


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
    bridges: list[tuple[str, object, int]] = []
    rails: list = []
    rail_bridges: list = []
    tunnels: list = []
    underpasses: list = []
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
        for a, b in data.has_flag(r, "is_tunnel"):
            if cls in TUNNEL_CLASSES and (b - a) * line.length * 75000 > 40:  # ~metres
                tunnels.append((cls, line, a, b))
            elif (b - a) * line.length * 75000 < 70:
                underpasses.append((cls, line, a, b))
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
                    if is_br:
                        pb_ = raster.to_block_geom(piece[0]).centroid
                        if cls in ("footway", "steps", "path") and -545 < pb_.x < -465 and 115 < pb_.y < 320:
                            continue          # station footbridge: built as one structure in civic.bahnhof
                        bridges.append((cls, piece[0], _level(r, u, v, 1)))
                    else:
                        roads_by_class.setdefault(cls, []).append(piece[0])
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

    # ---- tunnels (Citytunnel, Pfändertunnel, ...): approaches are cut down to the portals first
    ntun = 0
    world.portals = []
    world.bridge_mask = raster.lines([l for _, l, _ in bridges], g, 4).astype(bool) if bridges else np.zeros_like(road)
    for cls, line, a, b in tunnels:
        pr = ROAD_STYLE[cls][2]
        if _tunnel(world, cls, line, a, b, road & (allmask == pr + 1)):
            ntun += 1

    # rail corridor (needed for bridge clearance over the tracks + catenary)
    rail_ll = [shapely.transform(l, lambda c: np.column_stack(geo.to_lonlat(c[:, 0], c[:, 1]))) for l in rails + rail_bridges]
    railmask = raster.lines(rail_ll, g, 6).astype(bool) if rail_ll else np.zeros_like(road)

    log(f"roads: {ntun} tunnels carved")
    nunder = 0
    crossing = list(rails) + [raster.to_block_geom(l) for c2 in ("motorway", "trunk", "primary", "secondary", "tertiary",
                                                                 "unclassified", "residential") for l in roads_by_class.get(c2, [])]
    tree = shapely.STRtree(crossing) if crossing else None
    for cls, line, a, b in underpasses:
        pr = ROAD_STYLE[cls][2]
        if tree is not None and _underpass(world, cls, line, a, b, tree, crossing, road & (allmask == pr + 1)):
            nunder += 1
    log(f"roads: {nunder} underpasses carved")

    # ---- bridges: concrete decks between their ends. Clearance: 5 free over roads, 8 over tracks, 4 over water,
    # 5 over a lower bridge (OSM layer order). Ends that would hang in the air get an embankment ramp along the
    # road; ends at a tunnel portal are pinned to the portal floor.
    nb = 0
    rail_cells: set = set()
    E = world.edits
    deckmap: dict[tuple[int, int], tuple[int, int]] = {}   # (x, z) -> (deck y, layer)
    portals = [(px_, pz_, yp) for px_, pz_, yp, _ in world.portals]
    under_lines = [(raster.to_block_geom(l), 7) for cls_, ls in roads_by_class.items() if cls_ not in ("path", "track")
                   for l in ls] + [(l, 10) for l in rails]
    under_tree = shapely.STRtree([q for q, _ in under_lines]) if under_lines else None
    for cls, line, layer in sorted(bridges, key=lambda t: t[2]):
        w = ROAD_STYLE[cls][0]
        lb = raster.to_block_geom(line)
        if lb.length < 2:
            continue
        xs, zs, d = _sample(lb, 0.5)
        L = max(d[-1], 1e-6)
        h0 = float(world.surface(int(np.floor(xs[0])), int(np.floor(zs[0]))) - 1)
        h1 = float(world.surface(int(np.floor(xs[-1])), int(np.floor(zs[-1]))) - 1)
        # ends near a tunnel portal stay on the approach road (no ramp up, no embankment in front of the portal)
        pins = {}
        for end, (ex, ez) in ((0, (xs[0], zs[0])), (1, (xs[-1], zs[-1]))):
            for px_, pz_, yp in portals:
                dp = float(np.hypot(ex - px_, ez - pz_))
                if dp <= 8:
                    pins[end] = float(max(yp, (h0, h1)[end]))
        deck = h0 + (h1 - h0) * d / L
        ix_ = np.clip(np.floor(xs).astype(int) - g.x0, 0, g.nx - 1)
        iz_ = np.clip(np.floor(zs).astype(int) - g.z0, 0, g.nz - 1)
        mid = (d > 3) & (d < L - 3)
        on_rail = railmask[iz_, ix_] & mid
        on_road = road[iz_, ix_] & (d > 4) & (d < L - 4)
        wet = (world.wtop[iz_, ix_] > world.H[iz_, ix_]) & mid & (L >= 20)
        lower = np.array([deckmap.get((int(np.floor(x)), int(np.floor(z))), (-10000, 99))[1] < layer
                          for x, z in zip(xs, zs)]) & mid
        lower_y = np.array([deckmap.get((int(np.floor(x)), int(np.floor(z))), (-10000, 99))[0] for x, z in zip(xs, zs)])
        need = np.full(d.shape, -1e9)
        Hu = world.H[iz_, ix_].astype(float)
        need = np.where(on_road, np.maximum(need, Hu + 7), need)
        need = np.where(on_rail, np.maximum(need, Hu + 10), need)
        need = np.where(wet, np.maximum(need, world.wtop[iz_, ix_].astype(float) + 5), need)
        need = np.where(lower, np.maximum(need, lower_y + 7.0), need)
        # exact crossings with other roads / tracks, also right at the bridge ends
        if under_tree is not None:
            for qi in under_tree.query(lb):
                q, clr = under_lines[qi]
                if not q.crosses(lb):
                    continue
                inter = q.intersection(lb)
                for pt in getattr(inter, "geoms", [inter]):
                    if pt.geom_type != "Point":
                        continue
                    dd_ = lb.project(pt)
                    k_ = int(np.argmin(np.abs(d - dd_)))
                    hx, hz = int(np.floor(pt.x)), int(np.floor(pt.y))
                    hz_, hx_ = min(max(hz - g.z0, 0), g.nz - 1), min(max(hx - g.x0, 0), g.nx - 1)
                    need[k_] = max(need[k_], float(world.H[hz_, hx_]) + clr)
        if (need > -1e8).any():
            # the deck may not drop below what any crossing needs, ramps at 12 % on either side
            ramp = np.max(need[None, :] - 0.12 * np.abs(d[:, None] - d[None, :]), axis=1)
            deck = np.maximum(deck, ramp)
        for end, dist in ((0, d), (1, L - d)):
            if end in pins:
                deck = np.minimum(deck, pins[end] + 0.12 * dist)
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
            prev = deckmap.get((x, z))
            over_bridge = prev is not None and prev[1] < layer
            deckmap[(x, z)] = (y, layer)
            if world.H[iz, ix] >= y - 1 and world.wtop[iz, ix] <= world.H[iz, ix] and not over_bridge:
                world.H[iz, ix] = y
                world.top[iz, ix] = B(ROAD_STYLE[cls][1])
                world.road[iz, ix] = True
                continue
            E.set(x, y, z, "smooth_stone")
            if world.H[iz, ix] < y - 2:
                E.set(x, y - 1, z, "light_gray_concrete")  # deck slab
            if rail:
                rail_cells.add((x, z, y + 1))
            else:
                for yy in range(y + 1, y + 4):
                    E.set(x, yy, z, "air")
            world.road[iz, ix] = True
        # ends higher than the road they connect to: embankment ramp along the road beyond the end
        for end in (0, 1):
            if end in pins:
                continue
            i = 0 if end == 0 else len(xs) - 1
            j = min(len(xs) - 1, 8) if end == 0 else max(0, len(xs) - 9)
            ex, ez = xs[i], zs[i]
            u = np.array([ex - xs[j], ez - zs[j]])
            if np.linalg.norm(u) < 1e-6:
                continue
            u /= np.linalg.norm(u)
            gx_, gz_ = int(np.floor(ex)), int(np.floor(ez))
            if not g.inside(gx_, gz_):
                continue
            top = deck[i]
            if top - world.H[gz_ - g.z0, gx_ - g.x0] < 2:
                continue
            _embankment(world, ex, ez, u, top, half, own=road & (allmask == ROAD_STYLE[cls][2] + 1))
        # piers every ~14 blocks where the deck is high and nothing runs underneath
        for i in range(0, len(xs), 28):
            x, z, y = int(np.floor(xs[i])), int(np.floor(zs[i])), int(deck[i])
            if not g.inside(x, z):
                continue
            iz, ix = z - g.z0, x - g.x0
            if y - world.H[iz, ix] > 6 and not railmask[iz, ix] and not road[iz, ix]:
                for yy in range(int(world.H[iz, ix]) + 1, y - 1):
                    for ox, oz in ((0, 0), (1, 0), (0, 1), (1, 1)):
                        E.set(x + ox, yy, z + oz, "light_gray_concrete")
        nb += 1
    # steel railings with proper connections
    rset = {(x, z) for x, z, _ in rail_cells}
    for x, z, y in rail_cells:
        props = ",".join(f"{dn}={str((x + ddx, z + ddz) in rset).lower()}" for dn, (ddx, ddz) in
                         (("north", (0, -1)), ("south", (0, 1)), ("east", (1, 0)), ("west", (-1, 0))))
        E.set(x, y, z, f"iron_bars[{props}]")

    # ---- motorway: lane markings, guard rails, median barrier, sign gantries
    _motorway(world, roads_by_class.get("motorway", []), road)

    # ---- railway
    nrail = _railway(world, rails, rail_bridges, log)
    _platforms(world)
    world.roads_by_class = roads_by_class
    return {"bridges": nb, "rail_cells": nrail, "tunnels": ntun}


def _embankment(world: World, ex: float, ez: float, u, top: int, half: float, own=None) -> None:
    """Earth ramp under the road beyond a bridge end that sits higher than the ground (12 %)."""
    g = world.grid
    n = np.array([-u[1], u[0]])
    steps = int((top - 1) / 0.12) + 1
    for k in range(0, steps * 2):
        t = k * 0.5
        y = top - 0.12 * t
        c = np.array([ex, ez]) + u * t
        done = True
        for o in np.arange(-half - 2, half + 2.01, 0.5):
            x, z = int(np.floor(c[0] + n[0] * o)), int(np.floor(c[1] + n[1] * o))
            if not g.inside(x, z):
                continue
            iz, ix = z - g.z0, x - g.x0
            target = y - max(0.0, abs(o) - half)          # side slopes 1:1
            if world.road[iz, ix] and (own is None or not own[iz, ix]):
                continue                                  # another road passes here: it goes under the bridge
            if world.H[iz, ix] < round(target) and world.wtop[iz, ix] <= world.H[iz, ix]:
                world.H[iz, ix] = int(round(target))
                done = False
        if done and k > 4:
            break


def _underpass(world: World, cls: str, line, a: float, b: float, tree, crossing, classmask) -> bool:
    """Short OSM tunnels below a railway or a road (underpasses): the road dips under the crossing in a
    walled trough, the crossing stays on top."""
    g = world.grid
    full = raster.to_block_geom(line)
    L = full.length
    piece = ops.substring(full, a * L, b * L)
    if piece.length < 3 or not g.inside(int(piece.centroid.x), int(piece.centroid.y)):
        return False
    over = [crossing[i] for i in tree.query(piece) if crossing[i].intersects(piece)]
    if not over:
        return False           # passages under buildings etc.: left as they are
    xs, zs, d = _sample(piece, 0.5)
    top = float(max(world.h(int(np.floor(x)), int(np.floor(z))) for x, z in zip(xs, zs)))
    ends = min(world.h(int(np.floor(xs[0])), int(np.floor(zs[0]))), world.h(int(np.floor(xs[-1])), int(np.floor(zs[-1]))))
    floor = int(min(top - 6, ends))
    half = max(1.0, ROAD_STYLE[cls][0] / 2.0)
    E = world.edits
    dx, dz = np.gradient(xs), np.gradient(zs)
    nrm = np.hypot(dx, dz) + 1e-9
    px, pz = -dz / nrm, dx / nrm
    for i in range(len(xs)):
        for o in np.arange(-half - 1, half + 1.01, 0.5):
            x, z = int(np.floor(xs[i] + px[i] * o)), int(np.floor(zs[i] + pz[i] * o))
            if not g.inside(x, z):
                continue
            gtop = int(world.h(x, z))
            if abs(o) <= half:
                E.set(x, floor, z, "gray_concrete" if half > 1.5 else "smooth_stone")
                for y in range(floor + 1, floor + 5):
                    E.set(x, y, z, "air")
                if gtop > floor + 5:
                    E.set(x, floor + 5, z, "smooth_stone")
                if abs(o) < 0.3 and i % 16 == 0:
                    E.set(x, floor + 4, z, "light[level=15]")
            else:
                for y in range(floor, min(gtop, floor + 5) + 1):
                    E.set(x, y, z, "smooth_stone")
    # ramps down to the trough along the connecting road (same machinery as tunnel approaches)
    for (ex, ez), (qx, qz) in (((xs[0], zs[0]), (xs[min(6, len(xs) - 1)], zs[min(6, len(zs) - 1)])),
                               ((xs[-1], zs[-1]), (xs[max(0, len(xs) - 7)], zs[max(0, len(zs) - 7)]))):
        u = np.array([ex - qx, ez - qz])
        if np.linalg.norm(u) < 1e-6:
            continue
        u /= np.linalg.norm(u)
        _approach_cut(world, ex, ez, floor, classmask, u, half, radius=60.0)
    return True


def _approach_cut(world: World, px: float, pz: float, yp: int, classmask, u, half: float,
                  radius: float = 140.0, walls_on_roads: bool = False) -> None:
    """Lower the approach road towards a tunnel portal (smooth ramp) and line the cut with retaining walls.
    Only a cone in front of the portal (along the outward direction u) is touched, so roads crossing
    above the tunnel stay where they are."""
    g = world.grid
    x0, x1 = int(px - radius), int(px + radius)
    z0, z1 = int(pz - radius), int(pz + radius)
    xa, xb = max(x0 - g.x0, 0), min(x1 - g.x0, g.nx)
    za, zb = max(z0 - g.z0, 0), min(z1 - g.z0, g.nz)
    if xa >= xb or za >= zb:
        return
    H = world.H[za:zb, xa:xb]
    road = classmask[za:zb, xa:xb]
    zz, xx = np.mgrid[za:zb, xa:xb]
    dist = np.hypot(xx + g.x0 + 0.5 - px, zz + g.z0 + 0.5 - pz)
    t = np.clip(dist / radius, 0, 1)
    s = t * t * (3 - 2 * t)
    target = yp + (H.astype(np.float32) - yp) * s
    rx = xx + g.x0 + 0.5 - px
    rz = zz + g.z0 + 0.5 - pz
    along = rx * u[0] + rz * u[1]
    lateral = np.abs(-rx * u[1] + rz * u[0])
    cone = (along >= -1) & (lateral <= half + 3 + 0.35 * np.maximum(along, 0))
    lower = road & cone & (H > target + 0.5)
    if not lower.any():
        return
    old = H.copy()
    H[lower] = np.round(target[lower]).astype(np.int16)
    # retaining walls on the cut sides
    side = ndimage.binary_dilation(lower, iterations=2) & ~road
    if not walls_on_roads:
        side &= ~world.road[za:zb, xa:xb]
    neigh = ndimage.grey_erosion(np.where(lower, H, 32000), size=5)
    wall = side & (old > neigh + 1) & (neigh < 32000)
    wz, wx = np.nonzero(wall)
    for z, x in zip(wz, wx):
        for y in range(int(neigh[z, x]) + 1, int(old[z, x]) + 1):
            world.edits.set(int(x + xa + g.x0), y, int(z + za + g.z0), "smooth_stone")


def _tunnel(world: World, cls: str, line, a: float, b: float, classmask) -> bool:
    """Carve a road tunnel: approach roads ramp down to the portals, floor interpolated between them,
    vaulted concrete tube with lights, portal walls with the arch opening."""
    g = world.grid
    full = raster.to_block_geom(line)
    L = full.length
    if L <= 0:
        return False
    da, db = a * L, b * L

    def portal_y(dist, outward):
        """Lowest road level within 40 m outside the portal (the approach is in a cut)."""
        ys = []
        bm = getattr(world, "bridge_mask", None)
        need = -1e9
        for k in range(2, 42, 4):
            p = full.interpolate(min(max(dist + outward * k, 0), L))
            x, z = int(np.floor(p.x)), int(np.floor(p.y))
            if g.inside(x, z):
                if bm is not None and bm[z - g.z0, x - g.x0]:
                    # the approach continues on a bridge: the portal must sit high enough for that bridge to clear
                    # the roads it crosses (never sample the valley under it)
                    for kk in np.arange(k, k + 90, 1.0):
                        q = full.interpolate(min(max(dist + outward * kk, 0), L))
                        qx, qz = int(np.floor(q.x)), int(np.floor(q.y))
                        if not g.inside(qx, qz) or not bm[qz - g.z0, qx - g.x0]:
                            continue
                        for ox in (-3, 0, 3):
                            for oz in (-3, 0, 3):
                                cx_, cz_ = qx + ox, qz + oz
                                if g.inside(cx_, cz_) and world.road[cz_ - g.z0, cx_ - g.x0] \
                                        and not bm[cz_ - g.z0, cx_ - g.x0]:
                                    need = max(need, float(world.H[cz_ - g.z0, cx_ - g.x0]) + 7 - 0.12 * (kk - k))
                    break
                ys.append(float(world.H[z - g.z0, x - g.x0]))
        p = full.interpolate(min(max(dist, 0), L))
        if not ys:
            x, z = int(np.floor(p.x)), int(np.floor(p.y))
            if not g.inside(x, z):
                return float(OUTSIDE_PORTAL_Y), None
            ys = [float(world.H[z - g.z0, x - g.x0])]
        return max(min(ys), need), (p.x, p.y)

    y0, p0 = portal_y(da, -1)
    y1, p1 = portal_y(db, +1)
    w = ROAD_STYLE[cls][0]
    for (yp, pp, dist, outward) in ((y0, p0, da, -1), (y1, p1, db, +1)):
        if pp is not None and g.inside(int(pp[0]), int(pp[1])):
            q = full.interpolate(min(max(dist + outward * 15, 0), L))
            u = np.array([q.x - pp[0], q.y - pp[1]])
            if np.linalg.norm(u) < 1e-6:
                continue
            u = u / np.linalg.norm(u)
            _approach_cut(world, pp[0], pp[1], int(yp), classmask, u, w / 2.0)
            gx_, gz_ = int(np.floor(pp[0])), int(np.floor(pp[1]))
            if world.H[gz_ - g.z0, gx_ - g.x0] < yp - 1:
                # portal raised for a bridge right outside: carry the road on an embankment up to the bridge
                _embankment(world, pp[0], pp[1], u, int(yp), w / 2.0, own=classmask)
            world.portals.append((pp[0], pp[1], int(yp), cls))
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
            if i in portals:  # portal face around the arch (the opening itself stays free)
                for o in np.arange(-half - 5, half + 5.01, 0.5):
                    x = int(np.floor(xs[i] + px[i] * o))
                    z = int(np.floor(zs[i] + pz[i] * o))
                    top_ = min(int(world.h(x, z)), y + 12)
                    if abs(o) <= half + 1.01:
                        top_ = max(top_, y + 8)          # arch ring + cornice over the opening
                    for yy in range(y + 1, top_ + 1):
                        opening = abs(o) <= half + 0.01 and yy <= y + 6 - int(round(2.0 * (min(abs(o), half) / half) ** 2))
                        if opening:
                            E.set(x, yy, z, "air")
                        else:
                            E.set(x, yy, z, "white_concrete" if abs(abs(o) - half) <= 1 and yy <= y + 7 else "light_gray_concrete")
        elif ground[i] > y:
            # open cut inside the OSM tunnel span: road at floor level, retaining walls
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


def _motorway(world: World, lines, road) -> None:
    """A14: white edge lines, dashed lane divider, steel guard rails, concrete median barrier,
    and a sign gantry in front of every motorway tunnel portal."""
    g = world.grid
    E = world.edits
    half = ROAD_STYLE["motorway"][0] / 2.0
    WHITE = B("white_concrete")
    guard: dict = {}
    for line in lines:
        lb = raster.to_block_geom(line)
        if lb.length < 10:
            continue
        xs, zs, d = _sample(lb, 0.5)
        dx, dz = np.gradient(xs), np.gradient(zs)
        nrm = np.hypot(dx, dz) + 1e-9
        px, pz = -dz / nrm, dx / nrm
        for o, dashed in ((-(half - 1.2), False), (half - 1.2, False), (0.0, True)):
            x = np.floor(xs + px * o).astype(int)
            z = np.floor(zs + pz * o).astype(int)
            sel = ((d % 12) < 6) if dashed else np.ones_like(d, dtype=bool)
            ok = sel & (x >= g.x0) & (x < g.x1) & (z >= g.z0) & (z < g.z1)
            ok[ok] &= road[z[ok] - g.z0, x[ok] - g.x0]
            world.top[z[ok] - g.z0, x[ok] - g.x0] = WHITE
        for o in (-(half + 0.6), half + 0.6):
            x = np.floor(xs + px * o).astype(int)
            z = np.floor(zs + pz * o).astype(int)
            for cx, cz in zip(x, z):
                if g.inside(cx, cz) and world.wtop[cz - g.z0, cx - g.x0] <= world.H[cz - g.z0, cx - g.x0]:
                    guard[(int(cx), int(cz))] = road[cz - g.z0, cx - g.x0]
    gset = {k for k, on_road in guard.items() if not on_road}
    for (x, z), on_road in guard.items():
        y = int(world.H[z - g.z0, x - g.x0]) + 1
        if on_road:  # between the two carriageways: concrete barrier
            E.set(x, y, z, "light_gray_concrete")
        else:
            props = ",".join(f"{dn}={str((x + ddx, z + ddz) in gset).lower()}" for dn, (ddx, ddz) in
                             (("north", (0, -1)), ("south", (0, 1)), ("east", (1, 0)), ("west", (-1, 0))))
            E.set(x, y, z, f"iron_bars[{props}]")
        world.occupied[z - g.z0, x - g.x0] = True
    # sign gantries ~60 m in front of motorway tunnel portals
    for (ppx, ppz, yp, cls) in getattr(world, "portals", []):
        if cls != "motorway":
            continue
        best = None
        for line in lines:
            lb = raster.to_block_geom(line)
            if lb.distance(shapely.Point(ppx, ppz)) < 25:
                dd = lb.project(shapely.Point(ppx, ppz))
                for sgn in (-1, 1):
                    q = lb.interpolate(min(max(dd + sgn * 60, 0), lb.length))
                    if g.inside(int(q.x), int(q.y)) and not world.is_water(int(q.x), int(q.y)):
                        a_ = lb.interpolate(max(dd + sgn * 60 - 2, 0))
                        b_ = lb.interpolate(min(dd + sgn * 60 + 2, lb.length))
                        best = (q, np.array([b_.x - a_.x, b_.y - a_.y]))
                        break
            if best:
                break
        if not best:
            continue
        q, t = best
        t = t / (np.linalg.norm(t) + 1e-9)
        n = np.array([-t[1], t[0]])
        base = int(world.h(int(q.x), int(q.y))) + 1
        for side in (-1, 1):
            cx = int(np.floor(q.x + n[0] * side * (half + 2)))
            cz = int(np.floor(q.y + n[1] * side * (half + 2)))
            hb = int(world.h(cx, cz)) + 1
            for y in range(hb, base + 8):
                E.set(cx, y, cz, "iron_block")
        for o in np.arange(-(half + 2), half + 2.01, 0.5):
            cx = int(np.floor(q.x + n[0] * o))
            cz = int(np.floor(q.y + n[1] * o))
            E.set(cx, base + 8, cz, "iron_block")
            if abs(o) < 3:
                E.set(cx, base + 7, cz, "black_concrete")
                E.set(cx, base + 6, cz, "black_concrete")
        E.set(int(np.floor(q.x)), base + 5, int(np.floor(q.y)), "lime_concrete")  # green lane light


def _railway(world: World, rails, rail_bridges, log) -> int:
    g = world.grid
    if not rails and not rail_bridges:
        return 0
    bed = raster.lines([shapely.transform(l, lambda c: np.column_stack(geo.to_lonlat(c[:, 0], c[:, 1]))) for l in rails],
                       g, 4).astype(bool) & ~(world.wtop > world.H)
    under_bridge = getattr(world, "bridge_mask", np.zeros_like(bed))
    H = world.H.astype(np.float32)
    wsum = ndimage.gaussian_filter(bed.astype(np.float32), 6)
    hs = ndimage.gaussian_filter(np.where(bed, H, 0), 6) / np.maximum(wsum, 1e-3)
    world.H[:] = np.where(bed & ~under_bridge, np.round(hs), world.H).astype(np.int16)
    # below road bridges the bed may only go down (never up into the deck)
    lowered = bed & under_bridge
    world.H[lowered] = np.minimum(world.H[lowered], np.round(hs[lowered])).astype(np.int16)
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
        wet = np.array([g.inside(x, z) and world.is_water(x, z) and 4 < i < n_ - 4 for i, (x, z) in enumerate(path)])
        if n_ < 20:
            wet[:] = False
        if under.any() or wet.any():
            need = np.full(n_, -1e9)
            hh = np.array([float(world.h(x, z)) for x, z in path])
            ww = np.array([float(world.wtop[min(max(z - g.z0, 0), g.nz - 1), min(max(x - g.x0, 0), g.nx - 1)]) for x, z in path])
            need = np.where(under, hh + 7, need)
            need = np.where(wet, np.maximum(need, ww + 5), need)
            idx = np.arange(n_)
            lin = np.maximum(lin, np.max(need[None, :] - 0.12 * np.abs(idx[:, None] - idx[None, :]), axis=1))
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
