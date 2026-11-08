import * as THREE from 'three';
import type { GenContext, GenResult, GeneratorMeta, Interactable } from './lib/types';
import { box, boxOn, cyl, pivot, sphere } from './lib/shapes';

export const meta: GeneratorMeta = {
  id: 'mandir',
  version: 1,
  description: 'Wooden pooja mandir: base cabinet (doors), sanctum with marble floor, brass idols, diyas with live flame, bells, tiered shikhara top, marigold garland. Floor-standing or wall-mounted. Front faces +z.',
  tags: ['puja', 'furniture', 'interactive', 'indian'],
  params: {
    width: { type: 'number', default: 0.9, min: 0.45, max: 2.0 },
    depth: { type: 'number', default: 0.45, min: 0.3, max: 0.7 },
    height: { type: 'number', default: 1.9, min: 0.9, max: 2.4 },
    mount: { type: 'enum', default: 'floor', options: ['floor', 'wall'] },
    idols: { type: 'int', default: 3, min: 1, max: 5 },
  },
  slots: { wood: 'wood-teak', marble: 'marble-white', brass: 'metal-brass', flame: 'flame', flower: 'marigold', red: 'kumkum-red', handle: 'metal-brass' },
};

export function build(p: Record<string, any>, ctx: GenContext): GenResult {
  const g = new THREE.Group();
  const W: number = p.width, D: number = p.depth, H: number = p.height;
  const wood = ctx.mat('wood'), brass = ctx.mat('brass');
  const inter: Interactable[] = [];
  const baseH = p.mount === 'floor' ? 0.75 : 0;
  const y0 = p.mount === 'floor' ? 0 : 0.9;

  if (baseH > 0) {
    // base cabinet with two small doors
    g.add(boxOn(W, 0.06, D - 0.04, wood, 0, 0, -0.02));
    g.add(box(W, baseH - 0.06, 0.02, wood, [0, 0.06 + (baseH - 0.06) / 2, -D / 2 + 0.01]));
    g.add(box(0.02, baseH - 0.06, D, wood, [-W / 2 + 0.01, 0.06 + (baseH - 0.06) / 2, 0]));
    g.add(box(0.02, baseH - 0.06, D, wood, [W / 2 - 0.01, 0.06 + (baseH - 0.06) / 2, 0]));
    const lw = (W - 0.04) / 2;
    for (const s of [-1, 1]) {
      const pv = pivot([s * (W / 2 - 0.02), 0.07, D / 2 - 0.01], 'mandir-door');
      pv.add(box(lw - 0.004, baseH - 0.09, 0.02, wood, [(-s * lw) / 2, (baseH - 0.09) / 2, 0]));
      pv.add(box((lw - 0.004) * 0.7, (baseH - 0.09) * 0.7, 0.006, ctx.mat('brass'), [(-s * lw) / 2, (baseH - 0.09) / 2, 0.012], { collider: false }));
      g.add(pv);
      inter.push({ pivot: pv, kind: 'hinge', axis: 'y', amount: s * 1.6, label: 'Mandir drawer cabinet', group: 'mandir-base' });
    }
  }
  const sy = y0 + baseH; // sanctum floor
  const sanctumH = Math.min(0.75, H - baseH - 0.4);
  // sanctum: marble floor, back, sides, pillars
  g.add(boxOn(W, 0.04, D, ctx.mat('marble'), 0, sy, 0));
  g.add(box(W, sanctumH, 0.02, wood, [0, sy + 0.04 + sanctumH / 2, -D / 2 + 0.01]));
  g.add(box(0.03, sanctumH, D, wood, [-W / 2 + 0.015, sy + 0.04 + sanctumH / 2, 0]));
  g.add(box(0.03, sanctumH, D, wood, [W / 2 - 0.015, sy + 0.04 + sanctumH / 2, 0]));
  for (const s of [-1, 1]) g.add(cyl(0.03, 0.035, sanctumH, wood, [s * (W / 2 - 0.06), sy + 0.04 + sanctumH / 2, D / 2 - 0.05]));
  // arch top of sanctum + tiered shikhara
  let ty = sy + 0.04 + sanctumH;
  g.add(boxOn(W + 0.04, 0.06, D + 0.04, wood, 0, ty, 0));
  ty += 0.06;
  const tiers = Math.max(2, Math.min(4, Math.floor((H - (ty - y0)) / 0.12)));
  for (let i = 0; i < tiers; i++) {
    const k = 1 - (i + 1) / (tiers + 1.5);
    g.add(boxOn(W * k, 0.1, D * k, wood, 0, ty, 0));
    ty += 0.1;
  }
  g.add(cyl(0.0, W * 0.12, 0.18, brass, [0, ty + 0.09, 0], { collider: false })); // kalash
  g.add(sphere(0.025, brass, [0, ty + 0.2, 0], { collider: false }));

  // idols (stylised brass figures on small pedestals)
  const n: number = p.idols;
  for (let i = 0; i < n; i++) {
    const x = -W / 2 + 0.12 + ((W - 0.24) * (i + 0.5)) / n;
    const s = i === Math.floor(n / 2) ? 1.2 : 1;
    g.add(boxOn(0.1 * s, 0.05, 0.08, ctx.mat('red'), x, sy + 0.04, -D / 2 + 0.12, { collider: false }));
    g.add(cyl(0.035 * s, 0.05 * s, 0.14 * s, brass, [x, sy + 0.09 + 0.07 * s, -D / 2 + 0.12], { collider: false }));
    g.add(sphere(0.03 * s, brass, [x, sy + 0.09 + 0.17 * s, -D / 2 + 0.12], { collider: false }));
    g.add(cyl(0.0, 0.025 * s, 0.05 * s, brass, [x, sy + 0.09 + 0.22 * s, -D / 2 + 0.12], { collider: false }));
  }
  // diyas with flame (engine flickers anything tagged userData.flicker)
  for (const x of [-W / 4, W / 4]) {
    g.add(cyl(0.04, 0.025, 0.025, ctx.mat('brass'), [x, sy + 0.055, D / 2 - 0.1], { collider: false }));
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.03, 8), ctx.mat('flame'));
    flame.position.set(x, sy + 0.085, D / 2 - 0.1);
    flame.userData.collider = false;
    flame.userData.flicker = true;
    g.add(flame);
  }
  const lamp = new THREE.PointLight(0xffa64d, 0.6, 2.2, 2);
  lamp.position.set(0, sy + 0.2, D / 2 - 0.1);
  lamp.userData.flicker = true;
  g.add(lamp);
  // bells + marigold garland across the front
  for (const s of [-1, 1]) {
    g.add(cyl(0.01, 0.035, 0.05, brass, [s * (W / 2 - 0.12), sy + sanctumH - 0.08, D / 2 - 0.04], { collider: false }));
  }
  const garland = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-W / 2 + 0.06, sy + sanctumH, D / 2 - 0.02),
      new THREE.Vector3(0, sy + sanctumH - 0.18, D / 2 + 0.02),
      new THREE.Vector3(W / 2 - 0.06, sy + sanctumH, D / 2 - 0.02),
    ), 24, 0.018, 8),
    ctx.mat('flower'),
  );
  garland.userData.collider = false;
  g.add(garland);
  // blocker for the open sanctum
  const block = box(W, sanctumH, 0.02, wood, [0, sy + 0.04 + sanctumH / 2, D / 2 - 0.01]);
  block.visible = false;
  g.add(block);
  return { object: g, interactables: inter };
}
