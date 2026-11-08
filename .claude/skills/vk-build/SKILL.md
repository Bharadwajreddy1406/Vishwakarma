---
name: vk-build
description: End-to-end build of a Vishwakarma project, from floor plan PDF/image to a verified plan.json to a furnished scene.json to a walkable 3D house. Use when the user says "build <project>", "/vk-build <project>", has just dropped a floor plan into projects/<p>/input, or asks to rebuild or continue a project.
---

# vk-build — orchestrate the whole pipeline

Argument: a project name. If it's missing, run `node cli/bin/vk.js list` and ask which project.

Each stage is resumable. Check `vk status <p>` first and continue from the first stage that isn't `done`, unless the user asks for a rebuild.

## 0. Prepare
1. `node cli/bin/vk.js status <p>`. If the project doesn't exist: `vk create <p>`, then ask the user to put inputs in `projects/<p>/input/` (inputs left at the repo root can be moved in. Say so.)
2. Read every file in `input/`: the plan (PDF, or an image), reference photos, and `notes.md`. Use the Read tool on the images and describe briefly what you see: the unit, its labels, the orientation hints, and the exterior and interior style.
3. If something that changes the geometry is ambiguous, ask once and batch the questions: which unit when a sheet shows several, which way is north or which way the entrance faces, ground floor or upper floor.
4. `node cli/bin/vk.js doctor` must pass. If deps are missing, run `vk setup` / `npm install`.

## 1. Extract
`node cli/bin/vk.js extract <p>` (pass `--source input/<file>` if auto-detection picks the wrong file). Then Read `work/raw_overlay.png`.

## 2. Interpret
Follow the **vk-interpret** skill. It produces `plan.draft.json`, then `vk plan <p>`.

## 3. Verify (loop)
Follow the **vk-verify-plan** skill until `vk verify <p>` prints `GATE PASSED`, or until a remaining conflict in the source is documented. **Show the user `work/plan.png`** (give its path) and summarise the dimension table.

## 4. Furnish
Follow the **vk-scene** skill. It produces `scene.json`, which must pass `vk validate <p>`. Any new asset goes through **vk-asset**, and generic ones through **vk-promote**.

## 5. Hand over
- `npm run typecheck` (engine and CLI) must pass if you touched code.
- Tell the user: `node cli/bin/vk.js render <p>` (or `vk render <p>`), plus the controls: WASD, Shift sprint, Space jump, C crouch, V FPP/TPP, F open/close, H ceilings, M minimap, G graphics.
- Summarise: rooms, gate result, assumptions made, assets reused versus created versus promoted.
- `vk stage <p> furnish done`.
