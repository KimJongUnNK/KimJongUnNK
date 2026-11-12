"""Minimal, fast NBT (Named Binary Tag) encoder/decoder.

Python values map to NBT tags like this:
    dict -> Compound, str -> String, list -> List, bool -> Byte, int -> Int,
    float -> Double, numpy int64 array -> LongArray, int32 array -> IntArray,
    int8/uint8 array or bytes -> ByteArray.
Use the wrapper classes (Byte, Short, Long, Float, ...) to force a specific type.
"""
from __future__ import annotations

import gzip
import io
import struct

import numpy as np

TAG_END, TAG_BYTE, TAG_SHORT, TAG_INT, TAG_LONG, TAG_FLOAT, TAG_DOUBLE = range(7)
TAG_BYTE_ARRAY, TAG_STRING, TAG_LIST, TAG_COMPOUND, TAG_INT_ARRAY, TAG_LONG_ARRAY = range(7, 13)


class Byte(int):
    tag = TAG_BYTE


class Short(int):
    tag = TAG_SHORT


class Int(int):
    tag = TAG_INT


class Long(int):
    tag = TAG_LONG


class Float(float):
    tag = TAG_FLOAT


class Double(float):
    tag = TAG_DOUBLE


class List(list):
    """List with an explicit element tag (needed for empty lists)."""

    def __init__(self, items=(), elem_tag: int | None = None):
        super().__init__(items)
        self.elem_tag = elem_tag


class Raw(bytes):
    """Pre-encoded tag payload (used to cache identical sub-trees)."""

    def __new__(cls, tag: int, payload: bytes):
        obj = super().__new__(cls, payload)
        obj.tag = tag
        return obj


def tag_of(v) -> int:
    t = getattr(v, "tag", None)
    if t is not None:
        return t
    if isinstance(v, bool):
        return TAG_BYTE
    if isinstance(v, int):
        return TAG_INT
    if isinstance(v, float):
        return TAG_DOUBLE
    if isinstance(v, str):
        return TAG_STRING
    if isinstance(v, dict):
        return TAG_COMPOUND
    if isinstance(v, list):
        return TAG_LIST
    if isinstance(v, (bytes, bytearray)):
        return TAG_BYTE_ARRAY
    if isinstance(v, np.ndarray):
        if v.dtype == np.int64:
            return TAG_LONG_ARRAY
        if v.dtype == np.int32:
            return TAG_INT_ARRAY
        if v.dtype in (np.int8, np.uint8):
            return TAG_BYTE_ARRAY
    raise TypeError(f"cannot map {type(v)!r} to an NBT tag")


_S = struct.Struct


def _str(s: str) -> bytes:
    b = s.encode("utf-8")
    return _S(">H").pack(len(b)) + b


def payload(v, tag: int | None = None) -> bytes:
    if tag is None:
        tag = tag_of(v)
    if isinstance(v, Raw):
        return bytes(v)
    if tag == TAG_BYTE:
        return _S(">b").pack(int(v))
    if tag == TAG_SHORT:
        return _S(">h").pack(int(v))
    if tag == TAG_INT:
        return _S(">i").pack(int(v))
    if tag == TAG_LONG:
        return _S(">q").pack(int(v))
    if tag == TAG_FLOAT:
        return _S(">f").pack(float(v))
    if tag == TAG_DOUBLE:
        return _S(">d").pack(float(v))
    if tag == TAG_STRING:
        return _str(v)
    if tag == TAG_BYTE_ARRAY:
        b = bytes(np.asarray(v, dtype=np.int8).tobytes()) if isinstance(v, np.ndarray) else bytes(v)
        return _S(">i").pack(len(b)) + b
    if tag == TAG_INT_ARRAY:
        a = np.asarray(v, dtype=">i4")
        return _S(">i").pack(a.size) + a.tobytes()
    if tag == TAG_LONG_ARRAY:
        a = np.asarray(v, dtype=">i8")
        return _S(">i").pack(a.size) + a.tobytes()
    if tag == TAG_LIST:
        et = getattr(v, "elem_tag", None)
        if et is None:
            et = tag_of(v[0]) if len(v) else TAG_END
        parts = [_S(">bi").pack(et, len(v))]
        parts.extend(payload(x, et) for x in v)
        return b"".join(parts)
    if tag == TAG_COMPOUND:
        parts = []
        for k, x in v.items():
            t = tag_of(x)
            parts.append(_S(">b").pack(t))
            parts.append(_str(k))
            parts.append(payload(x, t))
        parts.append(b"\x00")
        return b"".join(parts)
    raise ValueError(f"bad tag {tag}")


def encode(root: dict, name: str = "") -> bytes:
    """Encode a root compound (uncompressed)."""
    return b"\x0a" + _str(name) + payload(root, TAG_COMPOUND)


def write_gzip(path, root: dict, name: str = "") -> None:
    with open(path, "wb") as f:
        f.write(gzip.compress(encode(root, name), compresslevel=6, mtime=0))


# ---------------------------------------------------------------- decoding
class _Reader:
    def __init__(self, data: bytes):
        self.b = io.BytesIO(data)

    def read(self, fmt):
        s = _S(fmt)
        return s.unpack(self.b.read(s.size))[0]

    def string(self):
        n = self.read(">H")
        return self.b.read(n).decode("utf-8")

    def value(self, tag):
        if tag == TAG_BYTE:
            return Byte(self.read(">b"))
        if tag == TAG_SHORT:
            return Short(self.read(">h"))
        if tag == TAG_INT:
            return Int(self.read(">i"))
        if tag == TAG_LONG:
            return Long(self.read(">q"))
        if tag == TAG_FLOAT:
            return Float(self.read(">f"))
        if tag == TAG_DOUBLE:
            return Double(self.read(">d"))
        if tag == TAG_BYTE_ARRAY:
            n = self.read(">i")
            return np.frombuffer(self.b.read(n), dtype=np.int8).copy()
        if tag == TAG_STRING:
            return self.string()
        if tag == TAG_LIST:
            et = self.read(">b")
            n = self.read(">i")
            return List([self.value(et) for _ in range(n)], et)
        if tag == TAG_COMPOUND:
            d = {}
            while True:
                t = self.read(">b")
                if t == TAG_END:
                    return d
                k = self.string()
                d[k] = self.value(t)
        if tag == TAG_INT_ARRAY:
            n = self.read(">i")
            return np.frombuffer(self.b.read(4 * n), dtype=">i4").astype(np.int32)
        if tag == TAG_LONG_ARRAY:
            n = self.read(">i")
            return np.frombuffer(self.b.read(8 * n), dtype=">i8").astype(np.int64)
        raise ValueError(f"bad tag {tag}")


def decode(data: bytes) -> tuple[str, dict]:
    r = _Reader(data)
    t = r.read(">b")
    if t != TAG_COMPOUND:
        raise ValueError("root is not a compound")
    name = r.string()
    return name, r.value(TAG_COMPOUND)


def read_gzip(path) -> tuple[str, dict]:
    with open(path, "rb") as f:
        return decode(gzip.decompress(f.read()))
