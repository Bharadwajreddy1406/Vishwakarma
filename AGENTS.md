# Vishwakarma AI — agent guide

Vishwakarma turns a floor plan (vector PDF or raster image) and reference photos into a **walkable 3D house in the browser**. You walk through it with WASD, sprint, jump, crouch, switch between first- and third-person views, and open doors, cupboards, the fridge and drawers with **F**. This file is the shared guide for any coding agent working in the repo (Claude Code, Codex, Cursor and others). Claude-specific notes are in `CLAUDE.md`.

## Layout

```
cli/        `vk` CLI (TypeScript, commander). Build: npm run build:cli   Run: node cli/bin/vk.js … (or `vk` after `npm link -w cli`)
pipeline/   Python (.venv): extract.py, draft2plan.py, render_plan.py, compare.py, validate.py, units.py, geometry.py
engine/     Vite + three.js (WebGL) + Rapier (WASM physics). index.html = game, preview.html = single-asset turntable
common/     SHARED across all projects: generators/ (parametric 3D assets), materials/library.json, palettes/, textures/, hdri/, models/, registry.json
schemas/    plan.schema.json, scene.schema.json  (the contract between pipeline and engine)
projects/<name>/
  input/            user uploads: floor plan PDF/image, reference photos, notes.md
  plan.draft.json   interpretation in SOURCE PIXELS (written by the agent; auditable)
  plan.json         verified metric plan (generated from the draft by `vk plan`)
  scene.json        furniture, materials, environment (written by the agent)
  assets/           project-local generators + assets/registry.json (candidates for promotion)
  work/             disposable intermediates (page.png, grid.png, overlay.png, report.md …); git-ignored
  project.json      stage status
```

## Pipeline (per project)

| Stage | Who | Command | Output | Gate |
|---|---|---|---|---|
| 1 extract | script | `vk extract <p>` | work/raw.json, page.png, grid.png, raw_overlay.png, walls_mask.png | — |
| 2 interpret | agent | write `plan.draft.json`, then `vk plan <p>` | plan.json | schema + semantic validation |
| 3 verify | script + agent | `vk verify <p>` | work/plan.png, overlay.png, report.md | wall F1 ≥ 0.85 **and** every gated room dimension within ±3 cm. Exit 0 = pass, 2 = fix and re-run |
| 4 furnish | agent | write `scene.json`, then `vk validate <p>` | scene.json | every generator exists, objects inside their rooms |
| 5 play | user | `vk render <p>` | browser | — |

Never skip the verify gate. If the gate can't pass because the source contradicts itself (for example, a label that disagrees with the drawing), record the conflict in `plan.draft.json` `notes`, mark that label `"gate": false`, and tell the user.

## Coordinate conventions (do not deviate)

- **Units:** meters everywhere after `plan.json`. The draft is in source pixels (y down).
- **Plan space:** +x right, +y up the drawing. `site.north_deg` gives true north in degrees counter-clockwise from +y. (flat-105: north points down the drawing, so `north_deg` is 180.)
- **World (three.js):** plan `(x, y)` maps to world `(x, height, -y)`. Rotations are degrees counter-clockwise seen from above; `rotation.y` is that value in radians.
- **Generator local frame:** origin is the centre of the footprint at floor level. Width runs along X, height along +Y, depth along Z. **The front faces +Z.** At `rotation: 0` the front faces plan −y; at 90 it faces +x; at 180, +y; at 270, −x.
- **Walls:** centerline `a→b` plus `thickness`. The left normal of `a→b` is the "left" side. Opening `offset` is measured from `a` to the opening's centre. Door `hinge` is `a` or `b`; door `swing` is `left` or `right`, meaning the side the leaf opens into.
- **Room polygons:** the clear interior (inside the wall faces), counter-clockwise. A room's `labeled` dimensions are the size printed on the drawing.

## Realism defaults (keep these when generating scenes)

- Slab height is `plan.defaults.wall_height` = 3.048 (10'0"). `scene.environment.false_ceiling.height` = 2.743 (9'0" POP). Doors are 2.134 (7'0").
- Ceiling fans, ceiling lights and wardrobe lofts take their height from the room's ceiling automatically. Don't hard-code it.
- `scene.environment.time` (0-24) and `date` (MM-DD) set the default sun. `plan.site.latitude` and `north_deg` orient it.
- Bathroom walls get the `wall_wet` palette tile up to `scene.environment.wet_dado_height` (1.372 = 4'6"), with paint above.
- Viewpoints come from furniture automatically (sofa, armchair, bed, dining-table, mandir, kitchen-counter with a hob, wc). Add hand-placed ones under `scene.viewpoints`.
- The in-game editor saves straight into `scene.json`: furniture moves change `objects[]`, and wall resizes go to `plan_edits.walls[id] = {a, b}`, which is applied on top of `plan.json` at load. **Never** fold `plan_edits` into `plan.json` or `plan.draft.json`; they are design changes, not measurements. Before rewriting `scene.json` by hand, re-read it, because the user may have edited it in the browser.
- Leave walkways of at least 0.45 m between furniture. The player capsule is 0.40 m wide.

## Asset rules (the reuse contract)

Assets are anything reusable: 3D generators, materials, palettes, textures, HDRIs, models.

1. **Search before you build.** Run `vk asset list` (or `--tag kitchen`), read `common/registry.json`, and look at generator `params`. Most needs are covered by parameters, such as `dining-table {seats: 3, sides: 2}` for a 3×2 table.
2. **Everything is parametric.** Never hard-code a one-off size. Expose `width`/`depth`/`height`, counts (`seats`, `doors`, `drawers`, `panes`) and styles as `meta.params` with defaults and min/max.
3. **New generator?** Write it in `projects/<p>/assets/<id>.ts` (reference it as `"local:<id>"`). Follow `common/generators/lib/types.ts`:
   - `meta` + `build(params, ctx)`; return a `THREE.Group`.
   - Front faces +Z, origin at floor level, meters.
   - Moving parts sit under a pivot listed in `interactables` (`hinge` around an axis, or `slide` along an axis). The engine animates them on **F** and moves their colliders.
   - Every mesh gets a box collider by default. Set `userData.collider = false` on handles, glass, cloth and other small details. Use invisible meshes as blockers for lattices and openings.
   - Get materials only through `ctx.mat('<slot>')`, and declare each slot's default in `meta.slots`. Never use hex colours inside a generator.
   - Reuse `lib/kit.ts` (`cabinet`, `drawer`, `legs`) and `lib/shapes.ts` (`box`, `rbox`, `cyl`, `handle`, `pivot`).
   - Child objects that should be separately dynamic (chairs around a table) go in `spawn`.
   - Optional runtime flags: `userData.spin` (rad/s, e.g. fans), `userData.flicker` (diya flames, lights).
4. **Preview it:** `vk asset preview <id> -p '{"seats":3}'`. Press F to test the moving parts.
5. **Promote anything generic.** If the asset isn't specific to this house, move it to common: `vk asset promote <p> <id>`, then `vk asset index`, then change `"local:<id>"` to `"<id>"` in the scene. Bump `meta.version` when you change a shared generator's behaviour, and keep old params working.
6. **Materials:** add presets to `common/materials/library.json` (a procedural `kind`, plus optional CC0 `maps`). Palettes in `common/palettes/*.json` map slots to material ids. Scenes choose a `palette` and can override per object with `materials: {slot: id}`.
7. After changing anything in `common/`, run `vk asset index && vk asset check`.

## Commands

```
vk create <p> | list | status <p> | delete <p> [-y] | clean [<p>] [--all]
vk extract <p> | plan <p> | verify <p> | validate <p> | stage <p> <stage> <state> [-n note]
vk render <p>                      # game (Vite dev server, http://localhost:5173/?project=<p>)
vk asset list|preview|index|check|promote
vk setup | doctor | fetch-assets
npm run typecheck                # engine tsc + cli build: must pass before you finish
```

## Definition of done for a change

- `npm run typecheck` passes.
- `vk asset check` passes, and `vk validate <p>` reports `valid` for the projects you touched.
- For pipeline changes: `vk verify flat-105` still prints `GATE PASSED`.
- For engine or asset changes: load `vk render <p>` or the preview page, with no console errors.

## Don'ts

- Don't edit `plan.json` by hand. Edit `plan.draft.json` and run `vk plan`.
- Don't put project-specific furniture straight into `common/` without the promote step.
- Don't commit `work/`, `.venv/`, `node_modules/` or downloaded CC0 binaries above roughly 5 MB without asking.
- Don't recreate copyrighted game assets or characters. Use the code-generated mannequin or CC0 models (Quaternius, Kenney, Poly Haven, ambientCG).
