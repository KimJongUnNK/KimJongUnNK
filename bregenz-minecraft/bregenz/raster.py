"""Rasterising vector geometries (shapely, lon/lat) onto the block grid."""
from __future__ import annotations

import numpy as np
import shapely
from PIL import Image, ImageDraw

from . import geo


def _ring_px(coords, grid: geo.Grid):
    a = np.asarray(coords)
    x, z = geo.to_block(a[:, 0], a[:, 1])
    return list(zip((x - grid.x0).tolist(), (z - grid.z0).tolist()))


def polygons(geoms, grid: geo.Grid, value: int = 1, out: np.ndarray | None = None,
             holes: bool = True) -> np.ndarray:
    """Fill (Multi)Polygons. Returns uint8 array [z, x]."""
    img = Image.new("L", (grid.nx, grid.nz), 0) if out is None else Image.fromarray(out)
    d = ImageDraw.Draw(img)
    for g in geoms:
        if g is None or g.is_empty:
            continue
        parts = g.geoms if hasattr(g, "geoms") else [g]
        for p in parts:
            if p.geom_type != "Polygon":
                continue
            d.polygon(_ring_px(p.exterior.coords, grid), fill=value)
            if holes:
                for r in p.interiors:
                    d.polygon(_ring_px(r.coords, grid), fill=0)
    return np.asarray(img)


def lines(geoms, grid: geo.Grid, width: float, value: int = 1, out: np.ndarray | None = None) -> np.ndarray:
    img = Image.new("L", (grid.nx, grid.nz), 0) if out is None else Image.fromarray(out)
    d = ImageDraw.Draw(img)
    w = max(1, int(round(width)))
    for g in geoms:
        if g is None or g.is_empty:
            continue
        parts = g.geoms if hasattr(g, "geoms") else [g]
        for p in parts:
            pts = _ring_px(p.coords, grid)
            if len(pts) < 2:
                continue
            d.line(pts, fill=value, width=w, joint="curve")
            if w > 2:  # round caps so segments join cleanly
                r = w / 2
                for x, z in (pts[0], pts[-1]):
                    d.ellipse((x - r, z - r, x + r, z + r), fill=value)
    return np.asarray(img)


def polygon_cells(poly, grid_origin=(0, 0)):
    """Cells (x, z int arrays, block coords) covered by one polygon in block coordinates."""
    minx, minz, maxx, maxz = poly.bounds
    x0, z0 = int(np.floor(minx)) - 1, int(np.floor(minz)) - 1
    w, h = int(np.ceil(maxx)) - x0 + 2, int(np.ceil(maxz)) - z0 + 2
    img = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(img)
    parts = poly.geoms if hasattr(poly, "geoms") else [poly]
    for p in parts:
        if p.geom_type != "Polygon":
            continue
        d.polygon([(x - x0, z - z0) for x, z in p.exterior.coords], fill=1)
        for r in p.interiors:
            d.polygon([(x - x0, z - z0) for x, z in r.coords], fill=0)
    m = np.asarray(img).astype(bool)
    return m, x0, z0


def to_block_geom(g):
    """Transform a lon/lat shapely geometry into block coordinates."""
    return shapely.transform(g, lambda c: np.column_stack(geo.to_block(c[:, 0], c[:, 1])))
