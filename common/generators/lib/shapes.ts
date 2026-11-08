/** Geometry helpers shared by all generators. All sizes in meters; UVs are metric (1 unit = 1 m). */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export type V3 = [number, number, number];

/** BoxGeometry whose UVs are in meters, so tiling textures keep real-world scale on any size. */
export function metricBox(w: number, h: number, d: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // face order: +x, -x, +y, -y, +z, -z ; 4 verts each
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, uv.getX(idx) * dims[f][0], uv.getY(idx) * dims[f][1]);
    }
  }
  uv.needsUpdate = true;
  return g;
}

function finish<T extends THREE.Mesh>(m: T, pos?: V3, opts: MeshOpts = {}): T {
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  m.castShadow = opts.shadow ?? true;
  m.receiveShadow = true;
  if (opts.collider === false) m.userData.collider = false;
  if (opts.name) m.name = opts.name;
  return m;
}

export interface MeshOpts {
  collider?: boolean;
  shadow?: boolean;
  name?: string;
}

/** box by CENTER position */
export function box(w: number, h: number, d: number, mat: THREE.Material, pos?: V3, opts?: MeshOpts): THREE.Mesh {
  return finish(new THREE.Mesh(metricBox(w, h, d), mat), pos, opts);
}

/** box positioned by its bottom-centre (handy for things standing on y) */
export function boxOn(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, opts?: MeshOpts): THREE.Mesh {
  return box(w, h, d, mat, [x, y + h / 2, z], opts);
}

export function rbox(w: number, h: number, d: number, r: number, mat: THREE.Material, pos?: V3, opts?: MeshOpts): THREE.Mesh {
  const rr = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  return finish(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.max(rr, 0.001)), mat), pos, opts);
}

export function cyl(rTop: number, rBot: number, h: number, mat: THREE.Material, pos?: V3, opts?: MeshOpts & { seg?: number }): THREE.Mesh {
  return finish(new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, opts?.seg ?? 24), mat), pos, opts);
}

export function sphere(r: number, mat: THREE.Material, pos?: V3, opts?: MeshOpts): THREE.Mesh {
  return finish(new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), mat), pos, opts);
}

/** bar handle (two posts + grip), vertical by default, centred at pos; no collider */
export function handle(mat: THREE.Material, pos: V3, length = 0.12, vertical = true, protrude = 0.03): THREE.Group {
  const g = new THREE.Group();
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, length, 10), mat);
  if (!vertical) grip.rotation.z = Math.PI / 2;
  grip.position.z = protrude;
  g.add(grip);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, protrude, 8), mat);
    post.rotation.x = Math.PI / 2;
    post.position.set(vertical ? 0 : (s * length) / 2.4, vertical ? (s * length) / 2.4 : 0, protrude / 2);
    g.add(post);
  }
  g.traverse((o) => {
    o.userData.collider = false;
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  g.position.set(...pos);
  return g;
}

/** a pivot group placed at `at`; children are added in pivot-local coordinates */
export function pivot(at: V3, name = 'pivot'): THREE.Group {
  const p = new THREE.Group();
  p.name = name;
  p.position.set(...at);
  return p;
}

/** extrude a 2D outline (x, z footprint in meters) up by height h, standing on y = y0 */
export function extrudeFootprint(points: [number, number][], h: number, mat: THREE.Material, y0 = 0, opts?: MeshOpts): THREE.Mesh {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return finish(new THREE.Mesh(g, mat), undefined, opts);
}
