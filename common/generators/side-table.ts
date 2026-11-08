import * as THREE from 'three';
import type { GenContext, GenResult, GeneratorMeta, Interactable } from './lib/types';
import { box, cyl, sphere } from './lib/shapes';
import { drawer, legs } from './lib/kit';

export const meta: GeneratorMeta = {
  id: 'side-table',
  version: 1,
  description: 'Bedside / side table with a pull-out drawer and optional table lamp (real light). Front faces +z.',
  tags: ['bedroom', 'living', 'furniture', 'interactive', 'light'],
  params: {
    width: { type: 'number', default: 0.45, min: 0.3, max: 0.7 },
    depth: { type: 'number', default: 0.4, min: 0.3, max: 0.6 },
    height: { type: 'number', default: 0.55, min: 0.4, max: 0.75 },
    lamp: { type: 'bool', default: true },
    drawer: { type: 'bool', default: true },
  },
  slots: { wood: 'wood-walnut', handle: 'metal-brass', shade: 'fabric-cushion-white', base: 'metal-brass', lamp: 'lamp-warm' },
};

export function build(p: Record<string, any>, ctx: GenContext): GenResult {
  const g = new THREE.Group();
  const W: number = p.width, D: number = p.depth, H: number = p.height;
  const wood = ctx.mat('wood');
  const inter: Interactable[] = [];
  const legH = 0.15;
  g.add(legs(W, D, legH, wood, 0.02, 0.03));
  const boxH = H - legH;
  g.add(box(W, 0.02, D, wood, [0, H - 0.01, 0]));
  g.add(box(W, 0.02, D, wood, [0, legH + 0.01, 0]));
  for (const s of [-1, 1]) g.add(box(0.02, boxH, D, wood, [s * (W / 2 - 0.01), legH + boxH / 2, 0]));
  g.add(box(W, boxH, 0.01, wood, [0, legH + boxH / 2, -D / 2 + 0.005]));
  if (p.drawer) {
    const dh = Math.min(0.16, boxH - 0.04);
    const d = drawer(W - 0.044, dh, D - 0.05, wood, wood, ctx.mat('handle'));
    d.group.position.set(0, H - 0.02 - dh - 0.002, D / 2 - 0.009);
    g.add(d.group);
    inter.push({ pivot: d.group, kind: 'slide', axis: 'z', amount: D * 0.7, label: 'Drawer' });
  }
  if (p.lamp) {
    const lx = 0, lz = -0.03;
    g.add(cyl(0.06, 0.07, 0.02, ctx.mat('base'), [lx, H + 0.01, lz], { collider: false }));
    g.add(cyl(0.01, 0.01, 0.28, ctx.mat('base'), [lx, H + 0.16, lz], { collider: false }));
    const shade = cyl(0.09, 0.13, 0.18, ctx.mat('shade'), [lx, H + 0.36, lz], { collider: false, shadow: false });
    (shade.material as THREE.Material).side = THREE.DoubleSide;
    g.add(shade);
    g.add(sphere(0.03, ctx.mat('lamp'), [lx, H + 0.33, lz], { collider: false, shadow: false }));
    const light = new THREE.PointLight(0xffd9a0, 1.2, 3.5, 2);
    light.position.set(lx, H + 0.33, lz);
    g.add(light);
  }
  return { object: g, interactables: inter };
}
