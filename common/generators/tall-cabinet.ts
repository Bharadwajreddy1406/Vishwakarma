import type { GenContext, GenResult, GeneratorMeta } from './lib/types';
import { cabinet } from './lib/kit';
import * as THREE from 'three';

export const meta: GeneratorMeta = {
  id: 'tall-cabinet',
  version: 1,
  description: 'Tall pantry / utility unit with shelves and hinged shutters (+ optional drawers). Front faces +z.',
  tags: ['kitchen', 'storage', 'cabinet', 'interactive'],
  params: {
    width: { type: 'number', default: 0.45, min: 0.3, max: 1.2 },
    height: { type: 'number', default: 2.1, min: 1, max: 2.6 },
    depth: { type: 'number', default: 0.6, min: 0.3, max: 0.7 },
    doors: { type: 'int', default: 0, min: 0, max: 4, description: '0 = auto' },
    drawers: { type: 'int', default: 0, min: 0, max: 4 },
    shelves: { type: 'int', default: 4, min: 0, max: 8 },
  },
  slots: { carcass: 'laminate-white-gloss', front: 'laminate-wood', handle: 'metal-steel' },
};

export function build(p: Record<string, any>, ctx: GenContext): GenResult {
  const g = new THREE.Group();
  const c = cabinet({
    width: p.width, height: p.height, depth: p.depth, doors: p.doors || 'auto', drawers: p.drawers, shelves: p.shelves,
    carcass: ctx.mat('carcass'), front: ctx.mat('front'), handleMat: ctx.mat('handle'), label: 'Pantry',
  });
  g.add(c.group);
  return { object: g, interactables: c.interactables };
}
