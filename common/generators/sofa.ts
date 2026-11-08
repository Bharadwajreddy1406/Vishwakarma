import * as THREE from 'three';
import type { GenContext, GenResult, GeneratorMeta } from './lib/types';
import { box, rbox } from './lib/shapes';
import { legs } from './lib/kit';

export const meta: GeneratorMeta = {
  id: 'sofa',
  version: 1,
  description: 'Modular sofa: N seats (1 = armchair), arms, seat + back cushions, throw pillows, wooden legs. Front faces +z.',
  tags: ['living', 'furniture', 'sofa', 'seating', 'parametric-mxn'],
  params: {
    seats: { type: 'int', default: 3, min: 1, max: 5 },
    seatWidth: { type: 'number', default: 0.62, min: 0.5, max: 0.9 },
    depth: { type: 'number', default: 0.88, min: 0.7, max: 1.1 },
    arms: { type: 'bool', default: true },
    throwPillows: { type: 'int', default: -1, min: -1, max: 6, description: '-1 = auto' },
  },
  slots: { fabric: 'fabric-grey', cushion: 'fabric-cushion-white', accent: 'fabric-mustard', wood: 'wood-walnut' },
};

export function build(p: Record<string, any>, ctx: GenContext): GenResult {
  const g = new THREE.Group();
  const n: number = p.seats, sw: number = p.seatWidth, D: number = p.depth;
  const armW = p.arms ? 0.16 : 0;
  const W = n * sw + 2 * armW;
  const fabric = ctx.mat('fabric');
  const legH = 0.12, baseH = 0.22, seatH = 0.14;
  g.add(legs(W - 0.04, D - 0.04, legH, ctx.mat('wood'), 0.03, 0.04, true));
  g.add(rbox(W, baseH, D, 0.03, fabric, [0, legH + baseH / 2, 0]));
  // back
  g.add(rbox(W, 0.45, 0.18, 0.04, fabric, [0, legH + baseH + 0.2, -D / 2 + 0.09]));
  if (p.arms) {
    for (const s of [-1, 1]) g.add(rbox(armW, 0.36, D, 0.05, fabric, [s * (W / 2 - armW / 2), legH + baseH + 0.1, 0]));
  }
  for (let i = 0; i < n; i++) {
    const x = -W / 2 + armW + sw * (i + 0.5);
    g.add(rbox(sw - 0.01, seatH, D - 0.22, 0.05, fabric, [x, legH + baseH + seatH / 2, 0.05]));
    const back = rbox(sw - 0.02, 0.42, 0.16, 0.06, fabric, [x, legH + baseH + seatH + 0.2, -D / 2 + 0.25], { collider: false });
    back.rotation.x = -0.12;
    g.add(back);
  }
  const tp = p.throwPillows >= 0 ? p.throwPillows : Math.min(n, 2) + (n >= 3 ? 0 : 0);
  for (let i = 0; i < tp; i++) {
    const left = i % 2 === 0;
    const k = Math.floor(i / 2);
    const x = (left ? -1 : 1) * (W / 2 - armW - 0.22 - k * 0.32);
    const pil = rbox(0.42, 0.4, 0.12, 0.06, ctx.mat(i % 2 ? 'cushion' : 'accent'), [x, legH + baseH + seatH + 0.2, -D / 2 + 0.38], { collider: false });
    pil.rotation.set(-0.3, left ? 0.25 : -0.25, left ? 0.12 : -0.12);
    g.add(pil);
  }
  return { object: g };
}
