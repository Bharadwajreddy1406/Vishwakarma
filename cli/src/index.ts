import { Command } from 'commander';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { COMMON, ENGINE, PIPELINE, PYTHON, ROOT, VENV, projectDir } from './paths.js';
import {
  STAGES, createProject, findInputPdf, listProjects, readMeta, requireProject, setStage,
} from './project.js';

const program = new Command();
program.name('vk').description('Vishwakarma AI — floor plan to walkable 3D house').version('0.1.0');

// ---------- helpers ----------
async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return ans === 'y' || ans === 'yes';
}

function runPython(module: string, args: string[]): number {
  if (!existsSync(PYTHON)) {
    console.error('Python venv missing. Run: vk setup');
    return 1;
  }
  const r = spawnSync(PYTHON, ['-m', `vk_pipeline.${module}`, ...args], {
    cwd: PIPELINE, stdio: 'inherit', env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });
  return r.status ?? 1;
}

/** Pick the plan source: vector PDF first, else the first raster image in input/ (or project root). */
function findPlanSource(name: string): string | undefined {
  const pdf = findInputPdf(name);
  if (pdf) return pdf;
  for (const dir of [join(projectDir(name), 'input'), projectDir(name)]) {
    if (!existsSync(dir)) continue;
    const img = readdirSync(dir).find((f) => /\.(png|jpe?g|webp)$/i.test(f) && /plan|floor/i.test(f));
    if (img) return join(dir, img);
  }
  return undefined;
}

function startEngine(query: string): void {
  const vite = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(vite)) {
    console.error('Engine deps missing. Run: npm install (in the workspace root)');
    process.exit(1);
  }
  const child = spawn(process.execPath, [vite, '--open', `/${query}`], { cwd: ENGINE, stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
}

function dirSize(path: string): number {
  if (!existsSync(path)) return 0;
  const st = statSync(path);
  if (!st.isDirectory()) return st.size;
  return readdirSync(path).reduce((n, f) => n + dirSize(join(path, f)), 0);
}
const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;

const wrap = (fn: (...a: any[]) => unknown) => async (...a: any[]) => {
  try {
    await fn(...a);
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    process.exitCode = 1;
  }
};

// ---------- project lifecycle ----------
program.command('create <name>').alias('new').description('create a new project (projects/<name>/{input,work,assets})').action(wrap((name: string) => {
  const dir = createProject(name);
  console.log(`Created ${relative(ROOT, dir)}`);
  console.log(`Drop the floor plan + reference images into ${relative(ROOT, join(dir, 'input'))}`);
  console.log(`Then in Claude Code: /vk-build ${name}`);
}));

program.command('list').alias('ls').description('list projects').action(wrap(() => {
  const ps = listProjects();
  if (ps.length === 0) return console.log('No projects. Create one: vk create <name>');
  for (const p of ps) {
    const done = STAGES.filter((s) => p.stages[s].state === 'done').length;
    console.log(`${p.name.padEnd(24)} ${done}/${STAGES.length} stages   updated ${p.updated.slice(0, 16).replace('T', ' ')}`);
  }
}));

program.command('status <name>').description('show pipeline stage status').action(wrap((name: string) => {
  requireProject(name);
  const m = readMeta(name);
  console.log(`${m.name}  (created ${m.created.slice(0, 10)})`);
  for (const s of STAGES) {
    const st = m.stages[s];
    console.log(`  ${s.padEnd(10)} ${st.state.padEnd(13)} ${st.note ?? ''}`);
  }
  const src = findPlanSource(name);
  console.log(`  source     ${src ? relative(projectDir(name), src) : '(none found in input/)'}`);
}));

program.command('stage <name> <stage> <state>')
  .description('set a stage state (used by Claude skills): pending|done|failed|needs-review')
  .option('-n, --note <note>')
  .action(wrap((name: string, stage: string, state: string, opts: { note?: string }) => {
    requireProject(name);
    if (!(STAGES as readonly string[]).includes(stage)) throw new Error(`stage must be one of ${STAGES.join(', ')}`);
    if (!['pending', 'done', 'failed', 'needs-review'].includes(state)) throw new Error('bad state');
    setStage(name, stage as any, state as any, opts.note);
    console.log(`${name}: ${stage} -> ${state}`);
  }));

program.command('delete <name>').alias('rm').description('delete a project (irreversible)')
  .option('-y, --yes', 'skip confirmation')
  .action(wrap(async (name: string, opts: { yes?: boolean }) => {
    const dir = requireProject(name);
    if (!opts.yes && !(await confirm(`Permanently delete ${relative(ROOT, dir)} including its inputs?`))) {
      return console.log('Aborted.');
    }
    rmSync(dir, { recursive: true, force: true });
    console.log(`Deleted ${name}`);
  }));

program.command('clean [name]').description('remove generated intermediates (work/); --all also clears build caches')
  .option('--all', 'all projects + engine build output + vite cache')
  .action(wrap((name: string | undefined, opts: { all?: boolean }) => {
    const targets: string[] = [];
    const names = name ? [name] : opts.all ? listProjects().map((p) => p.name) : [];
    if (names.length === 0) throw new Error('Specify a project or --all');
    for (const n of names) {
      requireProject(n);
      targets.push(join(projectDir(n), 'work'));
    }
    if (opts.all) targets.push(join(ENGINE, 'dist'), join(ENGINE, 'node_modules', '.vite'), join(ROOT, 'node_modules', '.vite'));
    let freed = 0;
    for (const t of targets) {
      if (!existsSync(t)) continue;
      freed += dirSize(t);
      rmSync(t, { recursive: true, force: true });
      console.log(`removed ${relative(ROOT, t)}`);
    }
    // recreate empty work dirs so the pipeline can write again
    for (const n of names) mkdirSync(join(projectDir(n), 'work'), { recursive: true });
    console.log(`freed ${mb(freed)}`);
  }));

// ---------- pipeline ----------
program.command('extract <name>').description('stage 1: extract raw geometry from the plan PDF/image -> work/raw.json')
  .option('-s, --source <file>', 'explicit source file (default: first PDF in input/, else an image named *plan*)')
  .option('-p, --page <n>', 'PDF page index', '0')
  .action(wrap((name: string, opts: { source?: string; page: string }) => {
    const dir = requireProject(name);
    const src = opts.source ? join(dir, opts.source) : findPlanSource(name);
    if (!src || !existsSync(src)) throw new Error('No plan source found. Put a PDF (or plan image) in input/ or pass --source');
    const code = runPython('extract', [src, join(dir, 'work'), '--page', opts.page]);
    setStage(name, 'extract', code === 0 ? 'done' : 'failed', relative(dir, src));
    process.exitCode = code;
  }));

program.command('plan <name>').description('stage 2: convert plan.draft.json (source pixels) -> plan.json (meters) and validate')
  .action(wrap((name: string) => {
    const dir = requireProject(name);
    if (!existsSync(join(dir, 'plan.draft.json'))) throw new Error('plan.draft.json missing — write it first (see the vk-interpret skill)');
    let code = runPython('draft2plan', [dir]);
    if (code === 0) code = runPython('validate', [dir]);
    setStage(name, 'interpret', code === 0 ? 'done' : 'failed');
    process.exitCode = code;
  }));

program.command('verify <name>').description('stage 3: render plan.json with matplotlib and compare to the source')
  .action(wrap((name: string) => {
    const dir = requireProject(name);
    const plan = join(dir, 'plan.json');
    if (!existsSync(plan)) throw new Error('plan.json missing — run the interpret stage (/vk-build) first');
    let code = runPython('render_plan', [plan, join(dir, 'work')]);
    if (code === 0) code = runPython('compare', [dir]);
    // compare exits 0 = gate passed, 2 = gate failed (needs fixes), other = error
    setStage(name, 'verify', code === 0 ? 'done' : code === 2 ? 'needs-review' : 'failed');
    process.exitCode = code;
  }));

program.command('validate <name>').description('validate plan.json / scene.json against the schemas')
  .action(wrap((name: string) => {
    const dir = requireProject(name);
    process.exitCode = runPython('validate', [dir]);
  }));

// ---------- play ----------
program.command('render <name>').aliases(['open', 'activate']).description('start the web app and open the walkable 3D house in the browser')
  .action(wrap((name: string) => {
    const dir = requireProject(name);
    if (!existsSync(join(dir, 'plan.json'))) throw new Error('plan.json missing — build the project first');
    if (!existsSync(join(dir, 'scene.json'))) console.warn('warning: scene.json missing — rendering an unfurnished shell');
    setStage(name, 'play', 'done');
    startEngine(`?project=${encodeURIComponent(name)}`);
  }));

// ---------- shared assets ----------
const asset = program.command('asset').description('shared asset library (common/)');

interface RegistryEntry { id: string; file: string; tags?: string[]; description?: string; params?: unknown; origin?: string; version?: number }
interface Registry { generators: RegistryEntry[]; materials: RegistryEntry[]; palettes: RegistryEntry[] }
const KINDS = ['generators', 'materials', 'palettes'] as const;
type Kind = (typeof KINDS)[number];
const readReg = (path: string): Registry => JSON.parse(readFileSync(path, 'utf8'));
const writeReg = (path: string, r: Registry) => writeFileSync(path, JSON.stringify(r, null, 2) + '\n');

asset.command('list').description('list shared generators, materials, palettes')
  .option('-t, --tag <tag>').option('-k, --kind <kind>')
  .action(wrap((opts: { tag?: string; kind?: Kind }) => {
    const reg = readReg(join(COMMON, 'registry.json'));
    for (const k of KINDS) {
      if (opts.kind && opts.kind !== k) continue;
      const items = reg[k].filter((e) => !opts.tag || e.tags?.includes(opts.tag));
      console.log(`\n${k} (${items.length})`);
      for (const e of items) console.log(`  ${e.id.padEnd(22)} ${(e.tags ?? []).join(',').padEnd(30)} ${e.description ?? ''}`);
    }
  }));

asset.command('preview <id>').description('turntable preview of one generator; extra params as JSON')
  .option('-p, --params <json>', 'e.g. \'{"seatsX":3,"seatsY":2}\'', '{}')
  .action(wrap((id: string, opts: { params: string }) => {
    JSON.parse(opts.params); // validate early
    startEngine(`preview.html?gen=${encodeURIComponent(id)}&params=${encodeURIComponent(opts.params)}`);
  }));

asset.command('promote <project> <id>').description('move a project-local asset into common/ so every project can reuse it')
  .option('-k, --kind <kind>', 'generators | materials | palettes', 'generators')
  .action(wrap((project: string, id: string, opts: { kind: Kind }) => {
    const pdir = requireProject(project);
    if (!KINDS.includes(opts.kind)) throw new Error(`kind must be one of ${KINDS.join(', ')}`);
    const localRegPath = join(pdir, 'assets', 'registry.json');
    const localReg = readReg(localRegPath);
    const entry = localReg[opts.kind].find((e) => e.id === id);
    if (!entry) throw new Error(`${id} not in ${relative(ROOT, localRegPath)} (${opts.kind})`);
    const commonRegPath = join(COMMON, 'registry.json');
    const commonReg = readReg(commonRegPath);
    if (commonReg[opts.kind].some((e) => e.id === id)) throw new Error(`common already has ${opts.kind}/${id} — rename or bump version instead`);
    const from = join(pdir, 'assets', entry.file);
    const to = join(COMMON, opts.kind, entry.file);
    if (existsSync(to)) throw new Error(`${relative(ROOT, to)} already exists`);
    renameSync(from, to);
    commonReg[opts.kind].push({ ...entry, origin: project });
    localReg[opts.kind] = localReg[opts.kind].filter((e) => e.id !== id);
    writeReg(commonRegPath, commonReg);
    writeReg(localRegPath, localReg);
    console.log(`Promoted ${opts.kind}/${id} -> ${relative(ROOT, to)}`);
    console.log(`Update references in ${project}/scene.json from "local:${id}" to "${id}".`);
  }));

asset.command('index [project]').description('regenerate registry.json from generator code (common/, or a project\'s assets/)')
  .action(wrap((project?: string) => {
    const args = [join(ENGINE, 'scripts', 'index-assets.mjs')];
    if (project) args.push(join(requireProject(project), 'assets'));
    const r = spawnSync(process.execPath, args, { cwd: ENGINE, stdio: 'inherit' });
    process.exitCode = r.status ?? 1;
  }));

asset.command('check').description('verify registry.json matches the files on disk')
  .action(wrap(() => {
    const reg = readReg(join(COMMON, 'registry.json'));
    let bad = 0;
    for (const k of KINDS) {
      for (const e of reg[k]) {
        if (!existsSync(join(COMMON, k, e.file))) { console.log(`missing file: ${k}/${e.file} (${e.id})`); bad++; }
      }
      const listed = new Set(reg[k].map((e) => e.file));
      for (const f of existsSync(join(COMMON, k)) ? readdirSync(join(COMMON, k)) : []) {
        if (/^(_|index\.|lib\/?)/.test(f) || statSync(join(COMMON, k, f)).isDirectory()) continue;
        if (!listed.has(f)) { console.log(`unregistered: ${k}/${f}`); bad++; }
      }
    }
    console.log(bad ? `${bad} problem(s)` : 'registry OK');
    process.exitCode = bad ? 1 : 0;
  }));

program.command('fetch-assets').description('download pinned CC0 textures / HDRIs listed in common/sources.json')
  .option('--force', 're-download existing files')
  .action(wrap(async (opts: { force?: boolean }) => {
    const sources: { dest: string; url: string; license?: string }[] = JSON.parse(readFileSync(join(COMMON, 'sources.json'), 'utf8')).files;
    let ok = 0, skip = 0, fail = 0;
    for (const s of sources) {
      const dest = join(COMMON, s.dest);
      if (existsSync(dest) && !opts.force) { skip++; continue; }
      try {
        const res = await fetch(s.url, { headers: { 'User-Agent': 'vishwakarma-ai/0.1' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
        console.log(`ok    ${s.dest}`);
        ok++;
      } catch (e) {
        console.log(`FAIL  ${s.dest}  ${(e as Error).message}`);
        fail++;
      }
    }
    console.log(`${ok} downloaded, ${skip} already present, ${fail} failed`);
    if (fail) console.log('Missing textures fall back to flat palette colours in the engine.');
  }));

// ---------- environment ----------
program.command('setup').description('create the Python venv and install pipeline deps')
  .action(wrap(() => {
    if (!existsSync(VENV)) {
      const py = process.platform === 'win32' ? 'python' : 'python3';
      const r = spawnSync(py, ['-m', 'venv', VENV], { stdio: 'inherit' });
      if (r.status !== 0) throw new Error('failed to create venv');
    }
    const r = spawnSync(PYTHON, ['-m', 'pip', 'install', '-r', join(PIPELINE, 'requirements.txt')], { stdio: 'inherit' });
    process.exitCode = r.status ?? 1;
  }));

program.command('doctor').description('check the toolchain').action(wrap(() => {
  const checks: [string, boolean, string][] = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push(['node >= 20', nodeMajor >= 20, process.versions.node]);
  checks.push(['python venv', existsSync(PYTHON), existsSync(PYTHON) ? relative(ROOT, PYTHON) : 'run: vk setup']);
  if (existsSync(PYTHON)) {
    const r = spawnSync(PYTHON, ['-c', 'import fitz,cv2,matplotlib,shapely,jsonschema,numpy;print("ok")'], { encoding: 'utf8' });
    checks.push(['python deps', r.stdout.trim() === 'ok', r.stdout.trim() === 'ok' ? 'ok' : 'run: vk setup']);
  }
  const hasVite = existsSync(join(ROOT, 'node_modules', 'vite'));
  checks.push(['engine deps', hasVite, hasVite ? 'ok' : 'run: npm install']);
  checks.push(['common/registry.json', existsSync(join(COMMON, 'registry.json')), '']);
  const hdris = existsSync(join(COMMON, 'hdri')) ? readdirSync(join(COMMON, 'hdri')).filter((f) => f.endsWith('.hdr')).length : 0;
  checks.push(['CC0 assets fetched', hdris > 0, hdris > 0 ? `${hdris} hdri` : 'optional: vk fetch-assets']);
  for (const [label, ok, info] of checks) console.log(`${ok ? '✔' : '✘'} ${label.padEnd(22)} ${info}`);
  process.exitCode = checks.slice(0, 4).every((c) => c[1]) ? 0 : 1;
}));

program.parseAsync();
