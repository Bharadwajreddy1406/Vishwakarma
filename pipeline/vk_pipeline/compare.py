"""Stage 3b — compare plan.json against the source drawing.

    python -m vk_pipeline.compare <project_dir> [--tol-px N] [--min-f1 0.85] [--dim-tol 0.03]

Projects plan.json walls back into source pixel space and compares them to work/walls_mask.png
(produced by extract). Writes work/overlay.png, work/report.json and work/report.md.

Exit code: 0 = gate passed, 2 = gate failed (fix plan.json and re-run), 1 = error.

Gate:
  * tolerant wall F1 >= min_f1  (precision/recall after dilating the other mask by tol_px)
  * every room with a `labeled` size matches its computed clear size within dim_tol meters
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

from .geometry import SourceXform, iter_polys, room_extent, wall_solid
from .units import fmt_ftin


def load_png(path: Path, flags=cv2.IMREAD_COLOR) -> np.ndarray:
    img = cv2.imdecode(np.fromfile(str(path), np.uint8), flags)
    if img is None:
        raise SystemExit(f"cannot read {path} — run `vk extract` first")
    return img


def rasterize_plan(plan: dict, xf: SourceXform, shape: tuple[int, int]) -> np.ndarray:
    mask = np.zeros(shape, np.uint8)
    for poly in iter_polys(wall_solid(plan)):
        ext = np.array([xf.to_px(x, y) for x, y in poly.exterior.coords], np.int32)
        cv2.fillPoly(mask, [ext], 255)
        for hole in poly.interiors:
            cv2.fillPoly(mask, [np.array([xf.to_px(x, y) for x, y in hole.coords], np.int32)], 0)
    return mask


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("project", type=Path)
    ap.add_argument("--tol-px", type=int, default=None, help="dilation tolerance in px (default: 40%% of wall thickness)")
    ap.add_argument("--min-f1", type=float, default=0.85)
    ap.add_argument("--dim-tol", type=float, default=0.03)
    a = ap.parse_args(argv)

    work = a.project / "work"
    plan = json.loads((a.project / "plan.json").read_text(encoding="utf-8"))
    raw = json.loads((work / "raw.json").read_text(encoding="utf-8"))
    page = load_png(work / "page.png")
    src_mask = load_png(work / "walls_mask.png", cv2.IMREAD_GRAYSCALE)
    xf = SourceXform(plan, raw["source"].get("px_per_unit", 1.0))
    plan_mask = rasterize_plan(plan, xf, src_mask.shape)

    # restrict the comparison to the unit's crop (neighbouring flats share the drawing)
    crop = (plan.get("source") or {}).get("crop")
    roi = np.zeros_like(src_mask)
    if crop:
        k = raw["source"].get("px_per_unit", 1.0)
        x0, y0, x1, y1 = (int(round(v * k)) for v in crop)
        roi[y0:y1, x0:x1] = 255
    else:
        ys, xs = np.nonzero(plan_mask)
        pad = 10
        roi[max(0, ys.min() - pad): ys.max() + pad, max(0, xs.min() - pad): xs.max() + pad] = 255
    k_px = raw["source"].get("px_per_unit", 1.0)
    for x0, y0, x1, y1 in (plan.get("source") or {}).get("ignore", []):
        roi[int(y0 * k_px): int(y1 * k_px), int(x0 * k_px): int(x1 * k_px)] = 0
    src = cv2.bitwise_and(src_mask, roi)
    pm = cv2.bitwise_and(plan_mask, roi)

    t_px = raw["wall_detection"].get("thickness_mode_px") or 8
    tol = a.tol_px if a.tol_px is not None else max(2, round(t_px * 0.4))
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * tol + 1, 2 * tol + 1))
    src_d, pm_d = cv2.dilate(src, k), cv2.dilate(pm, k)
    P = int((pm > 0).sum())
    S = int((src > 0).sum())
    precision = float(((pm > 0) & (src_d > 0)).sum()) / max(P, 1)
    recall = float(((src > 0) & (pm_d > 0)).sum()) / max(S, 1)
    f1 = 2 * precision * recall / max(precision + recall, 1e-9)
    iou = float(((pm > 0) & (src > 0)).sum()) / max(int(((pm > 0) | (src > 0)).sum()), 1)

    # dimension checks
    dims = []
    for r in plan["rooms"]:
        lab = r.get("labeled")
        if not lab or "w" not in lab:
            continue
        w, l = room_extent(r)
        err = min(max(abs(w - lab["w"]), abs(l - lab["l"])), max(abs(w - lab["l"]), abs(l - lab["w"])))
        dims.append({"room": r["id"], "name": r["name"], "labeled": lab.get("text", ""), "computed": f"{fmt_ftin(w)} x {fmt_ftin(l)}",
                     "computed_m": [round(w, 3), round(l, 3)], "err_m": round(err, 3),
                     "gated": lab.get("gate", True), "ok": err <= a.dim_tol or not lab.get("gate", True)})

    # overlay: grey page, source walls blue, plan walls red, agreement magenta
    base = cv2.cvtColor(cv2.cvtColor(page, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)
    over = (base * 0.35 + 255 * 0.65).astype(np.uint8)
    over[(src > 0) & ~(pm > 0)] = (220, 120, 0)     # only in source  (missed)  -> blue
    over[(pm > 0) & ~(src > 0)] = (0, 0, 230)       # only in plan    (extra)   -> red
    over[(pm > 0) & (src > 0)] = (160, 0, 160)      # both                       -> magenta
    # missed/extra beyond tolerance, highlighted
    over[(pm > 0) & ~(src_d > 0)] = (0, 0, 255)
    over[(src > 0) & ~(pm_d > 0)] = (255, 80, 0)
    cv2.putText(over, f"F1 {f1:.3f}  P {precision:.3f}  R {recall:.3f}  IoU {iou:.3f}  tol {tol}px",
                (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2, cv2.LINE_AA)
    ok, buf = cv2.imencode(".png", over)
    buf.tofile(str(work / "overlay.png"))

    passed = f1 >= a.min_f1 and all(d["ok"] for d in dims)
    report = {"passed": passed, "walls": {"f1": round(f1, 4), "precision": round(precision, 4), "recall": round(recall, 4),
                                          "iou": round(iou, 4), "tol_px": tol, "min_f1": a.min_f1}, "rooms": dims}
    (work / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    lines = [f"# Plan verification — {'PASS' if passed else 'FAIL'}", "",
             f"Wall match: F1 **{f1:.3f}** (precision {precision:.3f}, recall {recall:.3f}, strict IoU {iou:.3f}, tolerance {tol}px). Gate ≥ {a.min_f1}.",
             "", "Overlay legend: magenta = agree · red = in plan.json only (extra) · blue = in drawing only (missed).", "",
             "| Room | Labeled | Computed | Error | |", "|---|---|---|---|---|"]
    for d in dims:
        lines.append(f"| {d['name']} | {d['labeled']} | {d['computed']} ({d['computed_m'][0]:.2f} x {d['computed_m'][1]:.2f} m) | {d['err_m']*100:.1f} cm | {('✔' if d['ok'] else '✘') if d['gated'] else 'nominal'} |")
    for n in plan.get("notes", []):
        lines.append(f"\n- {n}")
    (work / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"walls  F1 {f1:.3f}  (P {precision:.3f} R {recall:.3f}, IoU {iou:.3f}, tol {tol}px)  gate {a.min_f1}")
    for d in dims:
        print(f"  {'ok ' if d['ok'] else 'BAD'} {d['name']:<14} labeled {d['labeled']:<16} computed {d['computed']:<18} err {d['err_m']*100:.1f} cm")
    print("GATE PASSED" if passed else "GATE FAILED — inspect work/overlay.png, fix plan.json, re-run vk verify")
    return 0 if passed else 2


if __name__ == "__main__":
    sys.exit(main())
