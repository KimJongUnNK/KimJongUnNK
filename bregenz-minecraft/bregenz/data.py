"""Loading the cached Overture data as lists of plain dicts with shapely geometries."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import pyarrow.parquet as pq
import shapely

RAW = Path(__file__).resolve().parent.parent / "data" / "raw"


@lru_cache(maxsize=None)
def overture(kind: str) -> list[dict]:
    rows = pq.read_table(RAW / "overture" / f"{kind}.parquet").to_pylist()
    for r in rows:
        r["geom"] = shapely.from_wkb(r["geometry"])
        names = r.get("names") or {}
        r["name"] = names.get("primary")
    return rows


def flags(row: dict, key: str = "road_flags") -> list[tuple[set, tuple[float, float] | None]]:
    out = []
    for f in row.get(key) or []:
        between = f.get("between")
        out.append((set(f.get("values") or []), tuple(between) if between else None))
    return out


def has_flag(row: dict, flag: str, key: str = "road_flags") -> list[tuple[float, float]]:
    """Return the [from, to] fractions of the segment that carry `flag`."""
    out = []
    for values, between in flags(row, key):
        if flag in values:
            out.append(between or (0.0, 1.0))
    return out
