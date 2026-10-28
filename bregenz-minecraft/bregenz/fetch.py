"""Download the source data for the Bregenz world.

* Terrain: Mapzen/AWS "terrarium" elevation tiles (zoom 15). For Austria these
  are built from the official 10 m Digitales Gelaendemodell (bare earth, no
  buildings or trees), which is exactly what a Minecraft terrain needs.
* Map features: Overture Maps (OSM-derived buildings, roads, rail, water,
  land use / land cover, piers, aerialways, places), read straight from the
  public S3 bucket with a bounding-box filter.

Run:  python -m bregenz.fetch
Everything lands in data/raw/ and is cached; re-running skips existing files.
"""
from __future__ import annotations

import math
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import config

RAW = Path(__file__).resolve().parent.parent / "data" / "raw"
OVERTURE_RELEASE = "2026-10-21.0"
OVERTURE_BUCKET = "overturemaps-us-west-2"
OVERTURE_TYPES = {
    "building": "buildings",
    "building_part": "buildings",
    "segment": "transportation",
    "infrastructure": "base",
    "water": "base",
    "land_use": "base",
    "land_cover": "base",
    "land": "base",
    "place": "places",
}
TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"


def tile_xy(lon: float, lat: float, z: int) -> tuple[float, float]:
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n
    return x, y


def fetch_terrain(bbox=config.WORLD_BBOX, z: int = config.DEM_ZOOM) -> None:
    out = RAW / "terrarium"
    out.mkdir(parents=True, exist_ok=True)
    lon0, lat0, lon1, lat1 = bbox
    x0, y0 = tile_xy(lon0, lat1, z)
    x1, y1 = tile_xy(lon1, lat0, z)
    jobs = []
    for x in range(int(x0), int(x1) + 1):
        for y in range(int(y0), int(y1) + 1):
            f = out / f"{z}_{x}_{y}.png"
            if not f.exists():
                jobs.append((TERRARIUM_URL.format(z=z, x=x, y=y), f))

    def get(job):
        url, f = job
        for attempt in range(4):
            try:
                with urllib.request.urlopen(url, timeout=60) as r:
                    f.write_bytes(r.read())
                return
            except Exception:  # network hiccup -> retry with backoff
                time.sleep(2 ** attempt)
        raise RuntimeError(f"failed: {url}")

    with ThreadPoolExecutor(16) as ex:
        list(ex.map(get, jobs))
    print(f"terrain: {len(jobs)} tiles downloaded")


def fetch_overture(bbox=config.FETCH_BBOX, types=tuple(OVERTURE_TYPES)) -> None:
    import pyarrow.dataset as ds
    import pyarrow.fs as pafs
    import pyarrow.parquet as pq

    out = RAW / "overture"
    out.mkdir(parents=True, exist_ok=True)
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    kw = {"anonymous": True, "region": "us-west-2"}
    if proxy:
        kw["proxy_options"] = proxy
    s3 = pafs.S3FileSystem(**kw)
    lon0, lat0, lon1, lat1 = bbox
    for t in types:
        f = out / f"{t}.parquet"
        if f.exists():
            continue
        theme = OVERTURE_TYPES[t]
        path = f"{OVERTURE_BUCKET}/release/{OVERTURE_RELEASE}/theme={theme}/type={t}/"
        dataset = ds.dataset(path, filesystem=s3, format="parquet")
        flt = (
            (ds.field("bbox", "xmin") < lon1)
            & (ds.field("bbox", "xmax") > lon0)
            & (ds.field("bbox", "ymin") < lat1)
            & (ds.field("bbox", "ymax") > lat0)
        )
        t0 = time.time()
        table = dataset.to_table(filter=flt)
        pq.write_table(table, f, compression="zstd")
        print(f"overture {t}: {table.num_rows} rows in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    what = sys.argv[1:] or ["terrain", "overture"]
    if "terrain" in what:
        fetch_terrain()
    if "overture" in what:
        fetch_overture()
