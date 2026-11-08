import * as THREE from 'three';
import type { GenContext, GenResult, GeneratorMeta, Interactable } from './lib/types';
import { box, cyl, handle, pivot, sphere } from './lib/shapes';

export const meta: GeneratorMeta = {
  id: 'fridge',
  version: 1,
  description: 'Refrigerator: single door, double door (freezer on top) or side-by-side. Doors open with F to reveal lit shelves, door bins and some groceries.',
  tags: ['kitchen', 'appliance', 'interactive'],
  params: {
    width: { type: 'number', default: 0.68, min: 0.5, max: 1.0 },
    height: { type: 'number', default: 1.75, min: 1.2, max: 1.95 },
    depth: { type: 'number', default: 0.68, min: 0.55, max: 0.8 },
    style: { type: 'enum', default: 'double', options: ['single', 'double', 'side-by-side'] },
    hinge: { type: 'enum', default: 'right', options: ['left', 'right'] },
  },
  slots: { body: 'appliance-silver', inner: 'appliance-white', handle: 'metal-steel', shelf: 'glass-clear', light: 'lamp-warm', food1: 'marigold', food2: 'plant-green', food3: 'kumkum-red' },
};

export function build(p: Record<string, any>, ctx: GenContext): GenResult {
  const g = new THREE.Group();
  const W: number = p.width, H: number = p.height, D: number = p.depth;
  const body = ctx.mat('body'), inner = ctx.mat('inner');
  const wt = 0.04, dt = 0.06;
  const Dc = D - dt;
  const zc = -dt / 2;
  // shell (open front)
  g.add(box(wt, H, Dc, body, [-W / 2 + wt / 2, H / 2, zc]));
  g.add(box(wt, H, Dc, body, [W / 2 - wt / 2, H / 2, zc]));
  g.add(box(W, wt, Dc, body, [0, H - wt / 2, zc]));
  g.add(box(W, 0.08, Dc, body, [0, 0.04, zc]));
  g.add(box(W, H, wt, inner, [0, H / 2, zc - Dc / 2 + wt / 2]));
  const inter: Interactable[] = [];

  const sections: { y0: number; y1: number; x0: number; x1: number; hingeLeft: boolean }[] = [];
  const hingeLeft = p.hinge === 'left';
  if (p.style === 'single') sections.push({ y0: 0.08, y1: H, x0: -W / 2, x1: W / 2, hingeLeft });
  else if (p.style === 'double') {
    const split = H * 0.72;
    sections.push({ y0: 0.08, y1: split, x0: -W / 2, x1: W / 2, hingeLeft });
    sections.push({ y0: split, y1: H, x0: -W / 2, x1: W / 2, hingeLeft });
    g.add(box(W - 2 * wt, wt, Dc - wt, inner, [0, split, zc + wt / 2]));
  } else {
    sections.push({ y0: 0.08, y1: H, x0: -W / 2, x1: -0.002, hingeLeft: true });
    sections.push({ y0: 0.08, y1: H, x0: 0.002, x1: W / 2, hingeLeft: false });
    g.add(box(wt, H - 0.1, Dc - wt, inner, [0, H / 2, zc + wt / 2]));
  }

  // shelves, light and groceries
  const shelfY = [0.45, 0.75, 1.0];
  for (const y of shelfY) if (y < H - 0.3) g.add(box(W - 2 * wt - 0.01, 0.008, Dc - wt - 0.02, ctx.mat('shelf'), [0, y, zc + wt / 2], { collider: false, shadow: false }));
  g.add(box(0.15, 0.02, 0.04, ctx.mat('light'), [0, (p.style === 'double' ? H * 0.72 : H) - 0.06, zc], { collider: false, shadow: false }));
  const foods = ['food1', 'food2', 'food3'];
  shelfY.forEach((y, i) => {
    if (y >= H - 0.3) return;
    g.add(cyl(0.035, 0.035, 0.2, ctx.mat(foods[i % 3]), [-W / 4, y + 0.1, zc], { collider: false }));
    g.add(sphere(0.04, ctx.mat(foods[(i + 1) % 3]), [W / 6, y + 0.045, zc + 0.05], { collider: false }));
    g.add(box(0.12, 0.1, 0.1, ctx.mat(foods[(i + 2) % 3]), [W / 6 - 0.12, y + 0.05, zc - 0.1], { collider: false }));
  });

  for (const s of sections) {
    const w = s.x1 - s.x0 - 0.004, h = s.y1 - s.y0 - 0.006;
    const hx = s.hingeLeft ? s.x0 + 0.002 : s.x1 - 0.002;
    const pv = pivot([hx, s.y0 + 0.003, D / 2 - dt / 2], 'fridge-door');
    const dir = s.hingeLeft ? 1 : -1;
    pv.add(box(w, h, dt, body, [(dir * w) / 2, h / 2, 0]));
    // door bins on the inside
    for (let y = 0.15; y < h - 0.1; y += 0.3) {
      pv.add(box(w - 0.08, 0.06, 0.08, inner, [(dir * w) / 2, y, -dt / 2 - 0.04], { collider: false }));
    }
    const hd = handle(ctx.mat('handle'), [dir * (w - 0.04), h / 2, dt / 2], Math.min(0.4, h * 0.4), true, 0.035);
    pv.add(hd);
    g.add(pv);
    inter.push({ pivot: pv, kind: 'hinge', axis: 'y', amount: (s.hingeLeft ? -1 : 1) * 1.9, label: 'Fridge', duration: 0.6 });
  }
  return { object: g, interactables: inter };
}
