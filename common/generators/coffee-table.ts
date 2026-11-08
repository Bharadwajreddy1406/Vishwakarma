import * as THREE from 'three';
import type { GenContext, GenResult, GeneratorMeta } from './lib/types';
import { box, cyl, sphere } from './lib/shapes';
import { legs } from './lib/kit';

export const meta: GeneratorMeta = {
  id: 'coffee-table',
  version: 1,
  description: 'Low centre table, wood frame with inset top (wood / glass / marble) and a lower shelf; small decor bowl.',
  tags: ['living', 'furniture', 'table'],
  params: {
    width: { type: 'number', default: 1.1, min: 0.5, max: 1.6 },
    depth: { type: 'number', default: 0.55, min: 0.4, max: 1.0 },
    height: { type: 'number', default: 0.42, min: 0.3, max: 0.5 },
    top: { type: 'enum', default: 'glass', options: ['wood', 'glass', 'marble'] },
  },
  slots: { wood: 'wood-teak', glass: 'glass-clear', marble: 'marble-white', decor: 'metal-brass', plant: 'plant-green' },
};

export function build(p: Record<string, any>, ctx: GenContext): GenResult {
  const g = new THREE.Group();
  const W: number = p.width, D: number = p.depth, H: number = p.height;
  const wood = ctx.mat('wood');
  g.add(legs(W, D, H - 0.04, wood, 0.0, 0.05));
  g.add(box(W, 0.04, 0.06, wood, [0, H - 0.02, D / 2 - 0.03]));
  g.add(box(W, 0.04, 0.06, wood, [0, H - 0.02, -D / 2 + 0.03]));
  g.add(box(0.06, 0.04, D, wood, [W / 2 - 0.03, H - 0.02, 0]));
  g.add(box(0.06, 0.04, D, wood, [-W / 2 + 0.03, H - 0.02, 0]));
  const top = p.top === 'wood' ? wood : ctx.mat(p.top);
  g.add(box(W - 0.12, 0.012, D - 0.12, top, [0, H - 0.01, 0]));
  g.add(box(W - 0.1, 0.02, D - 0.1, wood, [0, 0.12, 0]));
  g.add(cyl(0.12, 0.07, 0.06, ctx.mat('decor'), [W * 0.18, H + 0.03, 0], { collider: false }));
  for (let i = 0; i < 4; i++) g.add(sphere(0.03, ctx.mat('plant'), [W * 0.18 + (i - 1.5) * 0.04, H + 0.07, (i % 2) * 0.03 - 0.015], { collider: false }));
  return { object: g };
}
