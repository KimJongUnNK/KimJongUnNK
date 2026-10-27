"""Terrain: real elevation model, Bodensee, rivers, surface materials and biomes."""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

from . import config, data, geo, raster
from .blocks import B
from .noise import fbm, hash01, value_noise
from .world import BIO_ALM, BIO_FOREST, BIO_LAKE, BIO_TOWN, NO_WATER, World

WL = config.WATER_LEVEL


# ------------------------------------------------------------------ DEM
def load_dem(grid: geo.Grid) -> np.ndarray:
    """Bicubic-sampled elevation (metres) at every block centre, shape [z, x]."""
    z = config.DEM_ZOOM
    tdir = data.RAW / "terrarium"
    tiles = {}
    for f in tdir.glob(f"{z}_*_*.png"):
        _, tx, ty = f.stem.split("_")
        tiles[(int(tx), int(ty))] = f
    txs = sorted({k[0] for k in tiles})
    tys = sorted({k[1] for k in tiles})
    mosaic = np.zeros((len(tys) * 256, len(txs) * 256), dtype=np.float32)
    for (tx, ty), f in tiles.items():
        a = np.asarray(Image.open(f).convert("RGB")).astype(np.float32)
        e = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
        j, i = txs.index(tx), tys.index(ty)
        mosaic[i * 256:(i + 1) * 256, j * 256:(j + 1) * 256] = e
    n = 2 ** z * 256
    lon, _ = geo.to_lonlat(grid.xs() + 0.5, 0)
    _, lat = geo.to_lonlat(0, grid.zs() + 0.5)
    px = (lon + 180.0) / 360.0 * n - txs[0] * 256 - 0.5
    py = (1 - np.arcsinh(np.tan(np.radians(lat))) / math.pi) / 2 * n - tys[0] * 256 - 0.5
    spline = ndimage.spline_filter(mosaic, order=3)
    out = np.empty((grid.nz, grid.nx), dtype=np.float32)
    step = 256
    for i in range(0, grid.nz, step):
        cy, cx = np.meshgrid(py[i:i + step], px, indexing="ij")
        out[i:i + step] = ndimage.map_coordinates(spline, [cy, cx], order=3, prefilter=False, mode="nearest")
    return out


def _smoothstep(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3 - 2 * t)


def edge_factor(grid: geo.Grid, fade: float) -> np.ndarray:
    xs = np.arange(grid.nx, dtype=np.float32)
    zs = np.arange(grid.nz, dtype=np.float32)
    dx = np.minimum(xs, grid.nx - 1 - xs)
    dz = np.minimum(zs, grid.nz - 1 - zs)
    # rounded corners: euclidean distance to the nearest edge-corner region
    fx = _smoothstep(dx / fade)
    fz = _smoothstep(dz / fade)
    return np.minimum(fz[:, None], fx[None, :]).astype(np.float32)


# ---------------------------------------------------------------- build
def build(world: World, log=print) -> dict:
    grid = world.grid
    shape = (grid.nz, grid.nx)
    log("terrain: sampling elevation model")
    E = load_dem(grid)
    stats = {"dem_min": float(E.min()), "dem_max": float(E.max())}
    iz, ix = np.unravel_index(int(np.argmax(E)), shape)
    stats["dem_max_at"] = (int(ix + grid.x0), int(iz + grid.z0))

    # ---- water polygons
    log("terrain: water")
    lake_polys, inland_polys, river_polys = [], [], []
    for r in data.overture("water"):
        g = r["geom"]
        if g.geom_type not in ("Polygon", "MultiPolygon"):
            continue
        if r["subtype"] == "human_made":  # swimming pools
            inland_polys.append(g)
        elif r["subtype"] == "river" or (r["subtype"] == "stream"):
            river_polys.append(g)
        else:
            lake_polys.append(g)
    lake_raw = raster.polygons(lake_polys, grid).astype(bool)
    # water polygons that sit at lake level belong to the Bodensee (harbours); others are ponds
    lab, n = ndimage.label(lake_raw)
    if n:
        med = ndimage.median(E, lab, index=np.arange(1, n + 1))
        lakelevel = np.zeros(n + 1, dtype=bool)
        lakelevel[1:] = med <= WL + 1.5
        lake = lakelevel[lab]
        ponds = lake_raw & ~lake
    else:
        lake = lake_raw
        ponds = np.zeros(shape, bool)
    pools = raster.polygons(inland_polys, grid).astype(bool) | ponds
    rivers = raster.polygons(river_polys, grid).astype(bool) & ~lake

    # ---- micro relief on natural ground (the DEM is a 10 m model)
    rough = fbm(shape, 24.0, config.SEED + 1, octaves=3) * 0.9 + value_noise(shape, 6.0, config.SEED + 2) * 0.35
    urban = _urban_mask(world)
    natural = ~ndimage.binary_dilation(urban, iterations=6)
    E = E + np.where(natural & ~lake & ~rivers, rough, 0.0).astype(np.float32)

    # ---- edge fade into the lake
    f = edge_factor(grid, config.EDGE_FADE)
    base = WL - 12.0
    E = base + (E - base) * f
    land_e = np.maximum(E, WL + 1.0)
    # land the edge fade pushed under water becomes lake; low-lying land inside the map stays land
    world.fade_water = (E < WL + 0.5) & ~lake & (f < 0.98)
    lake = lake | world.fade_water
    lake &= ~(rivers & (E > WL + 1.5))

    # ---- bathymetry: depth grows with distance from shore, flat at 380
    d = ndimage.distance_transform_edt(lake)
    depth = np.clip(1.0 + d * 0.075 + fbm(shape, 60.0, config.SEED + 3, 2) * 1.5, 1.0, config.LAKE_MAX_DEPTH)
    harbours = raster.polygons([r["geom"] for r in data.overture("water")
                                if r["subtype"] in ("water", "lake") and r["geom"].area < 1e-4], grid).astype(bool)
    depth = np.where(harbours & lake, np.maximum(depth, 4.0), depth)
    H = np.where(lake, np.floor(WL - depth), np.floor(land_e)).astype(np.int16)
    wtop = np.where(lake, WL, NO_WATER).astype(np.int16)

    # ---- rivers (Bregenzer Ach etc.): surface follows the smoothed valley floor
    if rivers.any():
        Es = ndimage.gaussian_filter(np.where(rivers, E, 0), 8) / np.maximum(ndimage.gaussian_filter(rivers.astype(np.float32), 8), 1e-3)
        surf = np.floor(np.maximum(Es, WL)).astype(np.int16)
        rd = ndimage.distance_transform_edt(rivers)
        rdepth = np.clip(1 + rd * 0.25, 1, 3).astype(np.int16)
        H = np.where(rivers, surf - rdepth, H)
        wtop = np.where(rivers, surf, wtop)
        # banks never lower than the river surface (no water hanging in the air)
        bank = ndimage.binary_dilation(rivers, iterations=2) & ~rivers & ~lake
        bank_need = ndimage.grey_dilation(np.where(rivers, surf, -9999).astype(np.int16), size=5)
        H = np.where(bank, np.maximum(H, bank_need), H)

    # ---- streams: 1-2 wide channels
    streams = [r["geom"] for r in data.overture("water")
               if r["geom"].geom_type in ("LineString", "MultiLineString") and r["subtype"] in ("stream", "canal")
               and (r.get("level") or 0) >= 0]
    smask = raster.lines(streams, grid, 2).astype(bool) & ~lake & ~rivers
    smask &= E > WL + 2
    H = np.where(smask, H - 1, H)
    wtop = np.where(smask, H, wtop)  # water surface one below the banks
    H = np.where(smask, H - 1, H)

    # ---- pools & ponds: 2 deep
    pm = pools & ~lake & ~rivers
    pm_e = np.floor(land_e).astype(np.int16)
    H = np.where(pm, pm_e - 3, H)
    wtop = np.where(pm, pm_e - 1, wtop)

    world.H[:] = H
    world.wtop[:] = wtop
    water = wtop > H
    world.water_mask = water
    world.lake_mask = lake

    # ---- surface materials
    log("terrain: surface materials")
    _materials(world, E, lake, rivers | smask, pm)
    _biomes(world, lake)
    stats["lake_cells"] = int(lake.sum())
    return stats


def _urban_mask(world: World) -> np.ndarray:
    g = world.grid
    b = raster.polygons([r["geom"] for r in data.overture("building")], g).astype(bool)
    roads = [r["geom"] for r in data.overture("segment") if r["subtype"] in ("road", "rail")
             and r["class"] not in ("path", "track", "footway", "steps")]
    rm = raster.lines(roads, g, 6).astype(bool)
    return b | rm


def _materials(world: World, E, lake, flowing, pools) -> None:
    g = world.grid
    shape = (g.nz, g.nx)
    H = world.H.astype(np.float32)
    gy, gx = np.gradient(ndimage.gaussian_filter(H, 1.0))
    slope = np.hypot(gx, gy)
    world.slope = slope
    zz, xx = np.mgrid[g.z0:g.z1, g.x0:g.x1]
    rnd = hash01(xx, zz, seed=7)
    n1 = value_noise(shape, 9.0, config.SEED + 11)
    n2 = value_noise(shape, 30.0, config.SEED + 12)

    top = world.top
    sub = world.sub
    soil = world.soil

    # land cover polygons
    land = data.overture("land")
    def mask_of(pred):
        return raster.polygons([r["geom"] for r in land if pred(r)], g).astype(bool)
    forest = mask_of(lambda r: r["subtype"] == "forest") | raster.polygons(
        [r["geom"] for r in data.overture("land_cover") if r["subtype"] == "forest"], g).astype(bool) & (E > 430)
    sand = mask_of(lambda r: r["subtype"] == "sand")
    shingle = mask_of(lambda r: r["subtype"] == "rock" and r["class"] == "shingle")
    rock = mask_of(lambda r: r["subtype"] == "rock" and r["class"] != "shingle")
    wet = mask_of(lambda r: r["subtype"] == "wetland")
    cliffs = raster.lines([r["geom"] for r in land if r["class"] == "cliff"], g, 4).astype(bool)
    open_land = raster.polygons([r["geom"] for r in data.overture("land_use")
                                 if r["class"] in ("meadow", "grass", "farmland", "orchard", "pitch", "farmyard",
                                                   "allotments", "vineyard", "winter_sports", "hike")], g).astype(bool)
    open_land |= raster.polygons([r["geom"] for r in land if r["subtype"] in ("grass", "shrub")], g).astype(bool)
    osm_forest = mask_of(lambda r: r["subtype"] == "forest")
    forest = osm_forest | (forest & ~open_land)
    world.forest_mask = forest & ~lake

    lu = data.overture("land_use")
    def lu_mask(classes):
        return raster.polygons([r["geom"] for r in lu if r["class"] in classes], g).astype(bool)
    paved = lu_mask({"plaza", "pedestrian"}) | raster.polygons(
        [r["geom"] for r in data.overture("infrastructure") if r["class"] == "parking"
         and r["geom"].geom_type in ("Polygon", "MultiPolygon")], g).astype(bool)
    rail_land = lu_mask({"railway"})
    quarry = lu_mask({"quarry"})
    farmland = lu_mask({"farmland", "orchard", "vineyard", "allotments"})
    pitch = lu_mask({"pitch", "stadium"})
    cemetery = lu_mask({"cemetery", "grave_yard"})
    world.park_mask = lu_mask({"park", "garden", "grass", "meadow", "recreation_ground"})
    world.meadow_mask = lu_mask({"meadow", "grass"})
    world.zoo_mask = lu_mask({"zoo"})
    world.cemetery_mask = cemetery

    def put(mask, t, s=None, depth=None):
        top[mask] = B(t) if isinstance(t, str) else t[mask]
        if s is not None:
            sub[mask] = B(s)
        if depth is not None:
            soil[mask] = depth

    # forest floor
    put(forest & (n1 > 0.45), "podzol")
    put(forest & (n1 < -0.55), "coarse_dirt")
    put(forest & (rnd < 0.04), "moss_block")
    put(farmland, "grass_block")
    put(farmland & (n1 > 0.3), "coarse_dirt")
    put(wet, "mud")
    put(wet & (n1 > 0.2), "moss_block")
    put(cemetery & (rnd < 0.25), "podzol")
    put(pitch & (n2 > 0.6), "grass_block")
    # steep ground: Nagelfluh conglomerate (stone/andesite/cobble/gravel mix)
    steep = (slope > 1.25) | cliffs | rock
    rockmix = np.where(n1 > 0.35, B("andesite"), np.where(n1 < -0.35, B("cobblestone"),
                       np.where(rnd < 0.15, B("gravel"), np.where(rnd < 0.25, B("tuff"), B("stone"))))).astype(np.uint16)
    top[steep] = rockmix[steep]
    sub[steep] = B("stone")
    medium = (slope > 0.95) & ~steep
    put(medium & (rnd < 0.45), "coarse_dirt")
    put(medium & (rnd > 0.9), "rooted_dirt")
    put(quarry, "stone", "stone")
    put(sand, "sand", "sand")
    put(shingle, "gravel", "gravel")
    put(paved & ~lake, "polished_andesite", "stone")
    put(rail_land & ~lake, "gravel", "gravel")
    # shoreline: pebbles and sand
    dl = ndimage.distance_transform_edt(~lake)
    shore = (dl > 0) & (dl <= 3) & ~paved
    shoremix = np.where(rnd < 0.5, B("gravel"), np.where(rnd < 0.8, B("sand"), B("cobblestone"))).astype(np.uint16)
    top[shore] = shoremix[shore]
    # lake bed
    depth = config.WATER_LEVEL - world.H.astype(np.int32)
    bed = np.where(depth <= 3, np.where(rnd < 0.7, B("sand"), B("gravel")),
                   np.where(n1 > 0.3, B("gravel"), np.where(n1 < -0.4, B("clay"), np.where(rnd < 0.5, B("mud"), B("sand"))))).astype(np.uint16)
    top[lake] = bed[lake]
    sub[lake] = B("sand")
    # rivers: gravel beds
    rb = np.where(rnd < 0.6, B("gravel"), np.where(rnd < 0.85, B("cobblestone"), B("sand"))).astype(np.uint16)
    top[flowing] = rb[flowing]
    top[pools] = B("smooth_quartz")
    sub[pools] = B("stone")


def _biomes(world: World, lake) -> None:
    H = world.H
    b = np.full(H.shape, BIO_TOWN, dtype=np.uint8)
    b[world.forest_mask] = BIO_FOREST
    b[(H > 880) & ~world.forest_mask] = BIO_ALM
    b[lake] = BIO_LAKE
    world.biome[:] = b
