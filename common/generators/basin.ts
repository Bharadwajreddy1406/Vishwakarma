import * as THREE from 'three';
import type { GenContext, GenResult, GeneratorMeta, Interactable } from './lib/types';
import { box, cyl } from './lib/shapes';
import { cabinet } from './lib/kit';

export const meta: GeneratorMeta = {
  id: 'basin',
  version: 1,
  description: 'Wash basin: wall-mounted, counter-top on a vanity (cabinet doors open), or pedestal. Mirror and pillar tap. Back to wall (-z).',
  tags: ['bathroom', 'dining', 'sanitary', 'interactive'],
  params: {
    style: { type: 'enum', default: 'wall', options: ['wall', 'vanity', 'pedestal'] },
    width: { type: 'number', default: 0.5, min: 0.35, max: 1.2 },
    mirror: { type: 'bool', default: true },
  },
  slots: { ceramic: 'ceramic-white', chrome: 'chrome', mirror: 'mirror', carcass: 'laminate-white-gloss', front: 'laminate-wood', counter: 'granite-black' },
};

export function build(p: Record<string, any>, ctx: GenContext): GenResult {
  const g = new THREE.Group();
  const W: number = p.width;
  const D = 0.42, top = 0.82;
  const inter: Interactable[] = [];
  const ceramic = ctx.mat('ceramic'), chrome = ctx.mat('chrome');
  if (p.style === 'vanity') {
    const c = cabinet({ width: W, height: top - 0.22, depth: D, y0: 0.2, doors: W > 0.7 ? 2 : 1, carcass: ctx.mat('carcass'), front: ctx.mat('front'), handleMat: chrome, label: 'Vanity' });
    g.add(c.group);
    inter.push(...c.interactables);
    g.add(box(W + 0.02, 0.02, D + 0.02, ctx.mat('counter'), [0, top - 0.01, 0]));
    const bowl = cyl(0.2, 0.14, 0.12, ceramic, [0, top + 0.06, 0.02]);
    bowl.scale.z = 0.8;
    g.add(bowl);
  } else {
    const bowl = cyl(Math.min(0.26, W / 2), 0.12, 0.16, ceramic, [0, top - 0.08, 0]);
    bowl.scale.z = 0.75;
    g.add(bowl);
    if (p.style === 'pedestal') g.add(cyl(0.08, 0.12, top - 0.16, ceramic, [0, (top - 0.16) / 2, -0.05]));
  }
  g.add(cyl(0.015, 0.02, 0.18, chrome, [0, top + 0.09, -D / 2 + 0.08], { collider: false }));
  const spout = cyl(0.009, 0.009, 0.1, chrome, [0, top + 0.17, -D / 2 + 0.12], { collider: false });
  spout.rotation.x = Math.PI / 2;
  g.add(spout);
  if (p.mirror) g.add(box(Math.max(0.45, W), 0.7, 0.01, ctx.mat('mirror'), [0, top + 0.65, -D / 2 + 0.005], { collider: false }));
  return { object: g, interactables: inter };
}
