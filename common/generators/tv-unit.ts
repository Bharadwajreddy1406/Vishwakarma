import * as THREE from 'three';
import type { GenContext, GenResult, GeneratorMeta } from './lib/types';
import { box } from './lib/shapes';
import { cabinet } from './lib/kit';

export const meta: GeneratorMeta = {
  id: 'tv-unit',
  version: 1,
  description: 'Low TV console with drawers/shutters, wall panel and a wall-mounted flat TV (size in inches). Front faces +z (stand with back to wall).',
  tags: ['living', 'furniture', 'media', 'interactive'],
  params: {
    width: { type: 'number', default: 2.0, min: 0.8, max: 3.5 },
    depth: { type: 'number', default: 0.4, min: 0.3, max: 0.55 },
    height: { type: 'number', default: 0.45, min: 0.3, max: 0.7 },
    tvInches: { type: 'int', default: 55, min: 24, max: 85 },
    panel: { type: 'bool', default: true, description: 'decor back panel on the wall' },
  },
  slots: { carcass: 'laminate-white-gloss', front: 'laminate-wood', handle: 'metal-black', panel: 'wood-walnut', screen: 'screen-black', bezel: 'plastic-black' },
};

export function build(p: Record<string, any>, ctx: GenContext): GenResult {
  const g = new THREE.Group();
  const W: number = p.width, D: number = p.depth, H: number = p.height;
  const legH = 0.12;
  const c = cabinet({
    width: W, height: H - legH, depth: D, y0: legH, doors: Math.max(2, Math.round(W / 0.5)), drawers: 0,
    carcass: ctx.mat('carcass'), front: ctx.mat('front'), handleMat: ctx.mat('handle'), label: 'TV unit', handleHorizontal: true,
    liftUp: false,
  });
  g.add(c.group);
  g.add(box(W - 0.1, legH, D - 0.1, ctx.mat('handle'), [0, legH / 2, -0.03]));
  if (p.panel) g.add(box(Math.min(W, 2.2), 1.6, 0.03, ctx.mat('panel'), [0, H + 0.85, -D / 2 + 0.015]));
  const diag = p.tvInches * 0.0254;
  const tw = diag * 0.8716, th = diag * 0.4903;
  const ty = Math.max(H + 0.25 + th / 2, 1.1);
  g.add(box(tw + 0.02, th + 0.02, 0.03, ctx.mat('bezel'), [0, ty, -D / 2 + 0.05]));
  const screen = box(tw, th, 0.004, ctx.mat('screen'), [0, ty, -D / 2 + 0.066], { collider: false });
  screen.userData.screen = true;
  g.add(screen);
  return { object: g, interactables: c.interactables };
}
