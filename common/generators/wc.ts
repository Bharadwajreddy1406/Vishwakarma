import * as THREE from 'three';
import type { GenContext, GenResult, GeneratorMeta, Interactable } from './lib/types';
import { box, cyl, pivot, rbox } from './lib/shapes';

export const meta: GeneratorMeta = {
  id: 'wc',
  version: 1,
  description: 'Western commode (floor-mounted or wall-hung) with concealed cistern panel + flush plate; seat lid opens with F; health faucet. Back to wall (-z), front +z.',
  tags: ['bathroom', 'sanitary', 'interactive'],
  params: {
    mount: { type: 'enum', default: 'wall-hung', options: ['wall-hung', 'floor'] },
  },
  slots: { ceramic: 'ceramic-white', chrome: 'chrome', panel: 'tile-wall-white-gloss' },
};

export function build(p: Record<string, any>, ctx: GenContext): GenResult {
  const g = new THREE.Group();
  const ceramic = ctx.mat('ceramic');
  const chrome = ctx.mat('chrome');
  const seatY = 0.42;
  // cistern box against the wall
  g.add(box(0.5, 1.0, 0.18, ctx.mat('panel'), [0, 0.5, -0.27]));
  g.add(box(0.2, 0.14, 0.01, chrome, [0, 0.95, -0.175], { collider: false }));
  // bowl: tapered cylinder scaled into an oval
  const bowl = cyl(0.19, p.mount === 'floor' ? 0.14 : 0.12, p.mount === 'floor' ? seatY : 0.3, ceramic, undefined);
  bowl.scale.z = 1.4;
  bowl.position.set(0, p.mount === 'floor' ? seatY / 2 : seatY - 0.15, 0.03);
  g.add(bowl);
  g.add(rbox(0.36, 0.1, 0.18, 0.04, ceramic, [0, seatY - 0.12, -0.15]));
  // seat + hinged lid
  const seat = cyl(0.19, 0.19, 0.02, ceramic, [0, seatY + 0.01, 0.03], { collider: false });
  seat.scale.z = 1.4;
  g.add(seat);
  const lidPivot = pivot([0, seatY + 0.025, -0.22], 'lid');
  const lid = cyl(0.19, 0.19, 0.02, ceramic, [0, 0, 0.25], { collider: false });
  lid.scale.z = 1.35;
  lidPivot.add(lid);
  g.add(lidPivot);
  const inter: Interactable[] = [{ pivot: lidPivot, kind: 'hinge', axis: 'x', amount: -1.45, label: 'Toilet lid', duration: 0.5 }];
  // health faucet on the side wall area
  g.add(cyl(0.012, 0.012, 0.1, chrome, [0.33, 0.6, -0.3], { collider: false }));
  return { object: g, interactables: inter };
}
