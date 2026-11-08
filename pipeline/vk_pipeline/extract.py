"""Stage 1 — mechanical extraction (no interpretation).

    python -m vk_pipeline.extract <source.pdf|png|jpg> <work_dir> [--page N]

Writes into work_dir:
    page.png         raster of the source (what Claude looks at)
    grid.png         page.png with a labelled pixel grid (for reading coordinates)
    walls_mask.png   binary mask of detected wall pixels (source pixel space)
    raw_overlay.png  numbered wall candidates drawn over the page
    raw.json         candidates: wall rects, text spans + dimension strings (PDF), scale hints

All coordinates in raw.json are in *page.png pixel space* (y down). For PDFs `px_per_unit`
records the PDF-point -> pixel factor so plan.json can still reference real PDF points.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

from .units import DIM_PAIR_RE, parse_length, parse_pair

PDF_DPI = 200


# ---------------------------------------------------------------- rasterise
def load_source(src: Path, page: int) -> tuple[np.ndarray, dict]:
    """Return BGR image + info dict. PDFs are rasterised and their vector content extracted."""
    info: dict = {"file": src.name}
    if src.suffix.lower() == ".pdf":
        import fitz  # PyMuPDF

        doc = fitz.open(src)
        pg = doc[page]
        zoom = PDF_DPI / 72.0
        pix = pg.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        img = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)
        img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
        info.update(kind="pdf", page=page, px_per_unit=zoom, pages=len(doc))
        info["vector"] = extract_pdf_vectors(pg, zoom)
    else:
        data = np.fromfile(str(src), np.uint8)  # handles non-ASCII Windows paths
        img = cv2.imdecode(data, cv2.IMREAD_COLOR)
        if img is None:
            raise SystemExit(f"cannot read image {src}")
        info.update(kind="image", px_per_unit=1.0)
    info["size"] = [int(img.shape[1]), int(img.shape[0])]
    return img, info


def extract_pdf_vectors(pg, zoom: float) -> dict:
    """Line segments, rects, curves and text spans from a vector PDF page, in pixel space."""
    segs, rects, curves = [], [], []
    for d in pg.get_drawings():
        width = (d.get("width") or 0) * zoom
        filled = d.get("fill") is not None
        for it in d["items"]:
            op = it[0]
            if op == "l":
                p, q = it[1], it[2]
                segs.append([round(p.x * zoom, 1), round(p.y * zoom, 1), round(q.x * zoom, 1), round(q.y * zoom, 1), round(width, 2)])
            elif op == "re":
                r = it[1]
                rects.append({"bbox": [round(r.x0 * zoom, 1), round(r.y0 * zoom, 1), round(r.x1 * zoom, 1), round(r.y1 * zoom, 1)], "filled": filled})
            elif op == "c":
                pts = [it[1], it[2], it[3], it[4]]
                curves.append([[round(p.x * zoom, 1), round(p.y * zoom, 1)] for p in pts])
    spans = []
    for block in pg.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            for sp in line["spans"]:
                t = sp["text"].strip()
                if not t:
                    continue
                x0, y0, x1, y1 = sp["bbox"]
                spans.append({"text": t, "bbox": [round(x0 * zoom, 1), round(y0 * zoom, 1), round(x1 * zoom, 1), round(y1 * zoom, 1)], "size": round(sp["size"], 1)})
    # merge each line's spans so "10'7½" + "x12'6"" style splits are rejoined
    dims = []
    for s in spans:
        for m in DIM_PAIR_RE.finditer(s["text"]):
            pair = parse_pair(m.group(0))
            if pair:
                dims.append({"text": m.group(0), "w": round(pair[0], 4), "l": round(pair[1], 4), "bbox": s["bbox"]})
    singles = []
    for s in spans:
        v = parse_length(s["text"])
        if v and 0.3 < v < 60 and not DIM_PAIR_RE.search(s["text"]):
            singles.append({"text": s["text"], "m": round(v, 4), "bbox": s["bbox"]})
    return {"segments": segs, "rects": rects, "curves": curves, "spans": spans, "dim_pairs": dims, "dim_singles": singles}


# ---------------------------------------------------------------- walls
def wall_mask(img: np.ndarray) -> tuple[np.ndarray, int]:
    """Detect wall pixels: dark, and at least `min_t` px thick in one direction (kills text & hatching)."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # walls are the darkest large structures; pick threshold from histogram (Otsu on the dark tail)
    thr = min(90, int(cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[0] * 0.6))
    dark = (gray < thr).astype(np.uint8) * 255
    h, w = gray.shape
    min_t = max(4, round(min(h, w) / 220))  # typical wall >= ~0.45% of the image size
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (min_t, min_t))
    thick = cv2.morphologyEx(dark, cv2.MORPH_OPEN, k)
    # keep only components that are long (walls), drop blobs like text glyph clusters
    n, lab, stats, _ = cv2.connectedComponentsWithStats(thick, 8)
    out = np.zeros_like(thick)
    min_len = min_t * 5
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if max(bw, bh) >= min_len:
            out[lab == i] = 255
    return out, min_t


def wall_rects(mask: np.ndarray, min_t: int) -> list[dict]:
    """Split the wall mask into axis-aligned runs (horizontal + vertical) -> rectangles."""
    rects = []
    min_len = min_t * 4
    for orient, ksize in (("h", (min_len, 1)), ("v", (1, min_len))):
        k = cv2.getStructuringElement(cv2.MORPH_RECT, ksize)
        runs = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k)
        n, lab, stats, _ = cv2.connectedComponentsWithStats(runs, 8)
        for i in range(1, n):
            x, y, bw, bh, area = (int(v) for v in stats[i])
            if orient == "h" and bw < bh:
                continue
            if orient == "v" and bh < bw:
                continue
            t = bh if orient == "h" else bw
            if t < min_t:
                continue
            fill = area / float(bw * bh)
            rects.append({"orient": orient, "bbox": [x, y, x + bw, y + bh], "thickness_px": t,
                          "length_px": bw if orient == "h" else bh, "fill": round(fill, 2)})
    rects.sort(key=lambda r: (r["bbox"][1], r["bbox"][0]))
    for i, r in enumerate(rects):
        r["id"] = f"r{i}"
    return rects


def thickness_mode(rects: list[dict]) -> int | None:
    if not rects:
        return None
    ts = [r["thickness_px"] for r in rects for _ in range(max(1, r["length_px"] // 20))]
    vals, counts = np.unique(ts, return_counts=True)
    return int(vals[np.argmax(counts)])


# ---------------------------------------------------------------- debug images
def draw_grid(img: np.ndarray, step: int) -> np.ndarray:
    out = img.copy()
    h, w = out.shape[:2]
    for x in range(0, w, step):
        major = x % (step * 5) == 0
        cv2.line(out, (x, 0), (x, h), (0, 0, 255) if major else (255, 160, 0), 1)
        if major:
            cv2.putText(out, str(x), (x + 2, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 255), 1, cv2.LINE_AA)
    for y in range(0, h, step):
        major = y % (step * 5) == 0
        cv2.line(out, (0, y), (w, y), (0, 0, 255) if major else (255, 160, 0), 1)
        if major:
            cv2.putText(out, str(y), (2, y - 3), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 255), 1, cv2.LINE_AA)
    return out


def draw_rects(img: np.ndarray, rects: list[dict]) -> np.ndarray:
    out = (img * 0.55 + 255 * 0.45).astype(np.uint8)
    for r in rects:
        x0, y0, x1, y1 = r["bbox"]
        col = (0, 0, 220) if r["orient"] == "h" else (0, 150, 0)
        cv2.rectangle(out, (x0, y0), (x1 - 1, y1 - 1), col, 2)
        cv2.putText(out, r["id"], (x0 + 2, y0 + 12 if r["orient"] == "v" else y0 - 3),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.38, col, 1, cv2.LINE_AA)
    return out


def imwrite(path: Path, img: np.ndarray) -> None:
    ok, buf = cv2.imencode(path.suffix, img)
    if not ok:
        raise SystemExit(f"cannot encode {path}")
    buf.tofile(str(path))


# ---------------------------------------------------------------- main
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("source", type=Path)
    ap.add_argument("work", type=Path)
    ap.add_argument("--page", type=int, default=0)
    a = ap.parse_args(argv)
    a.work.mkdir(parents=True, exist_ok=True)

    img, info = load_source(a.source, a.page)
    mask, min_t = wall_mask(img)
    rects = wall_rects(mask, min_t)
    t_mode = thickness_mode(rects)

    imwrite(a.work / "page.png", img)
    step = max(10, round(max(img.shape[:2]) / 100 / 10) * 10)
    imwrite(a.work / "grid.png", draw_grid(img, step))
    imwrite(a.work / "walls_mask.png", mask)
    imwrite(a.work / "raw_overlay.png", draw_rects(img, rects))

    raw = {
        "version": 1,
        "source": info,
        "wall_detection": {"min_thickness_px": min_t, "thickness_mode_px": t_mode, "count": len(rects)},
        "wall_rects": rects,
        "hints": [
            "Coordinates are page.png pixels, y down.",
            "Wall rects are axis-aligned runs; a T or L junction appears as overlapping h + v rects.",
            "thickness_mode_px is usually the main (internal) wall thickness; exterior walls are often thicker.",
            "Calibrate scale from a labelled room: clear span in px between wall faces / labelled length in m.",
        ],
    }
    (a.work / "raw.json").write_text(json.dumps(raw, indent=1, ensure_ascii=False), encoding="utf-8")
    vec = info.get("vector", {})
    print(f"source: {info['kind']} {info['size'][0]}x{info['size'][1]}px")
    print(f"walls:  {len(rects)} rect candidates, thickness mode {t_mode}px (min {min_t}px)")
    if vec:
        print(f"vector: {len(vec['segments'])} segments, {len(vec['curves'])} curves, {len(vec['spans'])} text spans, {len(vec['dim_pairs'])} dimension pairs")
    print(f"wrote:  {a.work}/{{page,grid,walls_mask,raw_overlay}}.png raw.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
