import * as THREE from 'three';
import type { GenContext, GenResult, GeneratorMeta, Interactable } from './lib/types';
import { box, boxOn, cyl } from './lib/shapes';
import { cabinet } from './lib/kit';

export const meta: GeneratorMeta = {
  id: 'kitchen-counter',
  version: 1,
  description: 'Straight modular kitchen run: granite top, base cabinets (doors + top drawer row), optional sink, gas hob, wall cabinets and dado backsplash. Build an L-kitchen from two runs. Front faces +z.',
  tags: ['kitchen', 'counter', 'cabinet', 'interactive', 'parametric-mxn'],
  params: {
    length: { type: 'number', default: 2.4, min: 0.6, max: 6 },
    depth: { type: 'number', default: 0.6, min: 0.45, max: 0.75 },
    height: { type: 'number', default: 0.85 },
    sinkAt: { type: 'number', default: -1, description: 'sink centre from left end (m); -1 = none' },
    hobAt: { type: 'number', default: -1, description: 'hob centre from left end (m); -1 = none' },
    hobBurners: { type: 'int', default: 3, min: 2, max: 5 },
    wallCabinets: { type: 'bool', default: true },
    backsplash: { type: 'bool', default: true },
    chimney: { type: 'bool', default: true, description: 'hood above the hob' },
  },
  slots: { counter: 'granite-black', carcass: 'laminate-white-gloss', front: 'laminate-sage', handle: 'metal-steel', steel: 'metal-steel', hob: 'metal-black', dado: 'tile-kitchen-dado', glass: 'glass-clear' },
};

export function build(p: Record<string, any>, ctx: GenContext): GenResult {
  const g = new THREE.Group();
  const L: number = p.length, D: number = p.depth, H: number = p.height;
  const inter: Interactable[] = [];
  const plinth = 0.1;
  const topT = 0.02;
  const baseH = H - plinth - topT;

  g.add(box(L - 0.02, plinth, D - 0.08, ctx.mat('hob'), [0, plinth / 2, -0.04]));
  const base = cabinet({
    width: L, height: baseH, depth: D - 0.02, y0: plinth, doors: Math.max(1, Math.round(L / 0.6)), drawers: 1, drawerHeight: 0.16,
    shelves: 1, carcass: ctx.mat('carcass'), front: ctx.mat('front'), handleMat: ctx.mat('handle'), label: 'Kitchen cabinet', handleHorizontal: true,
  });
  base.group.position.z = -0.01;
  g.add(base.group);
  inter.push(...base.interactables);

  // counter top (with sink cut-out faked by a recessed bowl on top)
  g.add(box(L, topT, D + 0.02, ctx.mat('counter'), [0, H - topT / 2, 0.01]));
  g.add(box(L, 0.08, 0.015, ctx.mat('counter'), [0, H + 0.04, -D / 2 + 0.0075], { collider: false }));

  if (p.sinkAt >= 0) {
    const x = -L / 2 + p.sinkAt;
    const steel = ctx.mat('steel');
    g.add(box(0.5, 0.012, 0.42, steel, [x, H + 0.002, 0.02], { collider: false }));
    g.add(box(0.44, 0.005, 0.36, ctx.mat('hob'), [x, H + 0.009, 0.02], { collider: false }));
    // tap
    g.add(cyl(0.015, 0.02, 0.25, steel, [x, H + 0.125, -D / 2 + 0.08], { collider: false }));
    const spout = cyl(0.01, 0.01, 0.16, steel, [x, H + 0.24, -D / 2 + 0.15], { collider: false });
    spout.rotation.x = Math.PI / 2;
    g.add(spout);
  }
  if (p.hobAt >= 0) {
    const x = -L / 2 + p.hobAt;
    const hobW = 0.25 * p.hobBurners;
    g.add(boxOn(hobW, 0.02, 0.5, ctx.mat('glass'), x, H, 0.02, { collider: false }));
    g.add(boxOn(hobW - 0.02, 0.008, 0.48, ctx.mat('hob'), x, H, 0.02, { collider: false }));
    for (let i = 0; i < p.hobBurners; i++) {
      const bx = x - hobW / 2 + 0.125 + i * 0.25;
      g.add(cyl(0.05, 0.06, 0.02, ctx.mat('steel'), [bx, H + 0.035, 0.0], { collider: false }));
      g.add(cyl(0.008, 0.008, 0.03, ctx.mat('steel'), [bx, H + 0.012, 0.25], { collider: false }));
    }
    if (p.chimney) {
      g.add(boxOn(Math.max(0.6, hobW), 0.12, 0.5, ctx.mat('steel'), x, H + 0.75, -D / 2 + 0.25));
      g.add(boxOn(0.3, 0.9, 0.25, ctx.mat('steel'), x, H + 0.87, -D / 2 + 0.125));
    }
  }
  if (p.backsplash) {
    g.add(box(L, 0.6, 0.01, ctx.mat('dado'), [0, H + 0.3, -D / 2 + 0.005], { collider: false }));
  }
  if (p.wallCabinets) {
    const wallD = 0.35, wallH = 0.7, y0 = H + 0.6;
    const skip = p.hobAt >= 0 && p.chimney ? [-L / 2 + p.hobAt - 0.35, -L / 2 + p.hobAt + 0.35] : null;
    const segments: [number, number][] = skip ? [[-L / 2, skip[0]], [skip[1], L / 2]] : [[-L / 2, L / 2]];
    for (const [a, b] of segments) {
      const w = b - a;
      if (w < 0.3) continue;
      const wc = cabinet({
        width: w, height: wallH, depth: wallD, y0, doors: Math.max(1, Math.round(w / 0.6)), shelves: 1,
        carcass: ctx.mat('carcass'), front: ctx.mat('carcass'), handleMat: ctx.mat('handle'), label: 'Wall cabinet', liftUp: true,
      });
      wc.group.position.set((a + b) / 2, 0, -D / 2 + wallD / 2);
      g.add(wc.group);
      inter.push(...wc.interactables);
    }
  }
  return { object: g, interactables: inter };
}
