/** Turntable preview of one generator with a live parameter panel:  vk asset preview <id> -p '{"seats":3}' */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { resolveParams, type Generator, type Interactable } from '@common/generators/lib/types';
import { listGenerators } from './world/registry';
import { loadMaterials } from './world/materials-loader';

const qs = new URLSearchParams(location.search);
const panel = document.getElementById('panel')!;
const canvas = document.getElementById('view') as HTMLCanvasElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x24211e);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
camera.position.set(2.2, 1.8, 3.0);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.7, 0);
controls.autoRotate = true;
controls.autoRotateSpeed = 0.8;
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(3, 6, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun, new THREE.HemisphereLight(0xffffff, 0x554433, 0.4));
const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 48), new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const resize = () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
};
addEventListener('resize', resize);
resize();

let current: THREE.Object3D | undefined;
let inter: Interactable[] = [];
let opened = false;

async function start() {
  const lib = await loadMaterials(qs.get('palette') ?? 'warm-indian-modern');
  const gens = listGenerators();
  const gen = gens.find((g) => g.meta.id === qs.get('gen')) ?? gens[0];
  const given = JSON.parse(qs.get('params') ?? '{}');
  const params = resolveParams(gen.meta, given);

  const rebuild = (g: Generator) => {
    if (current) scene.remove(current);
    const res = g.build(resolveParams(g.meta, params), { THREE, mat: (slot) => lib.resolve(slot, undefined, g.meta.slots) });
    current = res.object;
    inter = res.interactables ?? [];
    current.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(current);
    const box = new THREE.Box3().setFromObject(current);
    const size = box.getSize(new THREE.Vector3()).length();
    controls.target.copy(box.getCenter(new THREE.Vector3()));
    camera.position.copy(controls.target).add(new THREE.Vector3(0.7, 0.5, 1).normalize().multiplyScalar(size * 1.4 + 0.5));
    const u = new URL(location.href);
    u.searchParams.set('gen', g.meta.id);
    u.searchParams.set('params', JSON.stringify(params));
    history.replaceState(null, '', u);
    opened = false;
  };

  panel.innerHTML = '';
  const title = document.createElement('div');
  const select = document.createElement('select');
  for (const g of gens) select.add(new Option(g.meta.id, g.meta.id, false, g === gen));
  select.onchange = () => { location.search = `?gen=${select.value}`; };
  title.innerHTML = `<h1>Asset preview</h1><p>${gen.meta.description}</p>`;
  const row = document.createElement('label');
  row.textContent = 'generator';
  row.append(select);
  panel.append(title, row);
  for (const [k, spec] of Object.entries(gen.meta.params)) {
    const l = document.createElement('label');
    l.textContent = k;
    let el: HTMLInputElement | HTMLSelectElement;
    if (spec.type === 'enum') {
      el = document.createElement('select');
      for (const o of spec.options) el.add(new Option(o, o, false, params[k] === o));
    } else {
      el = document.createElement('input');
      if (spec.type === 'bool') { el.type = 'checkbox'; el.checked = params[k]; }
      else if (spec.type === 'string') el.value = params[k];
      else { el.type = 'number'; el.step = spec.type === 'int' ? '1' : '0.05'; el.value = String(params[k]); }
    }
    el.onchange = () => {
      params[k] = el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el instanceof HTMLInputElement && el.type === 'number' ? Number(el.value) : el.value;
      rebuild(gen);
    };
    if (spec.description) l.title = spec.description;
    l.append(el);
    panel.append(l);
  }
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.innerHTML = `Press <code>F</code> to open/close all moving parts · drag to orbit · tags: ${gen.meta.tags.join(', ')}`;
  panel.append(hint);
  rebuild(gen);
}

addEventListener('keydown', (e) => {
  if (e.code !== 'KeyF') return;
  opened = !opened;
  for (const it of inter) {
    if (it.kind === 'hinge') it.pivot.rotation[it.axis] = opened ? it.amount : 0;
    else it.pivot.position[it.axis] += opened ? it.amount : -it.amount;
  }
});

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

start().catch((e) => { panel.textContent = String(e); });
