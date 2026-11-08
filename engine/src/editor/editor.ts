/**
 * In-game editor (press E):
 *   1 Move    — aim at furniture, click to pick it up, click to place. R = rotate 90°, wheel = rotate 5°,
 *               X = cut, P = paste, Delete = delete, right-click = cancel. Snaps flat against walls and shows
 *               live clearances to the surrounding walls.
 *   2 Measure — click two points; distance in feet-inches and meters (axis-snapped). Backspace clears.
 *   3 Walls   — only open-ended interior walls are resizable: click the wall, move the look to slide its open end,
 *               click to set. Shows the wall length and the clear gap that remains. Backspace = reset to plan.
 *   Z = undo. Every change is saved to scene.json (`objects`, `plan_edits.walls`) immediately.
 */
import * as THREE from 'three';
import type { BuiltWorld, PlacedObject } from '../world/builder';
import type { Physics } from '../core/physics';
import type { Input } from '../player/input';
import type { Interactions } from '../interaction/interact';
import type { Hud } from '../ui/hud';
import type { Plan, PlanWall, Scene, SceneObject, Vec2 } from '../types';
import { toPlan, toWorld } from '../core/coords';

export type Tool = 'move' | 'measure' | 'walls';

export function ftin(m: number): string {
  const neg = m < 0;
  const totalIn = Math.round((Math.abs(m) / 0.0254) * 2) / 2;
  let ft = Math.floor(totalIn / 12);
  let inch = totalIn - ft * 12;
  if (inch >= 12) { ft += 1; inch -= 12; }
  const whole = Math.floor(inch);
  const half = inch - whole >= 0.5 ? '½' : '';
  return `${neg ? '−' : ''}${ft}'${whole}${half}"`;
}
const dim = (m: number) => `${ftin(m)} <small>${m.toFixed(2)} m</small>`;

type Undo =
  | { kind: 'move'; id: string; from: { pos: THREE.Vector3; rot: number; room?: string } }
  | { kind: 'delete'; so: SceneObject; index: number }
  | { kind: 'add'; id: string }
  | { kind: 'wall'; id: string; from: { a: Vec2; b: Vec2 } };

interface Label { el: HTMLDivElement; pos: THREE.Vector3 }

export class Editor {
  active = false;
  tool: Tool = 'move';
  private ray = new THREE.Raycaster();
  private helpers = new THREE.Group();
  private labelsEl: HTMLDivElement;
  private panel: HTMLDivElement;
  private live: Label[] = [];
  private pinned: { line: THREE.Line; label: Label }[] = [];
  private undoStack: Undo[] = [];
  private clipboard?: SceneObject;
  private saveTimer = 0;
  // move tool
  private hoverObj?: PlacedObject;
  private carrying?: { po: PlacedObject; from: THREE.Vector3; fromRot: number; fromRoom?: string; isNew: boolean };
  private boxHelper = new THREE.Box3Helper(new THREE.Box3(), 0xe8a33d);
  // measure tool
  private mStart?: THREE.Vector3;
  private marker: THREE.Mesh;
  // walls tool
  private hoverWall?: string;
  private dragWall?: { id: string; end: 'a' | 'b'; fixed: Vec2; dir: Vec2; from: { a: Vec2; b: Vec2 }; maxL: number; minL: number; L: number; lastL: number };
  private wallGlow: THREE.Mesh;
  private handles: THREE.Mesh[] = [];
  private originalWalls = new Map<string, { a: Vec2; b: Vec2 }>();
  private lineMat = new THREE.LineBasicMaterial({ color: 0xe8a33d, depthTest: false, transparent: true });

  constructor(
    private stage: { scene: THREE.Scene; camera: THREE.PerspectiveCamera },
    private world: BuiltWorld,
    private physics: Physics,
    private input: Input,
    private interact: Interactions,
    private hud: Hud,
    private scene: Scene,
    private project: string,
    private originalPlan: Plan,
  ) {
    this.helpers.name = 'editor-helpers';
    this.helpers.visible = false;
    stage.scene.add(this.helpers);
    this.boxHelper.visible = false;
    (this.boxHelper.material as THREE.LineBasicMaterial).depthTest = false;
    this.helpers.add(this.boxHelper);
    this.marker = new THREE.Mesh(new THREE.SphereGeometry(0.025, 16, 12), new THREE.MeshBasicMaterial({ color: 0xe8a33d, depthTest: false }));
    this.marker.renderOrder = 999;
    this.helpers.add(this.marker);
    this.wallGlow = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xe8a33d, transparent: true, opacity: 0.18, depthWrite: false }));
    this.wallGlow.visible = false;
    this.helpers.add(this.wallGlow);
    for (const w of originalPlan.walls) this.originalWalls.set(w.id, { a: [...w.a] as Vec2, b: [...w.b] as Vec2 });

    this.labelsEl = document.createElement('div');
    this.labelsEl.id = 'edit-labels';
    document.getElementById('hud')!.append(this.labelsEl);
    this.panel = document.getElementById('editor') as HTMLDivElement;

    input.on('KeyE', () => this.toggle());
    input.on('KeyR', () => this.rotateCarried(Math.PI / 2));
    input.on('KeyX', () => this.cut());
    input.on('KeyP', () => void this.paste());
    input.on('Delete', () => this.deleteHovered());
    input.on('Backspace', () => this.backspace());
    input.on('KeyZ', () => void this.undo());
    addEventListener('mousedown', (e) => {
      if (!this.active || !this.input.locked) return;
      if (e.button === 0) void this.click();
      if (e.button === 2) this.cancel();
    });
    addEventListener('contextmenu', (e) => { if (this.active) e.preventDefault(); });
    addEventListener('wheel', (e) => {
      if (!this.active || !this.carrying) return;
      this.rotateCarried((e.deltaY > 0 ? -5 : 5) * (Math.PI / 180));
    }, { passive: true });
  }

  toggle(): void {
    this.active = !this.active;
    if (!this.active) this.cancel();
    this.helpers.visible = this.active;
    this.panel.hidden = !this.active;
    this.labelsEl.hidden = !this.active;
    this.renderPanel();
    this.hud.toast(this.active ? 'Editor on — 1 Move · 2 Measure · 3 Walls' : 'Editor off');
  }

  setTool(t: Tool): void {
    this.cancel();
    this.tool = t;
    this.renderPanel();
  }

  private renderPanel(): void {
    const tools: [Tool, string, string][] = [['move', '1', 'Move'], ['measure', '2', 'Measure'], ['walls', '3', 'Walls']];
    const help: Record<Tool, string> = {
      move: 'click: pick up / place · <kbd>R</kbd> rotate 90° · wheel rotate 5° · <kbd>X</kbd> cut · <kbd>P</kbd> paste · <kbd>Del</kbd> delete · right-click cancel',
      measure: 'click two points · lines snap to the room axes · <kbd>Backspace</kbd> clear all',
      walls: 'only open-ended walls resize · click the wall, look along it, click to set · <kbd>Backspace</kbd> reset to plan',
    };
    this.panel.innerHTML = `<div class="tabs">${tools.map(([id, k, n]) => `<span class="${this.tool === id ? 'on' : ''}"><kbd>${k}</kbd>${n}</span>`).join('')}</div>
      <div class="help">${help[this.tool]} · <kbd>Z</kbd> undo · <kbd>E</kbd> exit</div>`;
  }

  // ------------------------------------------------------------------ per frame
  update(): void {
    this.clearLive();
    if (!this.active) return;
    this.ray.setFromCamera(new THREE.Vector2(0, 0), this.stage.camera);
    this.ray.far = 40;
    this.marker.visible = false;
    this.boxHelper.visible = false;
    this.wallGlow.visible = false;
    for (const h of this.handles) h.visible = false;
    if (this.tool === 'move') this.updateMove();
    else if (this.tool === 'measure') this.updateMeasure();
    else this.updateWalls();
    this.updateRoomInfo();
    this.placeLabels();
  }

  private hitWorld(): THREE.Intersection | undefined {
    const skip = this.carrying?.po.obj;
    return this.ray.intersectObject(this.world.root, true).find((h) => {
      if (!(h.object as THREE.Mesh).isMesh || !h.object.visible) return false;
      if (skip) { let n: THREE.Object3D | null = h.object; while (n && n !== skip) n = n.parent; if (n) return false; }
      return true;
    });
  }

  private updateRoomInfo(): void {
    const p = toPlan(this.stage.camera.position);
    const r = this.world.roomAt(p);
    const el = document.getElementById('editor-room');
    if (!el) return;
    if (!r) { el.textContent = ''; return; }
    const xs = r.polygon.map((q) => q[0]), ys = r.polygon.map((q) => q[1]);
    el.innerHTML = `${r.name}: ${dim(Math.max(...xs) - Math.min(...xs))} × ${dim(Math.max(...ys) - Math.min(...ys))} clear`;
  }

  // ------------------------------------------------------------------ move
  private objectFromHit(o: THREE.Object3D): PlacedObject | undefined {
    let n: THREE.Object3D | null = o;
    while (n && !(n.name?.startsWith('object:'))) n = n.parent;
    return n ? this.world.objects.get(n.name.slice(7)) : undefined;
  }

  private updateMove(): void {
    if (this.carrying) {
      const { po } = this.carrying;
      const floorY = po.obj.position.y;
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -floorY);
      const p = new THREE.Vector3();
      if (!this.ray.ray.intersectPlane(plane, p) || p.distanceTo(this.stage.camera.position) > 9) {
        p.copy(this.stage.camera.position).addScaledVector(this.ray.ray.direction, 3);
        p.y = floorY;
      }
      po.obj.position.set(p.x, floorY, p.z);
      po.obj.updateMatrixWorld(true);
      this.snapToWall(po);
      if (po.mode === 'dynamic') this.physics.syncDynamicFromNode(po.obj);
      this.showBox(po, true);
      this.showClearances(po);
      return;
    }
    const h = this.hitWorld();
    this.hoverObj = h ? this.objectFromHit(h.object) : undefined;
    if (this.hoverObj) {
      this.showBox(this.hoverObj, false);
      const s = this.hoverObj.size;
      const top = new THREE.Box3().setFromObject(this.hoverObj.obj).max.y;
      this.addLabel(new THREE.Vector3(this.hoverObj.obj.position.x, top + 0.15, this.hoverObj.obj.position.z),
        `<b>${this.hoverObj.label}</b><br>${ftin(s.x)} W × ${ftin(s.z)} D × ${ftin(s.y)} H${this.hoverObj.parent ? '<br><i>part of ' + this.hoverObj.parent + '</i>' : ''}`, 'obj');
    }
  }

  private showBox(po: PlacedObject, carrying: boolean): void {
    this.boxHelper.box.setFromObject(po.obj);
    (this.boxHelper.material as THREE.LineBasicMaterial).color.set(carrying ? 0x6fd36f : 0xe8a33d);
    this.boxHelper.visible = true;
  }

  /** back (-z local) against a wall when it is close */
  private snapToWall(po: PlacedObject): void {
    const back = new THREE.Vector3(0, 0, -1).applyQuaternion(po.obj.quaternion).setY(0).normalize();
    const origin = po.obj.position.clone().setY(po.obj.position.y + 0.5);
    const half = po.size.z / 2;
    const hit = this.castH(origin, back, half + 0.4, po);
    if (hit !== null && hit > half - 0.05) po.obj.position.addScaledVector(back, hit - half - 0.01);
    po.obj.updateMatrixWorld(true);
  }

  /** horizontal physics ray, ignoring the player and the carried object; returns distance or null */
  private castH(origin: THREE.Vector3, dir: THREE.Vector3, max: number, po?: PlacedObject): number | null {
    const R = this.physics.R;
    const body = po && po.mode === 'dynamic' ? this.physics.dynamicBody(po.obj) : undefined;
    const hit = this.physics.world.castRay(new R.Ray(origin, dir), max, true, undefined, undefined, undefined, body,
      (c) => !c.parent()?.isKinematic() || !!c.parent()?.isFixed());
    return hit ? hit.timeOfImpact : null;
  }

  private showClearances(po: PlacedObject): void {
    const q = po.obj.quaternion;
    const c = po.obj.position.clone().setY(po.obj.position.y + 0.3);
    const dirs: [THREE.Vector3, number, string][] = [
      [new THREE.Vector3(1, 0, 0), po.size.x / 2, 'side'], [new THREE.Vector3(-1, 0, 0), po.size.x / 2, 'side'],
      [new THREE.Vector3(0, 0, 1), po.size.z / 2, 'front'], [new THREE.Vector3(0, 0, -1), po.size.z / 2, 'back'],
    ];
    for (const [d0, half] of dirs) {
      const d = d0.clone().applyQuaternion(q).setY(0).normalize();
      const dist = this.castH(c, d, 8, po);
      if (dist === null) continue;
      const gap = dist - half;
      const a = c.clone().addScaledVector(d, half), b = c.clone().addScaledVector(d, dist);
      this.addLine(a, b);
      if (gap > 0.02) this.addLabel(a.clone().lerp(b, 0.5), ftin(gap), gap < 0.45 ? 'warn' : '');
    }
    this.addLabel(c.clone().setY(new THREE.Box3().setFromObject(po.obj).max.y + 0.2),
      `<b>${po.label}</b> · ${Math.round(((THREE.MathUtils.radToDeg(po.obj.rotation.y) % 360) + 360) % 360)}°<br>click to place · R / wheel rotate · right-click cancel`, 'obj');
  }

  private rotateCarried(rad: number): void {
    if (!this.active || !this.carrying) return;
    const o = this.carrying.po.obj;
    o.rotation.y = rad === Math.PI / 2 ? Math.round((o.rotation.y + rad) / (Math.PI / 2)) * (Math.PI / 2) : o.rotation.y + rad;
  }

  private pickUp(po: PlacedObject, isNew = false): void {
    if (po.parent) { this.hud.toast(`Part of ${po.parent} — move that instead (chairs can be pushed)`); return; }
    if (!po.so) return;
    this.carrying = { po, from: po.obj.position.clone(), fromRot: po.obj.rotation.y, fromRoom: po.so.room, isNew };
    if (po.mode === 'dynamic') this.physics.setHeld(po.obj, true);
    else this.physics.removeColliders(po.colliders);
  }

  private place(): void {
    const c = this.carrying;
    if (!c || !c.po.so) return;
    const { po } = c;
    const so = po.so!;
    if (po.mode === 'dynamic') { this.physics.syncDynamicFromNode(po.obj); this.physics.setHeld(po.obj, false); }
    this.world.recollide(po.id);
    const p = toPlan(po.obj.position);
    so.position = [round3(p[0]), round3(p[1])];
    so.rotation = Math.round(((THREE.MathUtils.radToDeg(po.obj.rotation.y) % 360) + 360) % 360 * 10) / 10;
    so.room = this.world.roomAt(p)?.id ?? so.room;
    if (!c.isNew) this.undoStack.push({ kind: 'move', id: po.id, from: { pos: c.from, rot: c.fromRot, room: c.fromRoom } });
    this.carrying = undefined;
    this.hud.toast(`Placed ${po.label}`, 1);
    this.save();
  }

  private cancel(): void {
    const c = this.carrying;
    if (c) {
      if (c.isNew) {
        this.removeSceneObject(c.po.id);
      } else {
        c.po.obj.position.copy(c.from);
        c.po.obj.rotation.y = c.fromRot;
        c.po.obj.updateMatrixWorld(true);
        if (c.po.mode === 'dynamic') { this.physics.syncDynamicFromNode(c.po.obj); this.physics.setHeld(c.po.obj, false); }
        this.world.recollide(c.po.id);
      }
      this.carrying = undefined;
    }
    this.mStart = undefined;
    if (this.dragWall) {
      this.applyWall(this.dragWall.id, this.dragWall.from.a, this.dragWall.from.b);
      this.dragWall = undefined;
    }
  }

  private removeSceneObject(id: string): { so: SceneObject; index: number } | undefined {
    const index = this.scene.objects.findIndex((o) => o.id === id);
    if (index < 0) return;
    const [so] = this.scene.objects.splice(index, 1);
    this.world.removeObject(id);
    this.interact.refresh();
    return { so, index };
  }

  private cut(): void {
    if (!this.active || this.tool !== 'move') return;
    const po = this.carrying?.po ?? this.hoverObj;
    if (!po?.so) return;
    if (this.carrying) this.cancel();
    const so = JSON.parse(JSON.stringify(po.so)) as SceneObject;
    const r = this.removeSceneObject(po.id);
    if (!r) return;
    this.clipboard = so;
    this.undoStack.push({ kind: 'delete', so: r.so, index: r.index });
    this.hud.toast(`Cut ${po.label} — aim and press P to paste`, 2.2);
    this.save();
  }

  private deleteHovered(): void {
    if (!this.active || this.tool !== 'move') return;
    const po = this.hoverObj;
    if (!po?.so || this.carrying) return;
    const r = this.removeSceneObject(po.id);
    if (!r) return;
    this.clipboard = JSON.parse(JSON.stringify(r.so));
    this.undoStack.push({ kind: 'delete', so: r.so, index: r.index });
    this.hud.toast(`Deleted ${po.label} (Z to undo)`, 1.6);
    this.save();
  }

  private async paste(): Promise<void> {
    if (!this.active || this.tool !== 'move' || !this.clipboard || this.carrying) return;
    const so: SceneObject = JSON.parse(JSON.stringify(this.clipboard));
    let id = so.id, n = 2;
    while (this.world.objects.has(id) || this.scene.objects.some((o) => o.id === id)) id = `${so.id}-${n++}`;
    so.id = id;
    const p = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) p.copy(this.stage.camera.position);
    const pp = toPlan(p);
    so.position = [pp[0], pp[1]];
    so.room = this.world.roomAt(pp)?.id ?? so.room;
    this.scene.objects.push(so);
    const po = await this.world.addObject(so);
    this.interact.refresh();
    if (!po) return;
    this.undoStack.push({ kind: 'add', id });
    this.pickUp(po, true);
    this.hud.toast(`Pasted ${po.label} — click to place`, 1.6);
  }

  // ------------------------------------------------------------------ measure
  private updateMeasure(): void {
    const h = this.hitWorld();
    if (!h) return;
    const p = h.point.clone();
    // snap to pinned endpoints
    for (const m of this.pinned) {
      const pos = (m.line.geometry.getAttribute('position') as THREE.BufferAttribute);
      for (let i = 0; i < 2; i++) {
        const q = new THREE.Vector3().fromBufferAttribute(pos, i);
        if (q.distanceTo(p) < 0.06) p.copy(q);
      }
    }
    if (this.mStart) this.axisSnap(this.mStart, p);
    this.marker.position.copy(p);
    this.marker.visible = true;
    if (this.mStart) {
      this.addLine(this.mStart, p);
      this.addLabel(this.mStart.clone().lerp(p, 0.5), this.measureText(this.mStart, p), 'measure');
    } else {
      this.addLabel(p.clone().add(new THREE.Vector3(0, 0.12, 0)), 'click to start measuring', 'hint');
    }
  }

  /** if the segment is within 4° of a room axis (or vertical), snap it onto that axis */
  private axisSnap(a: THREE.Vector3, p: THREE.Vector3): void {
    const d = p.clone().sub(a);
    const len = d.length();
    if (len < 0.05) return;
    const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    for (const ax of axes) {
      const c = Math.abs(d.dot(ax)) / len;
      if (c > Math.cos((4 * Math.PI) / 180)) {
        p.copy(a).addScaledVector(ax, d.dot(ax));
        return;
      }
    }
  }

  private measureText(a: THREE.Vector3, b: THREE.Vector3): string {
    const d = b.clone().sub(a);
    const horiz = Math.hypot(d.x, d.z);
    let s = `<b>${dim(d.length())}</b>`;
    if (Math.abs(d.y) > 0.05 && horiz > 0.05) s += `<br>horizontal ${ftin(horiz)} · height ${ftin(Math.abs(d.y))}`;
    else if (Math.abs(d.x) > 0.05 && Math.abs(d.z) > 0.05) s += `<br>${ftin(Math.abs(d.x))} × ${ftin(Math.abs(d.z))}`;
    return s;
  }

  // ------------------------------------------------------------------ walls
  private wallOf(id: string): PlanWall | undefined {
    return this.world.plan.walls.find((w) => w.id === id);
  }

  private updateWalls(): void {
    if (this.dragWall) { this.updateWallDrag(); return; }
    const h = this.ray.intersectObject(this.world.root.getObjectByName('walls')!, true)[0];
    this.hoverWall = h?.object.userData.wall;
    if (!this.hoverWall) {
      for (const [id, e] of this.world.editableWalls) this.showHandles(id, e, false);
      return;
    }
    const w = this.wallOf(this.hoverWall)!;
    const ed = this.world.editableWalls.get(w.id);
    this.glowWall(w, ed ? 0xe8a33d : 0xd9534f);
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const label = this.world.wallLabel(w.id);
    this.addLabel(h.point.clone().add(new THREE.Vector3(0, 0.25, 0)),
      ed ? `<b>${label}</b><br>length ${dim(L)}<br>click to resize the open end`
         : `<b>${label}</b><br>length ${dim(L)}<br><i>fixed — ${w.exterior ? 'exterior wall' : 'closed at both ends'}</i>`, ed ? 'obj' : 'warn');
    if (ed) this.showHandles(w.id, ed, true);
  }

  private glowWall(w: PlanWall, color: number): void {
    const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1];
    const L = Math.hypot(dx, dy);
    const H = this.world.wallHeight;
    this.wallGlow.scale.set(L + w.thickness, H + 0.02, w.thickness + 0.03);
    this.wallGlow.position.copy(toWorld([(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2], H / 2));
    this.wallGlow.rotation.y = Math.atan2(dy, dx);
    (this.wallGlow.material as THREE.MeshBasicMaterial).color.set(color);
    this.wallGlow.visible = true;
  }

  private showHandles(id: string, e: { a: boolean; b: boolean }, strong: boolean): void {
    const w = this.wallOf(id)!;
    let i = 0;
    for (const end of ['a', 'b'] as const) {
      if (!e[end]) continue;
      const hm = this.handle(i++ + this.handles.length * 0);
      hm.position.copy(toWorld(w[end], 1.2));
      (hm.material as THREE.MeshBasicMaterial).opacity = strong ? 0.95 : 0.45;
      hm.visible = true;
    }
  }

  private handle(i: number): THREE.Mesh {
    // pool of handle meshes (one set per frame is enough; reuse by index across walls)
    const key = this.handlesUsed++;
    void i;
    if (!this.handles[key]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.0, 16), new THREE.MeshBasicMaterial({ color: 0xe8a33d, transparent: true, opacity: 0.6, depthTest: false }));
      m.renderOrder = 998;
      this.helpers.add(m);
      this.handles.push(m);
    }
    return this.handles[key];
  }
  private handlesUsed = 0;

  private beginWallDrag(id: string, aim: THREE.Vector3): void {
    const w = this.wallOf(id)!;
    const ed = this.world.editableWalls.get(id)!;
    const opens = this.world.plan.openings.filter((o) => o.wall === id);
    let end: 'a' | 'b';
    if (ed.a && ed.b) end = toWorld(w.a).distanceTo(aim) < toWorld(w.b).distanceTo(aim) ? 'a' : 'b';
    else end = ed.a ? 'a' : 'b';
    if (end === 'a' && opens.length) {
      if (!ed.b) { this.hud.toast('This wall has a door/window measured from that end — it cannot be resized there'); return; }
      end = 'b';
    }
    const fixed = (end === 'a' ? w.b : w.a).slice() as Vec2;
    const moving = w[end];
    const L = Math.hypot(moving[0] - fixed[0], moving[1] - fixed[1]);
    const dir: Vec2 = [(moving[0] - fixed[0]) / L, (moving[1] - fixed[1]) / L];
    // furthest it can go: until it meets the face of another wall
    let sHit = Infinity, hitT = 0;
    for (const o of this.world.plan.walls) {
      if (o.id === id) continue;
      const s = raySegment(fixed, dir, o.a, o.b, o.thickness / 2);
      if (s !== null && s > 0.15 && s < sHit) { sHit = s; hitT = o.thickness; }
    }
    const maxL = Number.isFinite(sHit) ? sHit - hitT / 2 - w.thickness / 2 + 0.002 : L + 3;
    const minL = Math.max(0.3, ...opens.map((o) => o.offset + o.width / 2 + 0.1));
    this.dragWall = { id, end, fixed, dir, from: { a: w.a.slice() as Vec2, b: w.b.slice() as Vec2 }, maxL, minL, L, lastL: L };
  }

  private updateWallDrag(): void {
    const d = this.dragWall!;
    const w = this.wallOf(d.id)!;
    // closest point on the wall axis (at eye-ish height) to the view ray
    const P0 = toWorld(d.fixed, 1.2);
    const e = new THREE.Vector3(d.dir[0], 0, -d.dir[1]);
    const o = this.ray.ray.origin, dd = this.ray.ray.direction;
    const w0 = o.clone().sub(P0);
    const a = dd.dot(dd), b = dd.dot(e), c = 1, dw = dd.dot(w0), ew = e.dot(w0);
    const den = a * c - b * b;
    let L = den > 1e-6 ? (a * ew - b * dw) / den : d.L;
    L = Math.round(Math.max(d.minL, Math.min(d.maxL, L)) / 0.0127) * 0.0127; // 1/2" steps
    if (Math.abs(L - d.lastL) > 0.001) {
      const end: Vec2 = [round3(d.fixed[0] + d.dir[0] * L), round3(d.fixed[1] + d.dir[1] * L)];
      if (d.end === 'a') w.a = end; else w.b = end;
      this.world.rebuildWall(d.id);
      d.lastL = L;
    }
    this.glowWall(w, 0x6fd36f);
    const endW = toWorld(d.end === 'a' ? w.a : w.b, 1.2);
    const startW = toWorld(d.fixed, 1.2);
    this.addLine(startW, endW);
    this.addLabel(startW.clone().lerp(endW, 0.5).add(new THREE.Vector3(0, 0.35, 0)),
      `<b>wall ${dim(L)}</b><br>${L >= d.L ? '+' : ''}${ftin(L - d.L)} from before`, 'measure');
    if (Number.isFinite(d.maxL) && d.maxL - L > 0.01) {
      const faceW = toWorld([d.fixed[0] + d.dir[0] * (d.maxL + w.thickness / 2), d.fixed[1] + d.dir[1] * (d.maxL + w.thickness / 2)], 1.2);
      const tipW = toWorld([d.fixed[0] + d.dir[0] * (L + w.thickness / 2), d.fixed[1] + d.dir[1] * (L + w.thickness / 2)], 1.2);
      this.addLine(tipW, faceW, 0x6fd36f);
      this.addLabel(tipW.clone().lerp(faceW, 0.5).add(new THREE.Vector3(0, -0.2, 0)), `opening ${dim(d.maxL - L)}`, d.maxL - L < 0.75 ? 'warn' : '');
    } else {
      this.addLabel(endW.clone().add(new THREE.Vector3(0, -0.3, 0)), 'closed off', 'warn');
    }
  }

  private commitWall(): void {
    const d = this.dragWall!;
    const w = this.wallOf(d.id)!;
    this.undoStack.push({ kind: 'wall', id: d.id, from: d.from });
    this.dragWall = undefined;
    this.recordWall(w);
    this.hud.refresh();
    this.hud.toast(`Wall set to ${ftin(Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]))}`, 1.4);
    this.save();
  }

  private recordWall(w: PlanWall): void {
    const orig = this.originalWalls.get(w.id)!;
    const same = (p: Vec2, q: Vec2) => Math.abs(p[0] - q[0]) < 1e-4 && Math.abs(p[1] - q[1]) < 1e-4;
    this.scene.plan_edits ??= { walls: {} };
    this.scene.plan_edits.walls ??= {};
    if (same(w.a, orig.a) && same(w.b, orig.b)) delete this.scene.plan_edits.walls[w.id];
    else this.scene.plan_edits.walls[w.id] = { a: w.a, b: w.b };
  }

  private applyWall(id: string, a: Vec2, b: Vec2): void {
    const w = this.wallOf(id);
    if (!w) return;
    w.a = a.slice() as Vec2;
    w.b = b.slice() as Vec2;
    this.world.rebuildWall(id);
    this.recordWall(w);
    this.hud.refresh();
  }

  // ------------------------------------------------------------------ input
  private async click(): Promise<void> {
    if (this.tool === 'move') {
      if (this.carrying) this.place();
      else if (this.hoverObj) this.pickUp(this.hoverObj);
    } else if (this.tool === 'measure') {
      const p = this.marker.visible ? this.marker.position.clone() : undefined;
      if (!p) return;
      if (!this.mStart) { this.mStart = p; return; }
      const geo = new THREE.BufferGeometry().setFromPoints([this.mStart, p]);
      const line = new THREE.Line(geo, this.lineMat);
      line.renderOrder = 997;
      this.helpers.add(line);
      const label = this.makeLabel(this.mStart.clone().lerp(p, 0.5), this.measureText(this.mStart, p), 'measure pinned');
      this.pinned.push({ line, label });
      this.mStart = undefined;
    } else {
      if (this.dragWall) { this.commitWall(); return; }
      if (!this.hoverWall) return;
      if (!this.world.editableWalls.has(this.hoverWall)) { this.hud.toast('This wall is fixed (exterior or closed at both ends)'); return; }
      const h = this.ray.intersectObject(this.world.root.getObjectByName('walls')!, true)[0];
      this.beginWallDrag(this.hoverWall, h?.point ?? this.stage.camera.position);
    }
  }

  private backspace(): void {
    if (!this.active) return;
    if (this.tool === 'measure') {
      for (const m of this.pinned) { m.line.removeFromParent(); m.line.geometry.dispose(); m.label.el.remove(); }
      this.pinned = [];
      this.mStart = undefined;
    } else if (this.tool === 'walls' && this.hoverWall && !this.dragWall) {
      const w = this.wallOf(this.hoverWall)!;
      const orig = this.originalWalls.get(w.id)!;
      this.undoStack.push({ kind: 'wall', id: w.id, from: { a: w.a.slice() as Vec2, b: w.b.slice() as Vec2 } });
      this.applyWall(w.id, orig.a, orig.b);
      this.hud.toast('Wall reset to the plan');
      this.save();
    } else if (this.tool === 'move') {
      this.deleteHovered();
    }
  }

  private async undo(): Promise<void> {
    if (!this.active) return;
    if (this.carrying || this.dragWall) { this.cancel(); return; }
    const u = this.undoStack.pop();
    if (!u) { this.hud.toast('Nothing to undo'); return; }
    if (u.kind === 'move') {
      const po = this.world.objects.get(u.id);
      if (po?.so) {
        po.obj.position.copy(u.from.pos);
        po.obj.rotation.y = u.from.rot;
        po.obj.updateMatrixWorld(true);
        this.world.recollide(u.id);
        const p = toPlan(u.from.pos);
        po.so.position = [round3(p[0]), round3(p[1])];
        po.so.rotation = Math.round(THREE.MathUtils.radToDeg(u.from.rot) * 10) / 10;
        po.so.room = u.from.room;
      }
    } else if (u.kind === 'delete') {
      this.scene.objects.splice(u.index, 0, u.so);
      await this.world.addObject(u.so);
      this.interact.refresh();
    } else if (u.kind === 'add') {
      this.removeSceneObject(u.id);
    } else if (u.kind === 'wall') {
      this.applyWall(u.id, u.from.a, u.from.b);
    }
    this.hud.toast('Undone', 0.8);
    this.save();
  }

  // ------------------------------------------------------------------ save
  private save(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(async () => {
      try {
        const r = await fetch(`/vk/save/projects/${encodeURIComponent(this.project)}/scene.json`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.scene),
        });
        if (!r.ok) throw new Error(await r.text());
      } catch (e) {
        this.hud.toast(`Could not save: ${(e as Error).message}`, 3);
      }
    }, 250);
  }

  // ------------------------------------------------------------------ overlay helpers
  private liveLines: THREE.Line[] = [];
  private addLine(a: THREE.Vector3, b: THREE.Vector3, color = 0xe8a33d): void {
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color, depthTest: false }));
    l.renderOrder = 997;
    this.helpers.add(l);
    this.liveLines.push(l);
  }

  private makeLabel(pos: THREE.Vector3, html: string, cls = ''): Label {
    const el = document.createElement('div');
    el.className = `elabel ${cls}`;
    el.innerHTML = html;
    this.labelsEl.append(el);
    return { el, pos };
  }

  private addLabel(pos: THREE.Vector3, html: string, cls = ''): void {
    this.live.push(this.makeLabel(pos, html, cls));
  }

  private clearLive(): void {
    for (const l of this.live) l.el.remove();
    this.live = [];
    for (const l of this.liveLines) { l.removeFromParent(); l.geometry.dispose(); (l.material as THREE.Material).dispose(); }
    this.liveLines = [];
    this.handlesUsed = 0;
  }

  private placeLabels(): void {
    const cam = this.stage.camera;
    const w = innerWidth, h = innerHeight;
    for (const l of [...this.live, ...this.pinned.map((p) => p.label)]) {
      const v = l.pos.clone().project(cam);
      const behind = v.z > 1 || v.z < -1;
      l.el.style.display = behind ? 'none' : '';
      l.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px) translate(-50%, -50%)`;
    }
  }
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** distance along ray (origin o, unit dir u) to segment a-b inflated by `pad`; null if it misses */
function raySegment(o: Vec2, u: Vec2, a: Vec2, b: Vec2, pad: number): number | null {
  const sx = b[0] - a[0], sy = b[1] - a[1];
  const den = u[0] * sy - u[1] * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qx = a[0] - o[0], qy = a[1] - o[1];
  const s = (qx * sy - qy * sx) / den;           // along the ray
  const t = (qx * u[1] - qy * u[0]) / den;       // along the segment (0..1)
  const len = Math.hypot(sx, sy);
  if (t < -pad / len || t > 1 + pad / len) return null;
  return s;
}
