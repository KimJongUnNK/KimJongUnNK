"""World state: terrain columns + sparse block edits, and the chunk assembler."""
from __future__ import annotations

import numpy as np

from . import config, geo
from .blocks import AIR, B, REG

NO_WATER = -32768

BIOMES = ["bregenz:bodensee", "bregenz:stadt", "bregenz:wald", "bregenz:pfaender_alm"]
BIO_LAKE, BIO_TOWN, BIO_FOREST, BIO_ALM = range(4)


class Edits:
    """Append-only list of block placements. Later placements win."""

    def __init__(self) -> None:
        self._parts: list[tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]] = []
        self._low: list[tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]] = []  # vegetation: loses to everything
        self._sx: list[int] = []
        self._sy: list[int] = []
        self._sz: list[int] = []
        self._sb: list[int] = []
        self.block_entities: list[dict] = []
        self.count = 0

    # -- scalar / small
    def set(self, x: int, y: int, z: int, block) -> None:
        self._sx.append(x)
        self._sy.append(y)
        self._sz.append(z)
        self._sb.append(block if isinstance(block, int) else B(block))
        if len(self._sx) >= 1_000_000:
            self._flush()

    def _flush(self) -> None:
        if self._sx:
            self.put(np.array(self._sx), np.array(self._sy), np.array(self._sz), np.array(self._sb))
            self._sx, self._sy, self._sz, self._sb = [], [], [], []

    # -- vectorised
    def put(self, xs, ys, zs, ids, low: bool = False) -> None:
        xs = np.asarray(xs, dtype=np.int32).ravel()
        ys = np.asarray(ys, dtype=np.int16).ravel()
        zs = np.asarray(zs, dtype=np.int32).ravel()
        ids = np.asarray(ids)
        if ids.ndim == 0:
            ids = np.full(xs.shape, int(ids), dtype=np.uint16)
        ids = ids.astype(np.uint16).ravel()
        if xs.size:
            (self._low if low else self._parts).append((xs, ys, zs, ids))
            self.count += xs.size

    def fill(self, x0, y0, z0, x1, y1, z1, block) -> None:
        """Fill the inclusive box between two corners."""
        xa, xb = sorted((x0, x1))
        ya, yb = sorted((y0, y1))
        za, zb = sorted((z0, z1))
        X, Y, Z = np.meshgrid(np.arange(xa, xb + 1), np.arange(ya, yb + 1), np.arange(za, zb + 1), indexing="ij")
        bid = block if isinstance(block, (int, np.integer)) else B(block)
        self.put(X, Y, Z, bid)

    def block_entity(self, be: dict) -> None:
        self.block_entities.append(be)

    def finalize(self, grid: geo.Grid):
        """Sort all edits by chunk. Returns (keys, starts, ends, xs, ys, zs, ids) + block entities by chunk."""
        self._flush()
        self._parts = self._low + self._parts
        self._low = []
        if not self._parts:
            e = np.zeros(0, dtype=np.int64)
            return _Sorted(e, e, e, e.astype(np.int32), e.astype(np.int16), e.astype(np.int32), e.astype(np.uint16), {})
        xs = np.concatenate([p[0] for p in self._parts])
        ys = np.concatenate([p[1] for p in self._parts])
        zs = np.concatenate([p[2] for p in self._parts])
        ids = np.concatenate([p[3] for p in self._parts])
        self._parts = []
        keep = grid.inside(xs, zs) & (ys >= config.MIN_Y) & (ys <= config.MAX_Y)
        xs, ys, zs, ids = xs[keep], ys[keep], zs[keep], ids[keep]
        key = (zs.astype(np.int64) >> 4) * 100000 + (xs.astype(np.int64) >> 4)
        order = np.argsort(key, kind="stable")
        xs, ys, zs, ids, key = xs[order], ys[order], zs[order], ids[order], key[order]
        uk, starts = np.unique(key, return_index=True)
        ends = np.append(starts[1:], key.size)
        bes: dict[tuple[int, int], list[dict]] = {}
        for be in self.block_entities:
            bes.setdefault((be["x"] >> 4, be["z"] >> 4), []).append(be)
        return _Sorted(uk, starts, ends, xs, ys, zs, ids, bes)


class _Sorted:
    def __init__(self, keys, starts, ends, xs, ys, zs, ids, bes):
        self.keys, self.starts, self.ends = keys, starts, ends
        self.xs, self.ys, self.zs, self.ids = xs, ys, zs, ids
        self.bes = bes
        self.index = {int(k): i for i, k in enumerate(keys)}

    def for_chunk(self, cx: int, cz: int):
        i = self.index.get(cz * 100000 + cx)
        if i is None:
            return None
        s, e = self.starts[i], self.ends[i]
        return self.xs[s:e], self.ys[s:e], self.zs[s:e], self.ids[s:e]


class World:
    def __init__(self, grid: geo.Grid) -> None:
        self.grid = grid
        shape = (grid.nz, grid.nx)
        self.H = np.zeros(shape, dtype=np.int16)          # top solid block
        self.top = np.full(shape, B("grass_block"), dtype=np.uint16)
        self.sub = np.full(shape, B("dirt"), dtype=np.uint16)
        self.soil = np.full(shape, 3, dtype=np.uint8)     # depth of `sub` layer below the top block
        self.wtop = np.full(shape, NO_WATER, dtype=np.int16)
        self.biome = np.full(shape, BIO_TOWN, dtype=np.uint8)
        # occupancy masks used to keep features from colliding
        self.occupied = np.zeros(shape, dtype=bool)       # buildings, landmarks
        self.road = np.zeros(shape, dtype=bool)
        self.fade_water = np.zeros(shape, dtype=bool)
        self.edits = Edits()
        self.markers: dict[str, tuple[int, int, int]] = {}  # named points (for docs / signs / spawn)

    # helpers in block coordinates
    def idx(self, x, z):
        return np.asarray(z) - self.grid.z0, np.asarray(x) - self.grid.x0

    def h(self, x, z):
        iz, ix = self.idx(x, z)
        iz = np.clip(iz, 0, self.grid.nz - 1)
        ix = np.clip(ix, 0, self.grid.nx - 1)
        return self.H[iz, ix]

    def is_water(self, x, z):
        iz, ix = self.idx(x, z)
        iz = np.clip(iz, 0, self.grid.nz - 1)
        ix = np.clip(ix, 0, self.grid.nx - 1)
        return self.wtop[iz, ix] > self.H[iz, ix]

    def surface(self, x, z):
        """Y of the first free block above ground or water."""
        iz, ix = self.idx(x, z)
        iz = np.clip(iz, 0, self.grid.nz - 1)
        ix = np.clip(ix, 0, self.grid.nx - 1)
        return np.maximum(self.H[iz, ix], self.wtop[iz, ix]) + 1


# ------------------------------------------------------------- chunk assembly
_YY = None


def build_chunk_blocks(world: World, edits, cx: int, cz: int) -> np.ndarray:
    global _YY
    if _YY is None:
        _YY = np.arange(config.MIN_Y, config.MAX_Y + 1, dtype=np.int16)[:, None, None]
    g = world.grid
    ix0, iz0 = cx * 16 - g.x0, cz * 16 - g.z0
    sl = (slice(iz0, iz0 + 16), slice(ix0, ix0 + 16))
    H = world.H[sl][None]
    top = world.top[sl][None]
    sub = world.sub[sl][None]
    soil = world.soil[sl].astype(np.int16)[None]
    wtop = world.wtop[sl][None]
    yy = _YY
    stone = np.where(yy < 0, np.uint16(B("deepslate")), np.uint16(B("stone")))
    arr = np.where(yy < H - soil, stone, np.uint16(0)).astype(np.uint16)
    arr = np.where((yy >= H - soil) & (yy < H), sub, arr)
    arr = np.where(yy == H, top, arr)
    arr = np.where((yy > H) & (yy <= wtop), np.uint16(B("water")), arr)
    arr[0] = B("bedrock")
    if edits is not None:
        e = edits.for_chunk(cx, cz)
        if e is not None:
            xs, ys, zs, ids = e
            flat = (ys.astype(np.int64) - config.MIN_Y) * 256 + (zs - cz * 16) * 16 + (xs - cx * 16)
            # keep only the last edit per position
            rev = flat[::-1]
            _, first = np.unique(rev, return_index=True)
            last = flat.size - 1 - first
            arr.reshape(-1)[flat[last]] = ids[last]
    return arr


def chunk_biome_grid(world: World, cx: int, cz: int) -> np.ndarray:
    g = world.grid
    ix0, iz0 = cx * 16 - g.x0, cz * 16 - g.z0
    return world.biome[iz0 + 2:iz0 + 16:4, ix0 + 2:ix0 + 16:4].astype(np.int64)
