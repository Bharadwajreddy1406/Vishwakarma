/**
 * Asset generator contract — every reusable 3D asset is a module exporting `meta` + `build`.
 *
 * Conventions (the engine relies on these):
 *  - Units are meters. Origin = floor level, centre of the footprint.
 *  - Width along local X, height along +Y, depth along Z. The FRONT faces +Z.
 *  - Every Mesh collides by default (box collider from its bounding box). Set
 *    `mesh.userData.collider = false` for handles, glass, cloth details, etc.
 *  - Moving parts go under a pivot Object3D listed in `interactables`; the engine animates the
 *    pivot on F and moves that pivot's colliders with it.
 *  - Material slots ('wood', 'fabric', 'metal' …) are resolved by the engine through
 *    scene overrides → palette → meta.slots defaults, so the same generator fits any palette.
 */
import type * as THREE from 'three';

export type ParamSpec =
  | { type: 'int' | 'number'; default: number; min?: number; max?: number; step?: number; description?: string }
  | { type: 'bool'; default: boolean; description?: string }
  | { type: 'enum'; default: string; options: string[]; description?: string }
  | { type: 'string'; default: string; description?: string };

export interface GeneratorMeta {
  id: string;
  version: number;
  description: string;
  tags: string[];
  params: Record<string, ParamSpec>;
  /** material slot -> default material id (from common/materials/library.json) */
  slots: Record<string, string>;
  /** default physics for placed instances: static (default), dynamic (pushable), none */
  physics?: 'static' | 'dynamic' | 'none';
  /** kg, for dynamic bodies */
  mass?: number;
}

export interface Interactable {
  /** object whose transform is animated; its descendant meshes get kinematic colliders */
  pivot: THREE.Object3D;
  kind: 'hinge' | 'slide';
  axis: 'x' | 'y' | 'z';
  /** radians for hinge, meters for slide (signed) */
  amount: number;
  label: string;
  open?: boolean;
  /** seconds */
  duration?: number;
  /** other interactables toggled together (double doors) */
  group?: string;
}

/** ask the engine to place another generator as a separate object (e.g. chairs around a table, so they can be dynamic) */
export interface Spawn {
  generator: string;
  params?: Record<string, unknown>;
  /** local position (meters) relative to the parent object origin, three.js axes */
  position: [number, number, number];
  rotationY?: number;
  materials?: Record<string, string>;
  physics?: 'static' | 'dynamic' | 'none';
}

export interface GenResult {
  object: THREE.Group;
  interactables?: Interactable[];
  spawn?: Spawn[];
}

export interface GenContext {
  THREE: typeof THREE;
  mat(slot: string): THREE.Material;
}

export interface Generator {
  meta: GeneratorMeta;
  build(params: Record<string, any>, ctx: GenContext): GenResult;
}

/** fill in defaults and clamp numeric params */
export function resolveParams(meta: GeneratorMeta, given: Record<string, unknown> = {}): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, spec] of Object.entries(meta.params)) {
    let v: any = given[k] ?? spec.default;
    if (spec.type === 'int' || spec.type === 'number') {
      v = Number(v);
      if (Number.isNaN(v)) v = spec.default;
      if (spec.min !== undefined) v = Math.max(spec.min, v);
      if (spec.max !== undefined) v = Math.min(spec.max, v);
      if (spec.type === 'int') v = Math.round(v);
    } else if (spec.type === 'bool') {
      v = v === true || v === 'true';
    } else if (spec.type === 'enum' && !spec.options.includes(v)) {
      v = spec.default;
    }
    out[k] = v;
  }
  return out;
}
