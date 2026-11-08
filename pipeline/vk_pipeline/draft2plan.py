"""Convert an interpretation draft (source-pixel space) into a metric plan.json.

    python -m vk_pipeline.draft2plan <project_dir>      # reads plan.draft.json, writes plan.json

Why: Claude measures in the pixels of work/page.png / grid.png. Writing those numbers down directly
(instead of hand-converting to meters) keeps the interpretation auditable and the maths in one place.

Draft format (all coordinates = page.png pixels, y down):
{
  "units_per_m": 101.4,            # px per meter (calibrated from labelled rooms)
  "origin": [297, 1285],           # px that becomes plan (0,0) — usually the bottom-left outer corner
  "crop": [...], "ignore": [[...]], "site": {...}, "defaults": {...}, "notes": [...],
  "walls": [{"id", "a": [px,py], "b": [px,py], "t": px, "exterior": bool}],
  "openings": [{"id", "wall", "type", "at": [px,py] (center), "width": px,
                "hinge_at": [px,py]?, "swing_toward": [px,py]?, "sill": m?, "height": m?, "leaves": n?, "connects": [...]?}],
  "rooms": [{"id", "name", "type", "rect": [x0,y0,x1,y1]} | {"polygon": [[px,py],...]}, "labeled": {"text", "gate"?}],
  "fixtures": [{"kind", "room", "rect": [x0,y0,x1,y1], "rotation"?}]
}
Heights/sills stay in meters. Labelled text like 10'7½"x12'6" is parsed automatically.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from shapely.geometry import Polygon
from shapely.geometry.polygon import orient

from .units import parse_pair


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    project = Path(args[0])
    d = json.loads((project / "plan.draft.json").read_text(encoding="utf-8"))
    k = float(d["units_per_m"])
    ox, oy = d["origin"]

    def P(p):  # px -> plan meters
        return [round((p[0] - ox) / k, 4), round((oy - p[1]) / k, 4)]

    walls, wall_px = [], {}
    for w in d["walls"]:
        wall_px[w["id"]] = w
        walls.append({"id": w["id"], "a": P(w["a"]), "b": P(w["b"]), "thickness": round(w["t"] / k, 4),
                      **({"exterior": True} if w.get("exterior") else {}), **({"height": w["height"]} if "height" in w else {})})

    openings = []
    for o in d["openings"]:
        w = wall_px[o["wall"]]
        (ax, ay), (bx, by) = w["a"], w["b"]
        L = ((bx - ax) ** 2 + (by - ay) ** 2) ** 0.5
        ux, uy = (bx - ax) / L, (by - ay) / L

        def along(p):
            return (p[0] - ax) * ux + (p[1] - ay) * uy

        s = along(o["at"])
        out = {"id": o["id"], "wall": o["wall"], "type": o["type"], "offset": round(s / k, 4), "width": round(o["width"] / k, 4)}
        if "hinge_at" in o:
            out["hinge"] = "a" if along(o["hinge_at"]) < s else "b"
        if "swing_toward" in o:
            # plan-space left normal of a->b. In pixel space (y down) a->b direction (ux, uy) maps to (ux, -uy);
            # its left normal in plan space is (uy, ux) -> back in pixel space (uy, -ux).
            nx, ny = uy, -ux
            px, py = o["swing_toward"][0] - o["at"][0], o["swing_toward"][1] - o["at"][1]
            out["swing"] = "left" if px * nx + py * ny > 0 else "right"
        for key in ("sill", "height", "leaves", "connects"):
            if key in o:
                out[key] = o[key]
        openings.append(out)

    rooms = []
    for r in d["rooms"]:
        if "rect" in r:
            x0, y0, x1, y1 = r["rect"]
            pts = [[x0, y1], [x1, y1], [x1, y0], [x0, y0]]
        else:
            pts = r["polygon"]
        poly = orient(Polygon([P(p) for p in pts]), sign=1.0)  # CCW in plan space
        room = {"id": r["id"], "name": r["name"], "type": r["type"],
                "polygon": [[round(x, 4), round(y, 4)] for x, y in list(poly.exterior.coords)[:-1]]}
        if "labeled" in r:
            lab = dict(r["labeled"])
            pair = parse_pair(lab["text"])
            if pair:
                lab["w"], lab["l"] = round(pair[0], 4), round(pair[1], 4)
            room["labeled"] = lab
        rooms.append(room)

    fixtures = []
    for f in d.get("fixtures", []):
        x0, y0, x1, y1 = f["rect"]
        c = P([(x0 + x1) / 2, (y0 + y1) / 2])
        fixtures.append({"kind": f["kind"], "room": f["room"], "center": c,
                         "size": [round(abs(x1 - x0) / k, 3), round(abs(y1 - y0) / k, 3)], "rotation": f.get("rotation", 0)})

    src_file = d.get("file", "")
    plan = {
        "version": 1, "units": "m",
        "source": {"kind": d.get("kind", "image"), "file": src_file, "page": d.get("page", 0), "units_per_m": k, "origin": [ox, oy],
                   **({"crop": d["crop"]} if "crop" in d else {}), **({"ignore": d["ignore"]} if "ignore" in d else {})},
        **({"site": d["site"]} if "site" in d else {}),
        **({"defaults": d["defaults"]} if "defaults" in d else {}),
        "walls": walls, "openings": openings, "rooms": rooms,
        **({"fixtures": fixtures} if fixtures else {}),
        "notes": d.get("notes", []),
    }
    (project / "plan.json").write_text(json.dumps(plan, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {project / 'plan.json'}: {len(walls)} walls, {len(openings)} openings, {len(rooms)} rooms, {len(fixtures)} fixtures")
    return 0


if __name__ == "__main__":
    sys.exit(main())
