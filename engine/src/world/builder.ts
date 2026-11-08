/**
 * plan.json + scene.json  ->  three.js scene graph + Rapier colliders + interactables.
 */
import * as THREE from 'three';
import type { Generator, GenContext, Interactable, Spawn } from '@common/generators/lib/types';
import { resolveParams } from '@common/generators/lib/types';
import { metricBox } from '@common/generators/lib/shapes';
import type { MaterialLibrary } from '@common/generators/lib/materials';
import type { Plan, PlanOpening, PlanRoom, PlanWall, Scene, SceneObject, Vec2 } from '../types';
import { deg, pointInPolygon, toWorld } from '../core/coords';
import type { Physics } from '../core/physics';
import type RAPIER from '@dimforge/rapier3d-compat';
import { getGenerator } from './registry';

export interface RuntimeInteractable {
  spec: Interactable;
  objectId: string;
  /** 0 = closed, 1 = open */
  t: number;
  target: number;
  base: THREE.Vector3;
  baseRot: THREE.Euler;
  meshes: THREE.Object3D[];
}

export interface Viewpoint {
  id: string;
  name: string;
  room?: string;
  /** eye position (world) */
  position: THREE.Vector3;
  yaw: number;
  pitch: number;
}

/** a placed piece of furniture / fixture, tracked so the editor can move, delete and re-add it */
export interface PlacedObject {
  id: string;
  /** scene.json entry (undefined for spawned children such as table chairs) */
  so?: SceneObject;
  parent?: string;
  generator: string;
  label: string;
  obj: THREE.Object3D;
  mode: string;
  colliders: RAPIER.Collider[];
  /** size in meters along local axes: width (x) x height (y) x depth (z) */
  size: THREE.Vector3;
}

export interface BuiltWorld {
  viewpoints: Viewpoint[];
  plan: Plan;
  objects: Map<string, PlacedObject>;
  /** interior walls with at least one open end; only open ends may be dragged */
  editableWalls: Map<string, { a: boolean; b: boolean; label: string }>;
  rebuildWall(id: string): void;
  addObject(so: SceneObject): Promise<PlacedObject | undefined>;
  removeObject(id: string): void;
  /** call after moving a static object's node */
  recollide(id: string): void;
  roomAt(p: Vec2): PlanRoom | undefined;
  wallLabel(id: string): string;
  root: THREE.Group;
  interactables: RuntimeInteractable[];
  rooms: { id: string; name: string; type: string; polygon: Vec2[] }[];
  spawn: { position: THREE.Vector3; heading: number };
  center: THREE.Vector3;
  radius: number;
  wallHeight: number;
  roof: THREE.Object3D;
  spinners: THREE.Object3D[];
  flickers: THREE.Object3D[];
  warnings: string[];
}

const WET = new Set(['toilet', 'bathroom', 'wash', 'utility']);
const BEDROOMS = new Set(['bedroom', 'master_bedroom']);

export async function buildWorld(plan: Plan, scene: Scene, lib: MaterialLibrary, physics: Physics, project: string): Promise<BuiltWorld> {
  const root = new THREE.Group();
  root.name = 'world';
  const viewpoints: Viewpoint[] = [];
  const vpSeen = new Set<string>();
  const warnings: string[] = [];
  const H = plan.defaults?.wall_height ?? 3.0;
  const doorH = plan.defaults?.door_height ?? 2.1;
  const winSill = plan.defaults?.window_sill ?? 0.9;
  const winH = plan.defaults?.window_height ?? 1.2;
  const sm = scene.materials ?? {};
  const pal = (slot: string, fallback: string) => lib.palette.slots[slot] ?? fallback;

  const roomAt = (p: Vec2): PlanRoom | undefined => plan.rooms.find((r) => pointInPolygon(p, r.polygon));
  /** bathroom wall tiles run from the floor up to this height (default 4'6"), paint above */
  const dadoH = scene.environment?.wet_dado_height ?? 1.372;
  const isWet = (r?: PlanRoom) => !!r && (r.type === 'toilet' || r.type === 'bathroom');
  const roomWallMat = (r: PlanRoom | undefined, exterior: boolean, belowDado = true): string => {
    if (!r) return exterior ? sm.wall_exterior ?? pal('wall_exterior', 'paint-exterior-white') : sm.wall_interior ?? pal('wall_interior', 'paint-warm-white');
    const o = scene.rooms?.[r.id]?.wall;
    if (o) return o;
    if (isWet(r) && belowDado) return pal('wall_wet', 'tile-wall-white-gloss');
    return sm.wall_interior ?? pal('wall_interior', 'paint-warm-white');
  };
  const roomFloorMat = (r: PlanRoom): string => {
    const o = scene.rooms?.[r.id]?.floor;
    if (o) return o;
    if (WET.has(r.type)) return pal('floor_wet', 'tile-antiskid-beige');
    if (r.type === 'puja') return pal('floor_puja', 'marble-white');
    if (BEDROOMS.has(r.type)) return pal('floor_bedroom', 'vitrified-ivory');
    if (r.type === 'balcony' || r.type === 'sitout') return pal('paving', 'pavers-grey');
    return sm.floor ?? pal('floor', 'vitrified-ivory');
  };

  // ---------------------------------------------------------------- bounds
  const xs: number[] = [], ys: number[] = [];
  for (const w of plan.walls) for (const p of [w.a, w.b]) { xs.push(p[0]); ys.push(p[1]); }
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const maxT = Math.max(...plan.walls.map((w) => w.thickness));
  const center = toWorld([(minX + maxX) / 2, (minY + maxY) / 2], H / 2);
  const radius = Math.hypot(maxX - minX, maxY - minY) / 2 + 2;

  // ---------------------------------------------------------------- walls
  const wallGroup = new THREE.Group();
  wallGroup.name = 'walls';
  root.add(wallGroup);
  const openingsByWall = new Map<string, PlanOpening[]>();
  for (const o of plan.openings) {
    if (!openingsByWall.has(o.wall)) openingsByWall.set(o.wall, []);
    openingsByWall.get(o.wall)!.push(o);
  }
  const wallById = new Map(plan.walls.map((w) => [w.id, w]));

  for (const w of plan.walls) buildWall(w);

  function wallFrame(w: PlanWall) {
    const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1];
    const L = Math.hypot(dx, dy);
    const ux = dx / L, uy = dy / L;
    const left: Vec2 = [-uy, ux];
    const at = (s: number, n = 0): Vec2 => [w.a[0] + ux * s + left[0] * n, w.a[1] + uy * s + left[1] * n];
    return { L, ux, uy, left, at, angle: Math.atan2(dy, dx) };
  }

  function buildWall(w: PlanWall): void {
    const f = wallFrame(w);
    const t = w.thickness;
    const Hw = w.height ?? H;
    const ops = (openingsByWall.get(w.id) ?? []).slice().sort((a, b) => a.offset - b.offset);
    // vertical bands: [s0, s1, yBottom, yTop]
    const bands: [number, number, number, number][] = [];
    let cursor = 0;
    for (const o of ops) {
      const s0 = Math.max(0, o.offset - o.width / 2), s1 = Math.min(f.L, o.offset + o.width / 2);
      if (s0 > cursor) bands.push([cursor, s0, 0, Hw]);
      const isWin = o.type === 'window' || o.type === 'ventilator';
      const sill = o.sill ?? (isWin ? winSill : 0);
      const top = Math.min(Hw, sill + (o.height ?? (isWin ? winH : doorH)));
      if (sill > 0.001) bands.push([s0, s1, 0, sill]);
      if (top < Hw - 0.001) bands.push([s0, s1, top, Hw]);
      cursor = Math.max(cursor, s1);
    }
    if (cursor < f.L) bands.push([cursor, f.L, 0, Hw]);

    for (const [s0, s1, y0, y1] of bands) {
      // split further where the room on either side changes (so each face gets its room's finish)
      const cuts = [s0];
      let prev = sideKey(s0 + 0.01);
      for (let s = s0 + 0.05; s < s1 - 0.01; s += 0.05) {
        const k = sideKey(s);
        if (k !== prev) { cuts.push(s); prev = k; }
      }
      cuts.push(s1);
      for (let i = 0; i < cuts.length - 1; i++) {
        let a = cuts[i], b = cuts[i + 1];
        // extend true wall ends to close corners
        if (a <= 0.0005) a -= t / 2 - 0.002;
        else a -= 0.0015; // overlap neighbouring pieces slightly: no hairline cracks at the seams
        if (b >= f.L - 0.0005) b += t / 2 - 0.002;
        else b += 0.0015;
        const mid = (cuts[i] + cuts[i + 1]) / 2;
        const leftRoom = roomAt(f.at(mid, t / 2 + 0.06));
        const rightRoom = roomAt(f.at(mid, -(t / 2 + 0.06)));
        const plain = lib.get(sm.wall_interior ?? pal('wall_interior', 'paint-warm-white'));
        const len = b - a;
        const c = f.at((a + b) / 2);
        // horizontal split at the bathroom dado height (tiles below, paint above)
        const wetSide = isWet(leftRoom) || isWet(rightRoom);
        const ys = wetSide && y0 < dadoH - 0.01 && y1 > dadoH + 0.01 ? [y0, dadoH, y1] : [y0, y1];
        for (let k = 0; k < ys.length - 1; k++) {
          const ya = ys[k], yb = ys[k + 1], h = yb - ya;
          const below = yb <= dadoH + 0.001;
          const matL = lib.get(roomWallMat(leftRoom, !!w.exterior, below));
          const matR = lib.get(roomWallMat(rightRoom, !!w.exterior, below));
          // faces: +x, -x, +y, -y, +z(right side), -z(left side)
          const mesh = new THREE.Mesh(metricBox(len, h, t), [plain, plain, plain, plain, matR, matL]);
          mesh.position.copy(toWorld(c, ya + h / 2));
          mesh.rotation.y = f.angle;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.userData.wall = w.id;
          wallGroup.add(mesh);
        }
        // trims on each room-facing side: skirting (dry rooms) / dado border strip (wet rooms)
        for (const [room, side] of [[leftRoom, 1], [rightRoom, -1]] as [PlanRoom | undefined, number][]) {
          if (!room || room.type === 'other') continue;
          const off = side * (t / 2 + 0.006);
          const tl = cuts[i + 1] - cuts[i];
          const tc = f.at((cuts[i] + cuts[i + 1]) / 2, off);
          if (isWet(room)) {
            if (y0 < dadoH && y1 > dadoH) addTrim(tl, 0.025, 0.012, dadoH, tc, f.angle, lib.get(pal('dado_border', 'granite-black')), wallGroup, w.id);
          } else if (y0 < 0.001) {
            addTrim(tl, 0.09, 0.012, 0.045, tc, f.angle, lib.get(roomFloorMat(room)), wallGroup, w.id);
          }
        }
      }
    }

    function sideKey(s: number): string {
      return `${roomAt(f.at(s, t / 2 + 0.06))?.id ?? '-'}|${roomAt(f.at(s, -(t / 2 + 0.06)))?.id ?? '-'}`;
    }
  }

  // ---------------------------------------------------------------- false ceilings (POP)
  const fc = scene.environment?.false_ceiling;
  const ceilings = new THREE.Group();
  ceilings.name = 'ceilings';
  root.add(ceilings);
  const fcRooms = new Map<string, { y: number; cove: boolean }>();
  if (fc && fc.height < H - 0.02) {
    const exclude = new Set(fc.exclude_types ?? ['other', 'balcony', 'sitout', 'parking']);
    const coveTypes = new Set(fc.cove_types ?? ['living', 'dining', 'bedroom', 'master_bedroom']);
    const band = fc.band ?? 0.45, recess = fc.recess ?? 0.12;
    const popMat = lib.get(sm.ceiling ?? pal('ceiling', 'ceiling-white'));
    const recessMat = (popMat as THREE.MeshStandardMaterial).clone();
    recessMat.side = THREE.DoubleSide;
    const ledMat = fc.led === '' ? null : new THREE.MeshStandardMaterial({ color: fc.led ?? '#ffd29a', emissive: fc.led ?? '#ffd29a', emissiveIntensity: 3 });
    for (const r of plan.rooms) {
      if (fc.rooms ? !fc.rooms.includes(r.id) : exclude.has(r.type)) continue;
      const b = polyBounds(r.polygon);
      const cove = coveTypes.has(r.type) && Math.min(b.w, b.h) > band * 2 + 1.0;
      const depth = H - fc.height;
      const outer = new THREE.Shape(r.polygon.map(([x, y]) => new THREE.Vector2(x, y)));
      let inner: Vec2[] | null = null;
      if (cove) {
        inner = insetPolygon(r.polygon, band);
        outer.holes.push(new THREE.Path(inner.map(([x, y]) => new THREE.Vector2(x, y))));
      }
      const geo = new THREE.ExtrudeGeometry(outer, { depth, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, fc.height, 0);
      const slab = new THREE.Mesh(geo, popMat);
      slab.receiveShadow = true;
      slab.castShadow = true;
      slab.name = `pop:${r.id}`;
      ceilings.add(slab);
      if (inner) {
        const rg = new THREE.ShapeGeometry(new THREE.Shape(inner.map(([x, y]) => new THREE.Vector2(x, y))));
        rg.rotateX(-Math.PI / 2);
        const rec = new THREE.Mesh(rg, recessMat);
        rec.position.y = fc.height + recess;
        rec.receiveShadow = true;
        ceilings.add(rec);
        if (ledMat) {
          // hidden cove LED along the inner lip of the band
          for (let i = 0; i < inner.length; i++) {
            const a = inner[i], c = inner[(i + 1) % inner.length];
            const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
            const strip = new THREE.Mesh(new THREE.BoxGeometry(len, 0.012, 0.02), ledMat);
            const n = [-(c[1] - a[1]) / len, (c[0] - a[0]) / len]; // inward (CCW polygon)
            strip.position.copy(toWorld([(a[0] + c[0]) / 2 - n[0] * 0.03, (a[1] + c[1]) / 2 - n[1] * 0.03], fc.height + recess - 0.03));
            strip.rotation.y = Math.atan2(c[1] - a[1], c[0] - a[0]);
            ceilings.add(strip);
          }
        }
      }
      fcRooms.set(r.id, { y: cove ? fc.height + recess : fc.height, cove });
    }
  }
  /** height of the ceiling surface at the room centre (false ceiling if any, else slab) */
  const ceilingAt = (roomId?: string) => (roomId && fcRooms.get(roomId)?.y) || H;

  // ---------------------------------------------------------------- floors, slab, roof
  const slabMat = lib.get(sm.floor ?? pal('floor', 'vitrified-ivory'));
  const pad = maxT;
  const slabW = maxX - minX + 2 * pad, slabD = maxY - minY + 2 * pad;
  const slab = new THREE.Mesh(metricBox(slabW, 0.12, slabD), slabMat);
  slab.position.copy(toWorld([(minX + maxX) / 2, (minY + maxY) / 2], -0.06 + 0.001));
  slab.receiveShadow = true;
  root.add(slab);

  for (const r of plan.rooms) {
    const shape = new THREE.Shape(r.polygon.map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2); // plan (x, y) -> world (x, 0, -y)
    const floor = new THREE.Mesh(geo, lib.get(roomFloorMat(r)));
    floor.position.y = (r.floor_level ?? 0) + 0.004;
    floor.receiveShadow = true;
    floor.name = `floor:${r.id}`;
    root.add(floor);
    // skirting is implied by the wall finish; add a ceiling light per room unless the scene provides one
    const hasLight = scene.objects.some((o) => o.room === r.id && o.generator === 'decor' && (o.params as any)?.kind === 'ceiling-light');
    if (!hasLight && r.type !== 'other') {
      const xsR = r.polygon.map((p) => p[0]), ysR = r.polygon.map((p) => p[1]);
      const area = Math.abs(polyArea(r.polygon));
      let c: Vec2 = [(Math.min(...xsR) + Math.max(...xsR)) / 2, (Math.min(...ysR) + Math.max(...ysR)) / 2];
      if (!pointInPolygon(c, r.polygon)) c = polyCentroid(r.polygon);
      const cfg = scene.rooms?.[r.id]?.light;
      const light = new THREE.PointLight(cfg?.color ?? 0xfff0dc, cfg?.intensity ?? Math.min(5, 1.6 + area * 0.25), Math.sqrt(area) * 2.4 + 2, 1.6);
      const ch = ceilingAt(r.id);
      light.position.copy(toWorld(c, ch - 0.2));
      light.userData.roomLight = true;
      root.add(light);
      // recessed downlight panel flush with the ceiling
      const fitting = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.012, 32), lib.get(pal('lamp', 'lamp-warm')));
      fitting.position.copy(toWorld(c, ch - 0.006));
      ceilings.add(fitting);
    }
  }

  const roofMat = [lib.get(pal('wall_exterior', 'paint-exterior-white'))];
  const ceilMat = lib.get(sm.ceiling ?? pal('ceiling', 'ceiling-white'));
  const roof = new THREE.Mesh(metricBox(slabW, 0.15, slabD), [roofMat[0], roofMat[0], roofMat[0], ceilMat, roofMat[0], roofMat[0]]);
  roof.position.copy(toWorld([(minX + maxX) / 2, (minY + maxY) / 2], H + 0.075));
  roof.castShadow = true;
  roof.receiveShadow = true;
  roof.name = 'roof';
  ceilings.add(roof);
  if (scene.environment?.ceilings === false) ceilings.visible = false;

  // ---------------------------------------------------------------- outside
  const groundMat = lib.get(scene.environment?.ground ?? pal('ground', 'concrete-grey'));
  const ground = new THREE.Mesh(metricBox(160, 0.1, 160), groundMat);
  ground.position.set(center.x, -0.07, center.z);
  ground.receiveShadow = true;
  root.add(ground);
  physics.addStaticBox(new THREE.Vector3(center.x, -0.5, center.z), new THREE.Vector3(80, 0.5, 80));
  for (const o of plan.site?.outside ?? []) {
    const m = o.kind === 'garden' ? pal('grass', 'grass-lawn') : pal('paving', 'pavers-grey');
    const shape = new THREE.Shape(o.polygon.map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, lib.get(m));
    mesh.position.y = -0.015;
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  // static colliders per wall (so one wall can be rebuilt when resized)
  const wallColliders = new Map<string, RAPIER.Collider[]>();
  const collideWall = (id: string) => {
    const cs: RAPIER.Collider[] = [];
    for (const m of wallGroup.children) if (m.userData.wall === id) cs.push(...physics.addStaticFromObject(m));
    wallColliders.set(id, cs);
  };
  for (const w of plan.walls) collideWall(w.id);
  function rebuildWall(id: string): void {
    const w = wallById.get(id);
    if (!w) return;
    physics.removeColliders(wallColliders.get(id) ?? []);
    for (const m of [...wallGroup.children]) {
      if (m.userData.wall !== id) continue;
      wallGroup.remove(m);
      (m as THREE.Mesh).geometry?.dispose();
    }
    buildWall(w);
    collideWall(id);
  }

  // editable walls: interior walls with an open end (an end that touches no other wall)
  const editableWalls = new Map<string, { a: boolean; b: boolean; label: string }>();
  const distToSeg = (p: Vec2, a: Vec2, b: Vec2) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  const isOpenEnd = (w: PlanWall, p: Vec2) => !plan.walls.some((o) => o.id !== w.id && distToSeg(p, o.a, o.b) < o.thickness / 2 + w.thickness / 2 + 0.03);
  for (const w of plan.walls) {
    if (w.exterior) continue;
    const a = isOpenEnd(w, w.a), b = isOpenEnd(w, w.b);
    if (a || b) editableWalls.set(w.id, { a, b, label: wallLabel(w.id) });
  }
  function wallLabel(id: string): string {
    const w = wallById.get(id);
    if (!w) return id;
    const f = wallFrame(w);
    const names = new Set<string>();
    for (let s = 0.2; s < f.L; s += 0.3) for (const n of [1, -1]) {
      const r = roomAt(f.at(s, n * (w.thickness / 2 + 0.1)));
      if (r) names.add(r.name);
    }
    return names.size ? `Wall · ${[...names].join(' / ')}` : `Wall ${id}`;
  }

  // ---------------------------------------------------------------- openings (doors / windows)
  const interactables: RuntimeInteractable[] = [];
  const objects = new Map<string, PlacedObject>();
  const spinners: THREE.Object3D[] = [];
  const flickers: THREE.Object3D[] = [];
  const entrance = plan.site?.entrance;

  for (const o of plan.openings) {
    if (o.type === 'opening') continue;
    const w = wallById.get(o.wall);
    if (!w) continue;
    const f = wallFrame(w);
    const override = scene.openings?.[o.id];
    const isWin = o.type === 'window' || o.type === 'ventilator';
    const genId = override?.generator ?? (isWin || o.type === 'sliding_door' ? 'window' : 'door');
    const connects = o.connects ?? [];
    const rTypes = connects.map((id) => plan.rooms.find((r) => r.id === id)?.type);
    let params: Record<string, unknown>;
    let rot = f.angle;
    if (genId === 'door') {
      const style = o.id === entrance || connects.includes('outside') ? 'main'
        : rTypes.includes('puja') ? 'puja'
        : rTypes.some((t) => t === 'toilet' || t === 'bathroom') ? 'bathroom' : 'panel';
      params = {
        width: o.width, height: o.height ?? doorH, wallThickness: w.thickness, leaves: o.leaves ?? (style === 'puja' ? 2 : 1),
        hinge: o.hinge === 'b' ? 'right' : 'left', swing: o.swing === 'left' ? 'back' : 'front', style,
      };
    } else {
      const sill = o.sill ?? (o.type === 'sliding_door' ? 0 : winSill);
      const style = o.type === 'ventilator' ? 'ventilator' : (o.height ?? winH) >= 1.4 && rTypesFor(o).includes('wash') ? 'grille' : 'sliding';
      const inside = roomAt(f.at(o.offset, w.thickness / 2 + 0.1)) ?? roomAt(f.at(o.offset, -w.thickness / 2 - 0.1));
      const curtains = style === 'sliding' && !!inside && ['living', 'dining', 'bedroom', 'master_bedroom', 'study'].includes(inside.type);
      params = {
        width: o.width, height: o.height ?? (o.type === 'sliding_door' ? doorH : winH), wallThickness: w.thickness, style, grill: !!w.exterior,
        curtains, sillHeight: sill, curtainLength: 'floor',
      };
      // windows face outside: +z (generator front) = plan right side; flip when outside is on the left
      const leftOutside = !roomAt(f.at(o.offset, w.thickness / 2 + 0.1));
      if (leftOutside) rot += Math.PI;
      (params as any)._sill = sill;
    }
    const gen = await getGenerator(genId, project);
    if (!gen) { warnings.push(`opening ${o.id}: unknown generator ${genId}`); continue; }
    const p = resolveParams(gen.meta, { ...params, ...(override?.params ?? {}) });
    const ctx = makeCtx(gen, override?.materials, genId === 'door' && p.style === 'main' ? { door: pal('door_main', 'door-main-teak') } : undefined);
    const res = gen.build(p, ctx);
    const obj = res.object;
    obj.name = `opening:${o.id}`;
    obj.position.copy(toWorld(f.at(o.offset), genId === 'window' ? ((params as any)._sill ?? 0) : 0));
    obj.rotation.y = rot;
    root.add(obj);
    registerObject(obj, res.interactables ?? [], o.id, 'static');
  }

  function rTypesFor(o: PlanOpening): string[] {
    const w = wallById.get(o.wall)!;
    const f = wallFrame(w);
    return [roomAt(f.at(o.offset, w.thickness / 2 + 0.1))?.type ?? '', roomAt(f.at(o.offset, -w.thickness / 2 - 0.1))?.type ?? ''];
  }

  // ---------------------------------------------------------------- furniture & fixtures
  for (const so of scene.objects) {
    await placeObject(so, undefined);
  }

  async function placeObject(so: SceneObject, parentMatrix: THREE.Matrix4 | undefined, spawnSpec?: Spawn): Promise<void> {
    const gen = await getGenerator(so.generator, project);
    if (!gen) { warnings.push(`object ${so.id}: unknown generator ${so.generator}`); return; }
    // ceiling-mounted things (fans, lights) and full-height units (wardrobe lofts) follow the room's ceiling
    const given: Record<string, unknown> = { ...(so.params ?? {}) };
    const kind = given.kind as string | undefined;
    if (so.generator === 'decor' && kind?.startsWith('ceiling') && given.height === undefined) given.height = ceilingAt(so.room);
    if ('ceiling' in gen.meta.params && given.ceiling === undefined) given.ceiling = ceilingAt(so.room);
    const p = resolveParams(gen.meta, given);
    const res = gen.build(p, makeCtx(gen, so.materials));
    const obj = res.object;
    obj.name = `object:${so.id}`;
    const room = so.room ? plan.rooms.find((r) => r.id === so.room) : undefined;
    if (parentMatrix && spawnSpec) {
      const local = new THREE.Matrix4().compose(
        new THREE.Vector3(...spawnSpec.position),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spawnSpec.rotationY ?? 0),
        new THREE.Vector3(1, 1, 1),
      );
      local.premultiply(parentMatrix);
      local.decompose(obj.position, obj.quaternion, obj.scale);
    } else {
      obj.position.copy(toWorld(so.position, (room?.floor_level ?? 0) + (so.elevation ?? 0)));
      obj.rotation.y = deg(so.rotation ?? 0);
    }
    root.add(obj);
    if (!spawnSpec) addViewpoint(so, gen.meta.id, p, obj, room);
    const physicsMode = so.physics ?? spawnSpec?.physics ?? gen.meta.physics ?? 'static';
    const colliders = registerObject(obj, res.interactables ?? [], so.id, physicsMode, gen.meta.mass ?? 10);
    // size in local axes (measure unrotated)
    const prevRot = obj.quaternion.clone();
    obj.quaternion.identity();
    obj.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(obj);
    obj.quaternion.copy(prevRot);
    obj.updateMatrixWorld(true);
    const kindName = so.generator === 'decor' ? String((p as any).kind ?? 'decor') : gen.meta.id;
    const label = kindName.split('-').map((w) => ({ tv: 'TV', wc: 'WC' } as Record<string, string>)[w] ?? w[0].toUpperCase() + w.slice(1)).join(' ');
    objects.set(so.id, {
      id: so.id, so: spawnSpec ? undefined : so, parent: spawnSpec ? so.id.split('.').slice(0, -1).join('.') : undefined,
      generator: gen.meta.id, label, obj, mode: physicsMode, colliders, size: bb.getSize(new THREE.Vector3()),
    });
    let i = 0;
    for (const sp of res.spawn ?? []) {
      await placeObject({ id: `${so.id}.${i++}`, generator: sp.generator, params: sp.params as any, position: so.position, materials: { ...(so.materials ?? {}), ...(sp.materials ?? {}) } }, obj.matrixWorld.clone(), sp);
    }
  }

  function registerObject(obj: THREE.Object3D, inter: Interactable[], id: string, mode: string, mass = 10): RAPIER.Collider[] {
    obj.traverse((o) => {
      if (o.userData.spin) spinners.push(o);
      if (o.userData.flicker) flickers.push(o);
    });
    if (mode === 'dynamic') {
      physics.addDynamic(obj, mass);
      return [];
    }
    const pivots = new Set(inter.map((i) => i.pivot));
    const colliders = mode !== 'none' ? physics.addStaticFromObject(obj, pivots) : [];
    for (const spec of inter) {
      if (mode !== 'none') physics.addFollower(spec.pivot);
      const meshes: THREE.Object3D[] = [];
      spec.pivot.traverse((m) => { if ((m as THREE.Mesh).isMesh) meshes.push(m); });
      const ri: RuntimeInteractable = {
        spec, objectId: id, t: 0, target: spec.open ? 1 : 0,
        base: spec.pivot.position.clone(), baseRot: spec.pivot.rotation.clone(), meshes,
      };
      interactables.push(ri);
    }
    return colliders;
  }

  async function addObject(so: SceneObject): Promise<PlacedObject | undefined> {
    await placeObject(so, undefined);
    return objects.get(so.id);
  }

  function removeObject(id: string): void {
    for (const [oid, po] of [...objects]) {
      if (oid !== id && po.parent !== id) continue;
      physics.removeColliders(po.colliders);
      physics.removeFollowersUnder(po.obj);
      physics.removeDynamic(po.obj);
      po.obj.removeFromParent();
      for (let i = interactables.length - 1; i >= 0; i--) if (interactables[i].objectId === oid) interactables.splice(i, 1);
      for (const arr of [spinners, flickers]) {
        for (let i = arr.length - 1; i >= 0; i--) {
          let n: THREE.Object3D | null = arr[i];
          while (n && n !== po.obj) n = n.parent;
          if (n) arr.splice(i, 1);
        }
      }
      objects.delete(oid);
    }
  }

  function recollide(id: string): void {
    const po = objects.get(id);
    if (!po) return;
    if (po.mode === 'dynamic') { physics.syncDynamicFromNode(po.obj); return; }
    if (po.mode === 'none') return;
    physics.removeColliders(po.colliders);
    const pivots = new Set(interactables.filter((i) => i.objectId === id).map((i) => i.spec.pivot));
    po.colliders = physics.addStaticFromObject(po.obj, pivots);
  }

  // ---------------------------------------------------------------- viewpoints (where a person would sit / stand)
  function roomLabel(room?: PlanRoom): string {
    if (!room) return '';
    if (room.type !== 'toilet' && room.type !== 'bathroom') return room.name;
    const via = plan.openings.find((o) => o.connects?.includes(room.id));
    const other = via?.connects?.find((c) => c !== room.id);
    const otherRoom = plan.rooms.find((r) => r.id === other);
    return otherRoom ? `${room.name} (off ${otherRoom.name})` : room.name;
  }
  function addViewpoint(so: SceneObject, gen: string, p: Record<string, any>, obj: THREE.Object3D, room?: PlanRoom): void {
    // local eye position + local look direction (generators face +z)
    let spec: { at: [number, number, number]; look: [number, number]; pitch: number; label: string } | undefined;
    switch (gen) {
      case 'sofa': spec = { at: [0, 1.17, 0.05], look: [0, 1], pitch: -6, label: 'Sitting on the sofa' }; break;
      case 'armchair': spec = { at: [0, 1.15, 0.05], look: [0, 1], pitch: -6, label: 'In the armchair' }; break;
      case 'bed': {
        const L = p.size === 'single' || p.size === 'double' ? 1.9 : 2.0;
        spec = { at: [0.15, 1.02, -L / 2 + 0.5], look: [0, 1], pitch: -10, label: 'Slouching on the bed' };
        break;
      }
      case 'dining-table': {
        // sit at whichever end chair looks into the house
        const L = (p.seats ?? 2) * (p.seatPitch ?? 0.6) + 0.2;
        obj.updateMatrixWorld(true);
        const endA = new THREE.Vector3(L / 2 + 0.5, 0, 0).applyMatrix4(obj.matrixWorld);
        const endB = new THREE.Vector3(-L / 2 - 0.5, 0, 0).applyMatrix4(obj.matrixWorld);
        const useA = endA.distanceTo(center) > endB.distanceTo(center);
        spec = { at: [useA ? L / 2 + 0.5 : -L / 2 - 0.5, 1.18, 0], look: [useA ? -1 : 1, 0], pitch: -7, label: 'Seated at the dining table' };
        break;
      }
      case 'mandir': spec = { at: [0, 0.82, (p.depth ?? 0.45) / 2 + 0.85], look: [0, -1], pitch: 8, label: 'Sitting before the mandir' }; break;
      case 'kitchen-counter':
        if ((p.hobAt ?? -1) >= 0) spec = { at: [-(p.length / 2) + p.hobAt, 1.68, (p.depth ?? 0.6) / 2 + 0.4], look: [0, -1], pitch: -24, label: 'Cooking at the counter' };
        break;
      case 'wc': spec = { at: [0, 1.15, 0.0], look: [0, 1], pitch: -4, label: 'Seated on the commode' }; break;
    }
    if (!spec) return;
    const key = `${gen}|${room?.id ?? ''}`;
    if (vpSeen.has(key)) return; // one per kind per room
    vpSeen.add(key);
    obj.updateMatrixWorld(true);
    const pos = new THREE.Vector3(...spec.at).applyMatrix4(obj.matrixWorld);
    const dir = new THREE.Vector3(spec.look[0], 0, spec.look[1]).transformDirection(obj.matrixWorld);
    viewpoints.push({
      id: so.id, name: `${spec.label} — ${roomLabel(room)}`, room: room?.id, position: pos,
      yaw: Math.atan2(-dir.x, -dir.z), pitch: (spec.pitch * Math.PI) / 180,
    });
  }

  function makeCtx(gen: Generator, overrides?: Record<string, string>, extra?: Record<string, string>): GenContext {
    return { THREE, mat: (slot: string) => lib.resolve(slot, { ...(extra ?? {}), ...(overrides ?? {}) }, gen.meta.slots) };
  }

  // ---------------------------------------------------------------- spawn
  let spawnPos: THREE.Vector3, heading = 0;
  if (scene.spawn?.position) {
    spawnPos = toWorld(scene.spawn.position, 0.1);
    heading = deg(scene.spawn.heading ?? 0);
  } else {
    const ent = plan.openings.find((o) => o.id === entrance) ?? plan.openings.find((o) => o.type === 'door');
    const w = ent ? wallById.get(ent.wall) : undefined;
    if (ent && w) {
      const f = wallFrame(w);
      const outLeft = !roomAt(f.at(ent.offset, w.thickness / 2 + 0.1));
      const n = outLeft ? 1 : -1;
      const p = f.at(ent.offset, n * 1.8);
      spawnPos = toWorld(p, 0.1);
      // face the door: direction from p toward the opening, in plan space
      const dx = -f.left[0] * n, dy = -f.left[1] * n;
      heading = Math.atan2(-dx, dy);
    } else {
      spawnPos = toWorld(polyCentroid(plan.rooms[0].polygon), 0.1);
    }
  }

  for (const v of scene.viewpoints ?? []) {
    const room = v.room ? plan.rooms.find((r) => r.id === v.room) : plan.rooms.find((r) => pointInPolygon(v.position, r.polygon));
    viewpoints.push({ id: v.id ?? v.name, name: v.name, room: room?.id, position: toWorld(v.position, (room?.floor_level ?? 0) + (v.eye ?? 1.68)),
      yaw: deg(v.heading ?? 0), pitch: deg(v.pitch ?? 0) });
  }
  const order = ['sofa', 'armchair', 'dining-table', 'kitchen-counter', 'mandir', 'bed', 'wc'];
  const rank = (v: Viewpoint) => { const o = scene.objects.find((x) => x.id === v.id); const i = o ? order.indexOf(o.generator) : 99; return i < 0 ? 98 : i; };
  viewpoints.sort((a, b) => rank(a) - rank(b));

  return {
    viewpoints, plan, objects, editableWalls, rebuildWall, addObject, removeObject, recollide, roomAt, wallLabel,
    root, interactables, rooms: plan.rooms.map((r) => ({ id: r.id, name: r.name, type: r.type, polygon: r.polygon })),
    spawn: { position: spawnPos, heading }, center, radius, wallHeight: H, roof: ceilings, spinners, flickers, warnings,
  };
}

/** thin strip on a wall face (skirting, dado border); no collider */
function addTrim(len: number, h: number, d: number, yCenter: number, at: Vec2, angle: number, mat: THREE.Material, parent: THREE.Object3D, wallId: string): void {
  const m = new THREE.Mesh(metricBox(len, h, d), mat);
  m.position.copy(toWorld(at, yCenter));
  m.rotation.y = angle;
  m.receiveShadow = true;
  m.userData.collider = false;
  m.userData.wall = wallId;
  parent.add(m);
}

function polyBounds(poly: Vec2[]) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** inward offset of a CCW polygon by d (miter joins; exact for orthogonal rooms) */
function insetPolygon(poly: Vec2[], d: number): Vec2[] {
  const n = poly.length;
  const normals = poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-(b[1] - a[1]) / L, (b[0] - a[0]) / L] as Vec2; // left of a->b = inside for CCW
  });
  return poly.map((v, i) => {
    const n1 = normals[(i - 1 + n) % n], n2 = normals[i];
    const k = d / (1 + n1[0] * n2[0] + n1[1] * n2[1]);
    return [v[0] + (n1[0] + n2[0]) * k, v[1] + (n1[1] + n2[1]) * k] as Vec2;
  });
}

function polyArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  return a / 2;
}

function polyCentroid(poly: Vec2[]): Vec2 {
  let x = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  return [x / poly.length, y / poly.length];
}
