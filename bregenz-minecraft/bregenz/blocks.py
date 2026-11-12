"""Block-state registry: maps block state strings to small integer ids.

State strings use the familiar command syntax, e.g. ``oak_stairs[facing=east,half=top]``.
Unspecified properties fall back to the block's defaults when Minecraft loads the chunk.
"""
from __future__ import annotations

from . import nbt


def parse_state(state: str) -> tuple[str, dict[str, str]]:
    state = state.strip()
    props: dict[str, str] = {}
    if "[" in state:
        name, rest = state.split("[", 1)
        rest = rest.rstrip("]")
        for kv in filter(None, rest.split(",")):
            k, v = kv.split("=")
            props[k.strip()] = v.strip()
    else:
        name = state
    if ":" not in name:
        name = "minecraft:" + name
    return name, dict(sorted(props.items()))


def format_state(name: str, props: dict[str, str]) -> str:
    if not props:
        return name
    return name + "[" + ",".join(f"{k}={v}" for k, v in sorted(props.items())) + "]"


class Registry:
    def __init__(self) -> None:
        self.states: list[tuple[str, dict[str, str]]] = []
        self._ids: dict[str, int] = {}
        self._palette_payload: list[bytes] = []
        self.id("air")  # id 0 is always air

    def id(self, state: str) -> int:
        i = self._ids.get(state)
        if i is not None:
            return i
        name, props = parse_state(state)
        canon = format_state(name, props)
        i = self._ids.get(canon)
        if i is None:
            i = len(self.states)
            if i > 65535:
                raise OverflowError("too many block states")
            self.states.append((name, props))
            self._ids[canon] = i
            entry = {"Name": name}
            if props:
                entry["Properties"] = dict(props)
            self._palette_payload.append(nbt.payload(entry, nbt.TAG_COMPOUND))
        self._ids[state] = i
        return i

    __call__ = id

    def name(self, i: int) -> str:
        return self.states[i][0]

    def state(self, i: int) -> str:
        return format_state(*self.states[i])

    def palette_payload(self, i: int) -> bytes:
        return self._palette_payload[i]

    def __len__(self) -> int:
        return len(self.states)


# One global registry shared by every module (ids are stable within a run).
REG = Registry()
B = REG.id
AIR = 0
