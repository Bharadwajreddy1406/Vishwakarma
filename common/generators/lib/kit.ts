/** Reusable furniture building blocks: cabinet carcasses with hinged doors, drawers, legs. */
import * as THREE from 'three';
import type { Interactable } from './types';
import { box, handle, pivot } from './shapes';

export interface CabinetOpts {
  width: number;
  height: number;
  depth: number;
  /** bottom of the carcass (plinth height for kitchen bases, 0 for wardrobes) */
  y0?: number;
  /** number of door leaves; 'auto' = ~0.45-0.6 m each */
  doors?: number | 'auto';
  /** drawer rows stacked at the top of the carcass (each row spans full width) */
  drawers?: number;
  drawerHeight?: number;
  shelves?: number;
  /** hanging rod (wardrobes) */
  rod?: boolean;
  carcass: THREE.Material;
  front: THREE.Material;
  handleMat: THREE.Material;
  /** glass inset in door fronts */
  glass?: THREE.Material;
  openAngle?: number;
  label?: string;
  /** horizontal bar handles (kitchen) vs vertical */
  handleHorizontal?: boolean;
  /** door leaves hinge at top and lift up (wall cabinets) */
  liftUp?: boolean;
}

const T = 0.018; // panel thickness

/** Cabinet carcass (open front) + doors/drawers; front face at z = depth/2. Returns group + interactables. */
export function cabinet(o: CabinetOpts): { group: THREE.Group; interactables: Interactable[] } {
  const g = new THREE.Group();
  const inter: Interactable[] = [];
  const { width: W, height: H, depth: D } = o;
  const y0 = o.y0 ?? 0;
  const zc = -T / 2; // carcass slightly behind the door plane
  const Dc = D - T;

  // carcass
  g.add(box(T, H, Dc, o.carcass, [-W / 2 + T / 2, y0 + H / 2, zc]));
  g.add(box(T, H, Dc, o.carcass, [W / 2 - T / 2, y0 + H / 2, zc]));
  g.add(box(W, T, Dc, o.carcass, [0, y0 + T / 2, zc]));
  g.add(box(W, T, Dc, o.carcass, [0, y0 + H - T / 2, zc]));
  g.add(box(W - 2 * T, H - 2 * T, 0.006, o.carcass, [0, y0 + H / 2, zc - Dc / 2 + 0.003]));

  const nDrawers = o.drawers ?? 0;
  const dh = o.drawerHeight ?? 0.2;
  const doorH = H - nDrawers * dh;

  // shelves in the door section
  const nShelves = o.shelves ?? 0;
  for (let i = 1; i <= nShelves; i++) {
    const y = y0 + (doorH * i) / (nShelves + 1);
    g.add(box(W - 2 * T, T, Dc - 0.02, o.carcass, [0, y, zc + 0.01], { collider: false }));
  }
  if (o.rod) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, W - 2 * T, 12), o.handleMat);
    rod.rotation.z = Math.PI / 2;
    rod.position.set(0, y0 + doorH - 0.12, zc);
    rod.userData.collider = false;
    g.add(rod);
  }

  // doors
  if (doorH > 0.05) {
    const n = o.doors === 'auto' || o.doors === undefined ? Math.max(1, Math.round(W / 0.5)) : o.doors;
    const leafW = W / n - 0.004;
    const angle = o.openAngle ?? 1.75;
    for (let i = 0; i < n; i++) {
      const x0 = -W / 2 + (W / n) * i + 0.002;
      if (o.liftUp) {
        const p = pivot([x0 + leafW / 2, y0 + doorH - 0.002, D / 2 - T / 2], 'lift-door');
        p.add(frontPanel(leafW, doorH - 0.004, o.front, o.glass, [0, -(doorH - 0.004) / 2, 0]));
        p.add(handle(o.handleMat, [0, -(doorH - 0.004) + 0.04, T / 2], Math.min(0.3, leafW * 0.5), false));
        g.add(p);
        inter.push({ pivot: p, kind: 'hinge', axis: 'x', amount: -1.3, label: o.label ?? 'Cabinet' });
        continue;
      }
      const hingeLeft = n === 1 ? true : i % 2 === 0;
      const hx = hingeLeft ? x0 : x0 + leafW;
      const p = pivot([hx, y0 + doorH / 2, D / 2 - T / 2], 'door-leaf');
      const sx = hingeLeft ? leafW / 2 : -leafW / 2;
      p.add(frontPanel(leafW, doorH - 0.004, o.front, o.glass, [sx, 0, 0]));
      const hxLocal = hingeLeft ? leafW - 0.04 : -leafW + 0.04;
      const hy = o.handleHorizontal ? doorH / 2 - 0.05 : (doorH > 1.2 ? 0 : doorH / 2 - 0.12);
      p.add(handle(o.handleMat, [hxLocal, hy, T / 2], o.handleHorizontal ? 0.12 : Math.min(0.3, doorH * 0.25), !o.handleHorizontal));
      g.add(p);
      inter.push({ pivot: p, kind: 'hinge', axis: 'y', amount: hingeLeft ? -angle : angle, label: o.label ?? 'Cabinet', group: n === 2 ? `pair` : undefined });
    }
  }

  // drawers (top rows)
  for (let r = 0; r < nDrawers; r++) {
    const yb = y0 + doorH + r * dh;
    const d = drawer(W - 0.004, dh - 0.004, Dc - 0.03, o.carcass, o.front, o.handleMat);
    d.group.position.set(0, yb + 0.002, D / 2 - T / 2);
    g.add(d.group);
    inter.push({ pivot: d.group, kind: 'slide', axis: 'z', amount: Math.min(0.42, Dc * 0.75), label: 'Drawer' });
  }
  return { group: g, interactables: inter };
}

function frontPanel(w: number, h: number, mat: THREE.Material, glass: THREE.Material | undefined, pos: [number, number, number]): THREE.Object3D {
  if (!glass) return box(w, h, T, mat, pos);
  const g = new THREE.Group();
  g.position.set(...pos);
  const f = 0.06;
  g.add(box(w, f, T, mat, [0, h / 2 - f / 2, 0]));
  g.add(box(w, f, T, mat, [0, -h / 2 + f / 2, 0]));
  g.add(box(f, h - 2 * f, T, mat, [-w / 2 + f / 2, 0, 0]));
  g.add(box(f, h - 2 * f, T, mat, [w / 2 - f / 2, 0, 0]));
  g.add(box(w - 2 * f, h - 2 * f, 0.005, glass, [0, 0, 0], { collider: false, shadow: false }));
  return g;
}

/** drawer whose front face sits on the pivot's z; slides along +z. Origin at bottom-centre of the front. */
export function drawer(w: number, h: number, d: number, body: THREE.Material, front: THREE.Material, handleMat: THREE.Material) {
  const group = new THREE.Group();
  group.name = 'drawer';
  group.add(box(w, h, T, front, [0, h / 2, 0]));
  const bw = w - 0.05, bh = h * 0.7;
  group.add(box(bw, 0.008, d, body, [0, 0.03, -d / 2], { collider: false }));
  group.add(box(0.01, bh, d, body, [-bw / 2, 0.03 + bh / 2, -d / 2], { collider: false }));
  group.add(box(0.01, bh, d, body, [bw / 2, 0.03 + bh / 2, -d / 2], { collider: false }));
  group.add(box(bw, bh, 0.01, body, [0, 0.03 + bh / 2, -d], { collider: false }));
  group.add(handle(handleMat, [0, h * 0.62, T / 2], Math.min(0.2, w * 0.4), false));
  return { group };
}

/** four square/round legs under a w x d footprint */
export function legs(w: number, d: number, h: number, mat: THREE.Material, inset = 0.04, size = 0.04, round = false): THREE.Group {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (w / 2 - inset - size / 2), z = sz * (d / 2 - inset - size / 2);
      const m = round
        ? new THREE.Mesh(new THREE.CylinderGeometry(size / 2, size / 2.6, h, 12), mat)
        : box(size, h, size, mat);
      m.position.set(x, h / 2, z);
      m.castShadow = true;
      g.add(m);
    }
  }
  return g;
}
