"""level.dat and the world datapack (taller overworld + Bregenz biomes)."""
from __future__ import annotations

import copy
import json
import time
from pathlib import Path

from . import config, nbt
from .world import BIOMES

VANILLA = Path(__file__).resolve().parent / "vanilla_26_3"

# grass / foliage colours are set explicitly because the biomes are "warm"
# (temperature 1.6) so that rain never turns into snow up at 1000 m and the lake never freezes.
BIOME_DEFS = {
    "bregenz:bodensee": dict(template="plains", water="#3a8fb0", grass="#91bd59", foliage="#77ab2f"),
    "bregenz:stadt": dict(template="plains", water="#3f76e4", grass="#91bd59", foliage="#77ab2f"),
    "bregenz:wald": dict(template="forest", water="#3f76e4", grass="#79c05a", foliage="#59ae30"),
    "bregenz:pfaender_alm": dict(template="meadow", water="#3f76e4", grass="#83bb6d", foliage="#63a948"),
}
BIOME_TEMPERATURE = 1.6

# the area outside the generated map: open lake at Bodensee level
OUTSIDE_LAYERS = [("minecraft:bedrock", 1), ("minecraft:stone", 441), ("minecraft:sand", 3), ("minecraft:water", 16)]


def dimension_type() -> dict:
    d = json.loads((VANILLA / "dimension_type_overworld.json").read_text())
    d["min_y"] = config.MIN_Y
    d["height"] = config.HEIGHT
    d["logical_height"] = config.HEIGHT
    d.setdefault("attributes", {})["minecraft:visual/cloud_height"] = config.CLOUD_HEIGHT
    return d


def biome(name: str) -> dict:
    spec = BIOME_DEFS[name]
    d = json.loads((VANILLA / f"biome_{spec['template']}.json").read_text())
    d = copy.deepcopy(d)
    d["temperature"] = BIOME_TEMPERATURE
    d["has_precipitation"] = True
    eff = d.setdefault("effects", {})
    eff["water_color"] = spec["water"]
    eff["grass_color"] = spec["grass"]
    eff["foliage_color"] = spec["foliage"]
    return d


def write_datapack(world_dir: Path) -> Path:
    root = world_dir / "datapacks" / "bregenz"
    (root / "data" / "minecraft" / "dimension_type").mkdir(parents=True, exist_ok=True)
    (root / "data" / "bregenz" / "worldgen" / "biome").mkdir(parents=True, exist_ok=True)
    mcmeta = {"pack": {
        "description": "Bregenz 1:1 - Welthoehe Y -64 bis 1215, Bregenz-Biome",
        "pack_format": config.PACK_FORMAT,
        "min_format": [config.PACK_FORMAT, 0],
        "max_format": [config.PACK_FORMAT + 4, 0],
    }}
    (root / "pack.mcmeta").write_text(json.dumps(mcmeta, indent=2))
    (root / "data" / "minecraft" / "dimension_type" / "overworld.json").write_text(json.dumps(dimension_type(), indent=2))
    for name in BIOMES:
        ns, path = name.split(":")
        (root / "data" / ns / "worldgen" / "biome" / f"{path}.json").write_text(json.dumps(biome(name), indent=2))
    return root


def player(spawn: tuple[int, int, int], items: list[dict]) -> dict:
    """The singleplayer host: standing at the spawn, creative, with the starter items."""
    return {
        "DataVersion": nbt.Int(config.DATA_VERSION),
        "Pos": nbt.List([nbt.Double(spawn[0] + 0.5), nbt.Double(spawn[1]), nbt.Double(spawn[2] + 0.5)], nbt.TAG_DOUBLE),
        "Rotation": nbt.List([nbt.Float(180.0), nbt.Float(0.0)], nbt.TAG_FLOAT),
        "Motion": nbt.List([nbt.Double(0), nbt.Double(0), nbt.Double(0)], nbt.TAG_DOUBLE),
        "Dimension": "minecraft:overworld",
        "playerGameType": nbt.Int(1),
        "Health": nbt.Float(20.0), "foodLevel": nbt.Int(20), "OnGround": nbt.Byte(1),
        "SelectedItemSlot": nbt.Int(0),
        "Inventory": nbt.List(items, nbt.TAG_COMPOUND),
    }


def level_dat(spawn: tuple[int, int, int], border: tuple[float, float, float], items: list[dict] | None = None) -> dict:
    cx, cz, size = border
    layers = nbt.List([{"block": b, "height": nbt.Int(h)} for b, h in OUTSIDE_LAYERS], nbt.TAG_COMPOUND)
    dims = {
        "minecraft:overworld": {
            "type": "minecraft:overworld",
            "generator": {"type": "minecraft:flat", "settings": {
                "biome": "bregenz:bodensee", "features": nbt.Byte(0), "lakes": nbt.Byte(0),
                "layers": layers, "structure_overrides": nbt.List([], nbt.TAG_STRING)}},
        },
        "minecraft:the_nether": {
            "type": "minecraft:the_nether",
            "generator": {"type": "minecraft:noise", "settings": "minecraft:nether",
                          "biome_source": {"type": "minecraft:multi_noise", "preset": "minecraft:nether"}},
        },
        "minecraft:the_end": {
            "type": "minecraft:the_end",
            "generator": {"type": "minecraft:noise", "settings": "minecraft:end",
                          "biome_source": {"type": "minecraft:the_end"}},
        },
    }
    now = int(time.time() * 1000)
    data = {
        "DataVersion": nbt.Int(config.DATA_VERSION),
        "version": nbt.Int(19133),
        "Version": {"Id": nbt.Int(config.DATA_VERSION), "Name": config.VERSION_NAME, "Series": "main", "Snapshot": nbt.Byte(0)},
        "LevelName": config.LEVEL_NAME,
        "GameType": nbt.Int(1),
        "Difficulty": nbt.Byte(1),
        "DifficultyLocked": nbt.Byte(0),
        "hardcore": nbt.Byte(0),
        "allowCommands": nbt.Byte(1),
        "initialized": nbt.Byte(1),
        "SpawnX": nbt.Int(spawn[0]), "SpawnY": nbt.Int(spawn[1]), "SpawnZ": nbt.Int(spawn[2]),
        "SpawnAngle": nbt.Float(0.0),
        "Time": nbt.Long(6000), "DayTime": nbt.Long(6000),
        "LastPlayed": nbt.Long(now),
        "raining": nbt.Byte(0), "rainTime": nbt.Int(120000), "thundering": nbt.Byte(0), "thunderTime": nbt.Int(180000),
        "clearWeatherTime": nbt.Int(0),
        "WanderingTraderSpawnChance": nbt.Int(25), "WanderingTraderSpawnDelay": nbt.Int(24000),
        "WasModded": nbt.Byte(0),
        "ServerBrands": nbt.List(["vanilla"], nbt.TAG_STRING),
        "DataPacks": {"Enabled": nbt.List(["vanilla", "file/bregenz"], nbt.TAG_STRING),
                      "Disabled": nbt.List([], nbt.TAG_STRING)},
        "enabled_features": nbt.List(["minecraft:vanilla"], nbt.TAG_STRING),
        "GameRules": {"spawnRadius": "0", "doFireTick": "false", "doInsomnia": "false"},
        "WorldGenSettings": {"seed": nbt.Long(config.SEED), "generate_features": nbt.Byte(0), "bonus_chest": nbt.Byte(0),
                             "dimensions": dims},
        "BorderCenterX": nbt.Double(cx), "BorderCenterZ": nbt.Double(cz), "BorderSize": nbt.Double(size),
        "BorderSafeZone": nbt.Double(5.0), "BorderWarningBlocks": nbt.Double(5.0), "BorderWarningTime": nbt.Double(15.0),
        "BorderDamagePerBlock": nbt.Double(0.2), "BorderSizeLerpTarget": nbt.Double(size), "BorderSizeLerpTime": nbt.Long(0),
        "CustomBossEvents": {},
        "ScheduledEvents": nbt.List([], nbt.TAG_COMPOUND),
    }
    if items:
        data["Player"] = player(spawn, items)
    return {"Data": data}


def write_level(world_dir: Path, spawn, border, items: list[dict] | None = None) -> None:
    nbt.write_gzip(world_dir / "level.dat", level_dat(spawn, border, items))
