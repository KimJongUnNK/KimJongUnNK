"""End-to-end: generate a small piece of the city and read it back like the game would."""
from __future__ import annotations

import gzip
import json
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))

import generate  # noqa: E402
from bregenz import config, nbt  # noqa: E402

pytestmark = pytest.mark.skipif(not (ROOT / "data" / "raw" / "overture" / "building.parquet").exists(),
                                reason="geodata not downloaded (python -m bregenz.fetch)")


@pytest.fixture(scope="module")
def small_world(tmp_path_factory):
    out = tmp_path_factory.mktemp("w") / "Bregenz_test"
    prev = tmp_path_factory.mktemp("p")
    # Kornmarkt / KUB / harbour / Oberstadt
    rc = generate.main(["--bbox", "9.744", "47.499", "9.752", "47.5075", "--out", str(out), "--previews", str(prev),
                        "--no-zip", "--workers", "2"])
    assert rc == 0
    return out, prev


def test_world_files(small_world):
    out, prev = small_world
    assert (out / "level.dat").exists() and (out / "icon.png").exists()
    assert (out / "datapacks" / "bregenz" / "pack.mcmeta").exists()
    regions = list((out / "region").glob("r.*.*.mca"))
    assert regions
    for r in regions:
        assert r.stat().st_size % 4096 == 0
    stats = json.loads((prev / "stats.json").read_text())
    assert stats["buildings"] > 200
    assert "kunsthaus" in stats["landmarks"] and "martinsturm" in stats["landmarks"]


def test_blocks_read_back(small_world):
    import iso_render
    out, _ = small_world
    with gzip.open(out / "level.dat") as f:
        d = nbt.decode(f.read())[1]["Data"]
    sx, sy, sz = d["SpawnX"], d["SpawnY"], d["SpawnZ"]
    ids, names = iso_render.load_box(out, sx - 2, sy - 3, sz - 2, sx + 2, sy + 3, sz + 2)
    col = [names[i] for i in ids[:, 2, 2]]
    # spawn stands on solid ground with free air above
    assert not col[2].startswith("minecraft:air") and col[3] == "minecraft:air" and col[4] == "minecraft:air"
    assert config.WATER_LEVEL < sy < 420


def test_kub_is_glass(small_world):
    import iso_render
    out, prev = small_world
    m = json.loads((prev / "stats.json").read_text())["markers"]
    x, y, z = m["Kunsthaus Bregenz (KUB)"]
    ids, names = iso_render.load_box(out, x - 16, y - 32, z - 16, x + 16, y - 1, z + 16)
    found = {names[i] for i in np.unique(ids)}
    assert "minecraft:white_stained_glass" in found
