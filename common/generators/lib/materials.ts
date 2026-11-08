/**
 * Material library: common/materials/library.json presets -> cached three.js materials.
 * A preset uses CC0 photo textures when present (`maps`), else a procedural canvas texture.
 */
import * as THREE from 'three';
import { drawTexture, toBump, type TexKind } from './textures';

export interface MaterialPreset {
  id: string;
  kind: TexKind | 'glass' | 'mirror' | 'emissive';
  color: string;
  color2?: string;
  grout?: string;
  /** meters covered by one texture repeat */
  scale?: number;
  /** tiles per texture repeat (tiles / pavers / wood planks) */
  tiles?: number;
  roughness?: number;
  metalness?: number;
  bump?: number;
  opacity?: number;
  emissive?: string;
  emissiveIntensity?: number;
  /** optional CC0 maps relative to common/ (fetched by `vk fetch-assets`) */
  maps?: { color?: string; normal?: string; roughness?: string };
  /** draw grout joints (`tiles` per `scale`) over a seamless photo albedo — for large-format floor tiles */
  photoGrout?: boolean;
  /** multiplies a photo albedo (e.g. warm up a grey marble scan) */
  tint?: string;
  /** meters covered by one repeat of the photo maps (defaults to `scale`) */
  mapScale?: number;
  normalScale?: number;
  source?: string;
  tags?: string[];
  description?: string;
}

export interface Palette {
  id: string;
  description?: string;
  slots: Record<string, string>;
}

const FALLBACK: MaterialPreset = { id: 'fallback', kind: 'plain', color: '#9a9a9a', roughness: 0.8 };

export class MaterialLibrary {
  private presets = new Map<string, MaterialPreset>();
  private cache = new Map<string, THREE.Material>();
  private loader = new THREE.TextureLoader();
  palette: Palette = { id: 'none', slots: {} };
  maxAnisotropy = 8;

  constructor(private baseUrl: string, private available: Set<string> = new Set()) {}

  add(presets: MaterialPreset[]): void {
    for (const p of presets) this.presets.set(p.id, p);
  }

  has(id: string): boolean {
    return this.presets.has(id);
  }

  ids(): string[] {
    return [...this.presets.keys()];
  }

  /** resolve slot: explicit overrides -> palette -> generator default -> fallback */
  resolve(slot: string, overrides: Record<string, string> | undefined, defaults: Record<string, string>): THREE.Material {
    const id = overrides?.[slot] ?? this.palette.slots[slot] ?? defaults[slot] ?? slot;
    return this.get(id);
  }

  get(id: string): THREE.Material {
    const hit = this.cache.get(id);
    if (hit) return hit;
    const p = this.presets.get(id);
    if (!p) console.warn(`[materials] unknown material "${id}", using fallback`);
    const m = this.build(p ?? { ...FALLBACK, id });
    m.name = id;
    this.cache.set(id, m);
    return m;
  }

  private tex(src: HTMLCanvasElement | string, scale: number, srgb: boolean): THREE.Texture {
    const t = typeof src === 'string' ? this.loader.load(`${this.baseUrl}/${src}`) : new THREE.CanvasTexture(src);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / scale, 1 / scale);
    t.anisotropy = this.maxAnisotropy;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private build(p: MaterialPreset): THREE.Material {
    if (p.kind === 'glass') {
      return new THREE.MeshPhysicalMaterial({
        color: p.color, roughness: p.roughness ?? 0.05, metalness: 0, transparent: true,
        opacity: p.opacity ?? 0.25, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.2,
      });
    }
    if (p.kind === 'mirror') {
      return new THREE.MeshStandardMaterial({ color: p.color, roughness: p.roughness ?? 0.02, metalness: 1 });
    }
    if (p.kind === 'emissive') {
      return new THREE.MeshStandardMaterial({ color: p.color, emissive: p.emissive ?? p.color, emissiveIntensity: p.emissiveIntensity ?? 2 });
    }
    const scale = p.scale ?? 1;
    const ms = p.mapScale ?? scale;
    const has = (f?: string): f is string => !!f && this.available.has(f);
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: p.roughness ?? 0.7, metalness: p.metalness ?? 0,
      ...(p.emissive ? { emissive: new THREE.Color(p.emissive), emissiveIntensity: p.emissiveIntensity ?? 1 } : {}),
    });
    if (has(p.maps?.color)) {
      // photo albedo; tiled floors get real grout joints drawn over the photo (2x2 tiles per repeat)
      m.map = p.photoGrout ? this.groutedPhoto(p.maps!.color!, p, scale) : this.tex(p.maps!.color!, ms, true);
      if (p.tint) m.color.set(p.tint);
    } else if (p.kind === 'plain') {
      m.color.set(p.color);
    } else {
      const canvas = drawTexture({ kind: p.kind as TexKind, color: p.color, color2: p.color2, tiles: p.tiles, grout: p.grout, seed: hash(p.id) });
      m.map = this.tex(canvas, scale, true);
      if (p.bump && !has(p.maps?.normal)) {
        m.bumpMap = this.tex(toBump(canvas), scale, false);
        m.bumpScale = p.bump;
      }
    }
    if (has(p.maps?.normal)) {
      m.normalMap = this.tex(p.maps!.normal!, ms, false);
      const ns = p.normalScale ?? 1;
      m.normalScale.set(ns, ns);
    }
    if (has(p.maps?.roughness)) {
      m.roughnessMap = this.tex(p.maps!.roughness!, ms, false);
      // roughnessMap multiplies `roughness`; photo maps sit around 0.5, so scale the base up to keep the preset's look
      m.roughness = Math.min(1, (p.roughness ?? 0.7) * 1.6);
    }
    return m;
  }

  private groutedPhoto(url: string, p: MaterialPreset, tileSize: number): THREE.Texture {
    const per = (p.tiles ?? 1) * 2;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 2048;
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1 / (tileSize * 2), 1 / (tileSize * 2));
    tex.anisotropy = this.maxAnisotropy;
    tex.colorSpace = THREE.SRGBColorSpace;
    new THREE.ImageLoader().load(`${this.baseUrl}/${url}`, (img) => {
      const ctx = cv.getContext('2d')!;
      const step = cv.width / per;
      // each tile gets a different region of the photo so neighbouring tiles don't repeat
      for (let i = 0; i < per; i++) {
        for (let j = 0; j < per; j++) {
          const sx = ((i * 0.37 + j * 0.61) % 1) * img.width * 0.5, sy = ((i * 0.53 + j * 0.29) % 1) * img.height * 0.5;
          ctx.drawImage(img, sx, sy, img.width * 0.5, img.height * 0.5, i * step, j * step, step, step);
        }
      }
      ctx.strokeStyle = p.grout ?? '#c9c2b4';
      ctx.lineWidth = Math.max(2, cv.width / 600);
      for (let k = 0; k <= per; k++) {
        ctx.beginPath(); ctx.moveTo(k * step, 0); ctx.lineTo(k * step, cv.height); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, k * step); ctx.lineTo(cv.width, k * step); ctx.stroke();
      }
      tex.needsUpdate = true;
    });
    return tex;
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
