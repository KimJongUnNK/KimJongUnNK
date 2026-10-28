"""Preview renders: top-down map (like a Minecraft map item, with hill shading) and the
height profile lake -> Pfänder compared with the project's planning profile."""
from __future__ import annotations

import csv
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from . import config, geo
from .blocks import REG
from .world import World

BASE_COLORS = {
    "grass_block": (110, 160, 70), "podzol": (106, 76, 46), "coarse_dirt": (119, 85, 59), "dirt": (134, 96, 67),
    "rooted_dirt": (144, 103, 76), "moss_block": (89, 110, 45), "mud": (60, 57, 61), "sand": (219, 207, 163),
    "gravel": (131, 127, 126), "stone": (125, 125, 125), "andesite": (136, 136, 137), "cobblestone": (122, 122, 122),
    "tuff": (108, 109, 102), "water": (55, 105, 190), "gray_concrete": (70, 73, 77), "white_concrete": (207, 213, 214),
    "polished_andesite": (132, 135, 134), "stone_bricks": (122, 121, 122), "smooth_stone": (159, 159, 159),
    "dirt_path": (148, 122, 65), "clay": (160, 166, 179), "smooth_quartz": (235, 229, 222), "deepslate": (80, 80, 82),
}
WORD_COLORS = [
    ("spruce_leaves", (60, 96, 60)), ("birch_leaves", (110, 150, 70)), ("dark_oak_leaves", (60, 110, 40)),
    ("leaves", (75, 125, 45)), ("_log", (100, 80, 50)), ("bricks", (150, 90, 75)), ("deepslate_tile", (60, 60, 64)),
    ("nether_brick", (110, 40, 40)), ("mud_brick", (137, 104, 79)), ("spruce", (115, 85, 50)), ("dark_oak", (66, 43, 20)),
    ("oak", (162, 130, 78)), ("birch", (192, 175, 121)), ("glass", (190, 215, 225)), ("white_terracotta", (209, 178, 161)),
    ("yellow_terracotta", (186, 133, 35)), ("terracotta", (152, 94, 67)), ("sandstone", (220, 210, 160)),
    ("calcite", (223, 224, 220)), ("quartz", (235, 229, 222)), ("light_gray", (140, 140, 132)), ("white", (220, 222, 222)),
    ("gray", (80, 85, 88)), ("red", (160, 40, 35)), ("blue", (50, 60, 160)), ("green", (85, 110, 40)),
    ("lime", (100, 170, 30)), ("yellow", (230, 190, 40)), ("gold", (240, 210, 60)), ("rail", (110, 100, 90)),
    ("lantern", (230, 180, 90)), ("fence", (110, 90, 60)), ("flower", (200, 60, 60)), ("poppy", (190, 40, 40)),
    ("dandelion", (230, 210, 40)), ("short_grass", (110, 160, 70)), ("fern", (90, 140, 60)), ("concrete", (150, 150, 150)),
    ("chain", (60, 65, 75)), ("iron", (200, 200, 200)), ("exposed_copper", (150, 110, 85)), ("copper", (80, 160, 140)),
]


def color_of(state_id: int) -> tuple[int, int, int]:
    name = REG.name(state_id).split(":")[1]
    if name in BASE_COLORS:
        return BASE_COLORS[name]
    for w, c in WORD_COLORS:
        if w in name:
            return c
    return (128, 128, 128)


INVISIBLE = {"air", "light", "short_grass", "fern", "chain", "lightning_rod", "iron_bars", "glass_pane", "rail",
             "lantern", "oak_sign", "dark_oak_fence", "birch_fence", "spruce_fence"}


def top_layer(world: World, edits) -> tuple[np.ndarray, np.ndarray]:
    """Highest visible block id and its Y for every column (terrain + edits)."""
    g = world.grid
    water = world.wtop > world.H
    top_id = np.where(water, REG.id("water"), world.top).astype(np.uint16)
    top_y = np.maximum(world.H, world.wtop).astype(np.int32)
    if edits.xs.size:
        vis = np.ones(len(REG), dtype=bool)
        for i in range(len(REG)):
            if REG.name(i).split(":")[1] in INVISIBLE:
                vis[i] = False
        sel = vis[edits.ids]
        xs, ys, zs, ids = edits.xs[sel], edits.ys[sel].astype(np.int32), edits.zs[sel], edits.ids[sel]
        col = (zs.astype(np.int64) - g.z0) * g.nx + (xs - g.x0)
        key = col * 4096 + (ys - config.MIN_Y)
        order = np.argsort(key)
        col_s, ys_s, ids_s = col[order], ys[order], ids[order]
        last = np.r_[col_s[1:] != col_s[:-1], True]
        c, y, b = col_s[last], ys_s[last], ids_s[last]
        flat_y = top_y.reshape(-1)
        flat_id = top_id.reshape(-1)
        higher = y >= flat_y[c]
        flat_y[c[higher]] = y[higher]
        flat_id[c[higher]] = b[higher]
    return top_id, top_y


def map_image(world: World, edits, scale: int = 1, region=None) -> Image.Image:
    top_id, top_y = top_layer(world, edits)
    if region is not None:
        g = world.grid
        x0, z0, x1, z1 = region
        sl = (slice(z0 - g.z0, z1 - g.z0), slice(x0 - g.x0, x1 - g.x0))
        top_id, top_y = top_id[sl], top_y[sl]
    lut = np.array([color_of(i) for i in range(len(REG))], dtype=np.float32)
    rgb = lut[top_id]
    yf = top_y.astype(np.float32)
    gz, gx = np.gradient(yf)
    shade = np.clip(1.0 + (-gx - gz) * 0.18, 0.55, 1.35)
    rgb = rgb * shade[..., None]
    # subtle altitude tint so the mountain reads at a glance
    alt = np.clip((yf - 400) / 700, 0, 1)[..., None]
    rgb = rgb * (1 - 0.15 * alt) + 255 * 0.15 * alt
    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))
    if scale != 1:
        img = img.resize((img.width // scale, img.height // scale), Image.LANCZOS)
    return img


def annotate(img: Image.Image, world: World, scale: int, offset=(0, 0)) -> Image.Image:
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("DejaVuSans-Bold.ttf", 15 if scale >= 1 else 20)
    except OSError:
        font = ImageFont.load_default()
    for name, (x, y, z) in world.markers.items():
        px = (x - world.grid.x0 - offset[0]) / scale
        pz = (z - world.grid.z0 - offset[1]) / scale
        if 0 <= px < img.width and 0 <= pz < img.height:
            d.ellipse((px - 4, pz - 4, px + 4, pz + 4), fill=(255, 40, 40), outline=(0, 0, 0))
            d.text((px + 7, pz - 7), name, fill=(255, 255, 255), font=font, stroke_width=2, stroke_fill=(0, 0, 0))
    return img


def profile_chart(world: World, out: Path, plan_csv: Path | None) -> list[tuple[float, float]]:
    """Real terrain along the line Seebühne -> Pfänder summit vs. the planning profile."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    a = np.array(geo.place(47.50562, 9.73809), dtype=float)  # Seebühne
    b = np.array(geo.place(47.50737, 9.78020), dtype=float)  # Pfänder summit
    L = np.linalg.norm(b - a)
    t = np.linspace(0, 1, int(L))
    pts = a[None, :] + (b - a)[None, :] * t[:, None]
    hs = world.surface(np.round(pts[:, 0]).astype(int), np.round(pts[:, 1]).astype(int)) - 1
    # distance measured from the shoreline like the plan
    water = world.is_water(np.round(pts[:, 0]).astype(int), np.round(pts[:, 1]).astype(int))
    shore_i = int(np.argmax(~water)) if (~water).any() else 0
    dist = (t - t[shore_i]) * L
    fig, ax = plt.subplots(figsize=(11, 5.2), dpi=130)
    ax.fill_between(dist, 380, hs, color="#7aa35a", alpha=0.35, linewidth=0)
    ax.plot(dist, hs, color="#3b6b2a", lw=1.6, label="Minecraft-Welt (echtes Gelaendemodell)")
    if plan_csv and plan_csv.exists():
        with open(plan_csv, newline="", encoding="utf-8-sig") as f:
            rows = list(csv.DictReader(f))
        px = [float(r["Distanz_X_Blöcke"]) - 500 for r in rows]  # the plan puts the shore at 500
        py = [float(r["Höhe_Y_Blöcke"]) for r in rows]
        ax.plot(px, py, "o--", color="#5b6cff", lw=1.4, label="Planungsprofil (CSV)")
        for r, x, y in zip(rows, px, py):
            ax.annotate(r["Zone"].split(". ", 1)[-1], (x, y), textcoords="offset points", xytext=(4, 6), fontsize=7, color="#333")
    ax.axhline(config.WATER_LEVEL, color="#3a8fb0", lw=0.8, ls=":")
    ax.set_xlim(dist.min(), dist.max())
    ax.set_ylim(370, 1100)
    ax.set_xlabel("Distanz vom Seeufer (Bloecke = Meter)")
    ax.set_ylabel("Y (= Meter ue. A.)")
    ax.set_title("Profil Seebuehne -> Pfaender-Gipfel")
    ax.grid(alpha=0.25)
    ax.legend(loc="upper left")
    fig.tight_layout()
    fig.savefig(out)
    plt.close(fig)
    return list(zip(dist.tolist()[::50], hs.tolist()[::50]))
