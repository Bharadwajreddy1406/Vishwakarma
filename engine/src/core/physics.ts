/**
 * Rapier (WASM) physics: static world colliders, kinematic followers for moving parts (doors, drawers),
 * and dynamic rigid bodies (chairs, armchairs) whose meshes are synced every step.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export type R = typeof RAPIER;

export const GROUP_WORLD = 0x0001;
export const GROUP_PLAYER = 0x0002;
/** membership << 16 | filter */
export const groups = (membership: number, filter: number) => (membership << 16) | filter;

interface Follower { body: RAPIER.RigidBody; node: THREE.Object3D }
interface DynamicLink { body: RAPIER.RigidBody; node: THREE.Object3D; offset: THREE.Matrix4 }

const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpBox = new THREE.Box3();
const tmpCenter = new THREE.Vector3();
const tmpSize = new THREE.Vector3();

export class Physics {
  world!: RAPIER.World;
  R!: R;
  private followers: Follower[] = [];
  private dynamics: DynamicLink[] = [];
  private accumulator = 0;
  readonly dt = 1 / 60;
  debugMesh?: THREE.LineSegments;

  async init(): Promise<void> {
    await RAPIER.init();
    this.R = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = this.dt;
  }

  /** world-space cuboid on a fixed body */
  addStaticBox(center: THREE.Vector3, half: THREE.Vector3, rot?: THREE.Quaternion, friction = 0.8): RAPIER.Collider {
    const body = this.world.createRigidBody(this.R.RigidBodyDesc.fixed());
    const desc = this.R.ColliderDesc.cuboid(Math.max(half.x, 0.005), Math.max(half.y, 0.005), Math.max(half.z, 0.005))
      .setTranslation(center.x, center.y, center.z).setFriction(friction);
    if (rot) desc.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
    return this.world.createCollider(desc, body);
  }

  /**
   * Box colliders for every collidable mesh under `root` (by local bounding boxes, in world space).
   * Meshes under any node in `skip` are ignored (they get their own kinematic followers).
   */
  addStaticFromObject(root: THREE.Object3D, skip: Set<THREE.Object3D> = new Set()): RAPIER.Collider[] {
    root.updateWorldMatrix(true, true);
    const out: RAPIER.Collider[] = [];
    walkCollidable(root, skip, (mesh) => {
      const c = meshBox(mesh);
      if (!c) return;
      out.push(this.addStaticBox(c.center, c.half, c.quat));
    });
    return out;
  }

  /** remove colliders created by addStaticBox / addStaticFromObject (and their fixed bodies) */
  removeColliders(cs: RAPIER.Collider[]): void {
    for (const c of cs) {
      const b = c.parent();
      this.world.removeCollider(c, false);
      if (b && b.numColliders() === 0) this.world.removeRigidBody(b);
    }
    cs.length = 0;
  }

  /** drop kinematic followers (door leaves, drawers…) under `root` */
  removeFollowersUnder(root: THREE.Object3D): void {
    this.followers = this.followers.filter((f) => {
      let n: THREE.Object3D | null = f.node;
      while (n && n !== root) n = n.parent;
      if (n === root) { this.world.removeRigidBody(f.body); return false; }
      return true;
    });
  }

  dynamicBody(node: THREE.Object3D): RAPIER.RigidBody | undefined {
    return this.dynamics.find((d) => d.node === node)?.body;
  }

  removeDynamic(node: THREE.Object3D): void {
    const i = this.dynamics.findIndex((d) => d.node === node);
    if (i >= 0) { this.world.removeRigidBody(this.dynamics[i].body); this.dynamics.splice(i, 1); }
  }

  /** carry a dynamic object: kinematic while held, dynamic again when placed */
  setHeld(node: THREE.Object3D, held: boolean): void {
    const b = this.dynamicBody(node);
    if (!b) return;
    b.setBodyType(held ? this.R.RigidBodyType.KinematicPositionBased : this.R.RigidBodyType.Dynamic, true);
    if (!held) { b.setLinvel({ x: 0, y: 0, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true); }
  }

  /** teleport a dynamic object's body to its node's current transform */
  syncDynamicFromNode(node: THREE.Object3D): void {
    const b = this.dynamicBody(node);
    if (!b) return;
    const p = node.position, q = node.quaternion;
    if (b.isKinematic()) {
      b.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
      b.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    } else {
      b.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
      b.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    }
  }

  /** kinematic body that follows `node` (a door leaf pivot); colliders from its meshes in node-local space */
  addFollower(node: THREE.Object3D): void {
    node.updateWorldMatrix(true, true);
    const body = this.world.createRigidBody(this.R.RigidBodyDesc.kinematicPositionBased());
    const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
    let count = 0;
    walkCollidable(node, new Set(), (mesh) => {
      const c = meshBox(mesh, inv, node);
      if (!c) return;
      const desc = this.R.ColliderDesc.cuboid(c.half.x, c.half.y, c.half.z)
        .setTranslation(c.center.x, c.center.y, c.center.z)
        .setRotation({ x: c.quat.x, y: c.quat.y, z: c.quat.z, w: c.quat.w });
      this.world.createCollider(desc, body);
      count++;
    });
    if (!count) {
      this.world.removeRigidBody(body);
      return;
    }
    this.followers.push({ body, node });
    this.syncFollower({ body, node }, true);
  }

  /** dynamic rigid body for a whole object: compound cuboids, mesh follows the body */
  addDynamic(node: THREE.Object3D, mass: number): void {
    node.updateWorldMatrix(true, true);
    node.matrixWorld.decompose(tmpPos, tmpQuat, tmpScale);
    const body = this.world.createRigidBody(
      this.R.RigidBodyDesc.dynamic().setTranslation(tmpPos.x, tmpPos.y, tmpPos.z)
        .setRotation({ x: tmpQuat.x, y: tmpQuat.y, z: tmpQuat.z, w: tmpQuat.w })
        .setLinearDamping(2.5).setAngularDamping(3.0).setCanSleep(true),
    );
    const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
    const parts: { c: ReturnType<typeof meshBox> & {}; vol: number }[] = [];
    walkCollidable(node, new Set(), (mesh) => {
      const c = meshBox(mesh, inv, node);
      if (c) parts.push({ c, vol: c.half.x * c.half.y * c.half.z });
    });
    const totalVol = parts.reduce((s, p) => s + p.vol, 0) || 1;
    for (const { c, vol } of parts) {
      const desc = this.R.ColliderDesc.cuboid(c.half.x, c.half.y, c.half.z)
        .setTranslation(c.center.x, c.center.y, c.center.z)
        .setRotation({ x: c.quat.x, y: c.quat.y, z: c.quat.z, w: c.quat.w })
        .setMass((mass * vol) / totalVol).setFriction(0.7).setRestitution(0.05);
      this.world.createCollider(desc, body);
    }
    // the node is re-parented to the scene root so physics drives its world transform directly
    const offset = new THREE.Matrix4();
    this.dynamics.push({ body, node, offset });
  }

  private syncFollower(f: Follower, teleport = false): void {
    f.node.updateWorldMatrix(true, false);
    f.node.matrixWorld.decompose(tmpPos, tmpQuat, tmpScale);
    if (teleport) {
      f.body.setTranslation({ x: tmpPos.x, y: tmpPos.y, z: tmpPos.z }, true);
      f.body.setRotation({ x: tmpQuat.x, y: tmpQuat.y, z: tmpQuat.z, w: tmpQuat.w }, true);
    } else {
      f.body.setNextKinematicTranslation({ x: tmpPos.x, y: tmpPos.y, z: tmpPos.z });
      f.body.setNextKinematicRotation({ x: tmpQuat.x, y: tmpQuat.y, z: tmpQuat.z, w: tmpQuat.w });
    }
  }

  /** fixed-step simulation; `beforeStep` runs once per sub-step (character controller lives there) */
  update(frameDt: number, beforeStep: (dt: number) => void): number {
    this.accumulator = Math.min(this.accumulator + frameDt, 0.25);
    let steps = 0;
    while (this.accumulator >= this.dt) {
      for (const f of this.followers) this.syncFollower(f);
      beforeStep(this.dt);
      this.world.step();
      this.accumulator -= this.dt;
      steps++;
    }
    for (const d of this.dynamics) {
      if (d.body.isSleeping() || d.body.isKinematic()) continue;
      const t = d.body.translation(), r = d.body.rotation();
      d.node.position.set(t.x, t.y, t.z);
      d.node.quaternion.set(r.x, r.y, r.z, r.w);
    }
    return this.accumulator / this.dt;
  }

  /** wireframe of all colliders (toggle with `) */
  debugLines(scene: THREE.Scene, on: boolean): void {
    if (!on) {
      if (this.debugMesh) scene.remove(this.debugMesh);
      this.debugMesh = undefined;
      return;
    }
    const { vertices, colors } = this.world.debugRender();
    if (!this.debugMesh) {
      this.debugMesh = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true }));
      this.debugMesh.frustumCulled = false;
      scene.add(this.debugMesh);
    }
    const g = this.debugMesh.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  }
}

function walkCollidable(root: THREE.Object3D, skip: Set<THREE.Object3D>, fn: (m: THREE.Mesh) => void): void {
  const visit = (o: THREE.Object3D) => {
    if (skip.has(o) && o !== root) return;
    if (o.userData.collider === false) return;
    if ((o as THREE.Mesh).isMesh) fn(o as THREE.Mesh);
    for (const c of o.children) visit(c);
  };
  visit(root);
}

/** oriented box of a mesh: world space by default, or relative to `relTo` (matrix = inverse of relTo.matrixWorld) */
function meshBox(mesh: THREE.Mesh, inv?: THREE.Matrix4, _relTo?: THREE.Object3D) {
  const geo = mesh.geometry;
  if (!geo.boundingBox) geo.computeBoundingBox();
  tmpBox.copy(geo.boundingBox!);
  if (tmpBox.isEmpty()) return null;
  tmpBox.getCenter(tmpCenter);
  tmpBox.getSize(tmpSize);
  const m = new THREE.Matrix4().copy(mesh.matrixWorld);
  if (inv) m.premultiply(inv);
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
  m.decompose(pos, quat, scl);
  const center = tmpCenter.clone().multiply(scl).applyQuaternion(quat).add(pos);
  const half = new THREE.Vector3(Math.abs(tmpSize.x * scl.x) / 2, Math.abs(tmpSize.y * scl.y) / 2, Math.abs(tmpSize.z * scl.z) / 2);
  if (half.x < 0.002 && half.y < 0.002 && half.z < 0.002) return null;
  half.max(new THREE.Vector3(0.004, 0.004, 0.004));
  return { center, half, quat };
}
