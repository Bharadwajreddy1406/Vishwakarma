import * as THREE from 'three';
import type { GenContext, GenResult, GeneratorMeta } from './lib/types';
import { box, cyl, sphere } from './lib/shapes';

export const meta: GeneratorMeta = {
  id: 'decor',
  version: 1,
  description: 'Small decor & fixtures by `kind`: rug, plant (potted), ceiling-fan (spins), ceiling-light (real light), shower (head + glass partition), towel-rail. Size via width/depth/height.',
  tags: ['decor', 'light', 'living', 'bathroom'],
  params: {
    kind: { type: 'enum', default: 'plant', options: ['rug', 'plant', 'ceiling-fan', 'ceiling-light', 'shower', 'towel-rail'] },
    width: { type: 'number', default: 1.6, min: 0.2, max: 4 },
    depth: { type: 'number', default: 1.2, min: 0.2, max: 4 },
    height: { type: 'number', default: 3.0, description: 'ceiling height for ceiling fixtures; plant height otherwise' },
    intensity: { type: 'number', default: 6, description: 'ceiling-light intensity (candela-ish)' },
  },
  slots: { rug: 'rug-grey', pot: 'terracotta', plant: 'plant-green', metal: 'metal-steel', blade: 'wood-walnut', lamp: 'lamp-warm', chrome: 'chrome', glass: 'glass-clear' },
};

export function build(p: Record<string, any>, ctx: GenContext): GenResult {
  const g = new THREE.Group();
  const W: number = p.width, D: number = p.depth, H: number = p.height;
  switch (p.kind) {
    case 'rug':
      g.add(box(W, 0.012, D, ctx.mat('rug'), [0, 0.006, 0], { collider: false }));
      break;
    case 'plant': {
      const h = Math.min(H, 1.4);
      g.add(cyl(0.16, 0.12, 0.3, ctx.mat('pot'), [0, 0.15, 0]));
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4, rr = 0.06 + (i % 3) * 0.05;
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.12 + (i % 2) * 0.05, 10, 8), ctx.mat('plant'));
        leaf.scale.set(0.6, 1.4, 0.6);
        leaf.position.set(Math.cos(a) * rr, 0.35 + ((h - 0.35) * (i + 1)) / 10, Math.sin(a) * rr);
        leaf.castShadow = true;
        leaf.userData.collider = false;
        g.add(leaf);
      }
      break;
    }
    case 'ceiling-fan': {
      const y = H - 0.35;
      g.add(cyl(0.015, 0.015, 0.3, ctx.mat('metal'), [0, H - 0.15, 0], { collider: false }));
      g.add(cyl(0.11, 0.11, 0.1, ctx.mat('metal'), [0, y, 0], { collider: false }));
      const rotor = new THREE.Group();
      rotor.position.y = y - 0.02;
      for (let i = 0; i < 3; i++) {
        const blade = box(0.55, 0.008, 0.12, ctx.mat('blade'), [0.38, 0, 0], { collider: false });
        const arm = new THREE.Group();
        arm.rotation.y = (i * Math.PI * 2) / 3;
        blade.rotation.x = 0.12;
        arm.add(blade);
        rotor.add(arm);
      }
      rotor.userData.spin = 9; // rad/s, animated by the engine
      g.add(rotor);
      break;
    }
    case 'ceiling-light': {
      g.add(cyl(0.18, 0.18, 0.04, ctx.mat('lamp'), [0, H - 0.02, 0], { collider: false, shadow: false }));
      const l = new THREE.PointLight(0xfff0dc, p.intensity, 9, 1.6);
      l.position.y = H - 0.15;
      l.userData.roomLight = true;
      g.add(l);
      break;
    }
    case 'shower': {
      g.add(cyl(0.012, 0.012, 0.35, ctx.mat('chrome'), [0, 2.0, -D / 2 + 0.2], { collider: false }));
      const head = cyl(0.1, 0.1, 0.015, ctx.mat('chrome'), [0, 2.1, -D / 2 + 0.25], { collider: false });
      g.add(head);
      g.add(box(0.01, 1.9, Math.min(D, 0.9), ctx.mat('glass'), [W / 2, 0.95 + 0.05, 0], { shadow: false }));
      break;
    }
    case 'towel-rail':
      g.add(box(0.6, 0.02, 0.02, ctx.mat('chrome'), [0, 1.3, 0.06], { collider: false }));
      g.add(sphere(0.015, ctx.mat('chrome'), [-0.3, 1.3, 0.03], { collider: false }));
      g.add(sphere(0.015, ctx.mat('chrome'), [0.3, 1.3, 0.03], { collider: false }));
      break;
  }
  return { object: g };
}
