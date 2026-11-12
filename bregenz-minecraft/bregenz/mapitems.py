"""In-game items: pre-rendered (locked) maps of Bregenz, a teleport book, and datapack functions
that keep the overview map in the inventory and teleport to every landmark."""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

import numpy as np
from PIL import Image

from . import config, nbt, render

# Minecraft map base colours (index = MapColor id); shade multipliers 180/220/255/135 per 255.
MAP_BASE = [
    None, (127, 178, 56), (247, 233, 163), (199, 199, 199), (255, 0, 0), (160, 160, 255), (167, 167, 167),
    (0, 124, 0), (255, 255, 255), (164, 168, 184), (151, 109, 77), (112, 112, 112), (64, 64, 255), (143, 119, 72),
    (255, 252, 245), (216, 127, 51), (178, 76, 216), (102, 153, 216), (229, 229, 51), (127, 204, 25),
    (242, 127, 165), (76, 76, 76), (153, 153, 153), (76, 127, 153), (127, 63, 178), (51, 76, 178), (102, 76, 51),
    (102, 127, 51), (153, 51, 51), (25, 25, 25), (250, 238, 77), (92, 219, 213), (74, 128, 255), (0, 217, 58),
    (129, 86, 49), (112, 2, 0), (209, 177, 161), (159, 82, 36), (149, 87, 108), (112, 108, 138), (186, 133, 36),
    (103, 117, 53), (160, 77, 78), (57, 41, 35), (135, 107, 98), (87, 92, 92), (122, 73, 88), (76, 62, 92),
    (76, 50, 35), (76, 82, 42), (142, 60, 46), (37, 22, 16), (189, 48, 49), (148, 63, 97), (92, 25, 29),
    (22, 126, 134), (58, 142, 140), (86, 44, 62), (20, 180, 133), (100, 100, 100), (216, 175, 147), (127, 167, 150),
]
SHADES = (180, 220, 255, 135)

# (name, centre x, centre z, scale) -- scale 4 = 2048 blocks across, 2 = 512, 1 = 256
MAPS = [
    ("Bregenz – Stadt & See", -250, 350, 4),
    ("Pfänder", 1650, 0, 4),
    ("Innenstadt & Hafen", 40, 0, 2),
    ("Oberstadt", 180, 470, 1),
]


def _palette():
    ids, cols = [], []
    for base, rgb in enumerate(MAP_BASE):
        if rgb is None:
            continue
        for shade in (0, 1, 2):
            m = SHADES[shade] / 255.0
            ids.append(base * 4 + shade)
            cols.append([c * m for c in rgb])
    return np.array(ids, dtype=np.int64), np.array(cols, dtype=np.float32)


def map_colors(rgb: np.ndarray) -> np.ndarray:
    """RGB image (128x128x3) -> map colour bytes (nearest palette entry)."""
    ids, cols = _palette()
    flat = rgb.reshape(-1, 3).astype(np.float32)
    d = ((flat[:, None, :] - cols[None, :, :]) ** 2).sum(axis=2)
    idx = ids[np.argmin(d, axis=1)]
    return idx.astype(np.uint8).view(np.int8)


def render_maps(world, edits, data_dir: Path) -> list[dict]:
    g = world.grid
    data_dir.mkdir(parents=True, exist_ok=True)
    out = []
    for map_id, (name, cx, cz, scale) in enumerate(MAPS):
        size = 128 * (2 ** scale)
        x0, z0 = cx - size // 2, cz - size // 2
        # crop the part inside the generated area, pad the rest with lake
        xa, za = max(x0, g.x0), max(z0, g.z0)
        xb, zb = min(x0 + size, g.x1), min(z0 + size, g.z1)
        canvas = Image.new("RGB", (size, size), (55, 105, 190))
        if xb > xa and zb > za:
            img = render.map_image(world, edits, 1, (xa, za, xb, zb))
            canvas.paste(img, (xa - x0, za - z0))
        small = np.asarray(canvas.resize((128, 128), Image.LANCZOS))
        colors = map_colors(small)
        root = {"DataVersion": nbt.Int(config.DATA_VERSION), "data": {
            "scale": nbt.Byte(scale), "dimension": "minecraft:overworld", "trackingPosition": nbt.Byte(1),
            "unlimitedTracking": nbt.Byte(0), "locked": nbt.Byte(1), "xCenter": nbt.Int(cx), "zCenter": nbt.Int(cz),
            "banners": nbt.List([], nbt.TAG_COMPOUND), "frames": nbt.List([], nbt.TAG_COMPOUND),
            "colors": np.asarray(colors, dtype=np.int8)}}
        nbt.write_gzip(data_dir / f"map_{map_id}.dat", root)
        out.append({"id": map_id, "name": name})
    nbt.write_gzip(data_dir / "idcounts.dat", {"DataVersion": nbt.Int(config.DATA_VERSION),
                                               "data": {"map": nbt.Int(len(MAPS) - 1)}})
    return out


def slug(name: str) -> str:
    s = name.lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s or "ort"


def teleport_targets(markers: dict) -> list[tuple[str, str, tuple[int, int, int]]]:
    seen = set()
    out = []
    for name, (x, y, z) in sorted(markers.items(), key=lambda kv: kv[0].lower()):
        sl = slug(name)
        while sl in seen:
            sl += "_2"
        seen.add(sl)
        out.append((name, sl, (int(x), int(y) + 1, int(z))))
    return out


def inventory(maps: list[dict], targets) -> list[dict]:
    """1.21.4-format item stacks (the game upgrades them): maps in the hotbar + the teleport book."""
    items = []
    for i, m in enumerate(maps):
        items.append({"Slot": nbt.Byte(i), "id": "minecraft:filled_map", "count": nbt.Int(1),
                      "components": {"minecraft:map_id": nbt.Int(m["id"]),
                                     "minecraft:custom_name": json.dumps({"text": m["name"], "italic": False})}})
    pages = []
    per_page = 11
    for p in range(0, len(targets), per_page):
        extra = [{"text": "Bregenz 1:1 – Teleport\n\n" if p == 0 else "", "bold": True}]
        for name, sl, (x, y, z) in targets[p:p + per_page]:
            extra.append({"text": f"▶ {name}\n", "color": "dark_blue",
                          "clickEvent": {"action": "run_command", "value": f"/tp @s {x} {y} {z}"},
                          "hoverEvent": {"action": "show_text", "contents": f"/tp @s {x} {y} {z}"}})
        pages.append(json.dumps({"text": "", "extra": extra}, ensure_ascii=False))
    items.append({"Slot": nbt.Byte(len(maps)), "id": "minecraft:written_book", "count": nbt.Int(1),
                  "components": {"minecraft:written_book_content": {
                      "title": {"raw": "Bregenz Teleporter"}, "author": "Claude",
                      "pages": nbt.List([{"raw": pg} for pg in pages], nbt.TAG_COMPOUND),
                      "resolved": nbt.Byte(1)}}})
    return items


def write_functions(datapack_root: Path, targets, n_maps: int) -> None:
    fn = datapack_root / "data" / "bregenz" / "function"
    (fn / "tp").mkdir(parents=True, exist_ok=True)
    tags = datapack_root / "data" / "minecraft" / "tags" / "function"
    tags.mkdir(parents=True, exist_ok=True)
    # keep the overview map in every player's inventory
    (fn / "tick.mcfunction").write_text(
        "execute as @a unless items entity @s container.* minecraft:filled_map[minecraft:map_id=0] "
        "unless items entity @s weapon.offhand minecraft:filled_map[minecraft:map_id=0] "
        "run give @s minecraft:filled_map[minecraft:map_id=0]\n", encoding="utf-8")
    (tags / "tick.json").write_text(json.dumps({"values": [{"id": "bregenz:tick", "required": False}]}, indent=2))
    (fn / "karten.mcfunction").write_text(
        "".join(f"give @s minecraft:filled_map[minecraft:map_id={i}]\n" for i in range(n_maps)), encoding="utf-8")
    lines = ["tellraw @s \"--- Bregenz 1:1: /function bregenz:tp/<ort> ---\""]
    for name, sl, (x, y, z) in targets:
        (fn / "tp" / f"{sl}.mcfunction").write_text(f"tp @s {x} {y} {z}\n", encoding="utf-8")
        lines.append(f"tellraw @s \"bregenz:tp/{sl}  ->  {name.replace(chr(34), '')}\"")
    (fn / "hilfe.mcfunction").write_text("\n".join(lines) + "\n", encoding="utf-8")
