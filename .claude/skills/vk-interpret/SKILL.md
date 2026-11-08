---
name: vk-interpret
description: Stage 2 of Vishwakarma. Read an extracted floor plan (work/page.png, grid.png, raw.json), calibrate the scale from labelled room dimensions, and write projects/<p>/plan.draft.json (walls, doors, windows, rooms, fixtures in source pixels), then run `vk plan`. Use after `vk extract`, or whenever plan.json has to be (re)created or corrected.
---

# vk-interpret — drawing → plan.draft.json

You write the draft in **source pixels** (the coordinates of `work/page.png`, y down). `vk plan <p>` converts it to metric `plan.json`; never hand-write `plan.json`. The draft format is documented in the docstring of `pipeline/vk_pipeline/draft2plan.py`. Read it first. `projects/flat-105/plan.draft.json` is a complete worked example.

## 1. Survey
- Read `work/raw_overlay.png`. Its numbered wall candidates come with `bbox` and `thickness_px` in `work/raw.json`.
- Print the candidates inside the unit:
  ```
  .venv/Scripts/python.exe -c "import json;r=json.load(open('projects/<p>/work/raw.json'));[print(w['id'],w['orient'],w['bbox'],w['thickness_px']) for w in r['wall_rects']]"
  ```
- For a vector PDF, also use `raw.json` → `source.vector.dim_pairs` (dimension strings already parsed to meters, with their positions) and `spans` (the room labels).
- Render **zoomed crops with pixel rulers** into the scratchpad for each region. Doors, windows and wall faces need ±2 px:
  ```python
  # crop(name, x0, y0, x1, y1, zoom): ticks every 10 px, labels every 50 px
  ```
  (See the crop snippet in the flat-105 history: cv2 resize with INTER_NEAREST, then draw ruler ticks on the top and left edges.) Read each crop.

## 2. Calibrate the scale
- For each labelled room, measure the clear span between the inner wall faces in px, and divide by the labelled length in meters (feet-inches: `vk_pipeline.units.parse_length`).
- Use at least 3 rooms in both axes. They should agree within about 1%. Use the median as `units_per_m` and note the spread in `notes`.
- Labels such as `10'7½"x12'6"` are usually width (x) × length (y) on the drawing, but check against the geometry.
- Pick `origin` as the outer bottom-left corner of the unit (px). Pick `crop` to cover the unit plus a margin.

## 3. Walls
- One wall per straight run, as a **centerline** (`a`, `b`) plus thickness `t` in px. Exterior walls get `"exterior": true`.
- Run walls through door openings. Openings cut them; don't split a wall at a door.
- Meet at shared points at corners and T-junctions. The builder extends wall ends by t/2 to close the corners.
- Wall thickness drawn inconsistently? Keep what's drawn so the room sizes match the labels, and note it.

## 4. Openings
- `at` = centre point on the wall centerline (px). `width` = clear opening width (px).
- Doors: `hinge_at` = a point near the hinge end. `swing_toward` = any point on the side the leaf sweeps into (inside the arc). `connects` = [room ids], using `"outside"` for the entrance.
- Windows: the default sill comes from `defaults`. Toilets get `ventilator` with `sill` 1.8. Wash or utility screens get a tall `window` (the builder renders a grille). Use `leaves: 2` for double doors (puja).
- Set `site.entrance` to the main door's id.

## 5. Rooms and fixtures
- Rooms: `rect` [x0,y0,x1,y1] on the **inner faces**, or a `polygon` for L-shapes. Copy `labeled.text` exactly as printed. Use `"gate": false` when a label spans an irregular or open area (e.g. Dining in an L).
- `type` comes from the schema enum (`puja`, `wash`, `toilet`, `master_bedroom` …). Shafts and ducts are `other`.
- Fixtures: every drawn furniture symbol, as `kind` + `rect` + `room`. These guide vk-scene, so be generous.
- If the wall detector picks up drawn furniture (beds, mandir, sofas), add those areas to `ignore`.

## 6. Site
`site.north_deg` (degrees CCW from +y; north pointing down the drawing = 180), `floor` (0 = ground), `unit`, and `outside` polygons in **meters** for the corridor, garden and open-to-sky areas (used for ground materials).

## 7. Convert
`node cli/bin/vk.js plan <p>` must print `valid`. Fix any errors it reports, then continue with **vk-verify-plan**.
