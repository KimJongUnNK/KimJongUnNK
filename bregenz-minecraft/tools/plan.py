"""Lageplan of the Bregenz world: contour lines, buildings, roads with street names, railway,
landmarks and a Minecraft coordinate grid, rendered at 1 block = N pixels.

    python tools/plan.py                       # full world 1 px/block + Innenstadt 4 px/block
    python tools/plan.py --box -1100 -800 900 1300 --scale 4 --out plan.png

The terrain (heights, water, forest) is computed once with the generator's terrain step and cached
in data/plan_cache.npz, so it matches the world exactly.
"""
from __future__ import annotations

import argparse
import math
import re
import sys
from pathlib import Path

import contourpy
import numpy as np
import shapely
import shapely.ops
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from bregenz import config, data, geo, raster, terrain  # noqa: E402
from bregenz.roads import ROAD_STYLE  # noqa: E402
from bregenz.world import World  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
CACHE = ROOT / "data" / "plan_cache.npz"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

WATER = (158, 196, 228)
WATER_LINE = (90, 140, 190)
BUILDING = (205, 190, 172)
BUILDING_LINE = (120, 100, 85)
LANDMARK = (200, 60, 50)
CONTOUR = (150, 115, 80)
GRID = (60, 80, 120)
ROAD_COLORS = {
    "motorway": (232, 140, 60), "trunk": (240, 170, 80), "primary": (250, 210, 110), "secondary": (252, 230, 150),
    "tertiary": (255, 245, 200),
}
LANDMARK_NAMES = {
    "Festspiel- und Kongresshaus Bregenz", "Landhaus", "Ehemaliges St.-Gallus-Stift", "Rathaus", "Nepomukkapelle",
    "Theater am Kornmarkt", "Kunsthaus Bregenz", "vorarlberg museum", "Martinsturm Bregenz", "Post Filiale 6900",
    "Herz Jesu-Kirche", "Stadtpfarrkirche St. Gallus", "Bregenz Busbahnhof", "Casino Bregenz", "Nostalgiebad Mili",
    "Altes Rathaus", "Deuringschlößle", "Wallfahrtskirche Hl. Gebhard", "Talstation", "Bergstation", "Sender Pfänder",
    "Haus am Hafen", "Pfarrkirche St. Wendelin", "Seebad Bregenz",
}


def terrain_cache():
    if CACHE.exists():
        z = np.load(CACHE)
        return z["H"], z["water"], z["forest"], tuple(int(v) for v in z["grid"])
    grid = geo.Grid.from_bbox(config.WORLD_BBOX)
    w = World(grid)
    terrain.build(w, print)
    water = w.wtop > w.H
    forest = getattr(w, "forest_mask", np.zeros(w.H.shape, bool))
    g = (grid.x0, grid.z0, grid.nx, grid.nz)
    np.savez_compressed(CACHE, H=w.H, water=water, forest=forest, grid=np.array(g))
    return w.H, water, forest, g


def font(size, bold=False):
    return ImageFont.truetype(FONT_B if bold else FONT, max(6, int(size)))


class Plan:
    def __init__(self, box, scale):
        self.x0, self.z0, self.x1, self.z1 = box
        self.s = scale
        self.W, self.Hpx = int((self.x1 - self.x0) * scale), int((self.z1 - self.z0) * scale)

    def px(self, x, z):
        return (x - self.x0) * self.s, (z - self.z0) * self.s

    def ring(self, coords):
        return [self.px(x, z) for x, z in coords]


def base_image(plan: Plan, H, water, forest, g):
    gx0, gz0, gnx, gnz = g
    ix0, iz0 = plan.x0 - gx0, plan.z0 - gz0
    ix1, iz1 = plan.x1 - gx0, plan.z1 - gz0
    sl = (slice(max(iz0, 0), min(iz1, gnz)), slice(max(ix0, 0), min(ix1, gnx)))
    h = H[sl].astype(np.float32)
    wat = water[sl]
    fo = forest[sl]
    # hypsometric tint (lake level -> Pfänder) + hillshade
    t = np.clip((h - 396) / 670.0, 0, 1)[..., None]
    low, mid, high = np.array([236, 240, 222]), np.array([226, 222, 196]), np.array([214, 200, 180])
    col = np.where(t < 0.5, low + (mid - low) * (t / 0.5), mid + (high - mid) * ((t - 0.5) / 0.5))
    gy, gxx = np.gradient(ndimage.gaussian_filter(h, 1.5))
    shade = np.clip(1.0 + (-gxx - gy) * 0.06, 0.72, 1.18)[..., None]
    col = col * shade
    col = np.where(fo[..., None] & ~wat[..., None], col * np.array([0.82, 0.93, 0.78]), col)
    col = np.where(wat[..., None], np.array(WATER), col)
    img = np.full((iz1 - iz0, ix1 - ix0, 3), 255, np.uint8)
    img[sl[0].start - iz0:sl[0].stop - iz0, sl[1].start - ix0:sl[1].stop - ix0] = np.clip(col, 0, 255).astype(np.uint8)
    im = Image.fromarray(img)
    if plan.s != 1:
        im = im.resize((plan.W, plan.Hpx), Image.NEAREST)
    return im, h, wat, sl


def draw_contours(plan: Plan, d: ImageDraw.ImageDraw, h, wat, sl, labels):
    hs = ndimage.gaussian_filter(h, 3.0)
    hs = np.where(wat, np.nan, hs)
    gen = contourpy.contour_generator(z=hs, name="serial")
    ox = sl[1].start + plan.gx0 - plan.x0
    oz = sl[0].start + plan.gz0 - plan.z0
    lo = int(math.ceil(np.nanmin(hs) / 10) * 10)
    for lev in range(max(lo, 400), int(np.nanmax(hs)) + 1, 10):
        index = lev % 50 == 0
        for line in gen.lines(lev):
            if len(line) < 6:
                continue
            pts = [((x + ox + 0.5) * plan.s, (z + oz + 0.5) * plan.s) for x, z in line]
            d.line(pts, fill=CONTOUR if index else (185, 160, 130), width=max(1, int(plan.s * (1.2 if index else 0.5))))
            if index and len(line) > 200:
                x, z = line[len(line) // 2]
                labels.append(("contour", f"{lev}", (x + ox, z + oz), 0.0))


def polys(geom):
    if geom.geom_type == "Polygon":
        return [geom]
    if geom.geom_type == "MultiPolygon":
        return list(geom.geoms)
    return []


def draw_landuse(plan: Plan, d):
    fills = {"park": (200, 228, 180), "grass": (210, 232, 190), "playground": (220, 236, 180), "pitch": (176, 214, 150),
             "garden": (205, 230, 185), "cemetery": (196, 214, 186), "stadium": (190, 220, 170), "plaza": (232, 226, 214),
             "pedestrian": (232, 226, 214), "recreation_ground": (205, 230, 185)}
    box = shapely.box(plan.x0, plan.z0, plan.x1, plan.z1)
    for r in data.overture("land_use"):
        c = fills.get(r.get("class"))
        if c is None:
            continue
        g = raster.to_block_geom(r["geom"])
        if not g.intersects(box):
            continue
        for p in polys(g):
            d.polygon(plan.ring(p.exterior.coords), fill=c)


def draw_water_lines(plan: Plan, d):
    for r in data.overture("water"):
        g = raster.to_block_geom(r["geom"])
        if g.geom_type in ("LineString", "MultiLineString"):
            for l in (g.geoms if hasattr(g, "geoms") else [g]):
                d.line(plan.ring(l.coords), fill=WATER_LINE, width=max(1, int(plan.s * 2)))


def draw_buildings(plan: Plan, d, labels):
    box = shapely.box(plan.x0, plan.z0, plan.x1, plan.z1)
    w = max(1, int(plan.s * 0.35))
    for r in data.overture("building"):
        g = raster.to_block_geom(r["geom"])
        if not g.intersects(box):
            continue
        lm = r["name"] in LANDMARK_NAMES
        for p in polys(g):
            d.polygon(plan.ring(p.exterior.coords), fill=LANDMARK if lm else BUILDING, outline=BUILDING_LINE)
            if w > 1:
                d.line(plan.ring(p.exterior.coords), fill=BUILDING_LINE, width=w)


def road_lines():
    out = []
    for r in data.overture("segment"):
        if r["geom"].geom_type != "LineString":
            continue
        g = raster.to_block_geom(r["geom"])
        tunnel = bool(data.has_flag(r, "is_tunnel")) if r["subtype"] == "road" else bool(data.has_flag(r, "is_tunnel", "rail_flags"))
        if r["subtype"] == "rail":
            out.append(("rail", g, None, tunnel))
        elif r["subtype"] == "road":
            cls = r["class"] if r["class"] in ROAD_STYLE else "unknown"
            out.append((cls, g, r["name"], tunnel))
    return out


def dashed(d, pts, fill, width, on, off):
    line = shapely.LineString(pts)
    L, t = line.length, 0.0
    while t < L:
        a = line.interpolate(t)
        b = line.interpolate(min(t + on, L))
        seg = shapely.ops.substring(line, t, min(t + on, L))
        if seg.geom_type == "LineString":
            d.line(list(seg.coords), fill=fill, width=width)
        else:
            d.line([(a.x, a.y), (b.x, b.y)], fill=fill, width=width)
        t += on + off


def draw_roads(plan: Plan, d, roads):
    s = plan.s
    order = sorted(ROAD_STYLE, key=lambda c: ROAD_STYLE[c][2])
    box = shapely.box(plan.x0 - 50, plan.z0 - 50, plan.x1 + 50, plan.z1 + 50)
    vis = [(c, g, n, t) for c, g, n, t in roads if g.intersects(box)]
    # casings, then fills (low classes first so main roads lie on top)
    for phase in ("case", "fill"):
        for cls in order:
            w = ROAD_STYLE[cls][0] * s
            for c, g, n, tun in vis:
                if c != cls:
                    continue
                pts = plan.ring(g.coords)
                if cls in ("footway", "path", "steps", "cycleway", "track"):
                    if phase == "fill":
                        col = (170, 120, 90) if cls != "cycleway" else (90, 120, 200)
                        dashed(d, pts, col, max(1, int(s * 0.8)), 4 * s, 2 * s)
                    continue
                if phase == "case":
                    d.line(pts, fill=(120, 120, 120) if not tun else (170, 170, 170), width=int(w + 2 * max(1, s * 0.6)), joint="curve")
                else:
                    col = ROAD_COLORS.get(cls, (255, 255, 255))
                    if tun:
                        dashed(d, pts, col, int(max(1, w * 0.6)), 6 * s, 4 * s)
                    else:
                        d.line(pts, fill=col, width=int(max(1, w)), joint="curve")
    for c, g, n, tun in vis:
        if c == "rail":
            pts = plan.ring(g.coords)
            w = max(2, int(s * 2.5))
            if tun:
                dashed(d, pts, (90, 90, 90), max(1, w // 2), 6 * s, 4 * s)
                continue
            d.line(pts, fill=(40, 40, 40), width=w)
            dashed(d, pts, (255, 255, 255), max(1, w - 2), 8 * s, 8 * s)


def street_labels(plan: Plan, roads, labels):
    by_name: dict[str, list] = {}
    for c, g, n, tun in roads:
        if n and c not in ("motorway",) and not tun:
            by_name.setdefault(n, []).append(g)
    box = shapely.box(plan.x0, plan.z0, plan.x1, plan.z1)
    for n, ls in by_name.items():
        merged = shapely.ops.linemerge(shapely.MultiLineString(ls))
        for part in (merged.geoms if hasattr(merged, "geoms") else [merged]):
            part = part.intersection(box)
            if part.is_empty or part.geom_type != "LineString":
                continue
            L = part.length
            if L < len(n) * 5.5:
                continue
            k = max(1, int(L // 450))
            for i in range(k):
                t = L * (i + 0.5) / k
                p0, p1 = part.interpolate(max(0, t - 6)), part.interpolate(min(L, t + 6))
                ang = math.degrees(math.atan2(p1.y - p0.y, p1.x - p0.x))
                if ang > 90:
                    ang -= 180
                elif ang < -90:
                    ang += 180
                p = part.interpolate(t)
                labels.append(("street", n, (p.x, p.y), ang))


def landmark_labels(labels):
    txt = (ROOT / "output" / "Bregenz_1zu1" / "KOORDINATEN.txt")
    if not txt.exists():
        return
    for line in txt.read_text().splitlines():
        m = re.match(r"^(.+?)\s{2,}/function \S+\s+/tp @s (-?\d+) (-?\d+) (-?\d+)", line)
        if not m or "(Schild)" in m.group(1) or "Projekt" in m.group(1):
            continue
        labels.append(("poi", m.group(1).strip(), (int(m.group(2)), int(m.group(4))), 0.0))


def draw_labels(plan: Plan, im: Image.Image, labels):
    s = plan.s
    d = ImageDraw.Draw(im)
    taken: list[tuple[float, float, float, float]] = []

    def free(bb):
        for b in taken:
            if bb[0] < b[2] and bb[2] > b[0] and bb[1] < b[3] and bb[3] > b[1]:
                return False
        return True

    order = {"poi": 0, "street": 1, "contour": 2}
    for kind, text, (x, z), ang in sorted(labels, key=lambda l: order[l[0]]):
        X, Z = plan.px(x, z)
        if not (0 <= X < plan.W and 0 <= Z < plan.Hpx):
            continue
        if kind == "poi":
            f = font(max(11, 4.2 * s + 6, plan.W / 420), bold=True)
            r = max(3, s * 2)
            tw, th = d.textbbox((0, 0), text, font=f)[2:]
            bb = (X + r + 2, Z - th / 2, X + r + 4 + tw, Z + th / 2)
            if not free(bb):
                bb = (X - r - 4 - tw, Z - th / 2, X - r - 2, Z + th / 2)
            d.ellipse((X - r, Z - r, X + r, Z + r), fill=LANDMARK, outline=(255, 255, 255), width=max(1, s // 2))
            d.text((bb[0], bb[1]), text, font=f, fill=(140, 20, 20), stroke_width=max(2, s // 2), stroke_fill=(255, 255, 255))
            taken.append(bb)
        else:
            size = (2.6 * s + 6) if kind == "street" else (2.0 * s + 5)
            f = font(size)
            tw, th = d.textbbox((0, 0), text, font=f)[2:]
            pad = 4
            tile = Image.new("RGBA", (tw + 2 * pad, th + 2 * pad), (0, 0, 0, 0))
            td = ImageDraw.Draw(tile)
            col = (40, 40, 40) if kind == "street" else CONTOUR
            td.text((pad, pad), text, font=f, fill=col, stroke_width=max(1, s // 2 + 1), stroke_fill=(255, 255, 255))
            tile = tile.rotate(-ang, expand=True, resample=Image.BICUBIC)
            bb = (X - tile.width / 2, Z - tile.height / 2, X + tile.width / 2, Z + tile.height / 2)
            if not free(bb):
                continue
            im.paste(tile, (int(bb[0]), int(bb[1])), tile)
            taken.append(bb)


def draw_grid(plan: Plan, im):
    s = plan.s
    d = ImageDraw.Draw(im, "RGBA")
    step = 100
    f = font(max(10, 2.2 * s + 8), bold=True)
    for x in range(int(math.ceil(plan.x0 / step) * step), plan.x1, step):
        X, _ = plan.px(x, 0)
        major = x % 500 == 0
        d.line([(X, 0), (X, plan.Hpx)], fill=GRID + ((150,) if major else (60,)), width=max(1, s if major else s // 2))
        if major or s >= 3:
            for Z in (4, plan.Hpx - 40):
                d.text((X + 4, Z), f"X {x}", font=f, fill=GRID + (255,), stroke_width=2, stroke_fill=(255, 255, 255, 255))
    for z in range(int(math.ceil(plan.z0 / step) * step), plan.z1, step):
        _, Z = plan.px(0, z)
        major = z % 500 == 0
        d.line([(0, Z), (plan.W, Z)], fill=GRID + ((150,) if major else (60,)), width=max(1, s if major else s // 2))
        if major or s >= 3:
            for X in (4, plan.W - 140):
                d.text((X, Z + 4), f"Z {z}", font=f, fill=GRID + (255,), stroke_width=2, stroke_fill=(255, 255, 255, 255))
    # origin
    X, Z = plan.px(0, 0)
    d.line([(X - 30 * s, Z), (X + 30 * s, Z)], fill=(200, 0, 0, 255), width=max(2, s))
    d.line([(X, Z - 30 * s), (X, Z + 30 * s)], fill=(200, 0, 0, 255), width=max(2, s))


def draw_frame(plan: Plan, im, title):
    s = plan.s
    u = max(1.0, plan.W / 3200)                    # keep title and legend legible on the 8000 px overview
    d = ImageDraw.Draw(im, "RGBA")
    ft = font(max(28, 10 * s + 20) * u, bold=True)
    fs = font(max(14, 4 * s + 10) * u)
    lines = [title, "1 Block = 1 Meter  ·  Koordinaten = Minecraft X / Z  ·  0/0 = vorarlberg museum  ·  Höhenlinien alle 10 m (fett alle 50 m)"]
    w = max(d.textbbox((0, 0), lines[0], font=ft)[2], d.textbbox((0, 0), lines[1], font=fs)[2]) + 40
    hgt = ft.size + fs.size + 50
    d.rectangle((20, 60, 20 + w, 60 + hgt), fill=(255, 255, 255, 225), outline=(40, 40, 40, 255), width=2)
    d.text((40, 75), lines[0], font=ft, fill=(20, 20, 20))
    d.text((40, 85 + ft.size), lines[1], font=fs, fill=(60, 60, 60))
    # legend
    items = [("Gebäude", BUILDING), ("Wahrzeichen / nach Fotos gebaut", LANDMARK), ("Autobahn", ROAD_COLORS["motorway"]),
             ("Hauptstraße", ROAD_COLORS["primary"]), ("Straße", (255, 255, 255)), ("Bahn", (40, 40, 40)),
             ("Tunnel (gestrichelt, grau gerahmt)", (170, 170, 170)), ("Fußweg (gestrichelt)", (170, 120, 90)), ("Radweg (gestrichelt)", (90, 120, 200)),
             ("Park / Wiese", (200, 228, 180)), ("Wald", (190, 210, 170)), ("Wasser", WATER), ("Höhenlinie", CONTOUR)]
    fl = font(max(13, 3.5 * s + 9) * u)
    lh = fl.size + 12
    lw = max(d.textbbox((0, 0), t, font=fl)[2] for t, _ in items) + 90
    y0 = plan.Hpx - 80 - lh * len(items) - 40
    d.rectangle((20, y0, 20 + lw, plan.Hpx - 60), fill=(255, 255, 255, 225), outline=(40, 40, 40, 255), width=2)
    for i, (t, c) in enumerate(items):
        y = y0 + 20 + i * lh
        d.rectangle((40, y, 80, y + fl.size), fill=c, outline=(80, 80, 80))
        d.text((95, y - 2), t, font=fl, fill=(30, 30, 30))
    # scale bar (500 m) and north arrow
    bx, by = plan.W - 40 - 500 * s, plan.Hpx - 90
    for k in range(5):
        d.rectangle((bx + k * 100 * s, by, bx + (k + 1) * 100 * s, by + max(8, 3 * s)),
                    fill=(30, 30, 30) if k % 2 == 0 else (255, 255, 255), outline=(30, 30, 30))
    d.text((bx, by - fl.size - 8), "0", font=fl, fill=(30, 30, 30), stroke_width=2, stroke_fill=(255, 255, 255))
    d.text((bx + 500 * s - 70, by - fl.size - 8), "500 m", font=fl, fill=(30, 30, 30), stroke_width=2, stroke_fill=(255, 255, 255))
    nx, ny, L = plan.W - 90, 200, 70 + 10 * s
    d.polygon([(nx, ny - L), (nx - L * 0.35, ny), (nx + L * 0.35, ny)], fill=(30, 30, 30))
    d.text((nx - 12, ny + 8), "N", font=ft, fill=(30, 30, 30), stroke_width=3, stroke_fill=(255, 255, 255))


def render(box, scale, out: Path, title: str):
    H, water, forest, g = terrain_cache()
    plan = Plan(box, scale)
    plan.gx0, plan.gz0 = g[0], g[1]
    im, h, wat, sl = base_image(plan, H, water, forest, g)
    d = ImageDraw.Draw(im)
    labels: list = []
    draw_landuse(plan, d)
    # re-apply water on top of land use, then contours
    draw_water_lines(plan, d)
    draw_contours(plan, d, h, wat, sl, labels)
    roads = road_lines()
    draw_roads(plan, d, roads)
    draw_buildings(plan, d, labels)
    draw_grid(plan, im)
    landmark_labels(labels)
    street_labels(plan, roads, labels)
    draw_labels(plan, im, labels)
    draw_frame(plan, im, title)
    im.save(out, optimize=True)
    print(f"{out}: {im.width} x {im.height} px")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--box", nargs=4, type=int, default=None, help="x0 z0 x1 z1 in blocks")
    ap.add_argument("--scale", type=int, default=1)
    ap.add_argument("--out", default=None)
    ap.add_argument("--title", default="Bregenz 1:1 – Lageplan der Minecraft-Welt")
    a = ap.parse_args(argv)
    if a.box:
        render(tuple(a.box), a.scale, Path(a.out or "plan.png"), a.title)
        return
    _, _, _, g = terrain_cache()
    outdir = ROOT / "output" / "plan"
    outdir.mkdir(parents=True, exist_ok=True)
    render((g[0], g[1], g[0] + g[2], g[1] + g[3]), 1, outdir / "Bregenz_Plan_gesamt_1px_pro_Block.png",
           "Bregenz 1:1 – Gesamtplan (Stadt, See, Pfänder)")
    render((-1100, -800, 900, 1300), 4, outdir / "Bregenz_Plan_Innenstadt_4px_pro_Block.png",
           "Bregenz 1:1 – Innenstadt, Hafen, Oberstadt")


if __name__ == "__main__":
    main()
