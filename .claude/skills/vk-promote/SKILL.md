---
name: vk-promote
description: Promote project-local assets (generators, materials, palettes, textures) into the shared common/ library so every future project can reuse them, keeping the registry consistent. Use at the end of a project build, when an asset created for one project is generic, or when the user says "make this reusable".
---

# vk-promote — project asset → common/

## Decide
Promote when the asset is **generic**: a sofa, a lamp, a shoe rack or a "brass pooja bell set" can be. Keep it local when it's tied to this house (a specific odd-shaped niche, or this builder's one-off facade panel). If you're not sure, promote it, but parametrise the house-specific parts first.

Before promoting, the asset must:
- have no hard-coded project dimensions (everything is a param with sensible defaults);
- use material slots only, with no project-specific material ids in its `meta.slots` defaults;
- import from `../../../common/generators/lib/...` or `@common/...` (relative paths into the project folder will break once it moves).

## Generators
1. Make sure `projects/<p>/assets/registry.json` has the entry (`vk asset index <p>`).
2. `node cli/bin/vk.js asset promote <p> <id>` moves the file to `common/generators/` and moves the registry entry.
3. Fix the imports in the moved file: `../../../common/generators/lib/x` becomes `./lib/x`.
4. In `projects/<p>/scene.json`, replace `"local:<id>"` with `"<id>"`.
5. `vk asset index && vk asset check && npm run typecheck && vk validate <p>`.

## Materials, palettes, textures
- Materials: move the preset from the project into `common/materials/library.json`. Ids are kebab-case and descriptive (`granite-tan-brown`, not `kitchen-top-2`).
- Palettes: move to `common/palettes/<id>.json`, with a `description` saying what style or reference it came from.
- Textures, HDRIs and models: CC0 only. Put them in `common/textures|hdri|models/`, add the source URL and licence to `common/sources.json` (so `vk fetch-assets` can re-download them), and reference them from a material's `maps`.
- Then run `vk asset index`.

## Report
Tell the user what was promoted and what stayed local, and why.
