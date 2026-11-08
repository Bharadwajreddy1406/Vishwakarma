import * as THREE from 'three';
import type { GenContext, GenResult, GeneratorMeta, Spawn } from './lib/types';
import { box } from './lib/shapes';
import { legs } from './lib/kit';

export const meta: GeneratorMeta = {
  id: 'dining-table',
  version: 1,
  description: 'Rectangular dining table sized from its seating: `seats` per long side x `sides` (1|2) + optional end seats. 3x2 = 6-seater. Chairs are spawned as separate dynamic objects (pushable).',
  tags: ['furniture', 'dining', 'table', 'parametric-mxn'],
  params: {
    seats: { type: 'int', default: 2, min: 1, max: 6, description: 'chairs along each long side' },
    sides: { type: 'int', default: 2, min: 1, max: 2, description: 'long sides with chairs' },
    endSeats: { type: 'int', default: 0, min: 0, max: 2, description: 'chairs at the short ends' },
    seatPitch: { type: 'number', default: 0.6, min: 0.45, max: 0.8, description: 'table length per chair' },
    width: { type: 'number', default: 0.9, min: 0.6, max: 1.2 },
    height: { type: 'number', default: 0.75 },
    top: { type: 'enum', default: 'wood', options: ['wood', 'glass', 'marble'] },
    chairs: { type: 'bool', default: true },
    chairStyle: { type: 'enum', default: 'upholstered', options: ['wood', 'upholstered'] },
  },
  slots: { wood: 'wood-teak', glass: 'glass-clear', marble: 'marble-white', fabric: 'fabric-beige' },
};

export function build(p: Record<string, any>, ctx: GenContext): GenResult {
  const g = new THREE.Group();
  const L = p.seats * p.seatPitch + 0.2;
  const W: number = p.width, H: number = p.height;
  const wood = ctx.mat('wood');
  const topT = 0.04;
  const topMat = p.top === 'glass' ? ctx.mat('glass') : p.top === 'marble' ? ctx.mat('marble') : wood;
  g.add(box(L, topT, W, topMat, [0, H - topT / 2, 0]));
  if (p.top === 'glass') g.add(box(L - 0.1, 0.02, W - 0.1, wood, [0, H - topT - 0.01, 0]));
  // apron + legs
  g.add(box(L - 0.12, 0.08, 0.025, wood, [0, H - topT - 0.04, W / 2 - 0.07]));
  g.add(box(L - 0.12, 0.08, 0.025, wood, [0, H - topT - 0.04, -W / 2 + 0.07]));
  g.add(legs(L, W, H - topT, wood, 0.05, 0.06));

  const spawn: Spawn[] = [];
  if (p.chairs) {
    const params = { style: p.chairStyle };
    for (let s = 0; s < p.sides; s++) {
      const z = (s === 0 ? 1 : -1) * (W / 2 + 0.18);
      for (let i = 0; i < p.seats; i++) {
        const x = -L / 2 + 0.1 + p.seatPitch * (i + 0.5);
        // chair front faces +z by convention -> rotate to face the table
        spawn.push({ generator: 'chair', params, position: [x, 0, z], rotationY: s === 0 ? Math.PI : 0, physics: 'dynamic' });
      }
    }
    for (let e = 0; e < p.endSeats; e++) {
      const x = (e === 0 ? -1 : 1) * (L / 2 + 0.2);
      spawn.push({ generator: 'chair', params, position: [x, 0, 0], rotationY: e === 0 ? Math.PI / 2 : -Math.PI / 2, physics: 'dynamic' });
    }
  }
  return { object: g, spawn };
}
