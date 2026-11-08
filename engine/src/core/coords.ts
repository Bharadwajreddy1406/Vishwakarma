import * as THREE from 'three';
import type { Vec2 } from '../types';

/**
 * Plan space: meters, +x right, +y "up the drawing". three.js: +y up, so plan (x, y) -> world (x, h, -y).
 * Plan rotations are degrees CCW seen from above -> rotation.y = +rad (CCW about +Y seen from above).
 * Generator objects face +z; at rotation 0 that is plan -y.
 */
export const toWorld = (p: Vec2, h = 0): THREE.Vector3 => new THREE.Vector3(p[0], h, -p[1]);
export const toPlan = (v: THREE.Vector3): Vec2 => [v.x, -v.z];
export const deg = (d: number) => (d * Math.PI) / 180;

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function polygonBounds(poly: Vec2[]) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}
