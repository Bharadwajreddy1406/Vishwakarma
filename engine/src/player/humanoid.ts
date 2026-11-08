/**
 * High-poly procedural human (no external assets). Anatomical lathe-profiled body parts (smooth
 * CatmullRom profiles, 48 radial segments), sculpted head with face, hands with fingers, clothing.
 * Built in real proportions, then normalised to exactly `height` meters (default 5'11" = 1.803 m).
 * Joint hierarchy (hips / spine / neck / shoulders / elbows / hips / knees / ankles) is animated by
 * `update()` with a procedural gait, so it needs no animation clips.
 * Faces -z (camera forward at yaw 0). Origin at the feet.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Avatar, Pose } from './avatar';

export const FT_IN = (ft: number, inch: number) => (ft * 12 + inch) * 0.0254;
export const DEFAULT_HEIGHT = FT_IN(5, 11); // 1.803 m

export interface HumanStyle {
  skin: string; hair: string; shirt: string; pants: string; shoe: string; sole: string; belt: string;
}
const DEFAULT_STYLE: HumanStyle = {
  skin: '#b98262', hair: '#1a1411', shirt: '#3e6a8a', pants: '#2c3446', shoe: '#ece9e3', sole: '#2b2b2b', belt: '#3b2a1e',
};

const SEG = 48;

/** smooth body segment: profile = [y, radius] control points (any order), elliptical via sx/sz */
function lathe(profile: [number, number][], mat: THREE.Material, sx = 1, sz = 1, samples = 36): THREE.Mesh {
  const sorted = [...profile].sort((a, b) => a[0] - b[0]);
  const curve = new THREE.SplineCurve(sorted.map(([y, r]) => new THREE.Vector2(r, y)));
  const pts = curve.getPoints(samples);
  pts.unshift(new THREE.Vector2(0.0001, sorted[0][0]));
  pts.push(new THREE.Vector2(0.0001, sorted[sorted.length - 1][0]));
  const geo = new THREE.LatheGeometry(pts, SEG);
  geo.scale(sx, 1, sz);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function ball(r: number, mat: THREE.Material, sx = 1, sy = 1, sz = 1): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 28), mat);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  return m;
}

function capsule(r: number, len: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 8, 20), mat);
  m.castShadow = true;
  return m;
}

function joint(parent: THREE.Object3D, x: number, y: number, z = 0): THREE.Group {
  const j = new THREE.Group();
  j.position.set(x, y, z);
  parent.add(j);
  return j;
}

function sculptedHead(skin: THREE.Material): THREE.Mesh {
  const geo = new THREE.SphereGeometry(1, 96, 72);
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    let { x, y, z } = v;
    // jaw / chin taper on the lower half, fuller cranium at the back, flatter face plane
    if (y < 0) {
      const k = 1 - 0.3 * Math.pow(-y, 1.6);
      x *= k;
      z *= 1 - 0.1 * Math.pow(-y, 2);
    }
    if (z > 0) z *= 1.06; // occiput
    if (z < 0) z *= 0.94 + 0.06 * Math.abs(y); // face slightly flatter at cheeks
    // cheekbones
    const cheek = Math.exp(-(((y + 0.05) / 0.22) ** 2) - (((Math.abs(x) - 0.62) / 0.25) ** 2)) * (z < 0 ? 1 : 0);
    x *= 1 + 0.04 * cheek;
    p.setXYZ(i, x * 0.077, y * 0.116, z * 0.099);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, skin);
  m.castShadow = true;
  return m;
}

function hand(side: number, skin: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const palm = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.09, 0.078, 4, 0.012), skin);
  palm.position.y = -0.045;
  palm.castShadow = true;
  g.add(palm);
  const curl = -side * 0.28; // fingers curl toward the body
  const fingerZ = [-0.027, -0.009, 0.009, 0.027];
  const lens = [0.026, 0.03, 0.028, 0.022];
  fingerZ.forEach((z, i) => {
    const f1 = joint(g, 0, -0.09, z);
    f1.rotation.z = curl;
    const p1 = capsule(0.0085 - i * 0.0004, lens[i], skin);
    p1.position.y = -lens[i] / 2 - 0.004;
    f1.add(p1);
    const f2 = joint(f1, 0, -lens[i] - 0.006);
    f2.rotation.z = curl * 1.2;
    const p2 = capsule(0.0078 - i * 0.0004, lens[i] * 0.8, skin);
    p2.position.y = -lens[i] * 0.4 - 0.004;
    f2.add(p2);
  });
  const th = joint(g, -side * 0.004, -0.03, -0.04);
  th.rotation.set(-0.5, 0, -side * 0.35);
  const t1 = capsule(0.0095, 0.03, skin);
  t1.position.y = -0.02;
  th.add(t1);
  return g;
}

export function buildHuman(height = DEFAULT_HEIGHT, style: Partial<HumanStyle> = {}): Avatar {
  const s = { ...DEFAULT_STYLE, ...style };
  const skin = new THREE.MeshPhysicalMaterial({ color: s.skin, roughness: 0.52, sheen: 0.4, sheenRoughness: 0.6, sheenColor: new THREE.Color('#ffd9c4') });
  const hairM = new THREE.MeshStandardMaterial({ color: s.hair, roughness: 0.75 });
  const shirt = new THREE.MeshPhysicalMaterial({ color: s.shirt, roughness: 0.85, sheen: 0.6, sheenRoughness: 0.8, sheenColor: new THREE.Color('#9cc3e0') });
  const pants = new THREE.MeshPhysicalMaterial({ color: s.pants, roughness: 0.9, sheen: 0.3, sheenColor: new THREE.Color('#6b7a99') });
  const shoe = new THREE.MeshStandardMaterial({ color: s.shoe, roughness: 0.6 });
  const sole = new THREE.MeshStandardMaterial({ color: s.sole, roughness: 0.8 });
  const belt = new THREE.MeshStandardMaterial({ color: s.belt, roughness: 0.5 });
  const eyeW = new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.15 });
  const iris = new THREE.MeshStandardMaterial({ color: '#2b1a10', roughness: 0.1 });
  const lip = new THREE.MeshStandardMaterial({ color: '#9a5e50', roughness: 0.45 });
  const brow = new THREE.MeshStandardMaterial({ color: s.hair, roughness: 0.9 });

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // ---- pelvis + torso
  const hips = joint(body, 0, 0.93);
  hips.add(lathe([[-0.11, 0.07], [-0.07, 0.15], [-0.01, 0.172], [0.06, 0.162], [0.12, 0.148]], pants, 1, 0.72));
  const beltM = lathe([[0.095, 0.152], [0.12, 0.15]], belt, 1.01, 0.74, 6);
  hips.add(beltM);
  const spine = joint(hips, 0, 0.1);
  spine.add(lathe([[0.0, 0.149], [0.08, 0.146], [0.17, 0.162], [0.27, 0.178], [0.35, 0.183], [0.41, 0.168], [0.455, 0.12], [0.47, 0.07]], shirt, 1, 0.64));
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 16, 48), shirt);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.465;
  collar.scale.set(1, 0.85, 1);
  spine.add(collar);

  // ---- neck + head
  const neck = joint(spine, 0, 0.47);
  neck.add(lathe([[-0.02, 0.058], [0.05, 0.053], [0.11, 0.055]], skin, 1, 0.95));
  const head = joint(neck, 0, 0.19, -0.008);
  head.add(sculptedHead(skin));
  for (const sx of [-1, 1]) {
    const ew = ball(0.0125, eyeW);
    ew.position.set(sx * 0.031, 0.012, -0.084);
    head.add(ew);
    const ir = ball(0.0068, iris);
    ir.position.set(sx * 0.031, 0.012, -0.0955);
    head.add(ir);
    const b = new THREE.Mesh(new RoundedBoxGeometry(0.034, 0.007, 0.01, 2, 0.003), brow);
    b.position.set(sx * 0.032, 0.036, -0.09);
    b.rotation.z = sx * -0.12;
    head.add(b);
    const ear = ball(0.028, skin, 0.32, 1, 0.62);
    ear.position.set(sx * 0.077, 0.002, 0.008);
    head.add(ear);
  }
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.042, 24), skin);
  nose.position.set(0, -0.008, -0.1);
  nose.rotation.x = -1.2;
  head.add(nose);
  const tip = ball(0.011, skin, 1.25, 0.9, 1);
  tip.position.set(0, -0.026, -0.108);
  head.add(tip);
  const mouth = capsule(0.0055, 0.032, lip);
  mouth.rotation.z = Math.PI / 2;
  mouth.position.set(0, -0.056, -0.09);
  head.add(mouth);
  const hairGeo = new THREE.SphereGeometry(1, 72, 40, 0, Math.PI * 2, 0, Math.PI * 0.56);
  const hair = new THREE.Mesh(hairGeo, hairM);
  hair.scale.set(0.083, 0.123, 0.104);
  hair.position.set(0, 0.006, 0.006);
  hair.rotation.x = 0.38; // hairline high at the front, low at the nape
  hair.castShadow = true;
  head.add(hair);

  // ---- arms
  const limbs: Record<string, THREE.Group> = {};
  for (const sd of [-1, 1]) {
    const side = sd < 0 ? 'L' : 'R';
    const sh = joint(spine, sd * 0.185, 0.425);
    sh.add(ball(0.062, shirt, 1, 0.95, 0.9));
    sh.add(lathe([[-0.15, 0.054], [-0.08, 0.06], [-0.02, 0.064], [0.02, 0.06]], shirt, 1, 0.95)); // sleeve
    sh.add(lathe([[-0.31, 0.037], [-0.24, 0.042], [-0.17, 0.048], [-0.12, 0.05]], skin, 1, 0.92)); // upper arm
    const el = joint(sh, 0, -0.31);
    el.add(ball(0.037, skin));
    el.add(lathe([[-0.265, 0.025], [-0.2, 0.031], [-0.12, 0.038], [-0.05, 0.042], [0.0, 0.038]], skin, 1, 0.85));
    const wrist = joint(el, 0, -0.265);
    wrist.add(hand(sd, skin));

    // ---- legs
    const hp = joint(hips, sd * 0.092, -0.03);
    hp.add(lathe([[-0.41, 0.054], [-0.3, 0.064], [-0.15, 0.078], [-0.04, 0.088], [0.03, 0.085]], pants, 1, 0.95));
    const kn = joint(hp, 0, -0.41);
    kn.add(ball(0.056, pants));
    kn.add(lathe([[-0.4, 0.05], [-0.3, 0.051], [-0.16, 0.056], [-0.06, 0.057], [0.0, 0.055]], pants, 1, 0.95));
    const an = joint(kn, 0, -0.41);
    an.add(lathe([[-0.04, 0.032], [0.02, 0.035]], skin, 1, 1, 6));
    const upper = new THREE.Mesh(new RoundedBoxGeometry(0.098, 0.075, 0.27, 5, 0.034), shoe);
    upper.position.set(0, -0.025, -0.07);
    upper.castShadow = true;
    an.add(upper);
    const soleM = new THREE.Mesh(new RoundedBoxGeometry(0.104, 0.024, 0.28, 3, 0.01), sole);
    soleM.position.set(0, -0.068, -0.07);
    soleM.castShadow = true;
    an.add(soleM);
    Object.assign(limbs, { [`sh${side}`]: sh, [`el${side}`]: el, [`hip${side}`]: hp, [`knee${side}`]: kn, [`ank${side}`]: an });
  }

  // ---- normalise to the requested height (rest pose)
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(body);
  const k = height / (box.max.y - box.min.y);
  body.scale.setScalar(k);
  body.position.y = -box.min.y * k;

  let phase = 0, crouchK = 0, airK = 0, moveK = 0;
  const damp = (a: number, b: number, r: number, dt: number) => a + (b - a) * (1 - Math.exp(-r * dt));

  return {
    object: root,
    height,
    update(pose: Pose, speed: number, dt: number) {
      const crouch = pose.startsWith('crouch') ? 1 : 0;
      const air = pose === 'jump' || pose === 'fall' ? 1 : 0;
      const moving = pose === 'walk' || pose === 'run' || pose === 'crouch_walk' ? 1 : 0;
      crouchK = damp(crouchK, crouch, 10, dt);
      airK = damp(airK, air, 10, dt);
      moveK = damp(moveK, moving, 8, dt);
      const run = pose === 'run' ? 1 : 0;
      const stride = run ? 0.7 : 0.45;
      phase += dt * (moving ? Math.max(4, speed * 3.3) : 1.5);
      const swing = Math.sin(phase) * moveK * stride * (1 - airK * 0.7);
      const bob = Math.abs(Math.cos(phase)) * 0.03 * moveK;
      hips.position.y = 0.93 - crouchK * 0.36 + bob - airK * 0.04;
      hips.rotation.y = Math.sin(phase) * 0.08 * moveK;
      spine.rotation.y = -Math.sin(phase) * 0.12 * moveK;
      spine.rotation.x = -crouchK * 0.32 - run * 0.14 * moveK;
      const breathe = Math.sin(performance.now() / 750) * 0.012 * (1 - moveK);
      spine.scale.set(1 + breathe * 0.5, 1, 1 + breathe);
      neck.rotation.x = crouchK * 0.28 + run * 0.1 * moveK;
      for (const sd of [-1, 1]) {
        const side = sd < 0 ? 'L' : 'R';
        const legSwing = swing * sd;
        // +x rotation swings a hanging limb forward (-z); knees bend with negative rotation
        limbs[`hip${side}`].rotation.x = legSwing + crouchK * 1.25 + airK * 0.6;
        limbs[`knee${side}`].rotation.x = -(Math.max(0, -Math.sin(phase + (sd > 0 ? 0 : Math.PI)) * (run ? 1.3 : 0.8) * moveK) + crouchK * 2.0 + airK * 1.0);
        limbs[`ank${side}`].rotation.x = crouchK * 0.75 + airK * 0.3;
        limbs[`sh${side}`].rotation.x = -legSwing * 1.0 + airK * 1.1 + crouchK * 0.3;
        limbs[`sh${side}`].rotation.z = sd * (0.07 + airK * 0.25);
        limbs[`el${side}`].rotation.x = 0.18 + (run ? 1.1 : 0.25) * moveK + airK * 0.4 + crouchK * 0.5;
      }
    },
  };
}
