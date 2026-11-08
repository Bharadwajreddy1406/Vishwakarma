import * as THREE from 'three';
import type { GenContext, GenResult, GeneratorMeta } from './lib/types';
import { cabinet } from './lib/kit';

export const meta: GeneratorMeta = {
  id: 'wardrobe',
  version: 1,
  description: 'Built-in wardrobe: N hinged shutters (auto from width), hanging rod + shelves inside, optional drawers row and loft cabinets above. Every shutter opens with F.',
  tags: ['furniture', 'storage', 'bedroom', 'interactive', 'parametric-mxn'],
  params: {
    width: { type: 'number', default: 1.8, min: 0.45, max: 4 },
    height: { type: 'number', default: 2.1, min: 1.2, max: 2.4 },
    depth: { type: 'number', default: 0.6, min: 0.35, max: 0.7 },
    doors: { type: 'int', default: 0, min: 0, max: 8, description: '0 = auto (~0.5 m per shutter)' },
    drawers: { type: 'int', default: 0, min: 0, max: 3 },
    loft: { type: 'bool', default: true, description: 'loft cabinet above, up to ceiling' },
    ceiling: { type: 'number', default: 3.0 },
  },
  slots: { carcass: 'laminate-white-gloss', front: 'laminate-wood', handle: 'metal-steel' },
};

export function build(p: Record<string, any>, ctx: GenContext): GenResult {
  const g = new THREE.Group();
  const doors = p.doors || 'auto';
  const main = cabinet({
    width: p.width, height: p.height, depth: p.depth, doors, drawers: 0, shelves: 0, rod: true,
    carcass: ctx.mat('carcass'), front: ctx.mat('front'), handleMat: ctx.mat('handle'), label: 'Wardrobe',
  });
  // half-height shelves on the hinge-left halves: a simple shelf stack
  g.add(main.group);
  const inter = [...main.interactables];
  if (p.drawers > 0) {
    const d = cabinet({
      width: p.width, height: p.drawers * 0.2, depth: p.depth, y0: 0, doors: 0, drawers: p.drawers,
      carcass: ctx.mat('carcass'), front: ctx.mat('front'), handleMat: ctx.mat('handle'),
    });
    main.group.position.y = p.drawers * 0.2;
    g.add(d.group);
    inter.push(...d.interactables);
  }
  const used = p.height + (p.drawers > 0 ? p.drawers * 0.2 : 0);
  const loftH = p.ceiling - used - 0.05;
  if (p.loft && loftH > 0.3) {
    const loft = cabinet({
      width: p.width, height: loftH, depth: p.depth, y0: used + 0.02, doors, shelves: 0,
      carcass: ctx.mat('carcass'), front: ctx.mat('front'), handleMat: ctx.mat('handle'), label: 'Loft', handleHorizontal: true,
    });
    g.add(loft.group);
    inter.push(...loft.interactables);
  }
  return { object: g, interactables: inter };
}
