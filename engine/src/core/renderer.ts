import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export type Quality = 'low' | 'medium' | 'high';

export interface SolarState {
  hour: number;
  /** sun elevation / compass azimuth in degrees */
  elevation: number;
  azimuth: number;
  /** 0 = full day, 1 = full night */
  night: number;
}

/**
 * Renderer + lighting rig.
 *  - quality low: forward render only; medium: + GTAO ambient occlusion; high: + bloom, 4k shadows
 *  - time of day: real solar position (latitude, day of year) drives the physical sky, sun colour/intensity,
 *    image-based ambient light (re-baked from the sky), hemisphere fill, moonlight and exposure.
 */
export class Stage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  moon: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  quality: Quality = 'medium';
  solar: SolarState = { hour: 10, elevation: 45, azimuth: 120, night: 0 };
  private sky?: Sky;
  private skyScene = new THREE.Scene();
  private skyForEnv?: Sky;
  private pmrem: THREE.PMREMGenerator;
  private envRT?: THREE.WebGLRenderTarget;
  /** neutral indoor bounce light (walls/ceiling) — interiors are lit by this, not by the blue sky */
  private roomEnv?: THREE.Texture;
  private composer?: EffectComposer;
  private gtao?: GTAOPass;
  private bloom?: UnrealBloomPass;
  private center = new THREE.Vector3();
  private radius = 10;
  private hdriFixed = false;
  latitude = 17.4;
  dayOfYear = 80;
  northDeg = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 600);
    this.hemi = new THREE.HemisphereLight(0xdfe9f5, 0x9c8a74, 0.4);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.moon = new THREE.DirectionalLight(0x9fb4ff, 0);
    this.scene.add(this.hemi, this.sun, this.sun.target, this.moon, this.moon.target);
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h);
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const dpr = devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 'low' ? 1 : q === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2));
    this.renderer.shadowMap.enabled = q !== 'low';
    const size = q === 'high' ? 4096 : 2048;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      (this.sun.shadow as any).map = null;
    }
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      for (const mm of Array.isArray(m) ? m : m ? [m] : []) mm.needsUpdate = true;
    });
    this.buildComposer();
    this.resize();
  }

  private buildComposer(): void {
    this.composer?.dispose();
    this.composer = undefined;
    this.gtao = undefined;
    this.bloom = undefined;
    if (this.quality === 'low') return;
    const w = innerWidth, h = innerHeight;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    const c = new EffectComposer(this.renderer, rt);
    c.addPass(new RenderPass(this.scene, this.camera));
    const ao = new GTAOPass(this.scene, this.camera, w, h);
    ao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: this.quality === 'high' ? 16 : 12 });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    ao.blendIntensity = 0.85;
    c.addPass(ao);
    this.gtao = ao;
    if (this.quality === 'high') {
      const b = new UnrealBloomPass(new THREE.Vector2(w, h), 0.1, 0.4, 0.97);
      c.addPass(b);
      this.bloom = b;
    }
    c.addPass(new OutputPass());
    this.composer = c;
  }

  /** sky + sun rig around the building; HDRI (if any) gives a fixed environment instead of the dynamic sky */
  async environment(hdriUrl: string | null, center: THREE.Vector3, radius: number): Promise<void> {
    this.center.copy(center);
    this.radius = radius;
    if (hdriUrl) {
      try {
        const tex = await new RGBELoader().loadAsync(hdriUrl);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        this.scene.environment = this.pmrem.fromEquirectangular(tex).texture;
        this.scene.background = tex;
        this.scene.environmentIntensity = 0.6;
        this.hdriFixed = true;
      } catch (e) {
        console.warn('HDRI failed, using dynamic sky', e);
      }
    }
    if (!this.hdriFixed) {
      const sky = new Sky();
      sky.scale.setScalar(2000);
      this.scene.add(sky);
      this.sky = sky;
      const envSky = new Sky();
      envSky.scale.setScalar(2000);
      this.skyScene.add(envSky);
      this.skyForEnv = envSky;
      this.scene.fog = new THREE.Fog(0xcfd9e2, 80, 400);
    }
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -radius * 1.2;
    cam.right = cam.top = radius * 1.2;
    cam.near = 0.5;
    cam.far = radius * 8;
    cam.updateProjectionMatrix();
    if (!this.composer && this.quality !== 'low') this.buildComposer();
  }

  /** set local solar time (hours, 0-24). Returns how "night" it is (0..1) for interior lighting. */
  setTime(hour: number): SolarState {
    const { elevation, azimuth } = solarPosition(hour, this.dayOfYear, this.latitude);
    const dir = sunDirection(azimuth, elevation, this.northDeg);
    const day = smoothstep(-6, 12, elevation);          // civil twilight .. well above horizon
    const golden = 1 - smoothstep(4, 22, elevation);     // warm when low
    const night = 1 - smoothstep(-8, 2, elevation);
    this.solar = { hour, elevation, azimuth, night };

    // sun
    this.sun.position.copy(this.center).addScaledVector(dir, this.radius * 3);
    this.sun.target.position.copy(this.center);
    const warm = new THREE.Color().setRGB(1.0, 0.58, 0.32), white = new THREE.Color().setRGB(1.0, 0.96, 0.9);
    this.sun.color.copy(white).lerp(warm, golden);
    this.sun.intensity = 3.4 * smoothstep(-1, 10, elevation);
    this.sun.castShadow = elevation > -1;
    // moon roughly opposite the sun
    this.moon.position.copy(this.center).addScaledVector(new THREE.Vector3(-dir.x, Math.max(0.35, -dir.y), -dir.z).normalize(), this.radius * 3);
    this.moon.target.position.copy(this.center);
    this.moon.intensity = 0.12 * night;
    // sky fill
    this.hemi.intensity = 0.08 + 0.42 * day;
    this.hemi.color.set(0xdfe9f5).lerp(new THREE.Color(0xffc9a0), golden * 0.5).lerp(new THREE.Color(0x3a4a7a), night);
    this.hemi.groundColor.set(0x9c8a74).multiplyScalar(0.3 + 0.7 * day);

    if (!this.hdriFixed && this.sky && this.skyForEnv) {
      for (const s of [this.sky, this.skyForEnv]) {
        const u = s.material.uniforms;
        u.turbidity.value = 4 + golden * 6;
        u.rayleigh.value = 1.2 + golden * 1.8;
        u.mieCoefficient.value = 0.004 + golden * 0.004;
        u.mieDirectionalG.value = 0.8;
        u.sunPosition.value.copy(dir);
      }
      // indoor ambient = neutral room bounce, warmed at golden hour, faint at night
      if (!this.roomEnv) this.roomEnv = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environment = this.roomEnv;
      this.scene.environmentIntensity = 0.06 + 0.55 * day;
      this.hemi.intensity *= 0.6;
      (this.scene.fog as THREE.Fog | null)?.color.set(0xcfd9e2).lerp(new THREE.Color(0xe7b48f), golden * 0.6).lerp(new THREE.Color(0x0b1020), night);
    }
    this.renderer.toneMappingExposure = 1.0 + day * 0.15 + night * 0.15;
    if (this.bloom) this.bloom.strength = 0.1 + night * 0.08;
    return this.solar;
  }

  render(): void {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** simple solar position (good to ~1°): local solar time, day of year, latitude -> elevation & compass azimuth (deg) */
export function solarPosition(hour: number, dayOfYear: number, latDeg: number): { elevation: number; azimuth: number } {
  const rad = Math.PI / 180;
  const decl = 23.44 * Math.sin(rad * (360 / 365) * (dayOfYear - 81));
  const H = 15 * (hour - 12);
  const lat = latDeg * rad, d = decl * rad, h = H * rad;
  const sinEl = Math.sin(lat) * Math.sin(d) + Math.cos(lat) * Math.cos(d) * Math.cos(h);
  const el = Math.asin(sinEl);
  const cosAz = (Math.sin(d) - sinEl * Math.sin(lat)) / (Math.cos(el) * Math.cos(lat));
  let az = Math.acos(Math.min(1, Math.max(-1, cosAz))) / rad;
  if (H > 0) az = 360 - az;
  return { elevation: el / rad, azimuth: az };
}

/** compass azimuth (0 = N, 90 = E) + elevation -> world direction toward the sun, honouring plan north */
export function sunDirection(azimuthDeg: number, elevationDeg: number, northDeg: number): THREE.Vector3 {
  const nd = (northDeg * Math.PI) / 180;
  const north = new THREE.Vector2(-Math.sin(nd), Math.cos(nd)); // plan space
  const east = new THREE.Vector2(Math.cos(nd), Math.sin(nd));
  const az = (azimuthDeg * Math.PI) / 180, el = (elevationDeg * Math.PI) / 180;
  const ground = north.multiplyScalar(Math.cos(az)).add(east.multiplyScalar(Math.sin(az)));
  return new THREE.Vector3(ground.x * Math.cos(el), Math.sin(el), -ground.y * Math.cos(el)).normalize();
}
