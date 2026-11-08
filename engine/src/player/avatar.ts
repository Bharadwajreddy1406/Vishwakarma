/**
 * Player avatar. Uses common/models/<id>.glb when present (any rigged humanoid with clips named
 * like idle / walk / run / jump / crouch), otherwise the high-poly procedural human (humanoid.ts).
 * Both are normalised to the same real-world height (default 5'11").
 * Origin at the feet, facing -z (same as the camera's forward at yaw 0).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DEFAULT_HEIGHT, buildHuman } from './humanoid';

export type Pose = 'idle' | 'walk' | 'run' | 'crouch_idle' | 'crouch_walk' | 'jump' | 'fall';

export interface Avatar {
  object: THREE.Object3D;
  /** standing height in meters */
  height: number;
  update(pose: Pose, speed: number, dt: number): void;
}

/** avatars offered in the UI: 'human' = procedural; others = common/models/<id>.glb when the file exists */
export const AVATARS: { id: string; label: string }[] = [
  { id: 'human', label: 'Human (high-poly, procedural)' },
  { id: 'xbot', label: 'Xbot (mocap mannequin)' },
  { id: 'soldier', label: 'Soldier (armoured)' },
];

export async function loadAvatar(id: string, height = DEFAULT_HEIGHT): Promise<Avatar> {
  if (id !== 'human') {
    const url = `/vk/common/models/${id}.glb`;
    try {
      const head = await fetch(url, { method: 'HEAD' });
      if (head.ok) return await gltfAvatar(url, height);
    } catch {
      /* fall through */
    }
  }
  return buildHuman(height);
}

async function gltfAvatar(url: string, height: number): Promise<Avatar> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);
  const h = box.max.y - box.min.y;
  const s = height / (h || height);
  model.scale.setScalar(s);
  model.position.y = -box.min.y * s;
  model.rotation.y = Math.PI; // most exports face +z
  model.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const root = new THREE.Group();
  root.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const find = (re: RegExp) => gltf.animations.find((c) => re.test(c.name.toLowerCase()));
  const clips: Partial<Record<Pose, THREE.AnimationClip>> = {
    idle: find(/idle/), walk: find(/walk/), run: find(/run|sprint/), jump: find(/jump/), fall: find(/fall|jump/),
    crouch_idle: find(/crouch.*idle|idle.*crouch|^crouch$/), crouch_walk: find(/crouch.*walk|sneak.*walk/),
  };
  const actions = new Map<Pose, THREE.AnimationAction>();
  for (const [k, c] of Object.entries(clips)) if (c) actions.set(k as Pose, mixer.clipAction(c));
  let current: THREE.AnimationAction | undefined;

  // Procedural overlays for clips the model lacks (crouch / jump), applied on top of the mixer pose.
  // Works with Mixamo-style rigs (mixamorig:Hips, LeftUpLeg, LeftLeg, Spine …).
  const bone = (n: string) => model.getObjectByName(`mixamorig${n}`) ?? model.getObjectByName(`mixamorig:${n}`) ?? model.getObjectByName(n);
  const rig = {
    spine: bone('Spine'), spine1: bone('Spine1'),
    upL: bone('LeftUpLeg'), upR: bone('RightUpLeg'), legL: bone('LeftLeg'), legR: bone('RightLeg'),
    footL: bone('LeftFoot'), footR: bone('RightFoot'), armL: bone('LeftArm'), armR: bone('RightArm'),
  };
  const hasCrouchClip = !!clips.crouch_idle;
  const hasJumpClip = !!clips.jump;
  const baseY = model.position.y;
  const qx = new THREE.Quaternion(), X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);
  const turn = (b: THREE.Object3D | undefined, axis: THREE.Vector3, a: number) => { if (b && a) b.quaternion.multiply(qx.setFromAxisAngle(axis, a)); };
  let crouchK = 0, airK = 0;
  const damp = (a: number, b: number, r: number, dt: number) => a + (b - a) * (1 - Math.exp(-r * dt));
  // native ground speed of the clips at timeScale 1 (m/s, for a 1.8 m character)
  const NATIVE = { walk: 1.45, run: 3.9 };

  return {
    object: root,
    height,
    update(pose, speed, dt) {
      const crouching = pose.startsWith('crouch');
      const moving = pose === 'walk' || pose === 'run' || pose === 'crouch_walk';
      let want: Pose = pose;
      if (!actions.has(want)) want = crouching ? (moving ? 'walk' : 'idle') : (pose === 'jump' || pose === 'fall') ? 'idle' : moving ? 'walk' : 'idle';
      const a = actions.get(want) ?? actions.get('idle');
      if (a && a !== current) {
        a.reset().fadeIn(0.2).play();
        current?.fadeOut(0.2);
        current = a;
      }
      if (current) {
        current.timeScale = moving ? THREE.MathUtils.clamp(speed / (want === 'run' ? NATIVE.run : NATIVE.walk), 0.55, 1.5) : 1;
      }
      mixer.update(dt);

      crouchK = damp(crouchK, crouching && !hasCrouchClip ? 1 : 0, 10, dt);
      airK = damp(airK, (pose === 'jump' || pose === 'fall') && !hasJumpClip ? 1 : 0, 9, dt);
      // crouch: drop the pelvis, flex hips/knees/ankles, lean forward
      model.position.y = baseY - crouchK * 0.42 * (height / 1.8);
      const hip = crouchK * 1.35 + airK * 0.7, knee = crouchK * 2.1 + airK * 1.2, ankle = crouchK * 0.75 + airK * 0.3;
      turn(rig.upL, X, -hip); turn(rig.upR, X, -hip);
      turn(rig.legL, X, knee); turn(rig.legR, X, knee);
      turn(rig.footL, X, -ankle * 0.6); turn(rig.footR, X, -ankle * 0.6);
      turn(rig.spine, X, crouchK * 0.35);
      turn(rig.spine1, X, crouchK * 0.15);
      // jump: arms lift a little
      turn(rig.armL, Z, airK * 0.5); turn(rig.armR, Z, -airK * 0.5);
    },
  };
}
