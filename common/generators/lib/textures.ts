/**
 * Procedural canvas textures — the offline fallback for every material.
 * Each returns a square canvas representing ONE tile of `scale` meters (set by the material).
 * Deterministic: same params -> same pixels.
 */

export type TexKind = 'plain' | 'wood' | 'tiles' | 'marble' | 'granite' | 'fabric' | 'plaster' | 'concrete' | 'grass' | 'pavers' | 'brushed' | 'terrazzo' | 'stripes';

export interface TexParams {
  kind: TexKind;
  color: string;
  color2?: string;
  /** tiles per texture edge (tiles, pavers) */
  tiles?: number;
  grout?: string;
  seed?: number;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgb = (c: number[]) => `rgb(${c[0]},${c[1]},${c[2]})`;

/** cheap value noise */
function makeNoise(r: () => number, size = 64) {
  const g = new Float32Array(size * size).map(() => r());
  const at = (x: number, y: number) => g[((y % size) + size) % size * size + (((x % size) + size) % size)];
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}
function fbm(n: (x: number, y: number) => number, x: number, y: number, oct = 4) {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += amp * n(x * f, y * f); f *= 2; amp *= 0.5; }
  return v;
}

export function drawTexture(p: TexParams, size = 512): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  const r = rng(p.seed ?? 7);
  const c1 = hexToRgb(p.color);
  const c2 = hexToRgb(p.color2 ?? p.color);
  const noise = makeNoise(r);

  const perPixel = (fn: (x: number, y: number) => number[]) => {
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const c = fn(x, y);
        const i = (y * size + x) * 4;
        img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  };
  // noise that tiles: sample on a torus-ish wrap by using periodic lattice (size 64 wraps)
  const k = 64 / size;

  switch (p.kind) {
    case 'plain':
      ctx.fillStyle = p.color; ctx.fillRect(0, 0, size, size);
      break;
    case 'plaster':
    case 'concrete': {
      const amt = p.kind === 'plaster' ? 0.06 : 0.16;
      perPixel((x, y) => {
        const n = fbm(noise, x * k * 4, y * k * 4) - 0.5;
        return mix(c1, n > 0 ? [255, 255, 255] : [0, 0, 0], Math.abs(n) * amt * 2);
      });
      break;
    }
    case 'wood': {
      // planks running along X; grain from stretched noise
      const planks = p.tiles ?? 4;
      perPixel((x, y) => {
        const plank = Math.floor((y / size) * planks);
        const off = plank * 17.3;
        const g = fbm(noise, x * k * 0.6 + off, y * k * 10, 3);
        const ring = (Math.sin((g * 18 + y * k * 2) * 1.0) + 1) / 2;
        let c = mix(c1, c2, ring * 0.65 + (noise(plank * 5.1, 3) - 0.5) * 0.5);
        const edge = (y / size) * planks - plank;
        if (planks > 1 && (edge < 0.012 || edge > 0.988)) c = mix(c, [0, 0, 0], 0.45);
        return c;
      });
      break;
    }
    case 'tiles':
    case 'pavers': {
      const n = p.tiles ?? 2;
      const grout = hexToRgb(p.grout ?? '#bdb6aa');
      const gw = p.kind === 'pavers' ? 0.03 : 0.012;
      perPixel((x, y) => {
        const u = (x / size) * n, v = (y / size) * n;
        const tx = Math.floor(u + (p.kind === 'pavers' && Math.floor(v) % 2 ? 0.5 : 0)), ty = Math.floor(v);
        const fu = u + (p.kind === 'pavers' && Math.floor(v) % 2 ? 0.5 : 0) - tx, fv = v - ty;
        if (fu < gw || fu > 1 - gw || fv < gw || fv > 1 - gw) return grout;
        const tileShade = (noise(tx * 13.7, ty * 7.1) - 0.5) * 0.25;
        const speck = (fbm(noise, x * k * 6, y * k * 6) - 0.5) * 0.25;
        return mix(c1, c2, Math.min(1, Math.max(0, 0.5 + tileShade + speck)));
      });
      break;
    }
    case 'marble': {
      perPixel((x, y) => {
        const t = fbm(noise, x * k * 2, y * k * 2, 5);
        const vein = Math.abs(Math.sin((x * k * 0.8 + y * k * 0.5 + t * 6) * 1.6));
        const v = Math.pow(1 - vein, 10);
        return mix(mix(c1, [255, 255, 255], (t - 0.5) * 0.3), c2, Math.min(1, v * 1.4));
      });
      break;
    }
    case 'granite':
    case 'terrazzo': {
      perPixel((x, y) => {
        const n1 = noise(x * k * 24, y * k * 24);
        const base = mix(c1, c2, fbm(noise, x * k * 3, y * k * 3) * 0.6);
        if (n1 > (p.kind === 'granite' ? 0.82 : 0.9)) return mix(base, [255, 255, 255], 0.55);
        if (n1 < 0.12) return mix(base, [0, 0, 0], 0.5);
        return base;
      });
      break;
    }
    case 'fabric': {
      perPixel((x, y) => {
        const weave = ((x % 4 < 2) !== (y % 4 < 2) ? 0.06 : -0.06) + (fbm(noise, x * k * 8, y * k * 8) - 0.5) * 0.2;
        return mix(c1, weave > 0 ? [255, 255, 255] : [0, 0, 0], Math.abs(weave));
      });
      break;
    }
    case 'grass': {
      perPixel((x, y) => {
        const n1 = fbm(noise, x * k * 10, y * k * 10);
        const blade = noise(x * k * 40, y * k * 6);
        return mix(mix(c1, c2, n1), [20, 40, 10], blade > 0.7 ? 0.35 : 0);
      });
      break;
    }
    case 'brushed': {
      perPixel((x, y) => mix(c1, [255, 255, 255], (noise(x * k * 0.3, y * k * 40) - 0.5) * 0.25 + 0.05));
      break;
    }
    case 'stripes': {
      const n = p.tiles ?? 8;
      perPixel((x) => (Math.floor((x / size) * n) % 2 ? c1 : c2));
      break;
    }
  }
  return cv;
}

/** grayscale height map derived from the color canvas (for bumpMap) */
export function toBump(src: HTMLCanvasElement): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = src.width; cv.height = src.height;
  const ctx = cv.getContext('2d')!;
  ctx.filter = 'grayscale(1) contrast(1.4)';
  ctx.drawImage(src, 0, 0);
  return cv;
}

export { rgb };
