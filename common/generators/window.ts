import * as THREE from 'three';
import type { GenContext, GenResult, GeneratorMeta, Interactable } from './lib/types';
import { box, pivot } from './lib/shapes';

export const meta: GeneratorMeta = {
  id: 'window',
  version: 1,
  description: 'Wall window. sliding (2-3 track panes, F slides), ventilator (glass louvres, toilets), grille (open MS grill, wash/utility). Optional safety grill. Local: centred x=0, y=0 = sill, z=0 = wall centre.',
  tags: ['window', 'opening', 'interactive'],
  params: {
    width: { type: 'number', default: 1.2, min: 0.3, max: 4 },
    height: { type: 'number', default: 1.2, min: 0.3, max: 2.4 },
    wallThickness: { type: 'number', default: 0.115, min: 0.05, max: 0.4 },
    style: { type: 'enum', default: 'sliding', options: ['sliding', 'ventilator', 'grille'] },
    panes: { type: 'int', default: 2, min: 2, max: 4 },
    grill: { type: 'bool', default: true, description: 'MS safety grill on the outside face (typical ground floor)' },
    sill: { type: 'bool', default: true, description: 'stone sill ledge inside' },
    curtains: { type: 'bool', default: false, description: 'pleated curtains on a rod (inside, -z); F draws them' },
    curtainLength: { type: 'enum', default: 'floor', options: ['floor', 'sill'] },
    sillHeight: { type: 'number', default: 0.9, description: 'sill above floor (for floor-length curtains)' },
  },
  slots: { frame: 'upvc-white', glass: 'glass-clear', frosted: 'glass-frosted', grill: 'metal-black', sill: 'granite-black', curtain: 'curtain-linen', rod: 'metal-black' },
};

/** pleated fabric panel: sine folds across its width, hanging from y=0 down to -h */
function curtainPanel(w: number, h: number, mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(w, h, Math.max(24, Math.round(w * 60)), 12);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const folds = Math.max(3, Math.round(w / 0.11));
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const sway = 1 + 0.25 * ((h / 2 - y) / h); // folds widen toward the hem
    pos.setZ(i, Math.sin(((x + w / 2) / w) * folds * Math.PI * 2) * 0.03 * sway);
  }
  geo.translate(0, -h / 2, 0);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData.collider = false;
  return m;
}

export function build(p: Record<string, any>, ctx: GenContext): GenResult {
  const g = new THREE.Group();
  const W: number = p.width, H: number = p.height, t = Math.max(p.wallThickness, 0.06);
  const frame = ctx.mat('frame');
  const grillMat = ctx.mat('grill');
  const inter: Interactable[] = [];
  const f = 0.045;

  if (p.style !== 'grille') {
    g.add(box(W, f, t, frame, [0, f / 2, 0]));
    g.add(box(W, f, t, frame, [0, H - f / 2, 0]));
    g.add(box(f, H, t, frame, [-W / 2 + f / 2, H / 2, 0]));
    g.add(box(f, H, t, frame, [W / 2 - f / 2, H / 2, 0]));
  }

  if (p.style === 'sliding') {
    const n: number = p.panes;
    const pw = (W - 2 * f) / n + 0.03;
    const ph = H - 2 * f;
    for (let i = 0; i < n; i++) {
      const track = i % 2 === 0 ? -0.018 : 0.018;
      const x = -W / 2 + f + pw / 2 + i * ((W - 2 * f - pw) / (n - 1));
      const pane = pivot([x, f, track], 'pane');
      const pf = 0.035;
      pane.add(box(pw, pf, 0.025, frame, [0, pf / 2, 0]));
      pane.add(box(pw, pf, 0.025, frame, [0, ph - pf / 2, 0]));
      pane.add(box(pf, ph, 0.025, frame, [-pw / 2 + pf / 2, ph / 2, 0]));
      pane.add(box(pf, ph, 0.025, frame, [pw / 2 - pf / 2, ph / 2, 0]));
      pane.add(box(pw - 2 * pf, ph - 2 * pf, 0.006, ctx.mat('glass'), [0, ph / 2, 0], { collider: false, shadow: false }));
      g.add(pane);
      // slide toward the neighbouring pane
      const dirn = i < n / 2 ? 1 : -1;
      if (i === 0 || i === n - 1) inter.push({ pivot: pane, kind: 'slide', axis: 'x', amount: dirn * (pw - 0.06), label: 'Window', duration: 0.6 });
    }
  } else if (p.style === 'ventilator') {
    const n = Math.max(3, Math.round((H - 2 * f) / 0.1));
    const lh = (H - 2 * f) / n;
    for (let i = 0; i < n; i++) {
      const l = box(W - 2 * f, lh * 1.1, 0.005, ctx.mat('frosted'), [0, f + lh * (i + 0.5), 0], { collider: false, shadow: false });
      l.rotation.x = -0.5;
      g.add(l);
    }
  }

  if (p.grill || p.style === 'grille') {
    const zg = p.style === 'grille' ? 0 : t / 2 + 0.015;
    const step = 0.12;
    for (let x = -W / 2 + step / 2; x < W / 2; x += step) {
      g.add(box(0.012, H, 0.012, grillMat, [x, H / 2, zg], { collider: false }));
    }
    for (const y of [0.01, H / 2, H - 0.01]) g.add(box(W, 0.025, 0.012, grillMat, [0, y, zg], { collider: false }));
  }

  // invisible blocker so nobody walks / jumps through
  const block = box(W, H, 0.04, frame, [0, H / 2, 0]);
  block.visible = false;
  g.add(block);

  if (p.sill && p.style !== 'grille') {
    g.add(box(W + 0.06, 0.02, 0.06, ctx.mat('sill'), [0, -0.01, -(t / 2 + 0.03) + 0.005], { collider: false }));
  }

  if (p.curtains && p.style === 'sliding') {
    const span = W + 0.5;
    const rodY = H + 0.2;
    const z = -(t / 2 + 0.1);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, span + 0.1, 16), ctx.mat('rod'));
    rod.rotation.z = Math.PI / 2;
    rod.position.set(0, rodY, z);
    rod.userData.collider = false;
    g.add(rod);
    const hang = p.curtainLength === 'floor' ? rodY + p.sillHeight - 0.02 : rodY + 0.15;
    const pw = span / 2 + 0.05;
    for (const s of [-1, 1]) {
      const closedX = s * (pw / 2 - 0.03);
      const openX = s * (span / 2 + pw * 0.15);
      const pv = pivot([openX, rodY - 0.02, z], 'curtain');
      pv.add(curtainPanel(pw, hang, ctx.mat('curtain')));
      g.add(pv);
      inter.push({ pivot: pv, kind: 'slide', axis: 'x', amount: closedX - openX, label: 'Curtains', duration: 1.1, group: 'curtains' });
    }
  }
  return { object: g, interactables: inter };
}
