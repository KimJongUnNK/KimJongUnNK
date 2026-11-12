"""The player's changes survive a regeneration: extract from a played world, lay over a new one."""
from __future__ import annotations

import gzip
import sys
import zlib
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bregenz import anvil, config, geo, level, nbt, useredits  # noqa: E402
from bregenz.blocks import REG  # noqa: E402
from bregenz.world import BIOMES, World  # noqa: E402

GROUND = 420


def _chunk(cx, cz, changes=(), bes=None, data_version=None):
    blocks = np.zeros((config.HEIGHT, 16, 16), dtype=np.uint16)
    blocks[: GROUND - config.MIN_Y + 1] = REG.id("stone")
    for (x, y, z), st in changes:
        blocks[y - config.MIN_Y, z & 15, x & 15] = REG.id(st)
    raw = anvil.chunk_bytes(cx, cz, blocks, BIOMES, np.zeros((4, 4), dtype=np.int64), bes or [])
    if data_version is not None:                    # as if the game had loaded and saved it
        _, ch = nbt.decode(raw)
        ch["DataVersion"] = nbt.Int(data_version)
        raw = nbt.encode(ch)
    return raw


def _world(path: Path, chunks: dict, player=False):
    (path / "region").mkdir(parents=True)
    w = anvil.RegionWriter(path / "region" / "r.0.0.mca")
    for (cx, cz), raw in chunks.items():
        w.add(cx, cz, raw)
    w.write()
    level.write_level(path, (1, GROUND + 1, 1), (0.0, 0.0, 100.0))
    if player:
        (path / "playerdata").mkdir()
        (path / "playerdata" / "me.dat").write_bytes(gzip.compress(b"x"))


def _sign(x, y, z, text):
    msg = nbt.List(['{"text":"%s"}' % text, '""', '""', '""'], nbt.TAG_STRING)
    return {"id": "minecraft:sign", "x": nbt.Int(x), "y": nbt.Int(y), "z": nbt.Int(z),
            "front_text": {"messages": msg}, "back_text": {"messages": msg}}


def test_extract_and_apply(tmp_path):
    base_sign = _sign(3, GROUND + 1, 3, "Kornmarkt")
    base = {(0, 0): _chunk(0, 0, [((3, GROUND + 1, 3), "oak_sign[rotation=0]")], [base_sign]),
            (1, 0): _chunk(1, 0), (2, 0): _chunk(2, 0)}
    _world(tmp_path / "base", base)
    # what the player did: a house wall, a hole, a renamed sign; chunk (2,0) loaded but untouched; a raft outside
    played = {
        (0, 0): _chunk(0, 0, [((3, GROUND + 1, 3), "oak_sign[rotation=0]"), ((5, GROUND + 1, 5), "bricks"),
                              ((5, GROUND + 2, 5), "bricks"), ((6, GROUND, 6), "air")],
                       [_sign(3, GROUND + 1, 3, "Mein Platz")], data_version=4600),
        (1, 0): base[(1, 0)],
        (2, 0): _chunk(2, 0, data_version=4600),
    }
    outside = np.zeros((config.HEIGHT, 16, 16), dtype=np.uint16)
    y = config.MIN_Y
    for blk, h in level.OUTSIDE_LAYERS:
        outside[y - config.MIN_Y: y - config.MIN_Y + h] = REG.id(blk.split(":")[1])
        y += h
    outside[config.WATER_LEVEL + 1 - config.MIN_Y, 4, 4] = REG.id("spruce_planks")
    played[(5, 5)] = anvil.chunk_bytes(5, 5, outside, BIOMES, np.zeros((4, 4), dtype=np.int64))
    _world(tmp_path / "played", played, player=True)

    out = tmp_path / "edits"
    s = useredits.extract(tmp_path / "played", tmp_path / "base", out, workers=1, log=lambda *a: None)
    assert s["changed_blocks"] == 3
    assert s["block_entities"] == 1          # only the sign with new text, not the untouched chunk
    assert s["extra_chunks"] == 1
    assert (out / "files" / "playerdata" / "me.dat").exists()

    # lay over a freshly generated world
    g = geo.Grid(0, 0, 48, 16)
    w = World(g)
    w.edits.block_entity(_sign(3, GROUND + 1, 3, "Kornmarkt"))
    useredits.apply_blocks(w, out, log=lambda *a: None)
    e = w.edits.finalize(g)
    got = {(int(x), int(y), int(z)): REG.state(int(i)) for x, y, z, i in zip(e.xs, e.ys, e.zs, e.ids)}
    assert got[(5, GROUND + 1, 5)] == "minecraft:bricks"
    assert got[(6, GROUND, 6)] == "minecraft:air"
    signs = e.bes[(0, 0)]
    assert len(signs) == 1 and "Mein Platz" in signs[0]["front_text"]["messages"][0]

    # outside chunk + player files restored into the new world folder
    new = tmp_path / "new"
    _world(new, {(0, 0): base[(0, 0)]})
    useredits.apply_files(new, out, log=lambda *a: None)
    chunks = useredits.read_chunks(new / "region" / "r.0.0.mca")
    assert set(chunks) == {(0, 0), (5, 5)}
    assert (new / "playerdata" / "me.dat").exists()


def test_reads_all_compressions(tmp_path):
    raw = _chunk(0, 0)
    for comp, blob in ((1, gzip.compress(raw)), (2, zlib.compress(raw)), (3, raw)):
        assert useredits._decompress(comp, blob) == raw
