"""Global settings for the Bregenz world (1 block = 1 metre, Y = metres above sea level)."""

# Area downloaded from the data sources (lon_min, lat_min, lon_max, lat_max).
FETCH_BBOX = (9.712, 47.480, 9.802, 47.520)

# Area that becomes Minecraft terrain. Everything outside is open Bodensee.
# Inside CORE_BBOX (= where map data exists) the world is the real city; the band between CORE_BBOX and
# WORLD_BBOX is real terrain only (forest, meadows) that runs out gently into the lake with a natural,
# irregular shoreline, so the map never ends in a straight cliff.
CORE_BBOX = FETCH_BBOX
WORLD_BBOX = (9.708, 47.4745, 9.814, 47.5255)
EDGE_BAND = 650            # blocks over which the land outside the core sinks into the lake

# Origin of the block grid: block (0, 0) = vorarlberg museum, Kornmarktplatz (as in the Bauplan).
ORIGIN_LAT, ORIGIN_LON = 47.50456, 9.74663  # centroid of the museum footprint (OSM)

DEM_ZOOM = 15

# Vertical layout. Y equals real altitude in metres (Pegel Bodensee ~395.5 m).
WATER_LEVEL = 396          # top water block of the Bodensee
LAKE_MAX_DEPTH = 16        # lake bottom flattens out at Y = 380
MIN_Y = -64
HEIGHT = 1280              # world height: Y -64 .. 1215 (needs the datapack)
MAX_Y = MIN_Y + HEIGHT - 1
CLOUD_HEIGHT = 760.0       # clouds hang at mid-slope: sea of fog view from the summit

# Final guard: everything within this distance of the world edge is lake.
EDGE_FADE = 120

# Minecraft version the chunk/level data is written in. Minecraft upgrades the
# data on load (DataFixerUpper), which keeps the world loadable in all newer
# versions. The datapack is written for Java 26.3 (data pack format 121).
DATA_VERSION = 4189        # Java 1.21.4
VERSION_NAME = "1.21.4"
TARGET_VERSION = "26.3"
PACK_FORMAT = 121

LEVEL_NAME = "Bregenz 1:1"
SEED = 6900  # PLZ Bregenz
