/** F-to-interact: aim at a door / drawer / cupboard within reach, toggle it, animate the pivot. */
import * as THREE from 'three';
import type { RuntimeInteractable } from '../world/builder';

const REACH = 2.2;
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class Interactions {
  private ray = new THREE.Raycaster();
  private meshToItem = new Map<THREE.Object3D, RuntimeInteractable>();
  private targets: THREE.Object3D[] = [];
  focused?: RuntimeInteractable;

  constructor(private items: RuntimeInteractable[], private blockers: THREE.Object3D) {
    this.refresh();
    for (const it of items) if (it.target === 1) it.t = 1;
  }

  /** re-index after objects were added / removed by the editor */
  refresh(): void {
    this.meshToItem.clear();
    this.targets = [];
    for (const it of this.items) for (const m of it.meshes) { this.meshToItem.set(m, it); this.targets.push(m); }
  }

  /** find what the crosshair points at; `origin` is the player's eye (reach is measured from there) */
  aim(camera: THREE.Camera, eye: THREE.Vector3): RuntimeInteractable | undefined {
    this.ray.setFromCamera(new THREE.Vector2(0, 0), camera);
    this.ray.far = REACH + camera.position.distanceTo(eye);
    const hits = this.ray.intersectObjects(this.targets, false);
    let best: RuntimeInteractable | undefined;
    for (const h of hits) {
      if (!h.object.visible && !(h.object as THREE.Mesh).isMesh) continue;
      if (h.point.distanceTo(eye) > REACH) continue;
      best = this.meshToItem.get(h.object);
      if (best) break;
    }
    // prefer a wall/obstacle in front? walls are not in targets, so check occlusion quickly
    if (best && hits.length) {
      const wallHits = this.ray.intersectObject(this.blockers, true);
      const first = hits.find((h) => this.meshToItem.get(h.object) === best)!;
      if (wallHits.length && wallHits[0].distance < first.distance - 0.05) best = undefined;
    }
    this.focused = best;
    return best;
  }

  toggle(it = this.focused): string | undefined {
    if (!it) return;
    const to = it.target > 0.5 ? 0 : 1;
    const group = it.spec.group;
    const peers = group ? this.items.filter((o) => o.objectId === it.objectId && o.spec.group === group) : [it];
    for (const p of peers) p.target = to;
    return `${to ? 'Opened' : 'Closed'} ${it.spec.label.toLowerCase()}`;
  }

  update(dt: number): void {
    for (const it of this.items) {
      if (it.t === it.target) continue;
      const dur = it.spec.duration ?? 0.55;
      const step = dt / dur;
      it.t = it.target > it.t ? Math.min(it.target, it.t + step) : Math.max(it.target, it.t - step);
      const k = ease(it.t);
      const pv = it.spec.pivot;
      if (it.spec.kind === 'hinge') {
        pv.rotation.copy(it.baseRot);
        pv.rotation[it.spec.axis] += it.spec.amount * k;
      } else {
        pv.position.copy(it.base);
        pv.position[it.spec.axis] += it.spec.amount * k;
      }
    }
  }

  promptFor(it: RuntimeInteractable): string {
    return `${it.target > 0.5 ? 'Close' : 'Open'} ${it.spec.label.toLowerCase()}`;
  }
}
