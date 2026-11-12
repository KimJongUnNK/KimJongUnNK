"""Cheap smooth 2D noise for large grids (cubic-interpolated value noise, fBm)."""
from __future__ import annotations

import numpy as np
from scipy import ndimage


def value_noise(shape: tuple[int, int], scale: float, seed: int) -> np.ndarray:
    """Smooth noise in [-1, 1] with feature size ~`scale` cells."""
    rng = np.random.default_rng(seed)
    gz = int(np.ceil(shape[0] / scale)) + 4
    gx = int(np.ceil(shape[1] / scale)) + 4
    coarse = rng.uniform(-1.0, 1.0, size=(gz, gx)).astype(np.float32)
    zz = np.arange(shape[0], dtype=np.float32) / scale + 1.5
    xx = np.arange(shape[1], dtype=np.float32) / scale + 1.5
    out = np.empty(shape, dtype=np.float32)
    spline = ndimage.spline_filter(coarse, order=3)
    step = max(1, 4_000_000 // max(shape[1], 1))
    for i in range(0, shape[0], step):
        z = zz[i:i + step]
        cz, cx = np.meshgrid(z, xx, indexing="ij")
        out[i:i + step] = ndimage.map_coordinates(spline, [cz, cx], order=3, prefilter=False, mode="nearest")
    return np.clip(out, -1.0, 1.0)


def fbm(shape, scale: float, seed: int, octaves: int = 3, gain: float = 0.5) -> np.ndarray:
    total = np.zeros(shape, dtype=np.float32)
    amp, norm = 1.0, 0.0
    for o in range(octaves):
        total += amp * value_noise(shape, scale / (2 ** o), seed + 101 * o)
        norm += amp
        amp *= gain
    return total / norm


def hash01(*arrays, seed: int = 0) -> np.ndarray:
    """Deterministic per-cell pseudo random numbers in [0, 1) from integer coordinates."""
    h = np.uint64(seed * 0x9E3779B1 + 0x632BE5AB)
    for a in arrays:
        a = np.asarray(a).astype(np.int64).astype(np.uint64)
        h = (h ^ (a * np.uint64(0x9E3779B97F4A7C15))) * np.uint64(0xBF58476D1CE4E5B9)
        h ^= h >> np.uint64(31)
    h = h * np.uint64(0x94D049BB133111EB)
    h ^= h >> np.uint64(29)
    return (h >> np.uint64(11)).astype(np.float64) / float(1 << 53)
