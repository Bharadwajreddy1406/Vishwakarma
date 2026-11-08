# CLAUDE.md

@AGENTS.md

## Claude Code specifics

- **You are the "brain" of the pipeline.** Scripts extract and measure; you interpret and verify. Start a project build with the skill `/vk-build <project>`. It walks through the stage skills in order: `vk-interpret`, then `vk-verify-plan`, then `vk-scene`.
- **Look at the images.** Use the Read tool on `work/page.png`, `work/grid.png`, `work/raw_overlay.png`, `work/plan.png` and `work/overlay.png`, and on the user's reference photos in `input/`. For precise coordinates, render zoomed crops with pixel rulers into the scratchpad (see the `vk-interpret` skill) instead of guessing from the full image.
- **The numbers come from the drawing.** Calibrate the scale from several labelled rooms and report the agreement between them. Write every measured pixel value into `plan.draft.json` so the user can audit it.
- **Report honestly.** If the verify gate fails, or you had to guess (wall thickness, a door swing that isn't drawn, ceiling height), list it in `notes` and in your reply. Don't silently tune numbers until the gate passes.
- **Ask the user** only about decisions the drawing can't answer and that change the result: the floor or unit when a sheet shows several flats, orientation when no north arrow and no description exist, flooring and colour preferences. Default sensibly and say what you assumed.
- **Reuse first.** Before writing any generator, run `vk asset list`. Write new assets as parametric generators (the `vk-asset` skill) and promote generic ones (`vk-promote`).
- Windows host: the shell is PowerShell, with Git Bash also available. Python is `.venv/Scripts/python.exe`, and pipeline modules run from `pipeline/` (`-m vk_pipeline.<module>`). `vk` is `node cli/bin/vk.js` unless it has been linked.

## Workspace memory

- The user gives orientation and context in chat (for example "ground floor, north-facing entrance"). Record it in `plan.draft.json` `site` and `notes`; that's where it's kept.
- Each project's `input/notes.md`, when present, is the user's brief. Read it before interpreting.
