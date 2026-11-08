"""Shared plan geometry: wall polygons with openings cut out, plan <-> source transforms."""
from __future__ import annotations

import math
from dataclasses import dataclass

from shapely.geometry import Polygon, box
from shapely.ops import unary_union


@dataclass
class Wall:
    id: str
    a: tuple[float, float]
    b: tuple[float, float]
    t: float
    exterior: bool

    @property
    def length(self) -> float:
        return math.dist(self.a, self.b)

    @property
    def dir(self) -> tuple[float, float]:
        L = self.length or 1.0
        return ((self.b[0] - self.a[0]) / L, (self.b[1] - self.a[1]) / L)

    @property
    def normal(self) -> tuple[float, float]:
        dx, dy = self.dir
        return (-dy, dx)  # left of a->b

    def point(self, s: float, n: float = 0.0) -> tuple[float, float]:
        dx, dy = self.dir
        nx, ny = self.normal
        return (self.a[0] + dx * s + nx * n, self.a[1] + dy * s + ny * n)

    def quad(self, s0: float, s1: float, extend: float = 0.0) -> Polygon:
        """Rectangle covering [s0, s1] along the wall, full thickness. `extend` grows the ends (for corner joints)."""
        h = self.t / 2
        pts = [self.point(s0 - extend, -h), self.point(s1 + extend, -h), self.point(s1 + extend, h), self.point(s0 - extend, h)]
        return Polygon(pts)


def walls_of(plan: dict) -> dict[str, Wall]:
    return {w["id"]: Wall(w["id"], tuple(w["a"]), tuple(w["b"]), w["thickness"], w.get("exterior", False)) for w in plan["walls"]}


def wall_solid(plan: dict, cut_openings: bool = True, kinds: tuple[str, ...] | None = None):
    """Union of all walls (ends extended by t/2 so corners close), minus openings."""
    walls = walls_of(plan)
    solid = unary_union([w.quad(0, w.length, extend=w.t / 2) for w in walls.values()])
    if cut_openings:
        holes = []
        for o in plan.get("openings", []):
            if kinds and o["type"] not in kinds:
                continue
            w = walls.get(o["wall"])
            if not w:
                continue
            s0, s1 = o["offset"] - o["width"] / 2, o["offset"] + o["width"] / 2
            # cut a little deeper than the wall so adjoining walls do not leave slivers
            holes.append(Polygon([w.point(s0, -w.t), w.point(s1, -w.t), w.point(s1, w.t), w.point(s0, w.t)]))
        if holes:
            solid = solid.difference(unary_union(holes))
    return solid


def bounds(plan: dict) -> tuple[float, float, float, float]:
    return wall_solid(plan, cut_openings=False).bounds


class SourceXform:
    """plan meters (y up) <-> source pixels (y down), using plan.source.units_per_m / origin and raw.json px_per_unit."""

    def __init__(self, plan: dict, px_per_unit: float = 1.0):
        src = plan.get("source") or {}
        self.k = src.get("units_per_m", 0) * px_per_unit
        ox, oy = src.get("origin", [0, 0])
        self.ox, self.oy = ox * px_per_unit, oy * px_per_unit
        if not self.k:
            raise ValueError("plan.source.units_per_m is required for comparison")

    def to_px(self, x: float, y: float) -> tuple[float, float]:
        return (self.ox + x * self.k, self.oy - y * self.k)

    def to_m(self, px: float, py: float) -> tuple[float, float]:
        return ((px - self.ox) / self.k, (self.oy - py) / self.k)


def iter_polys(geom):
    if geom.is_empty:
        return
    if geom.geom_type == "Polygon":
        yield geom
    else:
        for g in geom.geoms:
            yield from iter_polys(g)


def room_extent(room: dict) -> tuple[float, float]:
    xs = [p[0] for p in room["polygon"]]
    ys = [p[1] for p in room["polygon"]]
    return max(xs) - min(xs), max(ys) - min(ys)


def room_box(room: dict):
    return box(*Polygon(room["polygon"]).bounds)
