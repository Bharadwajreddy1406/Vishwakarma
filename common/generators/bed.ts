import * as THREE from 'three';
import type { GenContext, GenResult, GeneratorMeta, Interactable } from './lib/types';
import { box, rbox } from './lib/shapes';
import { drawer } from './lib/kit';

const SIZES: Record<string, [number, number]> = { single: [0.9, 1.9], double: [1.37, 1.9], queen: [1.52, 2.0], king: [1.83, 2.0] };

export const meta: GeneratorMeta = {
  id: 'bed',
  version: 1,
  description: 'Bed with frame, upholstered headboard, mattress, duvet, pillows; optional storage drawers. Headboard at -z, foot toward +z.',
  tags: ['bedroom', 'furniture', 'bed', 'interactive'],
  params: {
    size: { type: 'enum', default: 'queen', options: ['single', 'double', 'queen', 'king'] },
    headboard: { type: 'enum', default: 'upholstered', options: ['upholstered', 'wood', 'none'] },
    storage: { type: 'bool', default: true, description: 'two pull-out drawers at the foot' },
    pillows: { type: 'int', default: 0, min: 0, max: 4, description: '0 = auto' },
  },
  slots: { wood: 'wood-walnut', fabric: 'fabric-beige', linen: 'bed-linen-white', duvet: 'bed-linen-sand', cushion: 'fabric-cushion-white', handle: 'metal-steel' },
};

export function build(p: Record<string, any>, ctx: GenContext): GenResult {
  const g = new THREE.Group();
  const [W, L] = SIZES[p.size as string];
  const wood = ctx.mat('wood');
  const frameH = 0.32, mattH = 0.2;
  const fw = W + 0.1, fl = L + 0.08;
  const inter: Interactable[] = [];
  // frame box
  g.add(box(fw, frameH - 0.04, fl, wood, [0, 0.04 + (frameH - 0.04) / 2, 0.02]));
  g.add(box(fw - 0.06, 0.04, fl - 0.06, ctx.mat('handle'), [0, 0.02, 0.02], { collider: false }));
  if (p.storage) {
    const dw = (fw - 0.06) / 2 - 0.01;
    for (const s of [-1, 1]) {
      const d = drawer(dw, frameH - 0.1, 0.6, wood, wood, ctx.mat('handle'));
      d.group.position.set(s * (dw / 2 + 0.005), 0.06, fl / 2 + 0.02 + 0.005);
      g.add(d.group);
      inter.push({ pivot: d.group, kind: 'slide', axis: 'z', amount: 0.45, label: 'Bed drawer' });
    }
  }
  // mattress + duvet + pillows
  g.add(rbox(W, mattH, L, 0.05, ctx.mat('linen'), [0, frameH + mattH / 2, 0.02]));
  const duvetL = L * 0.7;
  g.add(rbox(W + 0.06, 0.06, duvetL, 0.03, ctx.mat('duvet'), [0, frameH + mattH + 0.01, 0.02 + L / 2 - duvetL / 2 + 0.02], { collider: false }));
  g.add(rbox(W + 0.08, mattH * 0.9, 0.04, 0.02, ctx.mat('duvet'), [0, frameH + mattH * 0.55, 0.02 + L / 2 + 0.04], { collider: false }));
  const np = p.pillows || (W > 1.2 ? 2 : 1);
  const pw = Math.min(0.7, (W - 0.1) / np);
  for (let i = 0; i < np; i++) {
    const x = -W / 2 + 0.05 + pw * (i + 0.5);
    const pil = rbox(pw - 0.04, 0.13, 0.4, 0.06, ctx.mat('cushion'), [x, frameH + mattH + 0.06, -L / 2 + 0.3], { collider: false });
    pil.rotation.x = -0.25;
    g.add(pil);
  }
  // headboard
  if (p.headboard !== 'none') {
    const hh = 1.1;
    g.add(box(fw + 0.1, hh, 0.06, wood, [0, hh / 2, -L / 2 - 0.05]));
    if (p.headboard === 'upholstered') {
      const cols = Math.round(fw / 0.35);
      const cw = (fw - 0.04) / cols;
      for (let i = 0; i < cols; i++) {
        g.add(rbox(cw - 0.02, 0.55, 0.06, 0.03, ctx.mat('fabric'), [-fw / 2 + 0.02 + cw * (i + 0.5), frameH + mattH + 0.3, -L / 2 - 0.01], { collider: false }));
      }
    }
  }
  return { object: g, interactables: inter };
}
