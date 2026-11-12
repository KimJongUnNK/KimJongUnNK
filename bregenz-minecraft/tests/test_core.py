"""Unit tests for the file-format layer and the world settings."""
from __future__ import annotations

import gzip
import json
import struct
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bregenz import anvil, config, geo, level, nbt  # noqa: E402
from bregenz.blocks import REG, format_state, parse_state  # noqa: E402
from bregenz.world import BIOMES  # noqa: E402


# ------------------------------------------------------------------ NBT
def test_nbt_roundtrip_all_types():
    root = {
        "b": nbt.Byte(-3), "s": nbt.Short(1234), "i": nbt.Int(-70000), "l": nbt.Long(2 ** 40), "f": nbt.Float(1.5),
        "d": nbt.Double(-2.25), "str": "Bregenz äöü", "ba": np.array([1, -2, 3], dtype=np.int8),
        "ia": np.array([1, -2, 2 ** 30], dtype=np.int32), "la": np.array([-1, 2 ** 62], dtype=np.int64),
        "list": nbt.List([nbt.Int(1), nbt.Int(2)]), "empty": nbt.List([], nbt.TAG_COMPOUND),
        "nested": {"x": "y", "deep": {"z": nbt.Byte(1)}},
    }
    name, back = nbt.decode(nbt.encode(root, "root"))
    assert name == "root"
    assert back["b"] == -3 and back["s"] == 1234 and back["i"] == -70000 and back["l"] == 2 ** 40
    assert back["f"] == 1.5 and back["d"] == -2.25 and back["str"] == "Bregenz äöü"
    assert back["ba"].tolist() == [1, -2, 3] and back["ia"].tolist() == [1, -2, 2 ** 30]
    assert back["la"].tolist() == [-1, 2 ** 62]
    assert back["list"] == [1, 2] and back["list"].elem_tag == nbt.TAG_INT
    assert back["empty"] == [] and back["empty"].elem_tag == nbt.TAG_COMPOUND
    assert back["nested"]["deep"]["z"] == 1


def test_nbt_matches_independent_parser():
    nbtlib = pytest.importorskip("nbtlib")
    root = {"DataVersion": nbt.Int(config.DATA_VERSION), "Status": "minecraft:full",
            "la": np.array([5, -6], dtype=np.int64), "lst": nbt.List(["a", "b"], nbt.TAG_STRING)}
    import io
    f = nbtlib.File.parse(io.BytesIO(nbt.encode(root)))
    assert int(f["DataVersion"]) == config.DATA_VERSION
    assert str(f["Status"]) == "minecraft:full"
    assert [int(v) for v in f["la"]] == [5, -6]
    assert [str(v) for v in f["lst"]] == ["a", "b"]


# ------------------------------------------------------------- bit packing
@pytest.mark.parametrize("bits", [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 15, 16])
def test_pack_roundtrip(bits):
    rng = np.random.default_rng(bits)
    vals = rng.integers(0, 2 ** bits, size=4096).astype(np.uint64)
    longs = anvil.pack(vals, bits)
    assert longs.dtype == np.int64
    assert longs.size == -(-4096 // (64 // bits))  # values never span two longs (1.16+)
    assert np.array_equal(anvil.unpack(longs, bits, 4096), vals.astype(np.int64))


def test_pack_layout_reference():
    # first value lives in the lowest bits of the first long
    longs = anvil.pack(np.array([1, 2, 3] + [0] * 13, dtype=np.uint64), 4)
    assert longs[0] == 1 | (2 << 4) | (3 << 8)


def test_bits_rules():
    assert anvil.bits_for_blocks(1) == 4 and anvil.bits_for_blocks(16) == 4 and anvil.bits_for_blocks(17) == 5
    assert anvil.bits_for_biomes(2) == 1 and anvil.bits_for_biomes(3) == 2 and anvil.bits_for_biomes(4) == 2


# ------------------------------------------------------------ block states
def test_state_parsing_is_canonical():
    assert parse_state("stone") == ("minecraft:stone", {})
    n, p = parse_state("oak_stairs[half=top,facing=east]")
    assert n == "minecraft:oak_stairs" and list(p) == ["facing", "half"]
    assert format_state(n, p) == "minecraft:oak_stairs[facing=east,half=top]"
    assert REG.id("oak_stairs[half=top,facing=east]") == REG.id("minecraft:oak_stairs[facing=east,half=top]")
    assert REG.id("air") == 0


# ------------------------------------------------------------- chunk / region
def _test_chunk():
    blocks = np.zeros((config.HEIGHT, 16, 16), dtype=np.uint16)
    blocks[0] = REG.id("bedrock")
    blocks[1:460] = REG.id("stone")
    blocks[460, 3, 5] = REG.id("oak_log[axis=y]")
    blocks[461:470, :, 0] = REG.id("water")
    grid = np.zeros((4, 4), dtype=np.int64)
    grid[0, 0] = 2
    return blocks, grid


def test_chunk_encoding_decodes_back():
    blocks, grid = _test_chunk()
    raw = anvil.chunk_bytes(-3, 7, blocks, BIOMES, grid)
    _, ch = nbt.decode(raw)
    assert ch["DataVersion"] == config.DATA_VERSION and ch["Status"] == "minecraft:full"
    assert ch["xPos"] == -3 and ch["zPos"] == 7 and ch["yPos"] == config.MIN_Y // 16
    secs = ch["sections"]
    assert len(secs) == config.HEIGHT // 16
    assert [s["Y"] for s in secs] == list(range(config.MIN_Y // 16, config.MIN_Y // 16 + config.HEIGHT // 16))
    # every section decodes to exactly what we put in
    for k, s in enumerate(secs):
        pal, idx = anvil.decode_section_blocks(s)
        want = blocks[k * 16:(k + 1) * 16]
        got_names = np.array(pal)[idx]
        want_names = np.array([REG.state(i) for i in range(len(REG))])[want]
        assert (got_names == want_names).all(), f"section {s['Y']}"
        bp = s["biomes"]["palette"]
        assert set(bp) <= set(BIOMES)
    # uniform sections carry no data array (vanilla rule)
    assert "data" not in secs[5]["block_states"]


def test_region_file_layout(tmp_path):
    blocks, grid = _test_chunk()
    w = anvil.RegionWriter(tmp_path / "r.0.0.mca")
    w.add(0, 0, anvil.chunk_bytes(0, 0, blocks, BIOMES, grid))
    w.add(31, 31, anvil.chunk_bytes(31, 31, blocks, BIOMES, grid))
    w.write()
    data = (tmp_path / "r.0.0.mca").read_bytes()
    assert len(data) % 4096 == 0
    loc0 = struct.unpack(">I", data[0:4])[0]
    assert loc0 >> 8 == 2  # first chunk right after the two header sectors
    chunks = anvil.read_region(tmp_path / "r.0.0.mca")
    assert set(chunks) == {(0, 0), (31, 31)}


# ------------------------------------------------------------- world setup
def test_projection_origin_and_scale():
    x, z = geo.place(config.ORIGIN_LAT, config.ORIGIN_LON)
    assert (x, z) == (0, 0)
    # 0.001 deg latitude ~ 111 m, north is -Z
    x, z = geo.place(config.ORIGIN_LAT + 0.001, config.ORIGIN_LON)
    assert x == 0 and -112 <= z <= -110
    x, z = geo.place(config.ORIGIN_LAT, config.ORIGIN_LON + 0.001)
    assert 74 <= x <= 76 and z == 0


def test_grid_is_chunk_aligned():
    g = geo.Grid.from_bbox()
    assert g.x0 % 16 == 0 and g.z0 % 16 == 0 and g.nx % 16 == 0 and g.nz % 16 == 0
    # the Bauplan's map cut-out (47.5120/9.7210 - 47.4890/9.7835) is fully inside
    for lat, lon in ((47.5120, 9.7210), (47.4890, 9.7835)):
        x, z = geo.place(lat, lon)
        assert g.inside(x, z)


def test_dimension_type_is_valid():
    d = level.dimension_type()
    vanilla = json.loads((level.VANILLA / "dimension_type_overworld.json").read_text())
    assert set(d) == set(vanilla)  # same schema as vanilla 26.3
    assert d["height"] % 16 == 0 and d["min_y"] % 16 == 0
    assert d["min_y"] + d["height"] <= 2032 and d["min_y"] >= -2032 and d["height"] <= 4064
    assert d["logical_height"] <= d["height"]
    assert d["min_y"] + d["height"] - 1 >= 1062 + 95  # Pfänder + Sendemast fit


def test_biomes_never_snow():
    for name in BIOMES:
        b = level.biome(name)
        # Minecraft lowers temperature by 0.00125 per block above Y=80; snow below 0.15
        t_top = b["temperature"] - (config.MAX_Y - 80) * 0.00125
        assert t_top >= 0.15
        assert {"grass_color", "foliage_color", "water_color"} <= set(b["effects"])


def test_level_dat(tmp_path):
    level.write_level(tmp_path, (1, 400, 2), (0.0, 0.0, 1000.0))
    with gzip.open(tmp_path / "level.dat") as f:
        _, root = nbt.decode(f.read())
    d = root["Data"]
    assert d["DataVersion"] == config.DATA_VERSION and d["Version"]["Id"] == config.DATA_VERSION
    assert "file/bregenz" in d["DataPacks"]["Enabled"]
    layers = d["WorldGenSettings"]["dimensions"]["minecraft:overworld"]["generator"]["settings"]["layers"]
    top = config.MIN_Y + sum(int(l["height"]) for l in layers) - 1
    assert top == config.WATER_LEVEL  # the lake outside the map is at Bodensee level
    assert layers[-1]["block"] == "minecraft:water"


def test_datapack_files(tmp_path):
    root = level.write_datapack(tmp_path)
    meta = json.loads((root / "pack.mcmeta").read_text())["pack"]
    assert meta["pack_format"] == config.PACK_FORMAT
    assert meta["min_format"][0] <= config.PACK_FORMAT <= meta["max_format"][0]
    assert (root / "data/minecraft/dimension_type/overworld.json").exists()
    for b in BIOMES:
        ns, p = b.split(":")
        assert (root / f"data/{ns}/worldgen/biome/{p}.json").exists()


# ------------------------------------------------------------- starter kit
def test_map_colors_and_items(tmp_path):
    from bregenz import mapitems
    rgb = np.zeros((128, 128, 3), dtype=np.uint8)
    rgb[:, :64] = (64, 64, 255)       # water
    rgb[:, 64:] = (127, 178, 56)      # grass
    cols = mapitems.map_colors(rgb).astype(np.uint8)
    assert cols.size == 128 * 128
    assert set(np.unique(cols // 4)) == {12, 1}  # WATER and GRASS base colours
    targets = mapitems.teleport_targets({"Kunsthaus Bregenz (KUB)": (50, 427, -47), "Pfänder Gipfelkreuz": (2529, 1063, -313)})
    assert targets[0][1] == "kunsthaus_bregenz_kub" and targets[1][1] == "pfaender_gipfelkreuz"
    items = mapitems.inventory([{"id": 0, "name": "A"}], targets)
    assert items[0]["id"] == "minecraft:filled_map" and items[-1]["id"] == "minecraft:written_book"
    mapitems.write_functions(tmp_path, targets, 1)
    tick = (tmp_path / "data/bregenz/function/tick.mcfunction").read_text()
    assert "filled_map[minecraft:map_id=0]" in tick
    assert (tmp_path / "data/bregenz/function/tp/pfaender_gipfelkreuz.mcfunction").read_text().startswith("tp @s 2529 1064 -313")
    level.write_level(tmp_path, (1, 400, 2), (0.0, 0.0, 100.0), items)
    with gzip.open(tmp_path / "level.dat") as f:
        d = nbt.decode(f.read())[1]["Data"]
    assert d["Player"]["Inventory"][0]["components"]["minecraft:map_id"] == 0


# ------------------------------------------------------------- signs & builds
def test_street_name_wrapping():
    from bregenz.signs import wrap
    assert wrap("Kornmarktstraße") == ["Kornmarktstraße"]
    assert wrap("Heldendankstraße") == ["Heldendank-", "straße"]
    assert all(len(line) <= 15 for line in wrap("Vorarlberger Landesbibliothek Fluherstraße"))
    assert wrap("Platz der Wiener Symphoniker") == ["Platz der", "Wiener", "Symphoniker"]


def test_circle_fit_and_connected_states():
    from bregenz import civic
    ang = np.linspace(0, np.pi, 9)
    cx, cz, r = civic._circle_fit(np.column_stack([3 + 8 * np.cos(ang), -2 + 8 * np.sin(ang)]))
    assert abs(cx - 3) < 1e-6 and abs(cz + 2) < 1e-6 and abs(r - 8) < 1e-6
    st = civic._connected({(0, 0), (1, 0), (1, 1)}, "birch_fence")
    assert st[(1, 0)] == "birch_fence[north=false,south=true,east=false,west=true]"


def test_only_real_orange_courts():
    import shapely
    from bregenz import details
    far = shapely.Point(5000, 5000).buffer(10)
    assert details._is_orange("multi", "tartan", far)
    assert details._is_orange("tennis", "clay", far)
    assert details._is_orange("running", "rubber", far)
    assert not details._is_orange("tennis", "rubber", far)
    assert not details._is_orange("multi", "", far)
    assert details._is_orange("multi", "", shapely.Point(-118, 510).buffer(10))   # BG Gallus (photo)
