---
name: vk-scene
description: Stage 4 of Vishwakarma. Furnish a verified plan by writing projects/<p>/scene.json. Place reusable parametric generators (beds, wardrobes, kitchen runs, fridge, mandir, dining table m×n, sofas, toilets…), pick a palette and materials from the reference photos, and validate. Use after the verify gate passes, or when the user asks to change furniture, materials, colours or lighting.
---

# vk-scene — plan.json → scene.json

The format is `schemas/scene.schema.json`, and `projects/flat-105/scene.json` is a complete worked example.

## 1. Inventory
- `plan.json` `fixtures` are the furniture symbols drawn on the plan (centre and size in meters). Start from them.
- Rooms without drawn furniture get sensible defaults for Indian homes:
  - bedrooms: a bed, a wardrobe and a side table;
  - kitchen: an L or straight counter with hob and sink, plus a fridge;
  - living: sofas, a TV unit and a coffee table;
  - puja: a mandir;
  - toilets: a WC and basin;
  - wash: a washing machine;
  - ceiling fans in the living room and bedrooms.
- `vk asset list`, plus the `params` in `common/registry.json`. **Reuse with parameters.** Write a new generator only when nothing fits (see the **vk-asset** skill).

## 2. Placement maths
- `position` = the object's origin (the centre of its footprint) in plan meters. `rotation` = degrees CCW. Generators face **+Z**, so:
  - 0 = front faces −y (down the drawing)
  - 90 = faces +x
  - 180 = faces +y
  - 270 = faces −x
- Against a wall: centre = inner wall face ± depth/2, facing into the room. Get room inner faces from the polygon bounds:
  ```
  .venv/Scripts/python.exe -c "import json;p=json.load(open('projects/<p>/plan.json',encoding='utf-8'));[print(f['kind'],f['room'],f['center'],f['size']) for f in p.get('fixtures',[])];[print(r['id'],min(q[0] for q in r['polygon']),max(q[0] for q in r['polygon']),min(q[1] for q in r['polygon']),max(q[1] for q in r['polygon'])) for r in p['rooms']]"
  ```
- Check clearances:
  - door swings: no furniture inside a door arc;
  - windows: no tall units in front of windows (`wallCabinets: false` on a window wall);
  - a walking path of at least 0.6 m.
- Beds: the headboard is at local −Z. If the headboard is against the east wall, use rotation 270.
- Doors and windows come from the plan automatically. Override style or materials through `openings.<id>` only when needed.

## 3. Look and feel
- Read the reference photos. Pick a `palette` from `common/palettes/` or create one (by copying `warm-indian-modern.json`).
- Override per object with `materials: {slot: materialId}`, and per room with `rooms.<id>.floor/wall`.
- If no palette fits, add materials to `common/materials/library.json` (a procedural kind + colours), then run `vk asset index`.
- `environment.sun` is a compass azimuth/elevation. The builder rotates it using the plan's `north_deg`.

## 4. Validate and view
- `node cli/bin/vk.js validate <p>` must print `valid`. It checks generator ids, room containment and spawn.
- The engine live-reloads `scene.json`. If the user has `vk render <p>` running, they'll see changes immediately.
- `vk stage <p> furnish done`.
