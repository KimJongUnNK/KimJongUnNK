"""Trees, forests, meadows and flowers."""
from __future__ import annotations

import zlib

import numpy as np
from scipy import ndimage

from . import config, data, geo, raster
from .blocks import B
from .noise import hash01, value_noise
from .world import World

LEAF = {
    "oak": "oak_leaves[persistent=true]",
    "birch": "birch_leaves[persistent=true]",
    "spruce": "spruce_leaves[persistent=true]",
    "dark_oak": "dark_oak_leaves[persistent=true]",
}
LOG = {k: f"{k}_log[axis=y]" for k in LEAF}


def _template(kind: str, size: int, seed: int):
    """Return list of (dx, dy, dz, block_id) for one tree, base at (0, 1, 0)."""
    rng = np.random.default_rng(seed)
    out = []
    lid, wid = B(LEAF[kind]), B(LOG[kind])
    if kind == "spruce":
        trunk = 8 + size * 3 + rng.integers(0, 4)
        for y in range(1, trunk + 1):
            out.append((0, y, 0, wid))
        top = trunk + 2
        start = 3 + rng.integers(0, 2)
        for y in range(start, top + 1):
            t = (top - y) / max(top - start, 1)
            r = 0.6 + t * (2.2 + size * 0.9)
            if (y - start) % 2 == 1:
                r *= 0.7
            R = int(np.ceil(r))
            for dx in range(-R, R + 1):
                for dz in range(-R, R + 1):
                    if (dx or dz) and dx * dx + dz * dz <= r * r + 0.3:
                        out.append((dx, y, dz, lid))
        out.append((0, top, 0, lid))
        out.append((0, top + 1, 0, lid))
        return out
    trunk = {"oak": 5, "birch": 6, "dark_oak": 6}[kind] + size * 2 + rng.integers(0, 3)
    for y in range(1, trunk + 1):
        out.append((0, y, 0, wid))
    cy = trunk - 1 + size
    rx = 2.3 + size * 1.1 + rng.uniform(-0.3, 0.4)
    ry = 2.0 + size * 0.8
    R = int(np.ceil(rx)) + 1
    for dx in range(-R, R + 1):
        for dz in range(-R, R + 1):
            for dy in range(-int(ry) - 1, int(ry) + 2):
                d = (dx / rx) ** 2 + (dz / rx) ** 2 + (dy / ry) ** 2
                if d <= 1.0 and rng.random() > 0.08 * d:
                    y = cy + dy
                    if dx == 0 and dz == 0 and y <= trunk:
                        continue
                    out.append((dx, y, dz, lid))
    # a couple of branches for big trees
    if size >= 2:
        for ang in rng.uniform(0, 2 * np.pi, 3):
            for t in (1, 2):
                out.append((int(round(np.cos(ang) * t)), trunk - 2 + t, int(round(np.sin(ang) * t)), B(f"{kind}_log[axis=x]")))
    return out


class TreeKit:
    def __init__(self):
        self.templates = {}
        for kind in LEAF:
            for size in range(3):
                self.templates[(kind, size)] = [np.array(_template(kind, size, 1000 * size + i + zlib.crc32(kind.encode()) % 97), dtype=np.int64)
                                                for i in range(6)]

    def get(self, kind, size, variant):
        lst = self.templates[(kind, size)]
        return lst[variant % len(lst)]


def build(world: World, log=print) -> dict:
    g = world.grid
    kit = TreeKit()
    H = world.H
    water = world.wtop > H
    free = ~world.occupied & ~world.road & ~water
    # keep trees off the ground right next to buildings / roads
    blocked = ndimage.binary_dilation(world.occupied | world.road, iterations=2)
    free &= ~blocked
    slope = getattr(world, "slope", np.zeros(H.shape, np.float32))
    forest = world.forest_mask & free & (slope < 2.2)

    zz, xx = np.mgrid[g.z0:g.z1, g.x0:g.x1]
    rnd = hash01(xx, zz, seed=31)
    dens = value_noise(H.shape, 40.0, config.SEED + 40) * 0.5 + 0.5

    # forest: jittered grid, one candidate per 5x5 cell
    cell = 5
    cand = (xx % cell == 0) & (zz % cell == 0)
    jx = (hash01(xx, zz, seed=32) * cell).astype(int)
    jz = (hash01(xx, zz, seed=33) * cell).astype(int)
    iz, ix = np.nonzero(cand)
    tx = np.clip(ix + jx[iz, ix], 0, g.nx - 1)
    tz = np.clip(iz + jz[iz, ix], 0, g.nz - 1)
    keep = forest[tz, tx] & (rnd[tz, tx] < 0.55 + 0.4 * dens[tz, tx])
    trees = [(tx[keep], tz[keep], "forest")]

    # parks, meadows, cemeteries: sparse
    sparse = (world.park_mask | world.cemetery_mask) & free & ~world.forest_mask
    cell2 = 14
    cand2 = (xx % cell2 == 0) & (zz % cell2 == 0) & sparse
    iz2, ix2 = np.nonzero(cand2)
    keep2 = rnd[iz2, ix2] < 0.55
    trees.append((ix2[keep2], iz2[keep2], "park"))

    # open countryside outside town: scattered trees and fruit trees on meadows
    countryside = free & ~world.forest_mask & (H > 430) & ~sparse
    cell3 = 23
    cand3 = (xx % cell3 == 0) & (zz % cell3 == 0) & countryside
    iz3, ix3 = np.nonzero(cand3)
    keep3 = rnd[iz3, ix3] < 0.35
    trees.append((ix3[keep3], iz3[keep3], "park"))

    # lakeside promenades (Seeanlagen, Molo, Pipeline): rows of big trees along the shore
    dl = ndimage.distance_transform_edt(~getattr(world, "lake_mask", water))
    shore_band = free & (dl >= 4) & (dl <= 14) & ~world.forest_mask
    cell4 = 9
    cand4 = (xx % cell4 == 0) & (zz % cell4 == 0) & shore_band
    iz4, ix4 = np.nonzero(cand4)
    keep4 = rnd[iz4, ix4] < 0.7
    trees.append((ix4[keep4], iz4[keep4], "single"))

    # OSM single trees and tree rows
    pts_x, pts_z = [], []
    for r in data.overture("land"):
        if r["subtype"] != "tree":
            continue
        gm = r["geom"]
        if gm.geom_type == "Point":
            x, z = geo.to_block(gm.x, gm.y)
            pts_x.append(int(np.floor(x)))
            pts_z.append(int(np.floor(z)))
        elif gm.geom_type == "LineString":
            lb = raster.to_block_geom(gm)
            for d in np.arange(0, lb.length, 8.0):
                p = lb.interpolate(d)
                pts_x.append(int(np.floor(p.x)))
                pts_z.append(int(np.floor(p.y)))
    if pts_x:
        px_ = np.array(pts_x) - g.x0
        pz_ = np.array(pts_z) - g.z0
        ok = (px_ >= 0) & (px_ < g.nx) & (pz_ >= 0) & (pz_ < g.nz)
        px_, pz_ = px_[ok], pz_[ok]
        ok = ~world.occupied[pz_, px_] & ~water[pz_, px_]
        trees.append((px_[ok], pz_[ok], "single"))

    # choose species / size / template for every tree (vectorised), then stamp per template
    TX = np.concatenate([t[0] for t in trees]).astype(np.int64)
    TZ = np.concatenate([t[1] for t in trees]).astype(np.int64)
    KIND = np.concatenate([np.full(len(t[0]), {"forest": 0, "park": 1, "single": 2}[t[2]]) for t in trees])
    gx_, gz_ = TX + g.x0, TZ + g.z0
    h = H[TZ, TX].astype(np.int64)
    r = rnd[TZ, TX]
    r2 = hash01(gx_, gz_, seed=5)
    rs = hash01(gx_, gz_, seed=6)
    species = np.where(r2 < 0.55, 0, np.where(r2 < 0.8, 3, 1))           # oak / dark_oak / birch
    p_spruce = np.clip((h - 520) / 400, 0.05, 0.85)
    species = np.where((KIND == 0) & (r < p_spruce), 2, species)         # spruce up the mountain
    species = np.where(KIND == 2, np.where(r < 0.7, 0, 1), species)
    size = np.where(KIND == 0, np.minimum(2, (rs * 3.2).astype(int)), 1 + (rs * 2).astype(int))
    size = np.where(KIND == 2, 2, np.minimum(size, 2))
    variant = (hash01(gx_, gz_, seed=9) * 6).astype(int)
    kinds = ["oak", "birch", "spruce", "dark_oak"]
    all_x, all_y, all_z, all_b = [], [], [], []
    for si, sp in enumerate(kinds):
        for sz in range(3):
            for va in range(6):
                sel = (species == si) & (size == sz) & (variant == va)
                if not sel.any():
                    continue
                t = kit.get(sp, sz, va)
                all_x.append((t[None, :, 0] + gx_[sel, None]).astype(np.int32).ravel())
                all_y.append((t[None, :, 1] + h[sel, None]).astype(np.int16).ravel())
                all_z.append((t[None, :, 2] + gz_[sel, None]).astype(np.int32).ravel())
                all_b.append(np.broadcast_to(t[None, :, 3], (int(sel.sum()), len(t))).astype(np.uint16).ravel())
    for xs_, ys_, zs_, bs_ in zip(all_x, all_y, all_z, all_b):
        world.edits.put(xs_, ys_, zs_, bs_, low=True)
    n = int(TX.size)
    pod = (KIND == 0) & (r > 0.7) & (world.top[TZ, TX] == B("grass_block"))
    world.top[TZ[pod], TX[pod]] = B("podzol")

    # ground cover: grass, ferns, flowers
    nflow = _ground_cover(world, free, rnd)
    log(f"vegetation: {n} trees, {nflow} plants")
    return {"trees": n, "plants": nflow}


def _ground_cover(world: World, free, rnd) -> int:
    g = world.grid
    H = world.H
    grass = (world.top == B("grass_block")) & free
    r2 = hash01(*np.mgrid[g.z0:g.z1, g.x0:g.x1][::-1], seed=77)
    sel_grass = grass & (rnd > 0.72)
    alm = H > 880
    meadow = world.meadow_mask | alm | (H > 450)
    flowers_town = ["poppy", "dandelion", "oxeye_daisy", "azure_bluet", "cornflower"]
    flowers_alm = ["cornflower", "oxeye_daisy", "dandelion", "allium", "lily_of_the_valley", "blue_orchid"]
    iz, ix = np.nonzero(sel_grass)
    ids = np.full(iz.shape, B("short_grass"), dtype=np.uint16)
    fern = world.forest_mask[iz, ix] & (r2[iz, ix] < 0.45)
    ids[fern] = B("fern")
    fl = meadow[iz, ix] & ~world.forest_mask[iz, ix] & (r2[iz, ix] > 0.86)
    names_alm = np.array([B(f) for f in flowers_alm], dtype=np.uint16)
    names_town = np.array([B(f) for f in flowers_town], dtype=np.uint16)
    pick = (r2[iz, ix] * 997).astype(int)
    ids[fl & alm[iz, ix]] = names_alm[pick[fl & alm[iz, ix]] % len(names_alm)]
    ids[fl & ~alm[iz, ix]] = names_town[pick[fl & ~alm[iz, ix]] % len(names_town)]
    world.edits.put(ix + g.x0, H[iz, ix].astype(int) + 1, iz + g.z0, ids, low=True)
    return int(iz.size)
