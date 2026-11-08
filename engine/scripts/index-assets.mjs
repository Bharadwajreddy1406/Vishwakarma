// Regenerates registry.json from the code: generator `meta`, material presets, palettes.
// usage: node engine/scripts/index-assets.mjs [projectAssetsDir]
//   no arg     -> common/registry.json
//   with arg   -> <dir>/registry.json for project-local assets (generators only + local materials/palettes)
import { createServer } from 'vite';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE = resolve(fileURLToPath(import.meta.url), '..', '..');
const ROOT = resolve(ENGINE, '..');
const target = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, 'common');
const isCommon = target === join(ROOT, 'common');
const genDir = isCommon ? join(target, 'generators') : target;

const server = await createServer({ root: ENGINE, configFile: join(ENGINE, 'vite.config.ts'), server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
const generators = [];
const problems = [];
try {
  const files = existsSync(genDir) ? readdirSync(genDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts')) : [];
  for (const f of files) {
    try {
      const mod = await server.ssrLoadModule(join(genDir, f));
      const m = mod.meta;
      if (!m?.id || typeof mod.build !== 'function') { problems.push(`${f}: missing meta/build`); continue; }
      if (`${m.id}.ts` !== f) problems.push(`${f}: meta.id "${m.id}" should match the file name`);
      generators.push({ id: m.id, file: f, version: m.version, tags: m.tags, description: m.description, params: m.params, slots: m.slots, ...(m.physics ? { physics: m.physics } : {}) });
    } catch (e) {
      problems.push(`${f}: ${e.message.split('\n')[0]}`);
    }
  }
} finally {
  await server.close();
}

const regPath = join(target, 'registry.json');
const prev = existsSync(regPath) ? JSON.parse(readFileSync(regPath, 'utf8')) : {};
let materials = prev.materials ?? [];
let palettes = prev.palettes ?? [];
if (isCommon) {
  const lib = JSON.parse(readFileSync(join(target, 'materials', 'library.json'), 'utf8'));
  materials = lib.materials.map((m) => ({ id: m.id, file: 'library.json', tags: m.tags ?? [], description: m.description ?? `${m.kind} ${m.color}` }));
  const pdir = join(target, 'palettes');
  palettes = readdirSync(pdir).filter((f) => f.endsWith('.json')).map((f) => {
    const p = JSON.parse(readFileSync(join(pdir, f), 'utf8'));
    return { id: p.id ?? basename(f, '.json'), file: f, description: p.description ?? '' };
  });
}
generators.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(regPath, JSON.stringify({ generators, materials, palettes }, null, 2) + '\n');
console.log(`registry: ${generators.length} generators, ${materials.length} materials, ${palettes.length} palettes -> ${regPath}`);
for (const p of problems) console.log(`  problem: ${p}`);
process.exit(problems.length ? 1 : 0);
