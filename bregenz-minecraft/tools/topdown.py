"""Top-down view of the finished world, read back from the .mca region files: the highest visible
block of every column, coloured like the block, shaded by height (like a Minecraft map, 1 px = 1 block).

    python tools/topdown.py output/Bregenz_1zu1          # -> output/topdown/*.png
"""
from __future__ import annotations

import argparse
import multiprocessing as mp
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from bregenz import anvil, config, geo  # noqa: E402
from bregenz.render import BASE_COLORS, WORD_COLORS  # noqa: E402

Image.MAX_IMAGE_PIXELS = None

# thin or invisible from above: look through them
SKIP = ("air", "light", "cave_air", "void_air", "barrier", "short_grass", "tall_grass", "fern", "large_fern", "chain",
        "lightning_rod", "iron_bars", "rail", "powered_rail", "_sign", "_wall_sign", "end_rod", "candle", "torch",
        "redstone_wire", "tripwire", "glass_pane", "stained_glass_pane", "_banner", "vine", "ladder")

# approximate average texture colours of the blocks used in the world
COLORS = {
    **BASE_COLORS,
    "oxidized_copper": (82, 162, 132), "oxidized_cut_copper": (79, 153, 126), "oxidized_cut_copper_slab": (79, 153, 126),
    "oxidized_cut_copper_stairs": (79, 153, 126), "waxed_exposed_copper_grate": (135, 107, 86),
    "orange_terracotta": (161, 83, 37), "pink_terracotta": (161, 78, 78), "yellow_terracotta": (186, 133, 35),
    "white_terracotta": (209, 178, 161), "light_gray_terracotta": (135, 107, 98), "cyan_terracotta": (87, 91, 91),
    "lime_terracotta": (103, 117, 52), "light_blue_terracotta": (113, 108, 137), "green_terracotta": (76, 83, 42),
    "red_terracotta": (143, 61, 46), "brown_terracotta": (77, 51, 35), "black_terracotta": (37, 22, 16),
    "gray_terracotta": (57, 42, 35), "terracotta": (152, 94, 67),
    "bricks": (150, 97, 83), "brick_slab": (150, 97, 83), "brick_stairs": (150, 97, 83),
    "deepslate_tiles": (54, 54, 55), "deepslate_tile_slab": (54, 54, 55), "deepslate_tile_stairs": (54, 54, 55),
    "red_nether_bricks": (69, 7, 9), "mud_bricks": (137, 103, 79), "granite": (149, 103, 85),
    "smooth_sandstone": (223, 214, 170), "sandstone": (216, 203, 155), "cut_sandstone": (217, 206, 159),
    "smooth_red_sandstone": (181, 97, 31), "red_sand": (190, 102, 33),
    "smooth_stone": (159, 159, 159), "smooth_stone_slab": (159, 159, 159), "stone_brick_slab": (122, 121, 122),
    "polished_andesite_slab": (132, 135, 134), "polished_blackstone_wall": (53, 48, 56), "blackstone": (42, 36, 41),
    "white_concrete": (207, 213, 214), "light_gray_concrete": (125, 125, 115), "gray_concrete": (54, 57, 61),
    "black_concrete": (8, 10, 15), "orange_concrete": (224, 97, 0), "blue_concrete": (44, 46, 143),
    "white_concrete_powder": (225, 227, 228), "calcite": (223, 224, 220), "smooth_quartz": (235, 229, 222),
    "quartz_bricks": (234, 229, 221), "diorite_wall": (188, 188, 188),
    "glass": (200, 220, 230), "white_stained_glass": (240, 240, 240), "light_blue_stained_glass": (100, 150, 210),
    "light_gray_stained_glass": (150, 150, 150), "gray_stained_glass": (75, 75, 75), "black_stained_glass": (25, 25, 25),
    "cyan_stained_glass": (75, 125, 150), "tinted_glass": (44, 38, 46),
    "spruce_planks": (114, 84, 48), "spruce_slab": (114, 84, 48), "spruce_stairs": (114, 84, 48),
    "dark_oak_planks": (66, 43, 20), "dark_oak_slab": (66, 43, 20), "dark_oak_stairs": (66, 43, 20),
    "oak_planks": (162, 130, 78), "oak_slab": (162, 130, 78), "birch_planks": (192, 175, 121), "birch_slab": (192, 175, 121),
    "mangrove_stairs": (117, 54, 48), "gold_block": (246, 208, 61), "raw_gold_block": (221, 169, 46),
    "iron_block": (220, 220, 220), "sea_lantern": (172, 199, 190), "bookshelf": (117, 94, 59),
    "oak_leaves": (60, 110, 35), "birch_leaves": (100, 140, 60), "spruce_leaves": (55, 85, 55), "dark_oak_leaves": (50, 95, 30),
    "grass_block": (110, 160, 70), "moss_block": (89, 110, 45), "podzol": (91, 63, 24), "farmland": (120, 80, 50),
    "water": (55, 105, 190), "sand": (219, 207, 163), "gravel": (131, 127, 126), "snow": (240, 250, 250),
}


def skip(name: str) -> bool:
    base = name.split("[")[0].split(":")[-1]
    return any(base == s or (s.startswith("_") and base.endswith(s)) or base.endswith("_" + s) for s in SKIP)


def color(name: str):
    base = name.split("[")[0].split(":")[-1]
    if base in COLORS:
        return COLORS[base]
    for suf in ("_slab", "_stairs", "_wall", "_fence", "_carpet", "_trapdoor", "_door"):
        if base.endswith(suf):
            for cand in (base[: -len(suf)], base[: -len(suf)] + "s", base[: -len(suf)] + "_planks"):
                if cand in COLORS:
                    return COLORS[cand]
    for w, c in WORD_COLORS:
        if w in base:
            return c
    return (128, 128, 128)


def region_top(path: str):
    """For one region: top visible block name id, its Y and the water depth for every column."""
    chunks = anvil.read_region(path)
    names: dict[str, int] = {}
    top = np.zeros((512, 512), np.int32)
    ty = np.full((512, 512), -64, np.int16)
    depth = np.zeros((512, 512), np.int16)
    for (cx, cz), ch in chunks.items():
        lx, lz = (cx & 31) * 16, (cz & 31) * 16
        open_ = np.ones((16, 16), bool)          # still looking for the top block
        inwater = np.zeros((16, 16), bool)       # found water, now looking for the bottom
        wtop = np.zeros((16, 16), np.int16)
        for sec in sorted(ch["sections"], key=lambda s: -s["Y"]):
            pal = [e["Name"] for e in sec["block_states"]["palette"]]
            if all(skip(n) for n in pal):
                continue
            pal_full, idx = anvil.decode_section_blocks(sec)
            vis = np.array([not skip(n) for n in pal_full])
            isw = np.array([n.split("[")[0].endswith(":water") for n in pal_full])
            for yy in range(15, -1, -1):
                row = idx[yy]                      # [z, x]
                v = vis[row]
                w = isw[row]
                y = sec["Y"] * 16 + yy
                hit = open_ & v
                if hit.any():
                    gid = np.array([names.setdefault(n, len(names)) for n in pal_full])
                    top[lz:lz + 16, lx:lx + 16][hit] = gid[row][hit]
                    ty[lz:lz + 16, lx:lx + 16][hit] = y
                    wt = hit & w
                    inwater |= wt
                    wtop[wt] = y
                    open_ &= ~hit
                bottom = inwater & v & ~w
                if bottom.any():
                    depth[lz:lz + 16, lx:lx + 16][bottom] = (wtop - y)[bottom]
                    inwater &= ~bottom
                if not open_.any() and not inwater.any():
                    break
            if not open_.any() and not inwater.any():
                break
    rx, rz = (int(v) for v in Path(path).stem.split(".")[1:3])
    return rx, rz, list(names), top, ty, depth


def render(world: Path, out: Path):
    grid = geo.Grid.from_bbox(config.WORLD_BBOX)
    regions = sorted(str(p) for p in (world / "region").glob("r.*.mca"))
    W, Hh = grid.nx, grid.nz
    rgb = np.full((Hh, W, 3), 255, np.float32)
    Y = np.zeros((Hh, W), np.float32)
    D = np.zeros((Hh, W), np.float32)
    with mp.get_context("fork").Pool(4) as pool:
        for k, (rx, rz, names, top, ty, depth) in enumerate(pool.imap_unordered(region_top, regions)):
            lut = np.array([color(n) for n in names] or [(255, 255, 255)], np.float32)
            x0, z0 = rx * 512 - grid.x0, rz * 512 - grid.z0
            xs0, zs0 = max(x0, 0), max(z0, 0)
            xs1, zs1 = min(x0 + 512, W), min(z0 + 512, Hh)
            if xs1 <= xs0 or zs1 <= zs0:
                continue
            sl = (slice(zs0 - z0, zs1 - z0), slice(xs0 - x0, xs1 - x0))
            rgb[zs0:zs1, xs0:xs1] = lut[top[sl]]
            Y[zs0:zs1, xs0:xs1] = ty[sl]
            D[zs0:zs1, xs0:xs1] = depth[sl]
            if k % 20 == 0:
                print(f"  regions {k + 1}/{len(regions)}", flush=True)
    # Minecraft-map style shading: brighter where the column is higher than its northern neighbour
    dn = np.zeros_like(Y)
    dn[1:] = Y[1:] - Y[:-1]
    shade = np.clip(1.0 + np.clip(dn, -4, 4) * 0.045, 0.82, 1.18)
    gz, gx = np.gradient(Y)
    shade *= np.clip(1.0 + (-gx - gz) * 0.03, 0.85, 1.12)
    water = D > 0
    rgb *= shade[..., None]
    # deeper water darker, shallow water lighter
    wt = np.clip(D / 14.0, 0, 1)[..., None]
    wcol = np.array([95, 160, 215]) * (1 - wt) + np.array([30, 70, 150]) * wt
    rgb = np.where(water[..., None], wcol, rgb)
    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))
    out.mkdir(parents=True, exist_ok=True)
    full = out / "Bregenz_TopDown_gesamt_1px_pro_Block.png"
    img.save(full, optimize=True)
    print(full, img.size)
    # city centre: every block as a 4x4 pixel square
    cx0, cz0 = -1100 - grid.x0, -800 - grid.z0
    crop = img.crop((cx0, cz0, cx0 + 2000, cz0 + 2000)).resize((8000, 8000), Image.NEAREST)
    _coords(crop, -1100, -800, 4)
    inner = out / "Bregenz_TopDown_Innenstadt_4px_pro_Block.png"
    crop.save(inner, optimize=True)
    print(inner, crop.size)
    # Pfänder summit area
    px0, pz0 = 1700 - grid.x0, -1200 - grid.z0
    pf = img.crop((px0, pz0, px0 + 2000, pz0 + 2000)).resize((8000, 8000), Image.NEAREST)
    _coords(pf, 1700, -1200, 4)
    pfo = out / "Bregenz_TopDown_Pfaender_4px_pro_Block.png"
    pf.save(pfo, optimize=True)
    print(pfo, pf.size)


def _coords(img: Image.Image, x0: int, z0: int, s: int):
    """Small coordinate ticks every 100 blocks on the frame, so you can find spots in game."""
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 30)
    for k in range(0, img.width // s + 1, 100):
        X = k * s
        d.line([(X, 0), (X, 24)], fill=(255, 255, 255), width=4)
        d.text((X + 6, 4), f"X {x0 + k}", font=f, fill=(255, 255, 255), stroke_width=3, stroke_fill=(0, 0, 0))
    for k in range(0, img.height // s + 1, 100):
        Z = k * s
        d.line([(0, Z), (24, Z)], fill=(255, 255, 255), width=4)
        d.text((6, Z + 6), f"Z {z0 + k}", font=f, fill=(255, 255, 255), stroke_width=3, stroke_fill=(0, 0, 0))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("world", nargs="?", default=str(ROOT / "output" / "Bregenz_1zu1"))
    ap.add_argument("--out", default=str(ROOT / "output" / "topdown"))
    a = ap.parse_args()
    render(Path(a.world), Path(a.out))
