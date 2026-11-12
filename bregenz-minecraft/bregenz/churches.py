"""Churches and chapels: furnished interiors (pews, central aisle, raised chancel, altar with retable and
candles, side altars, pulpit, organ loft, chandeliers, painted ceiling) and bell towers / ridge turrets."""
from __future__ import annotations

import math

import numpy as np

from .blocks import B

DIR_NAMES = {(1, 0): "east", (-1, 0): "west", (0, 1): "south", (0, -1): "north"}


def _dir_name(v) -> str:
    v = np.asarray(v, float)
    if abs(v[0]) >= abs(v[1]):
        return "east" if v[0] > 0 else "west"
    return "south" if v[1] > 0 else "north"


def is_church(r: dict, style: dict) -> bool:
    if "church" in style:
        return bool(style["church"])
    cls = r.get("class") or ""
    name = (r.get("name") or "").lower()
    return cls in ("church", "chapel", "cathedral") or "kirche" in name or "kapelle" in name


def interior(a, mT, inner, x0, z0, yb, yt, axis, baroque: bool, key: int) -> None:
    """Furnish the church on the local canvas `a` ([x, y, z]); `axis` points from the entrance to the altar."""
    xs, zs = np.nonzero(inner)
    if len(xs) < 20 or yt - yb < 5:
        return
    c = np.array([xs.mean() + x0 + 0.5, zs.mean() + z0 + 0.5])
    n = np.array([-axis[1], axis[0]])
    P = np.column_stack([xs + x0 + 0.5, zs + z0 + 0.5]) - c
    s = P @ axis
    t = P @ n
    s0, s1 = s.min(), s.max()
    L = s1 - s0
    tw = np.abs(t).max()
    if L < 8 or tw < 2:
        return
    to_altar = _dir_name(axis)
    to_door = _dir_name(-axis)
    h = yt - yb
    chancel = s > s1 - max(4.0, 0.2 * L)
    loft = s < s0 + min(5.0, 0.2 * L)

    def put(i, y, blk):
        if yb <= y <= yt:
            a[xs[i], y, zs[i]] = B(blk) if isinstance(blk, str) else blk

    for i in range(len(xs)):
        x, z = xs[i] + x0, zs[i] + z0
        # floor: chequered stone in the nave, raised marble in the chancel
        if chancel[i]:
            put(i, yb, "smooth_quartz")
            edge = s[i] < s1 - max(4.0, 0.2 * L) + 1.0
            put(i, yb + 1, f"quartz_stairs[facing={to_altar},half=bottom]" if edge else "smooth_quartz_slab[type=bottom]")
        else:
            put(i, yb, "polished_diorite" if (x + z) % 2 else "polished_andesite")
        # pews: rows across the nave, central aisle and side aisles left free
        if not chancel[i] and not loft[i] and s[i] < s1 - 0.28 * L and 1.6 < abs(t[i]) < tw - 1.4 and int(s[i] - s0) % 2 == 0:
            put(i, yb + 1, f"dark_oak_stairs[facing={to_door},half=bottom]")
        # organ loft over the entrance
        if loft[i] and h >= 8:
            put(i, yb + 5, "dark_oak_planks")
            if s[i] > s0 + min(5.0, 0.2 * L) - 1.0:
                put(i, yb + 6, "dark_oak_fence")
            if s[i] < s0 + 1.0 and abs(t[i]) < tw - 1:
                ph = 3 + int(abs(math.sin(t[i] * 1.3)) * 4)
                for k in range(1, ph + 1):
                    put(i, yb + 5 + k, "iron_block" if k < ph else "light_gray_concrete")
        # ceiling: painted vault in baroque churches, plain plaster otherwise
        if baroque:
            r = math.hypot((s[i] - (s0 + L / 2)) / (L / 2 + 1e-6), t[i] / (tw + 1e-6))
            fresco = ["light_blue_terracotta", "yellow_terracotta", "pink_terracotta", "white_terracotta"]
            put(i, yt, fresco[int(r * 6 + (x * 3 + z) % 2) % 4] if r < 0.75 else ("gold_block" if 0.75 <= r < 0.8 else "smooth_quartz"))
        else:
            put(i, yt, "smooth_quartz")
    # altar, retable, candles
    alt = [i for i in range(len(xs)) if s1 - 5.2 < s[i] < s1 - 2.0 and abs(t[i]) <= 2.1]
    if alt:
        smid = float(np.median([s[i] for i in alt]))
        alt = [i for i in alt if abs(s[i] - smid) < 0.8]
    for i in alt:
        put(i, yb + 2, "quartz_bricks")
        put(i, yb + 3, "candle[candles=3,lit=true]" if abs(t[i]) > 1.0 else "gold_block")
    back = [i for i in range(len(xs)) if s[i] > s1 - 1.0 and abs(t[i]) <= 3.6]
    rh = int(min(h - 2, max(5, h * 0.7)))
    for i in back:
        for k in range(2, rh + 1):
            if abs(t[i]) > 2.6:
                blk = "quartz_pillar[axis=y]"
            elif k == rh or abs(t[i]) > 1.6:
                blk = "gold_block"
            elif k > rh - 3:
                blk = "yellow_stained_glass"
            else:
                blk = "blue_terracotta" if (k + int(t[i])) % 3 else "orange_terracotta"
            put(i, yb + k, blk)
    # side altars at the chancel arch
    for side in (-1, 1):
        cand = [i for i in range(len(xs)) if abs(s[i] - (s1 - max(4.0, 0.2 * L) - 1.5)) < 0.6 and abs(t[i] - side * (tw - 1.5)) < 0.6]
        for i in cand[:1]:
            put(i, yb + 1, "quartz_bricks")
            put(i, yb + 2, "candle[candles=2,lit=true]")
            put(i, yb + 3, "gold_block")
    # pulpit on one side of the nave
    pul = [i for i in range(len(xs)) if abs(s[i] - (s1 - 0.32 * L)) < 0.6 and abs(t[i] - (tw - 1.0)) < 0.6]
    for i in pul[:1]:
        for k in range(1, 4):
            put(i, yb + k, "dark_oak_planks")
        put(i, yb + 4, "dark_oak_fence")
        put(i, min(yb + 7, yt - 1), "dark_oak_slab[type=top]")
    # chandeliers along the centre line
    for i in range(len(xs)):
        if abs(t[i]) < 0.5 and int(s[i] - s0) % 7 == 3 and not loft[i]:
            low = yb + max(4, int(h * 0.55))
            for y in range(low + 1, yt):
                put(i, y, "chain")
            put(i, low, "lantern[hanging=true]")
    # holy water stoups at the door
    for i in range(len(xs)):
        if s[i] < s0 + 1.0 and abs(abs(t[i]) - 2.0) < 0.5 and h >= 8:
            put(i, yb + 1, "water_cauldron[level=3]")


def tower(world, poly, base: int, roof_top: int, axis, kind: str, roof_block: str) -> tuple:
    """Bell tower at the entrance (kind='tower') or a ridge turret (kind='turret').
    axis points from the entrance to the altar. Returns (x, top_y, z)."""
    from .vox import Vox  # local import keeps module import cheap
    long_v = np.asarray(axis, float)
    n = np.array([-long_v[1], long_v[0]])
    c = np.asarray(poly.centroid.coords[0])
    pts = np.asarray(poly.exterior.coords)
    s_min = float(((pts - c) @ long_v).min())
    E = world.edits
    if kind == "turret":
        p = c + long_v * (s_min + 3)
        x, z = int(math.floor(p[0])), int(math.floor(p[1]))
        y0 = roof_top - 1
        for dx in (-1, 1):
            for dz in (-1, 1):
                for y in range(y0, y0 + 3):
                    E.set(x + dx, y, z + dz, "dark_oak_fence")
        E.set(x, y0, z, "bell[attachment=floor,facing=north]")
        for k, rr in enumerate((1, 1, 0)):
            for dx in range(-rr, rr + 1):
                for dz in range(-rr, rr + 1):
                    E.set(x + dx, y0 + 3 + k, z + dz, "dark_oak_planks" if rr else "lightning_rod")
        return x, y0 + 6, z
    half = 3
    p = c + long_v * (s_min - half + 1)
    tx, tz = int(math.floor(p[0])), int(math.floor(p[1]))
    hh = int(world.h(tx, tz))
    top = max(roof_top + 8, base + 22)
    spire = half * 4 + 2
    v = Vox(tx - half - 2, min(hh, base) - 4, tz - half - 2, 2 * half + 5, top - min(hh, base) + spire + 12, 2 * half + 5)
    v.fill(tx - half, min(hh, base) - 4, tz - half, tx + half, base, tz + half, "stone_bricks")
    v.hollow(tx - half, base + 1, tz - half, tx + half, top, tz + half, "white_concrete", "air")
    for y in range(base + 1, top + 1, 6):  # string courses
        for d in range(-half, half + 1):
            for e in (-half, half):
                v.set(tx + d, y, tz + e, "smooth_stone")
                v.set(tx + e, y, tz + d, "smooth_stone")
    # portal towards the street, opening into the nave on the other side
    dn = _dir_name(-long_v)
    ox, oz = {"east": (1, 0), "west": (-1, 0), "south": (0, 1), "north": (0, -1)}[dn]
    for side in (1, -1):
        for y in range(base + 1, base + 5):
            for d in (-1, 0, 1):
                v.set(tx + ox * half * side + (d if oz else 0), y, tz + oz * half * side + (d if ox else 0), "air")
    # belfry openings + clock faces
    for (fx, fz) in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        for y in range(top - 5, top - 1):
            for d in (-1, 1):
                v.set(tx + fx * half + (d if fz else 0), y, tz + fz * half + (d if fx else 0), "air")
        cy = top - 9
        for d1 in (-1, 0, 1):
            for d2 in (-1, 0, 1):
                v.set(tx + fx * half + (d1 if fz else 0), cy + d2, tz + fz * half + (d1 if fx else 0),
                      "black_concrete" if (d1, d2) == (0, 0) else "white_concrete")
        v.set(tx + fx * half, cy + 1, tz + fz * half, "black_concrete")
    v.set(tx, top - 3, tz, "bell[attachment=ceiling,facing=north]")
    v.column(tx, tz, top - 2, top - 1, "dark_oak_fence")
    # pointed spire
    for k in range(spire):
        rr = half * (1 - k / spire) + 0.4
        for dx in range(-half, half + 1):
            for dz in range(-half, half + 1):
                if max(abs(dx), abs(dz)) <= rr and max(abs(dx), abs(dz)) > rr - 1.2:
                    v.set(tx + dx, top + 1 + k, tz + dz, roof_block)
    v.column(tx, tz, top + spire, top + spire + 2, "iron_bars")
    v.set(tx - 1, top + spire + 1, tz, "iron_bars")
    v.set(tx + 1, top + spire + 1, tz, "iron_bars")
    v.commit(world.edits)
    g = world.grid
    for dx in range(-half, half + 1):
        for dz in range(-half, half + 1):
            if g.inside(tx + dx, tz + dz):
                world.occupied[tz + dz - g.z0, tx + dx - g.x0] = True
    return tx, top + spire + 3, tz
