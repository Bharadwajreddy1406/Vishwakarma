/**
 * Player: Rapier kinematic character controller (capsule), FPP / TPP cameras with wall-aware spring arm,
 * walk / sprint / crouch (headroom-checked) / jump. Pushes dynamic bodies it walks into.
 */
import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Physics } from '../core/physics';
import type { Avatar, Pose } from './avatar';
import type { Input } from './input';

const RADIUS = 0.18;
/** controller skin: the capsule hovers this far above the floor */
const SKIN = 0.02;
const halfFor = (h: number) => (h - 2 * RADIUS) / 2;
/** eyes sit ~11.5 cm below the crown on an adult */
const EYE_BELOW_CROWN = 0.115;

const SPEED = { walk: 1.5, run: 4.2, crouch: 0.9 };
const GRAVITY = -16;
const JUMP_V = 5.0;

export class Player {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  private controller: RAPIER.KinematicCharacterController;
  yaw = 0;
  pitch = 0;
  view: 'fpp' | 'tpp' = 'tpp';
  crouched = false;
  grounded = false;
  sprinting = false;
  private vel = new THREE.Vector3();
  /** capsule heights follow the avatar's real height (5'11" by default) */
  private readonly STAND_H: number;
  private readonly CROUCH_H: number;
  private height: number;
  private eye: number;
  private camDist = 2.8;
  private avatarYaw = 0;
  private pose: Pose = 'idle';
  private bob = 0;
  private prevFeet = new THREE.Vector3();
  feet = new THREE.Vector3();
  horizSpeed = 0;

  constructor(private physics: Physics, private input: Input, private camera: THREE.PerspectiveCamera, public avatar: Avatar, spawn: THREE.Vector3, heading: number) {
    const R = physics.R;
    this.STAND_H = avatar.height;
    this.CROUCH_H = Math.round(avatar.height * 0.64 * 100) / 100;
    this.height = this.STAND_H;
    this.eye = this.STAND_H - EYE_BELOW_CROWN;
    const STAND_H = this.STAND_H;
    this.body = physics.world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + STAND_H / 2 + 0.02, spawn.z),
    );
    this.collider = physics.world.createCollider(R.ColliderDesc.capsule(halfFor(STAND_H), RADIUS).setFriction(0), this.body);
    this.controller = physics.world.createCharacterController(0.02);
    this.controller.enableAutostep(0.22, 0.15, false);
    this.controller.enableSnapToGround(0.25);
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((30 * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(70);
    this.yaw = heading;
    this.avatarYaw = heading;
    this.feet.copy(spawn);
    this.prevFeet.copy(spawn);
  }

  toggleView(): void {
    this.view = this.view === 'fpp' ? 'tpp' : 'fpp';
  }

  toggleCrouch(): void {
    if (this.crouched) {
      if (this.canStand()) this.setCrouch(false);
      return;
    }
    this.setCrouch(true);
  }

  private canStand(): boolean {
    const R = this.physics.R;
    const t = this.body.translation();
    const feetY = t.y - this.height / 2;
    const shape = new R.Capsule(halfFor(this.STAND_H), RADIUS - 0.02);
    const hit = this.physics.world.intersectionWithShape(
      { x: t.x, y: feetY + this.STAND_H / 2 + 0.03, z: t.z }, { x: 0, y: 0, z: 0, w: 1 }, shape,
      undefined, undefined, this.collider, this.body,
    );
    return !hit;
  }

  private setCrouch(on: boolean): void {
    const t = this.body.translation();
    const feetY = t.y - this.height / 2;
    this.height = on ? this.CROUCH_H : this.STAND_H;
    this.crouched = on;
    this.collider.setHalfHeight(halfFor(this.height));
    this.body.setTranslation({ x: t.x, y: feetY + this.height / 2, z: t.z }, true);
  }

  /** called each physics sub-step */
  step(dt: number): void {
    const inp = this.input;
    const f = (inp.held('KeyW') ? 1 : 0) - (inp.held('KeyS') ? 1 : 0);
    const s = (inp.held('KeyD') ? 1 : 0) - (inp.held('KeyA') ? 1 : 0);
    this.sprinting = inp.held('ShiftLeft') || inp.held('ShiftRight');
    if (this.sprinting && this.crouched && f > 0 && this.canStand()) this.setCrouch(false);
    const speed = this.crouched ? SPEED.crouch : this.sprinting && f > 0 ? SPEED.run : SPEED.walk;

    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = fwd.multiplyScalar(f).add(right.multiplyScalar(s));
    if (wish.lengthSq() > 1) wish.normalize();
    wish.multiplyScalar(speed);

    const accel = this.grounded ? 14 : 3;
    this.vel.x += (wish.x - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wish.z - this.vel.z) * Math.min(1, accel * dt);

    if (this.grounded) {
      this.vel.y = Math.max(this.vel.y, -1);
      if (inp.held('Space') && !this.crouched) this.vel.y = JUMP_V;
    }
    this.vel.y += GRAVITY * dt;

    const desired = { x: this.vel.x * dt, y: this.vel.y * dt, z: this.vel.z * dt };
    this.controller.computeColliderMovement(this.collider, desired);
    const mv = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.vel.y < 0) this.vel.y = 0;
    // bumped head
    if (this.vel.y > 0 && mv.y < desired.y * 0.5) this.vel.y = 0;
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z });
    // keep actual velocity in sync with blocked movement (stops sliding along walls at full speed)
    this.vel.x = mv.x / dt;
    this.vel.z = mv.z / dt;
  }

  /** per rendered frame: look, camera, avatar animation */
  frame(dt: number, alpha: number): void {
    const [mx, my] = this.input.consumeMouse();
    this.yaw -= mx * 0.0022;
    this.pitch = THREE.MathUtils.clamp(this.pitch - my * 0.0022, -1.45, 1.35);

    const t = this.body.translation();
    this.prevFeet.copy(this.feet);
    this.feet.set(t.x, t.y - this.height / 2 - SKIN, t.z);
    this.horizSpeed = Math.hypot(this.vel.x, this.vel.z);
    void alpha;

    // pose
    const moving = this.horizSpeed > 0.25;
    this.pose = !this.grounded ? (this.vel.y > 0 ? 'jump' : 'fall')
      : this.crouched ? (moving ? 'crouch_walk' : 'crouch_idle')
      : moving ? (this.horizSpeed > 3 ? 'run' : 'walk') : 'idle';

    // eye height smoothing (crouch)
    const eyeTarget = this.crouched ? this.CROUCH_H - 0.1 : this.STAND_H - EYE_BELOW_CROWN;
    this.eye += (eyeTarget - this.eye) * (1 - Math.exp(-12 * dt));

    // avatar
    const a = this.avatar.object;
    a.position.copy(this.feet);
    if (moving) {
      const moveYaw = Math.atan2(-this.vel.x, -this.vel.z);
      // PUBG-style: body follows the camera when moving forward, strafes otherwise
      const target = this.input.held('KeyW') || this.input.held('KeyS') ? this.yaw : moveYaw;
      this.avatarYaw = lerpAngle(this.avatarYaw, target, 1 - Math.exp(-10 * dt));
    }
    a.rotation.y = this.avatarYaw;
    this.avatar.update(this.pose, this.horizSpeed, dt);
    a.visible = this.view === 'tpp';

    // camera
    const cam = this.camera;
    const look = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    if (this.view === 'fpp') {
      this.bob += dt * (this.grounded && moving ? this.horizSpeed * 3.2 : 0);
      const bobY = this.grounded && moving ? Math.sin(this.bob) * 0.025 : 0;
      cam.position.set(this.feet.x, this.feet.y + this.eye + bobY, this.feet.z);
      cam.quaternion.setFromEuler(look);
      cam.position.add(new THREE.Vector3(0, 0, -0.12).applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.yaw, 0))));
    } else {
      const pivot = new THREE.Vector3(this.feet.x, this.feet.y + this.eye - 0.05, this.feet.z);
      const q = new THREE.Quaternion().setFromEuler(look);
      const shoulder = new THREE.Vector3(0.42, 0.05, 0).applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.yaw, 0)));
      const anchor = pivot.clone().add(shoulder);
      const back = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      const want = this.crouched ? 2.2 : 2.8;
      // spring arm: ray from the head through the shoulder anchor to the camera
      let dist = want;
      const R = this.physics.R;
      const hitShoulder = this.physics.world.castRay(new R.Ray(pivot, dirTo(pivot, anchor)), pivot.distanceTo(anchor), true, undefined, undefined, this.collider, this.body);
      const base = hitShoulder ? pivot.clone().lerp(anchor, Math.max(0, hitShoulder.timeOfImpact - 0.1) / pivot.distanceTo(anchor)) : anchor;
      const hit = this.physics.world.castRay(new R.Ray(base, back), want, true, undefined, undefined, this.collider, this.body);
      if (hit) dist = Math.max(0.25, hit.timeOfImpact - 0.18);
      this.camDist = dist < this.camDist ? dist : this.camDist + (dist - this.camDist) * (1 - Math.exp(-5 * dt));
      cam.position.copy(base).addScaledVector(back, this.camDist);
      cam.quaternion.copy(q);
    }
  }

  get stance(): string {
    return `${this.view.toUpperCase()} · ${this.crouched ? 'crouching' : this.sprinting && this.horizSpeed > 3 ? 'sprinting' : this.horizSpeed > 0.25 ? 'walking' : 'standing'}`;
  }
}

function dirTo(a: THREE.Vector3, b: THREE.Vector3) {
  const d = b.clone().sub(a);
  const l = d.length() || 1;
  return { x: d.x / l, y: d.y / l, z: d.z / l };
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
