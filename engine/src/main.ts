import * as THREE from 'three';
import { loadMaterials } from './world/materials-loader';
import { Physics } from './core/physics';
import { Stage, type Quality } from './core/renderer';
import { buildWorld, type Viewpoint } from './world/builder';
import { Input } from './player/input';
import { AVATARS, loadAvatar } from './player/avatar';
import { Player } from './player/player';
import { Interactions } from './interaction/interact';
import { Hud } from './ui/hud';
import { Editor } from './editor/editor';
import type { Plan, Scene } from './types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $('status');
const enterBtn = $<HTMLButtonElement>('enter');
const overlay = $('overlay');
const setStatus = (s: string, err = false) => { statusEl.textContent = s; statusEl.classList.toggle('error', err); };

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

async function exists(url: string): Promise<boolean> {
  try { return (await fetch(url, { method: 'HEAD' })).ok; } catch { return false; }
}

const fmtTime = (h: number) => {
  const hh = Math.floor(h) % 24, mm = Math.round((h % 1) * 60) % 60;
  const ap = hh < 12 ? 'AM' : 'PM';
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${ap}`;
};

function dayOfYear(mmdd?: string): number {
  const now = new Date();
  const [m, d] = mmdd ? mmdd.split('-').map(Number) : [now.getMonth() + 1, now.getDate()];
  return Math.round((Date.UTC(2025, m - 1, d) - Date.UTC(2025, 0, 1)) / 86400000) + 1;
}

async function main(): Promise<void> {
  const q = new URLSearchParams(location.search);
  const project = q.get('project');
  if (!project) {
    setStatus('No project selected. Run:  vk render <project>', true);
    return;
  }
  $('project-name').textContent = `Project: ${project}`;
  document.title = `${project} · Vishwakarma AI`;

  setStatus('Loading plan…');
  const base = `/vk/projects/${encodeURIComponent(project)}`;
  const plan = await getJson<Plan>(`${base}/plan.json`);
  let scene: Scene;
  try { scene = await getJson<Scene>(`${base}/scene.json`); } catch { scene = { version: 1, plan: 'plan.json', objects: [] }; }
  // the verified plan stays untouched on disk; editor wall changes are layered on top from scene.plan_edits
  const originalPlan: Plan = JSON.parse(JSON.stringify(plan));
  for (const [id, e] of Object.entries(scene.plan_edits?.walls ?? {})) {
    const w = plan.walls.find((x) => x.id === id);
    if (w) { w.a = e.a; w.b = e.b; }
  }

  setStatus('Starting physics (WASM)…');
  const physics = new Physics();
  await physics.init();

  const stage = new Stage($<HTMLCanvasElement>('view'));
  const lib = await loadMaterials(scene.palette ?? 'warm-indian-modern');
  lib.maxAnisotropy = stage.renderer.capabilities.getMaxAnisotropy();

  setStatus('Building the house…');
  const world = await buildWorld(plan, scene, lib, physics, project);
  stage.scene.add(world.root);
  for (const w of world.warnings) console.warn(w);

  // ---- sky, sun & time of day
  stage.latitude = plan.site?.latitude ?? 17.4;
  stage.northDeg = plan.site?.north_deg ?? 0;
  stage.dayOfYear = dayOfYear(q.get('date') ?? scene.environment?.date);
  const hdri = scene.environment?.hdri ? `/vk/common/hdri/${scene.environment.hdri}` : null;
  await stage.environment(hdri && (await exists(hdri)) ? hdri : null, world.center, world.radius);
  const savedQ = (q.get('quality') ?? safeGet('vk.quality')) as Quality | null;
  stage.setQuality(savedQ && ['low', 'medium', 'high'].includes(savedQ) ? savedQ : 'high');

  // house lights: every point light except flickering diyas; emissive fittings dim with them
  const houseLights: { l: THREE.PointLight; base: number }[] = [];
  const emissives = new Map<THREE.MeshStandardMaterial, number>();
  world.root.traverse((o) => {
    if ((o as THREE.PointLight).isPointLight && !o.userData.flicker) houseLights.push({ l: o as THREE.PointLight, base: (o as THREE.PointLight).intensity });
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m && !Array.isArray(m) && m.emissiveIntensity > 0 && m.emissive && m.emissive.getHex() !== 0 && !o.userData.flicker) emissives.set(m, m.emissiveIntensity);
  });
  let lightsMode: 'auto' | 'on' | 'off' = (safeGet('vk.lights') as any) ?? 'auto';
  let hour = Number(q.get('time') ?? safeGet('vk.time') ?? scene.environment?.time ?? 10);
  const timeSlider = $<HTMLInputElement>('time');
  const lightsSel = $<HTMLSelectElement>('lights');
  const applyTime = () => {
    const s = stage.setTime(hour);
    const on = lightsMode === 'on' || (lightsMode === 'auto' && s.night > 0.35);
    const k = on ? 1 : 0;
    for (const { l, base } of houseLights) { l.intensity = base * k; l.visible = k > 0; }
    for (const [m, base] of emissives) m.emissiveIntensity = on ? base : base * 0.08;
    $('clock').textContent = `${fmtTime(hour)} · lights ${lightsMode}${lightsMode === 'auto' ? (on ? ' (on)' : ' (off)') : ''}`;
    timeSlider.value = String(hour);
    lightsSel.value = lightsMode;
  };
  timeSlider.addEventListener('input', () => { hour = Number(timeSlider.value); safeSet('vk.time', String(hour)); applyTime(); });
  lightsSel.addEventListener('change', () => { lightsMode = lightsSel.value as any; safeSet('vk.lights', lightsMode); applyTime(); });
  applyTime();

  // ---- player
  const input = new Input(stage.renderer.domElement);
  const avatarId = q.get('avatar') ?? safeGet('vk.avatar') ?? 'human';
  const avatar = await loadAvatar(avatarId);
  const avSel = $<HTMLSelectElement>('avatar');
  for (const a of AVATARS) avSel.add(new Option(a.label, a.id, false, a.id === avatarId));
  avSel.onchange = () => { safeSet('vk.avatar', avSel.value); location.reload(); };
  stage.scene.add(avatar.object);
  const player = new Player(physics, input, stage.camera, avatar, world.spawn.position, world.spawn.heading);
  const interact = new Interactions(world.interactables, world.root.getObjectByName('walls')!);
  const hud = new Hud(plan);

  // ---- viewpoints: sit on the sofa, slouch on the bed, … (keys 1-9, or the menu)
  let vp: Viewpoint | null = null;
  let vpYaw = 0, vpPitch = 0;
  const vpLabel = $('viewpoint');
  const setViewpoint = (v: Viewpoint | null) => {
    vp = v;
    if (v) { vpYaw = v.yaw; vpPitch = v.pitch; }
    vpLabel.hidden = !v;
    if (v) vpLabel.innerHTML = `<b>${v.name}</b><span>look around with the mouse · 1-9 other views · W/A/S/D to get up</span>`;
  };
  const vpList = $('viewpoints');
  world.viewpoints.forEach((v, i) => {
    const b = document.createElement('button');
    b.innerHTML = `<kbd>${i < 9 ? i + 1 : ''}</kbd>${v.name}`;
    b.onclick = () => { setViewpoint(v); input.lock(); };
    vpList.append(b);
  });
  // digits: editor tools while editing, viewpoints otherwise
  const editor = new Editor(stage, world, physics, input, interact, hud, scene, project, originalPlan);
  const tools = ['move', 'measure', 'walls'] as const;
  for (let i = 1; i <= 9; i++) {
    input.on(`Digit${i}`, () => {
      if (editor.active) { if (i <= 3) editor.setTool(tools[i - 1]); return; }
      const v = world.viewpoints[i - 1];
      if (v) { setViewpoint(v); hud.toast(v.name, 1.4); }
    });
  }
  input.on('Digit0', () => setViewpoint(null));

  // ---- controls
  const sens = $<HTMLInputElement>('sens');
  const savedSens = safeGet('vk.sens');
  if (savedSens) sens.value = savedSens;
  input.sensitivity = Number(sens.value);
  sens.addEventListener('input', () => { input.sensitivity = Number(sens.value); safeSet('vk.sens', sens.value); });

  input.on('KeyV', () => { player.toggleView(); hud.toast(player.view === 'fpp' ? 'First person' : 'Third person'); });
  input.on('KeyC', () => player.toggleCrouch());
  input.on('KeyF', () => { const m = interact.toggle(); if (m) hud.toast(m, 1); });
  input.on('KeyM', () => hud.toggleMap());
  input.on('KeyH', () => { world.roof.visible = !world.roof.visible; hud.toast(world.roof.visible ? 'Ceilings on' : 'Ceilings off (dollhouse)'); });
  input.on('BracketLeft', () => { hour = (hour + 23.5) % 24; safeSet('vk.time', String(hour)); applyTime(); });
  input.on('BracketRight', () => { hour = (hour + 0.5) % 24; safeSet('vk.time', String(hour)); applyTime(); });
  const presets = [[7, 'Morning'], [12.5, 'Noon'], [17.75, 'Golden hour'], [19, 'Dusk'], [21.5, 'Night']] as const;
  input.on('KeyT', () => {
    const next = presets.find(([h]) => h > hour + 0.01) ?? presets[0];
    hour = next[0];
    safeSet('vk.time', String(hour));
    applyTime();
    hud.toast(`${next[1]} · ${fmtTime(hour)}`);
  });
  input.on('KeyL', () => {
    lightsMode = lightsMode === 'auto' ? 'on' : lightsMode === 'on' ? 'off' : 'auto';
    safeSet('vk.lights', lightsMode);
    applyTime();
    hud.toast(`House lights: ${lightsMode}`);
  });
  // overview: orbiting dollhouse camera above the flat (mouse X orbits, ceilings hidden while active)
  let overview = false, orbit = 0, roofWas = true;
  const setOverview = (on: boolean) => {
    overview = on;
    if (on) { roofWas = world.roof.visible; world.roof.visible = false; orbit = player.yaw; } else world.roof.visible = roofWas;
    hud.toast(on ? 'Overview (O to return)' : 'Back to player');
  };
  input.on('KeyO', () => setOverview(!overview));
  let debug = false;
  input.on('Backquote', () => { debug = !debug; hud.toast(debug ? 'Collider debug on' : 'Collider debug off'); });
  const qualities: Quality[] = ['low', 'medium', 'high'];
  input.on('KeyG', () => {
    const nq = qualities[(qualities.indexOf(stage.quality) + 1) % 3];
    stage.setQuality(nq);
    safeSet('vk.quality', nq);
    hud.toast(`Graphics: ${nq}`);
  });

  enterBtn.disabled = false;
  setStatus(`${plan.rooms.length} rooms · ${world.interactables.length} things you can open · ${world.viewpoints.length} viewpoints`);
  enterBtn.onclick = () => input.lock();
  input.onLockChange = (locked) => {
    overlay.classList.toggle('hidden', locked);
    enterBtn.textContent = 'Resume';
  };
  stage.renderer.domElement.addEventListener('click', () => { if (!input.locked) input.lock(); });

  // ---- scripted / screenshot mode:  ?autoplay=1&pos=x,y&heading=deg&pitch=deg&view=fpp|tpp&ceilings=0&quality=low&time=18&vp=2
  const autoplay = q.get('autoplay') === '1';
  if (autoplay) overlay.classList.add('hidden');
  if (q.get('pos')) {
    const [x, y] = q.get('pos')!.split(',').map(Number);
    const t = player.body.translation();
    player.body.setTranslation({ x, y: t.y, z: -y }, true);
  }
  if (q.get('heading')) player.yaw = (Number(q.get('heading')) * Math.PI) / 180;
  if (q.get('pitch')) player.pitch = (Number(q.get('pitch')) * Math.PI) / 180;
  if (q.get('view') === 'fpp' || q.get('view') === 'tpp') player.view = q.get('view') as 'fpp' | 'tpp';
  if (q.get('ceilings') === '0') world.roof.visible = false;
  if (q.get('overview') === '1') setOverview(true);
  if (q.get('orbit')) orbit = (Number(q.get('orbit')) * Math.PI) / 180;
  if (q.get('vp')) setViewpoint(world.viewpoints[Number(q.get('vp')) - 1] ?? null);
  (window as any).__vk = {
    world, player, interact, stage, editor,
    openAll: () => { for (const it of world.interactables) it.target = 1; },
    setTime: (h: number) => { hour = h; applyTime(); },
    ready: true,
  };

  // ---- loop
  const clock = new THREE.Clock();
  const eye = new THREE.Vector3();
  const loop = () => {
    const dt = Math.min(clock.getDelta(), 0.1);
    const running = input.locked || autoplay;
    // getting up from a viewpoint
    if (vp && running && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].some((k) => input.held(k))) setViewpoint(null);
    const alpha = physics.update(running ? dt : 0, (h) => { if (running && !vp) player.step(h); });
    interact.update(dt);
    if (vp) {
      const [mx, my] = input.consumeMouse();
      vpYaw -= mx * 0.0022;
      vpPitch = THREE.MathUtils.clamp(vpPitch - my * 0.0022, -1.4, 1.3);
      stage.camera.position.copy(vp.position);
      stage.camera.quaternion.setFromEuler(new THREE.Euler(vpPitch, vpYaw, 0, 'YXZ'));
      player.avatar.object.visible = false;
    } else {
      player.frame(dt, alpha);
    }
    if (overview) {
      orbit -= input.consumeMouse()[0] * 0.004;
      const r = world.radius * 1.15;
      stage.camera.position.set(world.center.x + Math.sin(orbit) * r * 0.55, world.radius * 1.5, world.center.z + Math.cos(orbit) * r * 0.55);
      stage.camera.lookAt(world.center.x, 0, world.center.z);
      player.avatar.object.visible = true;
    }
    if (vp) eye.copy(vp.position); else eye.set(player.feet.x, player.feet.y + 1.5, player.feet.z);
    const target = running ? interact.aim(stage.camera, eye) : undefined;
    hud.setPrompt(target ? interact.promptFor(target) : null);
    const t = performance.now() / 1000;
    for (const s of world.spinners) s.rotation.y += (s.userData.spin as number) * dt;
    for (const f of world.flickers) {
      const k = 0.85 + Math.sin(t * 13 + f.id) * 0.08 + Math.sin(t * 29 + f.id * 3) * 0.07;
      if ((f as THREE.PointLight).isLight) (f as THREE.PointLight).intensity = 0.6 * k;
      else f.scale.set(1, k, 1);
    }
    editor.update();
    physics.debugLines(stage.scene, debug);
    hud.update(dt, vp ? vp.position : player.feet, vp ? vpYaw : player.yaw, vp ? 'viewpoint' : player.stance);
    stage.render();
    requestAnimationFrame(loop);
  };
  loop();
}

function safeGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k: string, v: string): void { try { localStorage.setItem(k, v); } catch { /* private mode */ } }

main().catch((e) => {
  console.error(e);
  setStatus(`Failed to load:\n${(e as Error).message}`, true);
});
