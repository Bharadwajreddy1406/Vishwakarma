---
name: vk-verify-plan
description: Stage 3 of Vishwakarma. Replicate plan.json with matplotlib, overlay it on the source drawing, and iterate on plan.draft.json until the verification gate passes (wall F1 ≥ 0.85, labelled room sizes within ±3 cm). Use after `vk plan`, or whenever plan accuracy is in question.
---

# vk-verify-plan — prove the plan matches the drawing

1. `node cli/bin/vk.js verify <p>`. It writes `work/plan.png`, `work/overlay.png` and `work/report.md`. Exit code: 0 means passed, 2 means it needs fixes.
2. **Always look at both images**, even when the gate passes. A numeric pass can hide a mirrored door swing or a missing window.
   - `plan.png`: check every room name and size, every door's hinge side and arc, every window, and the north arrow.
   - `overlay.png`: magenta means agreement; **red** is in plan.json only (an extra or misplaced wall); **blue** is in the drawing only (a missed wall, or drawn furniture the detector picked up).
3. Fix the cause in `plan.draft.json`, never in plan.json:
   - A blue strip parallel to a red one means the centerline is off by a few px. Re-measure from a zoomed crop.
   - Blue blobs inside rooms are furniture. Add them to `ignore` (and list them in `fixtures` if you haven't).
   - A room dimension off by several cm means a wrong inner face, or the wrong scale. Check the other rooms on the same axis before changing `units_per_m`.
   - A label that contradicts the drawing even though the geometry agrees with its neighbours is an error in the source. Keep the geometry, set `"gate": false` on that label, and explain in `notes`.
4. `vk plan <p>`, then `vk verify <p>`. Repeat. Each iteration should change something specific. Stop after about 5 rounds and report what's still unresolved.
5. When done, tell the user: F1, each room's labelled versus computed size, any nominal or conflicting labels, and the path to `work/plan.png` so they can check it themselves.
