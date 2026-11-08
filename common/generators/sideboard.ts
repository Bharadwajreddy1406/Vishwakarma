import * as THREE from 'three';
import type { GenContext, GenResult, GeneratorMeta } from './lib/types';
import { box } from './lib/shapes';
import { cabinet } from './lib/kit';

export const meta: GeneratorMeta = {
  id: 'sideboard',
  version: 1,
  description: 'Crockery unit / console / sideboard: base cabinet with shutters + drawers, optional glass-front upper display. Front faces +z.',
  tags: ['dining', 'storage', 'furniture', 'interactive'],
  params: {
    width: { type: 'number', default: 1.8, min: 0.6, max: 3.5 },
    depth: { type: 'number', default: 0.4, min: 0.25, max: 0.6 },
    height: { type: 'number', default: 0.85, min: 0.5, max: 1.0 },
    drawers: { type: 'int', default: 1, min: 0, max: 2 },
    upper: { type: 'bool', default: false, description: 'glass-front upper crockery display' },
  },
  slots: { carcass: 'laminate-wood', front: 'wood-teak', handle: 'metal-brass', glass: 'glass-clear', top: 'granite-black' },
};

export function build(p: Record<string, any>, ctx: GenContext): GenResult {
  const g = new THREE.Group();
  const W: number = p.width, D: number = p.depth, H: number = p.height;
  const base = cabinet({
    width: W, height: H - 0.1, depth: D, y0: 0.08, doors: Math.max(2, Math.round(W / 0.45)), drawers: p.drawers, drawerHeight: 0.15, shelves: 1,
    carcass: ctx.mat('carcass'), front: ctx.mat('front'), handleMat: ctx.mat('handle'), label: 'Crockery unit',
  });
  g.add(base.group);
  g.add(box(W - 0.04, 0.08, D - 0.06, ctx.mat('carcass'), [0, 0.04, -0.03]));
  g.add(box(W + 0.02, 0.02, D + 0.02, ctx.mat('top'), [0, H - 0.01, 0]));
  const inter = [...base.interactables];
  if (p.upper) {
    const up = cabinet({
      width: W, height: 0.9, depth: D * 0.75, y0: H + 0.45, doors: Math.max(2, Math.round(W / 0.45)), shelves: 2,
      carcass: ctx.mat('carcass'), front: ctx.mat('front'), handleMat: ctx.mat('handle'), glass: ctx.mat('glass'), label: 'Crockery display',
    });
    up.group.position.z = -D * 0.125;
    g.add(up.group);
    inter.push(...up.interactables);
  }
  return { object: g, interactables: inter };
}
