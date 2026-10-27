"""Anvil chunk + region file writer (Java Edition, chunk format of 1.18+).

Chunks are written as fully generated ("minecraft:full") with lighting marked
as not computed, so the game lights them itself on first load. Heightmaps are
omitted on purpose: Minecraft recomputes missing heightmaps when it loads a chunk.
"""
from __future__ import annotations

import struct
import zlib

import numpy as np

from . import config, nbt
from .blocks import REG

SECTION_COUNT = config.HEIGHT // 16
MIN_SECTION = config.MIN_Y // 16


# ------------------------------------------------------------------ bit packing
def bits_for_blocks(n: int) -> int:
    return max(4, (n - 1).bit_length())


def bits_for_biomes(n: int) -> int:
    return max(1, (n - 1).bit_length())


def pack(values: np.ndarray, bits: int) -> np.ndarray:
    """Pack small unsigned ints into longs; values never straddle two longs (1.16+ layout)."""
    per_long = 64 // bits
    n = values.size
    n_longs = -(-n // per_long)
    padded = np.zeros(n_longs * per_long, dtype=np.uint64)
    padded[:n] = values
    padded = padded.reshape(n_longs, per_long)
    shifts = (np.arange(per_long, dtype=np.uint64) * np.uint64(bits))
    longs = np.bitwise_or.reduce(padded << shifts, axis=1)
    return longs.view(np.int64)


def unpack(longs: np.ndarray, bits: int, n: int) -> np.ndarray:
    per_long = 64 // bits
    u = np.asarray(longs, dtype=np.int64).view(np.uint64)
    shifts = (np.arange(per_long, dtype=np.uint64) * np.uint64(bits))
    mask = np.uint64((1 << bits) - 1)
    vals = (u[:, None] >> shifts[None, :]) & mask
    return vals.reshape(-1)[:n].astype(np.int64)


# ------------------------------------------------------------- section encoding
_T = nbt


def _named(tag: int, name: str, payload: bytes) -> bytes:
    b = name.encode()
    return struct.pack(">bH", tag, len(b)) + b + payload


def _palette_list(ids) -> bytes:
    parts = [struct.pack(">bi", nbt.TAG_COMPOUND, len(ids))]
    parts.extend(REG.palette_payload(int(i)) for i in ids)
    return b"".join(parts)


_uniform_cache: dict[int, bytes] = {}


def block_states_payload(sec: np.ndarray) -> bytes:
    """sec: uint16 global ids, shape (16,16,16) indexed [y, z, x]."""
    flat = sec.reshape(-1)
    first = flat[0]
    if (flat == first).all():
        p = _uniform_cache.get(int(first))
        if p is None:
            p = _named(nbt.TAG_LIST, "palette", _palette_list([first])) + b"\x00"
            _uniform_cache[int(first)] = p
        return p
    pal, inv = np.unique(flat, return_inverse=True)
    bits = bits_for_blocks(len(pal))
    data = pack(inv.astype(np.uint64), bits)
    return (
        _named(nbt.TAG_LIST, "palette", _palette_list(pal))
        + _named(nbt.TAG_LONG_ARRAY, "data", nbt.payload(data, nbt.TAG_LONG_ARRAY))
        + b"\x00"
    )


def biomes_payload(biome_names: list[str], grid: np.ndarray) -> bytes:
    """grid: (4,4,4) [y,z,x] indices into biome_names (already compacted)."""
    pal = nbt.List(biome_names, nbt.TAG_STRING)
    out = _named(nbt.TAG_LIST, "palette", nbt.payload(pal, nbt.TAG_LIST))
    if len(biome_names) > 1:
        data = pack(grid.reshape(-1).astype(np.uint64), bits_for_biomes(len(biome_names)))
        out += _named(nbt.TAG_LONG_ARRAY, "data", nbt.payload(data, nbt.TAG_LONG_ARRAY))
    return out + b"\x00"


def section_payload(y: int, block_states: bytes, biomes: bytes) -> bytes:
    return (
        _named(nbt.TAG_BYTE, "Y", struct.pack(">b", y))
        + _named(nbt.TAG_COMPOUND, "block_states", block_states)
        + _named(nbt.TAG_COMPOUND, "biomes", biomes)
        + b"\x00"
    )


def chunk_bytes(cx: int, cz: int, blocks: np.ndarray, biome_names: list[str], biome_grid: np.ndarray,
                block_entities: list[dict] | None = None) -> bytes:
    """Encode a complete chunk.

    blocks: uint16 array (HEIGHT, 16, 16) indexed [y - MIN_Y, z, x]
    biome_grid: (4, 4) [z, x] indices into biome_names (constant over height)
    """
    used = np.unique(biome_grid)
    names = [biome_names[i] for i in used]
    remap = np.zeros(max(len(biome_names), 1), dtype=np.int64)
    remap[used] = np.arange(len(used))
    grid3 = np.broadcast_to(remap[biome_grid][None, :, :], (4, 4, 4))
    bio = biomes_payload(names, grid3)
    sections = []
    for k in range(SECTION_COUNT):
        sec = blocks[k * 16:(k + 1) * 16]
        sections.append(nbt.Raw(nbt.TAG_COMPOUND, section_payload(MIN_SECTION + k, block_states_payload(sec), bio)))
    root = {
        "DataVersion": nbt.Int(config.DATA_VERSION),
        "xPos": nbt.Int(cx),
        "zPos": nbt.Int(cz),
        "yPos": nbt.Int(MIN_SECTION),
        "Status": "minecraft:full",
        "LastUpdate": nbt.Long(0),
        "InhabitedTime": nbt.Long(0),
        "isLightOn": nbt.Byte(0),
        "sections": nbt.List(sections, nbt.TAG_COMPOUND),
        "block_entities": nbt.List(block_entities or [], nbt.TAG_COMPOUND),
        "Heightmaps": {},
        "fluid_ticks": nbt.List([], nbt.TAG_COMPOUND),
        "block_ticks": nbt.List([], nbt.TAG_COMPOUND),
        "PostProcessing": nbt.List([nbt.List([], nbt.TAG_SHORT) for _ in range(SECTION_COUNT)], nbt.TAG_LIST),
        "structures": {"References": {}, "starts": {}},
    }
    return nbt.encode(root)


# ------------------------------------------------------------------- regions
class RegionWriter:
    def __init__(self, path):
        self.path = path
        self.chunks: dict[tuple[int, int], bytes] = {}

    def add(self, cx: int, cz: int, raw_nbt: bytes, level: int = 6) -> None:
        self.chunks[(cx & 31, cz & 31)] = zlib.compress(raw_nbt, level)

    def write(self) -> None:
        offsets = bytearray(4096)
        stamps = bytearray(4096)
        body = bytearray()
        sector = 2
        for (lx, lz), data in sorted(self.chunks.items(), key=lambda kv: (kv[0][1], kv[0][0])):
            blob = struct.pack(">IB", len(data) + 1, 2) + data
            n = -(-len(blob) // 4096)
            if n > 255:
                raise ValueError(f"chunk {lx},{lz} too large ({len(blob)} bytes)")
            blob += b"\x00" * (n * 4096 - len(blob))
            i = 4 * (lx + 32 * lz)
            offsets[i:i + 4] = struct.pack(">I", (sector << 8) | n)
            stamps[i:i + 4] = struct.pack(">I", 0)
            body += blob
            sector += n
        with open(self.path, "wb") as f:
            f.write(offsets)
            f.write(stamps)
            f.write(body)


def read_region(path) -> dict[tuple[int, int], dict]:
    """Decode every chunk of a region file (used by tests and verification)."""
    with open(path, "rb") as f:
        data = f.read()
    out = {}
    for i in range(1024):
        loc = struct.unpack(">I", data[4 * i:4 * i + 4])[0]
        if not loc:
            continue
        off, n = loc >> 8, loc & 0xFF
        start = off * 4096
        length, comp = struct.unpack(">IB", data[start:start + 5])
        assert comp == 2, comp
        raw = zlib.decompress(data[start + 5:start + 4 + length])
        out[(i % 32, i // 32)] = nbt.decode(raw)[1]
    return out


def decode_section_blocks(section: dict) -> tuple[list[str], np.ndarray]:
    """Return (palette names with properties, (16,16,16) index array [y,z,x])."""
    bs = section["block_states"]
    pal = []
    for e in bs["palette"]:
        props = e.get("Properties")
        pal.append(e["Name"] + ("[" + ",".join(f"{k}={v}" for k, v in sorted(props.items())) + "]" if props else ""))
    if "data" not in bs:
        return pal, np.zeros((16, 16, 16), dtype=np.int64)
    idx = unpack(bs["data"], bits_for_blocks(len(pal)), 4096)
    return pal, idx.reshape(16, 16, 16)
