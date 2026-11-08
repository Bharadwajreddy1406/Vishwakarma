---
name: vk-asset
description: Create or extend a reusable parametric 3D asset generator (furniture, fixture, appliance, decor) for Vishwakarma, with interactive parts (hinged doors, drawers, sliding panes) and material slots. Use when a scene needs an object that `vk asset list` doesn't cover, or when the user asks for a new or improved 3D asset.
---

# vk-asset — write a reusable generator

## Before writing
1. `node cli/bin/vk.js asset list` (try `--tag <room>`). Can an existing generator get there with params? Then add a **param** to it (keeping the old default behaviour, and bumping `meta.version`) instead of writing a new file.
2. Read `common/generators/lib/types.ts` (the contract), `lib/kit.ts` (cabinet/drawer/legs) and `lib/shapes.ts`. Good models to copy:
   - `wardrobe.ts` and `kitchen-counter.ts`: cabinets built on the kit;
   - `fridge.ts`: hinged doors and interior details;
   - `dining-table.ts`: m×n sizing and spawned dynamic children;
   - `door.ts`: double leaves and styles.

## Write it
- Location: `projects/<p>/assets/<id>.ts` (project-local, referenced as `"local:<id>"`). The file name must equal `meta.id`.
- Imports are relative to common: `import { box } from '../../../common/generators/lib/shapes'`. The `@common/...` alias works too.
- Rules:
  - **Meters.** Origin at the centre of the footprint, floor level. **Front = +Z.**
  - **Every dimension and count is a param** with a default, min and max. Derive sizes from counts, as in the m×n table: `length = seats * pitch + margin`.
  - **Materials only via `ctx.mat(slot)`**, with defaults in `meta.slots`. Use existing slot names where they fit: wood, fabric, metal, glass, ceramic, counter, carcass, front, handle, linen…
  - **Moving parts:** build them under a `pivot([hingeX, y, z])` and push `{ pivot, kind: 'hinge', axis: 'y', amount: ±rad, label }`, or `kind: 'slide'`.
    - A left-hinged leaf extending +x opens toward +Z with a **negative** angle.
    - A right-hinged leaf opens toward +Z with a positive angle.
    - Use the same `group` string on parts that open together.
  - **Colliders:** each mesh gets an automatic box collider. Turn it off on small details (`{ collider: false }`). Add an invisible box as a blocker for lattices and open fronts.
  - **Dynamic** (pushable) objects: set `meta.physics = 'dynamic'` and `meta.mass`. Children that should move on their own go in `spawn`.
  - Fans: `userData.spin = rad/s`. Flames and lights: `userData.flicker = true`. Lamps may add a `THREE.PointLight`.
- Keep the polygon budget sane: no more than about 5k triangles per object, and reuse geometry in loops.

## Check
1. Register: add `{id, file, tags, description}` to `projects/<p>/assets/registry.json` (or run `vk asset index <p>`).
2. `npm run typecheck` (it covers `common/generators`; for project assets, the engine build in step 3 will flag errors).
3. `vk asset preview local:<id>` doesn't work for local assets yet. Preview by temporarily placing the asset in the scene, or write it directly in `common/` when it's clearly generic, then: `vk asset preview <id> -p '{...}'`. Turn it, press **F**, and try extreme params (min and max).
4. Use it in `scene.json`, then run `vk validate <p>`.
5. If it's generic, follow the **vk-promote** skill.
