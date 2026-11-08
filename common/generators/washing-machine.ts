import * as THREE from 'three';
import type { GenContext, GenResult, GeneratorMeta } from './lib/types';
import { box, cyl, pivot } from './lib/shapes';

export const meta: GeneratorMeta = {
  id: 'washing-machine',
  version: 1,
  description: 'Front-load washing machine, round glass door opens with F, drum visible. Front faces +z.',
  tags: ['utility', 'appliance', 'interactive'],
  params: {
    width: { type: 'number', default: 0.6 },
    height: { type: 'number', default: 0.85 },
    depth: { type: 'number', default: 0.56 },
  },
  slots: { body: 'appliance-white', trim: 'metal-steel', glass: 'glass-clear', drum: 'metal-steel', panel: 'plastic-black' },
};

export function build(p: Record<string, any>, ctx: GenContext): GenResult {
  const g = new THREE.Group();
  const W: number = p.width, H: number = p.height, D: number = p.depth;
  g.add(box(W, H, D, ctx.mat('body'), [0, H / 2, 0]));
  g.add(box(W - 0.04, 0.09, 0.005, ctx.mat('panel'), [0, H - 0.07, D / 2 + 0.003], { collider: false }));
  const knob = cyl(0.03, 0.03, 0.02, ctx.mat('trim'), [W / 2 - 0.1, H - 0.07, D / 2 + 0.01], { collider: false });
  knob.rotation.x = Math.PI / 2;
  g.add(knob);
  const r = 0.18, cy = H * 0.45;
  const drum = cyl(r * 0.92, r * 0.92, 0.01, ctx.mat('drum'), [0, cy, D / 2 + 0.001], { collider: false });
  drum.rotation.x = Math.PI / 2;
  g.add(drum);
  const pv = pivot([-r - 0.02, cy, D / 2 + 0.03], 'wm-door');
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.03, 12, 40), ctx.mat('trim'));
  ring.position.x = r + 0.02;
  ring.userData.collider = false;
  ring.castShadow = true;
  pv.add(ring);
  const glass = cyl(r, r, 0.02, ctx.mat('glass'), [r + 0.02, 0, 0], { collider: false, shadow: false });
  glass.rotation.x = Math.PI / 2;
  pv.add(glass);
  g.add(pv);
  return { object: g, interactables: [{ pivot: pv, kind: 'hinge', axis: 'y', amount: -1.6, label: 'Washing machine', duration: 0.5 }] };
}
