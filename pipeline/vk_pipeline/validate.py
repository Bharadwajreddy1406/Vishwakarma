"""Schema + semantic validation of a project's plan.json and scene.json.

    python -m vk_pipeline.validate <project_dir>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator
from shapely.geometry import Point, Polygon

from .geometry import walls_of

SCHEMAS = Path(__file__).resolve().parents[2] / "schemas"
COMMON = Path(__file__).resolve().parents[2] / "common"


def schema_errors(doc: dict, schema_file: str) -> list[str]:
    schema = json.loads((SCHEMAS / schema_file).read_text(encoding="utf-8"))
    return [f"{'/'.join(map(str, e.path)) or '<root>'}: {e.message}" for e in Draft202012Validator(schema).iter_errors(doc)]


def check_plan(plan: dict) -> list[str]:
    errs = schema_errors(plan, "plan.schema.json")
    if errs:
        return errs
    walls = walls_of(plan)
    ids = [w["id"] for w in plan["walls"]] + [o["id"] for o in plan["openings"]] + [r["id"] for r in plan["rooms"]]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        errs.append(f"duplicate ids: {sorted(dup)}")
    for o in plan["openings"]:
        w = walls.get(o["wall"])
        if not w:
            errs.append(f"opening {o['id']}: unknown wall {o['wall']}")
            continue
        if o["offset"] - o["width"] / 2 < -1e-3 or o["offset"] + o["width"] / 2 > w.length + 1e-3:
            errs.append(f"opening {o['id']}: extends past wall {w.id} (len {w.length:.3f}, offset {o['offset']}, width {o['width']})")
    room_ids = {r["id"] for r in plan["rooms"]}
    for r in plan["rooms"]:
        if not Polygon(r["polygon"]).is_valid:
            errs.append(f"room {r['id']}: invalid polygon")
    for o in plan["openings"]:
        for c in o.get("connects", []):
            if c not in room_ids and c != "outside":
                errs.append(f"opening {o['id']}: connects unknown room {c}")
    return errs


def check_scene(scene: dict, plan: dict, project: Path) -> list[str]:
    errs = schema_errors(scene, "scene.schema.json")
    if errs:
        return errs
    reg = json.loads((COMMON / "registry.json").read_text(encoding="utf-8"))
    local_path = project / "assets" / "registry.json"
    local = json.loads(local_path.read_text(encoding="utf-8")) if local_path.exists() else {"generators": []}
    gens = {g["id"] for g in reg["generators"]}
    local_gens = {g["id"] for g in local["generators"]}
    rooms = {r["id"]: Polygon(r["polygon"]) for r in plan["rooms"]}
    seen = set()
    for ob in scene["objects"]:
        if ob["id"] in seen:
            errs.append(f"object {ob['id']}: duplicate id")
        seen.add(ob["id"])
        g = ob["generator"]
        if g.startswith("local:"):
            if g[6:] not in local_gens:
                errs.append(f"object {ob['id']}: local generator {g[6:]} not in assets/registry.json")
        elif g not in gens:
            errs.append(f"object {ob['id']}: unknown generator {g} (see `vk asset list`)")
        if ob.get("room") and ob["room"] in rooms:
            if not rooms[ob["room"]].buffer(0.05).contains(Point(ob["position"])):
                errs.append(f"object {ob['id']}: position {ob['position']} outside room {ob['room']}")
        elif ob.get("room"):
            errs.append(f"object {ob['id']}: unknown room {ob['room']}")
    sp = scene.get("spawn", {}).get("position")
    if sp and not any(p.contains(Point(sp)) for p in rooms.values()):
        errs.append(f"spawn {sp} is not inside any room")
    return errs


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    project = Path(args[0])
    plan_p, scene_p = project / "plan.json", project / "scene.json"
    if not plan_p.exists():
        print("plan.json missing")
        return 1
    plan = json.loads(plan_p.read_text(encoding="utf-8"))
    errs = [f"plan: {e}" for e in check_plan(plan)]
    if scene_p.exists():
        errs += [f"scene: {e}" for e in check_scene(json.loads(scene_p.read_text(encoding="utf-8")), plan, project)]
    for e in errs:
        print(e)
    print("valid" if not errs else f"{len(errs)} problem(s)")
    return 0 if not errs else 1


if __name__ == "__main__":
    sys.exit(main())
