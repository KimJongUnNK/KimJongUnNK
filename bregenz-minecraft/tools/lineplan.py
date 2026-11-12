"""Line plan (vector) of the Bregenz world: building outlines, road centre lines with street names,
railway, land use and water outlines, on axes in Minecraft block coordinates (X east, Z south).

    python tools/lineplan.py                     # -> output/lineplan/*.pdf (vector) + *.png
    python tools/lineplan.py --box -80 -100 100 80 --out kornmarkt.pdf
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import shapely  # noqa: E402
import shapely.ops  # noqa: E402
from matplotlib.collections import LineCollection  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from bregenz import config, data, geo, raster  # noqa: E402

COL = {"building": "k", "landmark": "#c0392b", "land_use": "#2e9e3e", "land_cover": "#c8b400", "water": "#00b4c8",
       "infrastructure": "#1f4fd1", "road": "0.55", "path": "0.75", "rail": "k"}
LANDMARK_NAMES = {
    "Festspiel- und Kongresshaus Bregenz", "Landhaus", "Ehemaliges St.-Gallus-Stift", "Rathaus", "Nepomukkapelle",
    "Theater am Kornmarkt", "Kunsthaus Bregenz", "vorarlberg museum", "Martinsturm Bregenz", "Post Filiale 6900",
    "Herz Jesu-Kirche", "Stadtpfarrkirche St. Gallus", "Bregenz Busbahnhof", "Casino Bregenz", "Nostalgiebad Mili",
    "Altes Rathaus", "Deuringschlößle", "Wallfahrtskirche Hl. Gebhard", "Talstation", "Bergstation", "Sender Pfänder",
    "Haus am Hafen", "Pfarrkirche St. Wendelin",
}
PATHS = {"footway", "path", "steps", "cycleway", "track"}


def rings(g):
    if g.geom_type == "Polygon":
        return [np.asarray(g.exterior.coords)] + [np.asarray(r.coords) for r in g.interiors]
    if g.geom_type == "MultiPolygon":
        return [a for p in g.geoms for a in rings(p)]
    if g.geom_type == "LineString":
        return [np.asarray(g.coords)]
    if g.geom_type == "MultiLineString":
        return [np.asarray(l.coords) for l in g.geoms]
    return []


def draw(box, out: Path, scale_in: float, title: str, label_size: float, png_px: int, lw: float = 0.35):
    x0, z0, x1, z1 = box
    clip = shapely.box(x0, z0, x1, z1)
    w, h = (x1 - x0) / scale_in, (z1 - z0) / scale_in
    fig = plt.figure(figsize=(w + 1.2, h + 1.2))
    ax = fig.add_axes([0.6 / (w + 1.2), 0.6 / (h + 1.2), w / (w + 1.2), h / (h + 1.2)])
    groups: dict[str, list] = {k: [] for k in COL}
    texts = []
    for kind in ("land_cover", "land_use", "water", "infrastructure"):
        for r in data.overture(kind):
            g = raster.to_block_geom(r["geom"])
            if g.is_empty or not g.intersects(clip):
                continue
            groups[kind] += rings(g)
            if kind in ("land_use", "infrastructure") and g.geom_type in ("Polygon", "MultiPolygon") and g.area > 400:
                c = g.representative_point()
                texts.append((c.x, c.y, r.get("name") or r.get("class") or "", COL[kind], label_size * 0.7, 0, False))
    for r in data.overture("building"):
        g = raster.to_block_geom(r["geom"])
        if not g.intersects(clip):
            continue
        lm = r["name"] in LANDMARK_NAMES
        groups["landmark" if lm else "building"] += rings(g)
        if r["name"]:
            c = g.representative_point()
            texts.append((c.x, c.y, r["name"], COL["landmark"] if lm else "k", label_size * (1.0 if lm else 0.75), 0, lm))
    names: dict[str, list] = {}
    for r in data.overture("segment"):
        if r["geom"].geom_type != "LineString":
            continue
        g = raster.to_block_geom(r["geom"])
        if not g.intersects(clip):
            continue
        if r["subtype"] == "rail":
            groups["rail"] += rings(g)
        elif r["subtype"] == "road":
            groups["path" if r["class"] in PATHS else "road"] += rings(g)
            if r["name"]:
                names.setdefault(r["name"], []).append(g)
    for n, ls in names.items():
        merged = shapely.ops.linemerge(shapely.MultiLineString(ls))
        for part in (merged.geoms if hasattr(merged, "geoms") else [merged]):
            part = part.intersection(clip)
            if part.is_empty or part.geom_type != "LineString" or part.length < 25:
                continue
            k = max(1, int(part.length // 400))
            for i in range(k):
                t = part.length * (i + 0.5) / k
                p0, p1 = part.interpolate(max(0, t - 3)), part.interpolate(min(part.length, t + 3))
                ang = np.degrees(np.arctan2(-(p1.y - p0.y), p1.x - p0.x))   # axes are flipped in Z
                if ang > 90:
                    ang -= 180
                elif ang < -90:
                    ang += 180
                p = part.interpolate(t)
                texts.append((p.x, p.y, n, "0.35", label_size * 0.75, ang, False))
    widths = {"building": lw, "landmark": lw * 2.2, "land_use": lw, "land_cover": lw * 0.6, "water": lw * 1.2,
              "infrastructure": lw, "road": lw * 1.1, "path": lw * 0.6, "rail": lw * 1.6}
    order = ["land_cover", "land_use", "water", "infrastructure", "path", "road", "rail", "building", "landmark"]
    for k in order:
        if groups[k]:
            ax.add_collection(LineCollection(groups[k], colors=COL[k], linewidths=widths[k],
                                             linestyles="--" if k == "path" else "-"))
    for x, z, t, c, s, a, bold in texts:
        if x0 <= x <= x1 and z0 <= z <= z1 and t:
            ax.text(x, z, t, color=c, fontsize=s, rotation=a, ha="center", va="center", rotation_mode="anchor",
                    fontweight="bold" if bold else "normal", clip_on=True)
    ax.plot([0], [0], "r+", ms=10, mew=1.2)
    ax.set_xlim(x0, x1)
    ax.set_ylim(z1, z0)                       # Z grows southwards, north up
    ax.set_aspect("equal")
    step = 100 if (x1 - x0) > 600 else 20
    ax.set_xticks(np.arange(np.ceil(x0 / step) * step, x1 + 1, step))
    ax.set_yticks(np.arange(np.ceil(z0 / step) * step, z1 + 1, step))
    ax.tick_params(labelsize=label_size * 1.1, top=True, labeltop=True, right=True, labelright=True)
    for lab in ax.get_xticklabels():
        lab.set_rotation(90)
    ax.grid(alpha=0.3, lw=0.3)
    ax.set_title(title, fontsize=label_size * 3, loc="left", pad=label_size * 4)
    fig.text(0.6 / (w + 1.2), 0.25 / (h + 1.2),
             "Koordinaten = Minecraft X (Ost) / Z (Süd), 1 Block = 1 m, 0/0 = vorarlberg museum (rotes Kreuz).  "
             "Schwarz: Gebäude · Rot: Wahrzeichen · Grau: Straßenachsen · gestrichelt: Fußwege · Schwarz dick: Bahn · "
             "Grün: Landnutzung · Cyan: Wasser · Blau: Infrastruktur (Stege, Parkplätze) · Gelb: Bodenbedeckung",
             fontsize=label_size * 1.2)
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out.with_suffix(".pdf"))
    dpi = png_px / (w + 1.2)
    fig.savefig(out.with_suffix(".png"), dpi=dpi)
    plt.close(fig)
    print(out.with_suffix(".pdf"), out.with_suffix(".png"))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--box", nargs=4, type=int)
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    if a.box:
        draw(tuple(a.box), Path(a.out or "lineplan.pdf"), max(1, (a.box[2] - a.box[0]) / 20), "Bregenz 1:1 – Linienplan", 6, 8000)
        return
    g = geo.Grid.from_bbox(config.WORLD_BBOX)
    outdir = ROOT / "output" / "lineplan"
    draw((g.x0, g.z0, g.x0 + g.nx, g.z0 + g.nz), outdir / "Bregenz_Linienplan_gesamt", 100,
         "Bregenz 1:1 – Linienplan der Minecraft-Welt (gesamt)", 1.6, 8000, lw=0.75)
    draw((-1100, -800, 900, 1300), outdir / "Bregenz_Linienplan_Innenstadt", 40,
         "Bregenz 1:1 – Linienplan Innenstadt, Hafen, Oberstadt", 2.2, 7800)


if __name__ == "__main__":
    main()
