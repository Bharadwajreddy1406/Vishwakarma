"""Stage 3a — replicate plan.json as a measured matplotlib drawing.

    python -m vk_pipeline.render_plan <plan.json> <work_dir>

Writes work_dir/plan.png: walls (with openings), door swings, windows, room fills with
name + computed clear size (and the labelled size in brackets when it differs).
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import Arc, Polygon as MplPolygon  # noqa: E402

from .geometry import iter_polys, room_extent, wall_solid, walls_of  # noqa: E402
from .units import fmt_ftin  # noqa: E402

ROOM_COLORS = {
    "living": "#f3e7d3", "dining": "#f6ecd9", "kitchen": "#e6efe0", "bedroom": "#e3e9f3", "master_bedroom": "#dde4f2",
    "toilet": "#e2f0f2", "bathroom": "#e2f0f2", "puja": "#f8e0c8", "utility": "#ececec", "wash": "#ececec",
    "balcony": "#eaf2e2", "foyer": "#f2eadc", "passage": "#f2eadc", "store": "#ececec",
}


def render(plan: dict, out: Path, dpi: int = 150) -> None:
    walls = walls_of(plan)
    solid = wall_solid(plan)
    minx, miny, maxx, maxy = wall_solid(plan, cut_openings=False).bounds
    W, H = maxx - minx, maxy - miny
    fig, ax = plt.subplots(figsize=(max(6, W * 0.9), max(6, H * 0.9)))
    ax.set_aspect("equal")

    for r in plan["rooms"]:
        ax.add_patch(MplPolygon(r["polygon"], closed=True, fc=ROOM_COLORS.get(r["type"], "#f0f0f0"), ec="none", zorder=1))
        xs = [p[0] for p in r["polygon"]]
        ys = [p[1] for p in r["polygon"]]
        cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
        w, l = room_extent(r)
        label = f"{r['name']}\n{fmt_ftin(w)} x {fmt_ftin(l)}\n{w:.2f} x {l:.2f} m"
        lab = r.get("labeled")
        if lab and "w" in lab:
            ok = sorted([abs(w - lab["w"]), abs(l - lab["l"])])[-1] <= 0.03 or sorted([abs(w - lab["l"]), abs(l - lab["w"])])[-1] <= 0.03
            mark = " (nominal)" if lab.get("gate") is False else ("" if ok else "  ✗")
            label += f"\n[{lab.get('text', '')}]" + mark
        ax.text(cx, cy, label, ha="center", va="center", fontsize=7, zorder=5)

    for poly in iter_polys(solid):
        ax.add_patch(MplPolygon(list(poly.exterior.coords), closed=True, fc="#2b2b2b", ec="#2b2b2b", lw=0.3, zorder=3))
        for hole in poly.interiors:
            ax.add_patch(MplPolygon(list(hole.coords), closed=True, fc="white", ec="none", zorder=3))

    for o in plan.get("openings", []):
        w = walls[o["wall"]]
        s0, s1 = o["offset"] - o["width"] / 2, o["offset"] + o["width"] / 2
        if o["type"] in ("window", "ventilator"):
            for n in (-w.t / 2, 0, w.t / 2):
                p, q = w.point(s0, n), w.point(s1, n)
                ax.plot([p[0], q[0]], [p[1], q[1]], color="#1f77b4", lw=1, zorder=4)
        elif o["type"] in ("door",):
            hinge_s = s0 if o.get("hinge", "a") == "a" else s1
            free_s = s1 if hinge_s == s0 else s0
            side = 1 if o.get("swing", "left") == "left" else -1
            face = side * w.t / 2
            hp = w.point(hinge_s, face)
            fp = w.point(free_s, face)
            leaf_end = (hp[0] + w.normal[0] * side * o["width"], hp[1] + w.normal[1] * side * o["width"])
            ax.plot([hp[0], leaf_end[0]], [hp[1], leaf_end[1]], color="#c0392b", lw=1.2, zorder=4)
            a0 = math.degrees(math.atan2(fp[1] - hp[1], fp[0] - hp[0]))
            a1 = math.degrees(math.atan2(leaf_end[1] - hp[1], leaf_end[0] - hp[0]))
            lo, hi = sorted([a0, a1])
            if hi - lo > 180:
                lo, hi = hi, lo + 360
            ax.add_patch(Arc(hp, 2 * o["width"], 2 * o["width"], theta1=lo, theta2=hi, color="#c0392b", lw=0.8, ls="--", zorder=4))
        elif o["type"] == "sliding_door":
            p, q = w.point(s0, 0), w.point(s1, 0)
            ax.plot([p[0], q[0]], [p[1], q[1]], color="#c0392b", lw=1.5, zorder=4)
        ax.text(*w.point(o["offset"], w.t * 1.6), o["id"], fontsize=5, color="#555", ha="center", va="center", zorder=6)

    for wid, w in walls.items():
        mx, my = w.point(w.length / 2)
        ax.text(mx, my, wid, fontsize=4, color="#f39c12", ha="center", va="center", zorder=7)

    north = (plan.get("site") or {}).get("north_deg")
    if north is not None:
        ang = math.radians(90 + north)
        ox, oy = maxx + 0.6, maxy - 0.6
        ax.annotate("N", xy=(ox + 0.45 * math.cos(ang), oy + 0.45 * math.sin(ang)), xytext=(ox, oy),
                    arrowprops=dict(arrowstyle="->", lw=1.5), ha="center", va="center", fontsize=9, weight="bold")

    ax.set_xlim(minx - 0.5, maxx + 1.2)
    ax.set_ylim(miny - 0.5, maxy + 0.5)
    ax.set_xticks(range(math.floor(minx), math.ceil(maxx) + 1))
    ax.set_yticks(range(math.floor(miny), math.ceil(maxy) + 1))
    ax.grid(True, lw=0.3, alpha=0.5)
    ax.set_title(f"plan.json replica  —  {W:.2f} x {H:.2f} m bounding box", fontsize=9)
    fig.tight_layout()
    fig.savefig(out, dpi=dpi)
    plt.close(fig)


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if len(args) != 2:
        print(__doc__)
        return 1
    plan = json.loads(Path(args[0]).read_text(encoding="utf-8"))
    out = Path(args[1]) / "plan.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    render(plan, out)
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
