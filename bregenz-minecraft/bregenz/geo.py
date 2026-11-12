"""Geographic projection and the block grid.

Local equirectangular projection around the KUB: +X = east, +Z = south,
1 block = 1 metre. Accuracy inside the 6 km map is far below one block.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from . import config

_phi = math.radians(config.ORIGIN_LAT)
M_PER_DEG_LAT = 111132.954 - 559.822 * math.cos(2 * _phi) + 1.175 * math.cos(4 * _phi)
M_PER_DEG_LON = 111412.84 * math.cos(_phi) - 93.5 * math.cos(3 * _phi)


def to_block(lon, lat):
    """lon/lat (scalars or arrays) -> (x, z) floats in blocks."""
    x = (np.asarray(lon, dtype=np.float64) - config.ORIGIN_LON) * M_PER_DEG_LON
    z = -(np.asarray(lat, dtype=np.float64) - config.ORIGIN_LAT) * M_PER_DEG_LAT
    return x, z


def to_lonlat(x, z):
    lon = config.ORIGIN_LON + np.asarray(x, dtype=np.float64) / M_PER_DEG_LON
    lat = config.ORIGIN_LAT - np.asarray(z, dtype=np.float64) / M_PER_DEG_LAT
    return lon, lat


@dataclass(frozen=True)
class Grid:
    """The rectangular block area that is generated, aligned to chunk borders."""

    x0: int
    z0: int
    nx: int
    nz: int

    @classmethod
    def from_bbox(cls, bbox=config.WORLD_BBOX) -> "Grid":
        lon0, lat0, lon1, lat1 = bbox
        xa, za = to_block(lon0, lat1)  # north-west corner
        xb, zb = to_block(lon1, lat0)  # south-east corner
        x0 = int(math.floor(float(xa) / 16)) * 16
        z0 = int(math.floor(float(za) / 16)) * 16
        x1 = int(math.ceil(float(xb) / 16)) * 16
        z1 = int(math.ceil(float(zb) / 16)) * 16
        return cls(x0, z0, x1 - x0, z1 - z0)

    @property
    def x1(self) -> int:
        return self.x0 + self.nx

    @property
    def z1(self) -> int:
        return self.z0 + self.nz

    def xs(self) -> np.ndarray:
        return np.arange(self.x0, self.x1)

    def zs(self) -> np.ndarray:
        return np.arange(self.z0, self.z1)

    def chunks(self):
        for cz in range(self.z0 // 16, self.z1 // 16):
            for cx in range(self.x0 // 16, self.x1 // 16):
                yield cx, cz

    def inside(self, x, z):
        return (x >= self.x0) & (x < self.x1) & (z >= self.z0) & (z < self.z1)


def place(lat: float, lon: float) -> tuple[int, int]:
    """Convenience: lat/lon (Google Maps order) -> integer block (x, z)."""
    x, z = to_block(lon, lat)
    return int(round(float(x))), int(round(float(z)))
