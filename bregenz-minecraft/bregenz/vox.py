"""Local voxel canvas for building structures, committed to the world edits in one go."""
from __future__ import annotations

import numpy as np

from .blocks import B

NONE = np.uint16(65535)  # "leave the world as it is"


class Vox:
    def __init__(self, x0: int, y0: int, z0: int, sx: int, sy: int, sz: int):
        self.x0, self.y0, self.z0 = x0, y0, z0
        self.a = np.full((sx, sy, sz), NONE, dtype=np.uint16)

    @property
    def shape(self):
        return self.a.shape

    def _i(self, x, y, z):
        return x - self.x0, y - self.y0, z - self.z0

    def inside(self, x, y, z) -> bool:
        i, j, k = self._i(x, y, z)
        return 0 <= i < self.a.shape[0] and 0 <= j < self.a.shape[1] and 0 <= k < self.a.shape[2]

    def set(self, x, y, z, block) -> None:
        i, j, k = self._i(x, y, z)
        if 0 <= i < self.a.shape[0] and 0 <= j < self.a.shape[1] and 0 <= k < self.a.shape[2]:
            self.a[i, j, k] = block if isinstance(block, (int, np.integer)) else B(block)

    def get(self, x, y, z) -> int:
        i, j, k = self._i(x, y, z)
        return int(self.a[i, j, k])

    def fill(self, x0, y0, z0, x1, y1, z1, block) -> None:
        xa, xb = sorted((x0, x1))
        ya, yb = sorted((y0, y1))
        za, zb = sorted((z0, z1))
        i0, j0, k0 = self._i(xa, ya, za)
        i1, j1, k1 = self._i(xb, yb, zb)
        if i1 < 0 or j1 < 0 or k1 < 0:
            return
        i0, j0, k0 = max(i0, 0), max(j0, 0), max(k0, 0)
        bid = block if isinstance(block, (int, np.integer)) else B(block)
        self.a[i0:i1 + 1, j0:j1 + 1, k0:k1 + 1] = bid

    def hollow(self, x0, y0, z0, x1, y1, z1, wall, inside="air") -> None:
        self.fill(x0, y0, z0, x1, y1, z1, wall)
        if inside is not None and abs(x1 - x0) > 1 and abs(z1 - z0) > 1:
            self.fill(min(x0, x1) + 1, y0, min(z0, z1) + 1, max(x0, x1) - 1, y1, max(z0, z1) - 1, inside)

    def column(self, x, z, y0, y1, block) -> None:
        self.fill(x, y0, z, x, y1, z, block)

    def disk(self, cx, cz, y, r, block, filled=True) -> None:
        R = int(np.ceil(r))
        for dx in range(-R, R + 1):
            for dz in range(-R, R + 1):
                d = np.hypot(dx, dz)
                if d <= r + 0.3 and (filled or d > r - 1.0):
                    self.set(cx + dx, y, cz + dz, block)

    def line(self, p0, p1, block) -> None:
        p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
        n = int(np.ceil(np.abs(p1 - p0).max())) + 1
        for t in np.linspace(0, 1, max(n, 2)):
            x, y, z = np.round(p0 + (p1 - p0) * t).astype(int)
            self.set(x, y, z, block)

    def commit(self, edits) -> int:
        i, j, k = np.nonzero(self.a != NONE)
        if i.size:
            edits.put(i + self.x0, j + self.y0, k + self.z0, self.a[i, j, k])
        return int(i.size)
