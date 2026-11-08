import { defineConfig, type Plugin } from 'vite';
import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const ROOT = resolve(__dirname, '..');
const PROJECTS = join(ROOT, 'projects');
const COMMON = join(ROOT, 'common');

const MIME: Record<string, string> = {
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.hdr': 'application/octet-stream', '.glb': 'model/gltf-binary', '.ktx2': 'image/ktx2', '.exr': 'application/octet-stream',
};

/**
 * Serves workspace data to the browser:
 *   /vk/projects/<name>/...  -> projects/<name>/...   (plan.json, scene.json, input images)
 *   /vk/common/...           -> common/...            (materials, palettes, textures, hdri, models)
 * and live-reloads the page when Claude edits plan.json / scene.json / common JSON.
 */
function vkData(): Plugin {
  const mounts: [string, string][] = [['/vk/projects/', PROJECTS], ['/vk/common/', COMMON]];
  let suppressReloadUntil = 0;
  return {
    name: 'vk-data',
    configureServer(server) {
      // editor saves: POST /vk/save/projects/<name>/scene.json  (only scene.json files inside projects/)
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'POST' || !req.url?.startsWith('/vk/save/')) return next();
        const rel = decodeURIComponent(req.url.slice('/vk/save/'.length).split('?')[0]);
        if (!/^projects\/[a-z0-9][a-z0-9-_]*\/scene\.json$/.test(rel)) {
          res.statusCode = 403;
          return res.end('only projects/<name>/scene.json can be saved');
        }
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 5e6) req.destroy(); });
        req.on('end', () => {
          try {
            const json = JSON.parse(body);
            suppressReloadUntil = Date.now() + 2000; // the page that saved already shows the change
            writeFileSync(join(ROOT, rel), JSON.stringify(json, null, 1) + '\n');
            res.setHeader('Content-Type', 'application/json');
            res.end('{"ok":true}');
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
      });
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0]);
        for (const [prefix, dir] of mounts) {
          if (!url.startsWith(prefix)) continue;
          const file = normalize(join(dir, url.slice(prefix.length)));
          if (!file.startsWith(dir + sep) || !existsSync(file) || !statSync(file).isFile()) {
            res.statusCode = 404;
            return res.end('not found');
          }
          res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
          res.setHeader('Cache-Control', 'no-cache');
          return createReadStream(file).pipe(res);
        }
        next();
      });
      server.watcher.add([join(PROJECTS, '*/plan.json'), join(PROJECTS, '*/scene.json'), join(COMMON, '**/*.json')]);
      server.watcher.on('change', (f) => {
        if (Date.now() < suppressReloadUntil) return;
        if (f.endsWith('.json') && (f.startsWith(PROJECTS) || f.startsWith(COMMON))) {
          server.ws.send({ type: 'full-reload' });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [vkData()],
  resolve: {
    alias: { '@common': COMMON },
    dedupe: ['three'],
  },
  server: {
    port: 5173,
    fs: { allow: [ROOT] },
  },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
  build: {
    target: 'es2022',
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), preview: resolve(__dirname, 'preview.html') } },
  },
});
