import * as THREE from 'three';
import type { GenContext, GenResult, GeneratorMeta } from './lib/types';
import { box, rbox } from './lib/shapes';
import { legs } from './lib/kit';

export const meta: GeneratorMeta = {
  id: 'chair',
  version: 1,
  description: 'Dining / study chair. Front faces +z. Dynamic by default (you can push it around).',
  tags: ['furniture', 'chair', 'dining', 'dynamic'],
  params: {
    style: { type: 'enum', default: 'upholstered', options: ['wood', 'upholstered'] },
    seatHeight: { type: 'number', default: 0.46 },
    width: { type: 'number', default: 0.45 },
  },
  slots: { wood: 'wood-teak', fabric: 'fabric-beige' },
  physics: 'dynamic',
  mass: 6,
};

export function build(p: Record<string, any>, ctx: GenContext): GenResult {
  const g = new THREE.Group();
  const W: number = p.width, D = 0.45, SH: number = p.seatHeight;
  const wood = ctx.mat('wood');
  const seatMat = p.style === 'upholstered' ? ctx.mat('fabric') : wood;
  g.add(legs(W, D, SH - 0.04, wood, 0.02, 0.035));
  if (p.style === 'upholstered') g.add(rbox(W, 0.07, D, 0.02, seatMat, [0, SH - 0.02, 0]));
  else g.add(box(W, 0.04, D, wood, [0, SH - 0.02, 0]));
  // back: posts + panel
  const bh = 0.45;
  for (const s of [-1, 1]) g.add(box(0.035, bh, 0.035, wood, [s * (W / 2 - 0.0375), SH + bh / 2, -D / 2 + 0.0375]));
  if (p.style === 'upholstered') g.add(rbox(W - 0.06, 0.32, 0.05, 0.02, seatMat, [0, SH + 0.26, -D / 2 + 0.04]));
  else for (const y of [0.18, 0.38]) g.add(box(W - 0.07, 0.06, 0.02, wood, [0, SH + y, -D / 2 + 0.0375]));
  return { object: g };
}
