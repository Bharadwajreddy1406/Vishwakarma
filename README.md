# Vishwakarma AI

**Walk through your house before it's built.**

Vishwakarma takes a floor plan (a vector PDF, or an image), plus any reference photos, and builds a **3D house you can walk through in the browser**. The controls are like a game: WASD to move, sprint, jump, crouch, first- or third-person view, and **F** to open doors, wardrobes, the fridge, drawers and windows. Physics are real: you can push the chairs around.

It's a **Claude Code workspace**. Scripts do the measuring, Claude does the interpreting, and every 3D asset it builds is parametric and reusable across projects.

```
floor-plan.pdf/jpg ─► extract ─► interpret ─► verify (matplotlib replica vs drawing) ─► furnish ─► render (WebGL + WASM physics)
                      script     Claude       script + Claude, gated                     Claude       vk render <project>
```

---

## Quick start

```powershell
# one-time setup (Node ≥ 20, Python ≥ 3.10)
npm install
npm run build:cli
npm link -w cli          # makes `vk` available everywhere (or use: node cli/bin/vk.js …)
vk setup                 # Python venv + pipeline deps
vk doctor                # everything should be ✔

# a new house
vk create my-flat
#   → drop the floor plan + reference photos into projects/my-flat/input/
#   → in Claude Code:  /vk-build my-flat
vk render my-flat        # opens http://localhost:5173/?project=my-flat
```

A finished example is included: **`vk render flat-105`** (a 2BHK ground-floor flat, north-facing entrance).

## Controls

| Key | Action | Key | Action |
|---|---|---|---|
| `W` `A` `S` `D` | move | Mouse | look |
| `Shift` | sprint | `Space` | jump |
| `C` | crouch (toggle; you can't stand up under a table) | `V` | first ↔ third person |
| `F` | open / close what you're looking at | `O` | overview (orbiting dollhouse view) |
| `H` | ceilings on/off | `M` | minimap |
| `1`–`9` | jump to a viewpoint (sofa, bed, dining, mandir, kitchen, each commode…); `0` / WASD to get up | `T` | morning → noon → golden hour → dusk → night |
| `[` `]` | time of day −/+ 30 min | `L` | house lights auto / on / off |
| `E` | editor: move furniture · measure · resize open walls | `Z` | undo (in the editor) |
| `G` | graphics quality (low / medium / high) | `` ` `` | show physics colliders |
| `Esc` | pause menu: time slider, viewpoints, character, mouse sensitivity | | |

### Editor (press `E`)

| Tool | How |
|---|---|
| `1` **Move** | Aim at furniture to see its size. Click to pick it up; it follows where you look and snaps flat against a wall. Live clearances to the surrounding walls show in feet-inches (red under 1'6"). Click to place. `R` rotates 90°, the wheel rotates 5°, `X` cuts, `P` pastes where you aim, `Del` deletes, right-click cancels. |
| `2` **Measure** | Click two points. The distance shows in feet-inches and metres, split into horizontal and height parts. Lines snap to the room axes and stay pinned. `Backspace` clears them. The current room's clear size is always shown top left. |
| `3` **Walls** | Only **open-ended interior walls** can be resized: walls whose end stops in an open area, such as the TV wall between the hall and dining. Exterior walls and walls closed at both ends stay fixed (shown red). Click the wall, look along it to slide its open end in ½" steps, and click to set. The wall length, the change, and the clear opening left all show live. `Backspace` resets the wall to the plan. |

`Z` undoes. Every change saves to `scene.json` immediately: furniture under `objects`, wall changes under `plan_edits.walls`. `plan.json` always stays exactly as drawn.

### Realism features

- **Real dimensions:** 10'0" slab with a 9'0" POP false ceiling (cove band, raised centre, warm LED cove in the living, dining and bedrooms; flat POP elsewhere). 7'0" doors. A 5'11" character.
- **Time of day:** real sun path for the site latitude (`plan.site.latitude`, default 17.4°N) and date. The sun's direction, colour and intensity, the physical sky, the indoor bounce light and exposure all follow the clock. House lights switch on at dusk.
- **Materials:** CC0 photoscanned PBR textures from Poly Haven (marble and laminate floors, bathroom marble tiles to 4'6" with a border strip, anti-skid floor tiles, teak, walnut and oak, plaster relief, fabric weaves, outdoor pavers). Skirting boards, and pleated curtains that draw closed with F.
- **Rendering:** WebGL2 with PBR. Ground-truth ambient occlusion, soft bloom, neutral PBR tone mapping, and soft sun shadows through the windows.
- **Characters:** a high-poly procedural human (default), or the three.js Xbot / Soldier models with motion-capture walk and run (pause menu → Character).

---

## CLI reference

```
Usage: vk [options] [command]

Vishwakarma AI — floor plan to walkable 3D house

Commands:
  create|new <name>                       create a new project (projects/<name>/{input,work,assets})
  list|ls                                 list projects
  status <name>                           show pipeline stage status
  stage [options] <name> <stage> <state>  set a stage state (used by Claude skills): pending|done|failed|needs-review
  delete|rm [options] <name>              delete a project (irreversible)
  clean [options] [name]                  remove generated intermediates (work/); --all also clears build caches
  extract [options] <name>                stage 1: extract raw geometry from the plan PDF/image -> work/raw.json
  plan <name>                             stage 2: convert plan.draft.json (source pixels) -> plan.json (meters) and validate
  verify <name>                           stage 3: render plan.json with matplotlib and compare to the source
  validate <name>                         validate plan.json / scene.json against the schemas
  render|open <name>                      start the web app and open the walkable 3D house in the browser
  asset                                   shared asset library (common/)
  fetch-assets [options]                  download pinned CC0 textures / HDRIs listed in common/sources.json
  setup                                   create the Python venv and install pipeline deps
  doctor                                  check the toolchain
  help [command]                          display help for command
```

### Projects

| Command | Options | What it does |
|---|---|---|
| `vk create <name>` | | Creates `projects/<name>/` with `input/`, `work/`, `assets/` and `project.json`. Names are lowercase letters, digits, `-` and `_`. |
| `vk list` | | Every project, with stages done and last update. |
| `vk status <name>` | | Per-stage state (`extract`, `interpret`, `verify`, `furnish`, `play`) and the detected plan source. |
| `vk render <name>` | | Starts the Vite dev server and opens the game. It live-reloads when `plan.json`, `scene.json` or anything in `common/` changes. |
| `vk delete <name>` | `-y, --yes` skip confirmation | Permanently deletes the project, **including its inputs**. Asks first. |
| `vk clean [name]` | `--all` every project + engine build + Vite caches | Removes the disposable `work/` intermediates and reports the space freed. |
| `vk stage <name> <stage> <state>` | `-n, --note <note>` | Sets a stage state by hand (Claude skills use this). |

### Pipeline

| Command | Options | What it does |
|---|---|---|
| `vk extract <name>` | `-s, --source <file>` (default: first PDF in `input/`, else an image named `*plan*`) · `-p, --page <n>` PDF page (default 0) | Rasterises the source and detects wall runs. For PDFs, also pulls vector lines, arcs, text and dimension strings. Writes `work/raw.json`, `page.png`, `grid.png` (pixel rulers), `raw_overlay.png` and `walls_mask.png`. |
| `vk plan <name>` | | Converts Claude's `plan.draft.json` (written in source pixels) into a metric `plan.json`, then validates it. |
| `vk verify <name>` | | Redraws `plan.json` with matplotlib (`work/plan.png`), overlays it on the drawing (`work/overlay.png`) and writes `work/report.md`. **Gate:** wall F1 ≥ 0.85 and every labelled room within ±3 cm. Exit code 0 = pass, 2 = fix and re-run. |
| `vk validate <name>` | | Checks `plan.json` and `scene.json` against the JSON schemas, plus semantics: walls exist, openings fit, generators exist, objects sit inside their rooms, the spawn point is valid. |

### Shared assets

```
Usage: vk asset [options] [command]
  list [options]                    list shared generators, materials, palettes
  preview [options] <id>            turntable preview of one generator; extra params as JSON
  promote [options] <project> <id>  move a project-local asset into common/ so every project can reuse it
  index [project]                   regenerate registry.json from generator code (common/, or a project's assets/)
  check                             verify registry.json matches the files on disk
```

| Command | Options | What it does |
|---|---|---|
| `vk asset list` | `-t, --tag <tag>` · `-k, --kind generators\|materials\|palettes` | Browses the library: `vk asset list -t kitchen`. |
| `vk asset preview <id>` | `-p, --params <json>` | A turntable with a live parameter panel. Press F to test moving parts. Example: `vk asset preview dining-table -p '{"seats":3,"sides":2}'` |
| `vk asset index [project]` | | Rebuilds `registry.json` from each generator's `meta` (always in sync with the code). |
| `vk asset check` | | Every registry entry has a file, and every file is registered. |
| `vk asset promote <project> <id>` | `-k, --kind generators\|materials\|palettes` | Moves a project-local asset into `common/` and updates both registries. |
| `vk fetch-assets` | `--force` re-download | Downloads the CC0 textures, HDRIs and models pinned in `common/sources.json`. Optional: everything has a procedural fallback. |

### Environment

| Command | What it does |
|---|---|
| `vk setup` | Creates `.venv` and installs `pipeline/requirements.txt`. |
| `vk doctor` | Checks Node, the Python venv and deps, engine deps, the registry, and fetched CC0 assets. |

---

## How a project gets built

1. **`vk create <p>`**, then drop the inputs into `projects/<p>/input/`:
   - the floor plan: a vector PDF is best, but JPG/PNG works;
   - reference photos: elevations, renders, photos of a miniature model;
   - optionally `notes.md`: floor, orientation ("north-facing entrance"), ceiling height, finishes you like.
2. In Claude Code: **`/vk-build <p>`**. Claude runs the stage skills in order:
   - **extract**: `vk extract`.
   - **interpret** (skill `vk-interpret`): Claude reads the drawing (zoomed crops with pixel rulers), calibrates the scale from several labelled rooms, and writes `plan.draft.json`: walls, doors (hinge and swing), windows, rooms, the furniture symbols it saw, and orientation. Then `vk plan`.
   - **verify** (skill `vk-verify-plan`): a matplotlib replica plus an overlay on the original. Claude iterates until the gate passes. Conflicting labels in the source get documented, not hidden.
   - **furnish** (skill `vk-scene`): Claude places parametric assets from the shared library, writes any missing ones as new reusable generators (`vk-asset`), picks a palette from your reference photos, and promotes generic assets to `common/` (`vk-promote`).
3. **`vk render <p>`** and walk in.

## Reusable assets

Everything in `common/` is shared by every project:

- **`common/generators/*.ts`**: parametric 3D assets. Each exports `meta` (params, material slots, tags) and `build()`. Examples:
  - `dining-table {seats: 3, sides: 2}` → a 6-seater with pushable chairs;
  - `wardrobe {width: 2.2, loft: true}` → shutters, a hanging rod and a loft, all of which open;
  - `kitchen-counter {length, sinkAt, hobAt}`;
  - `sofa {seats}`, `fridge {style}`, `mandir {idols}`, `bed {size}`;
  - `door {style: panel|main|bathroom|puja}`, `window {style: sliding|ventilator|grille}`.
  `vk asset list` shows them all.
- **`common/materials/library.json`**: PBR material presets (vitrified tile, teak, granite, marble, fabrics, brass…). Procedural textures render offline; CC0 photo maps are used automatically when fetched.
- **`common/palettes/*.json`**: slot → material maps (`warm-indian-modern`, …). A scene picks a palette and overrides per object or room.
- **`common/registry.json`**: a generated index Claude searches before building anything new.

## Repository layout

```
cli/        `vk` command (TypeScript)
pipeline/   Python: extract · draft2plan · render_plan · compare · validate
engine/     three.js (WebGL) + Rapier (WASM physics) game · asset preview · scripts/smoke.mjs (headless screenshots)
common/     shared generators, materials, palettes, textures, HDRIs, models, registry
schemas/    plan.schema.json · scene.schema.json
projects/   one folder per house (inputs, plan.draft.json, plan.json, scene.json, local assets, work/)
.claude/skills/  vk-build · vk-interpret · vk-verify-plan · vk-scene · vk-asset · vk-promote
AGENTS.md   conventions for any coding agent · CLAUDE.md  Claude Code specifics
```

## Tech

- **Rendering:** three.js on WebGL2, with ACES tone mapping, a physical sky, image-based lighting, a shadow-casting sun placed from the plan's true north, and warm room lights.
- **Physics:** Rapier compiled to WASM. A kinematic character controller (capsule, auto-step, snap-to-ground, headroom-checked crouch) pushes dynamic furniture. Door, drawer and shutter colliders follow their animations.
- **Pipeline:** PyMuPDF (vector PDFs), OpenCV (raster plans), shapely, matplotlib, jsonschema.

## Development

```powershell
npm run typecheck                         # engine (tsc) + CLI build
npm run dev                               # engine dev server only
node engine/scripts/smoke.mjs flat-105 out/ '[{"name":"overview","overview":1}]'   # headless render + console check (needs the dev server)
```

## Roadmap

- **v1 (now):** plan → verified plan → furnished, walkable, interactive house.
- **v2:** pick up, carry and place objects with your hands (physics grab). Rearrange furniture and save the layout back to `scene.json`.
