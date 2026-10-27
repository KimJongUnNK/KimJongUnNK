"""Global settings for the Bregenz world (1 block = 1 metre, Y = metres above sea level)."""

# Area downloaded from the data sources (lon_min, lat_min, lon_max, lat_max).
FETCH_BBOX = (9.712, 47.480, 9.802, 47.520)

# Area that becomes Minecraft terrain. Everything outside is open Bodensee.
WORLD_BBOX = (9.716, 47.482, 9.797, 47.518)

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

# Land is blended into the lake along the edges of WORLD_BBOX over this distance (blocks),
# so the map ends in shoreline instead of cut-off cliffs.
EDGE_FADE = 320

# Minecraft version the chunk/level data is written in. Minecraft upgrades the
# data on load (DataFixerUpper), which keeps the world loadable in all newer
# versions. The datapack is written for Java 26.3 (data pack format 121).
DATA_VERSION = 4189        # Java 1.21.4
VERSION_NAME = "1.21.4"
TARGET_VERSION = "26.3"
PACK_FORMAT = 121

LEVEL_NAME = "Bregenz 1:1"
SEED = 6900  # PLZ Bregenz
