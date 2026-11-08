import * as THREE from 'three';
import type { GenContext, GenResult, GeneratorMeta, Interactable } from './lib/types';
import { box, cyl, handle, pivot, sphere } from './lib/shapes';

export const meta: GeneratorMeta = {
  id: 'door',
  version: 1,
  description: 'Hinged door with frame (chaukhat). Single or double leaf; styles: flush, panel, main (teak, raised panels, brass), bathroom (frosted strip), puja (lattice jaali + bells). Local: opening centred at x=0, floor y=0, wall centre z=0; front = +z.',
  tags: ['door', 'opening', 'interactive'],
  params: {
    width: { type: 'number', default: 0.9, min: 0.5, max: 2.4, description: 'clear opening width (m)' },
    height: { type: 'number', default: 2.1, min: 1.6, max: 2.7 },
    wallThickness: { type: 'number', default: 0.115, min: 0.05, max: 0.4 },
    leaves: { type: 'int', default: 1, min: 1, max: 2 },
    hinge: { type: 'enum', default: 'left', options: ['left', 'right'], description: 'hinge side seen from the front (+z)' },
    swing: { type: 'enum', default: 'front', options: ['front', 'back'], description: 'side the leaf opens into' },
    style: { type: 'enum', default: 'panel', options: ['flush', 'panel', 'main', 'bathroom', 'puja'] },
    open: { type: 'bool', default: false },
  },
  slots: { door: 'door-wood-veneer', frame: 'wood-teak', handle: 'metal-steel', brass: 'metal-brass', glass: 'glass-frosted' },
};

const FW = 0.06; // frame member width

export function build(p: Record<string, any>, ctx: GenContext): GenResult {
  const g = new THREE.Group();
  const t = Math.max(p.wallThickness, 0.08);
  const W: number = p.width, H: number = p.height;
  const frame = ctx.mat('frame');
  const leafMat = ctx.mat('door');
  const metal = p.style === 'main' || p.style === 'puja' ? ctx.mat('brass') : ctx.mat('handle');

  // frame: two jambs + head
  g.add(box(FW, H, t + 0.01, frame, [-W / 2 + FW / 2, H / 2, 0]));
  g.add(box(FW, H, t + 0.01, frame, [W / 2 - FW / 2, H / 2, 0]));
  g.add(box(W, FW, t + 0.01, frame, [0, H - FW / 2, 0]));

  const clearW = W - 2 * FW;
  const leafH = H - FW - 0.01;
  const lt = 0.035;
  const side = p.swing === 'front' ? 1 : -1;
  const zLeaf = side * (t / 2 - lt / 2);
  const inter: Interactable[] = [];
  const nLeaves: number = p.leaves;
  const leafW = clearW / nLeaves - 0.004;

  for (let i = 0; i < nLeaves; i++) {
    const hingeLeft = nLeaves === 2 ? i === 0 : p.hinge === 'left';
    const hx = hingeLeft ? -clearW / 2 + 0.002 : clearW / 2 - 0.002;
    const pv = pivot([hx, 0.005, zLeaf], 'door-leaf');
    const dir = hingeLeft ? 1 : -1;
    const leaf = buildLeaf(p.style, leafW, leafH, lt, leafMat, frame, ctx);
    leaf.position.x = (dir * leafW) / 2;
    pv.add(leaf);
    // handles on both faces, near the free edge
    const hx2 = dir * (leafW - 0.07);
    for (const s of [1, -1]) {
      const h = handle(metal, [hx2, 1.0, (s * lt) / 2], p.style === 'main' ? 0.3 : 0.14, true, 0.04);
      if (s < 0) h.rotation.y = Math.PI;
      pv.add(h);
    }
    if (p.style === 'main') {
      const lock = box(0.04, 0.12, lt + 0.01, metal, [hx2, 0.88, 0], { collider: false });
      pv.add(lock);
    }
    // opening toward +z when hinge-left needs negative rotation (see lib/kit.ts for the derivation)
    const amount = (hingeLeft ? -1 : 1) * side * 1.62;
    g.add(pv);
    inter.push({ pivot: pv, kind: 'hinge', axis: 'y', amount, label: p.style === 'main' ? 'Main door' : p.style === 'puja' ? 'Puja door' : 'Door', open: p.open, duration: 0.7, group: nLeaves === 2 ? 'leaves' : undefined });
  }

  if (p.style === 'puja') {
    // small brass bells hanging under the head
    for (const x of [-clearW / 3, 0, clearW / 3]) {
      const bell = cyl(0.008, 0.03, 0.05, metal, [x, H - FW - 0.08, side * (t / 2 + 0.03)], { collider: false });
      g.add(bell);
      g.add(sphere(0.008, metal, [x, H - FW - 0.11, side * (t / 2 + 0.03)], { collider: false }));
    }
  }
  return { object: g, interactables: inter };
}

function buildLeaf(style: string, w: number, h: number, t: number, mat: THREE.Material, trim: THREE.Material, ctx: GenContext): THREE.Group {
  const leaf = new THREE.Group();
  if (style === 'puja') {
    // frame + lattice (jaali)
    const f = 0.07;
    leaf.add(box(w, f, t, mat, [0, h - f / 2, 0]));
    leaf.add(box(w, f, t, mat, [0, f / 2, 0]));
    leaf.add(box(f, h, t, mat, [-w / 2 + f / 2, h / 2, 0]));
    leaf.add(box(f, h, t, mat, [w / 2 - f / 2, h / 2, 0]));
    leaf.add(box(w, f, t, mat, [0, h * 0.42, 0]));
    leaf.add(box(w - 2 * f, h * 0.42 - f, t * 0.6, mat, [0, f + (h * 0.42 - f) / 2, 0])); // solid lower panel
    const step = 0.075;
    const top0 = h * 0.42 + f / 2, top1 = h - f;
    for (let x = -w / 2 + f + step / 2; x < w / 2 - f; x += step) {
      leaf.add(box(0.012, top1 - top0, t * 0.5, mat, [x, (top0 + top1) / 2, 0], { collider: false }));
    }
    for (let y = top0 + step / 2; y < top1; y += step) {
      leaf.add(box(w - 2 * f, 0.012, t * 0.5, mat, [0, y, 0], { collider: false }));
    }
    // invisible blocker so the lattice still collides as a whole
    const block = box(w, top1 - top0, t * 0.5, mat, [0, (top0 + top1) / 2, 0]);
    block.visible = false;
    leaf.add(block);
    return leaf;
  }
  leaf.add(box(w, h, t, mat, [0, h / 2, 0]));
  if (style === 'panel' || style === 'main') {
    // raised panels on both faces
    const rows = style === 'main' ? [[0.12, 0.62], [0.72, 1.32], [1.42, h - 0.12]] : [[0.12, h * 0.45], [h * 0.5, h - 0.12]];
    const cols = style === 'main' ? 2 : 1;
    const pw = (w - 0.12 * (cols + 1)) / cols;
    for (const [y0, y1] of rows) {
      for (let c = 0; c < cols; c++) {
        const x = -w / 2 + 0.12 + pw / 2 + c * (pw + 0.12);
        for (const s of [1, -1]) {
          leaf.add(box(pw, y1 - y0, 0.008, style === 'main' ? trim : mat, [x, (y0 + y1) / 2, (s * (t + 0.008)) / 2], { collider: false }));
        }
      }
    }
  } else if (style === 'bathroom') {
    leaf.add(box(w * 0.18, h * 0.55, t + 0.004, ctx.mat('glass'), [w * 0.28, h * 0.55, 0], { collider: false, shadow: false }));
  }
  return leaf;
}
