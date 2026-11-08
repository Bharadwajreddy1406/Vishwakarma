// Headless smoke test: loads a project in Chrome/Edge via the running dev server, collects console
// errors, and saves screenshots from a few viewpoints.
// usage: node engine/scripts/smoke.mjs <project> <outDir> [viewsJson]
//   viewsJson: [{"name":"living","pos":[1.5,2.5],"heading":0,"pitch":-5,"view":"fpp","ceilings":1,"openAll":false}]
// requires: dev server on :5173 (npm run dev -w engine)
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [project, outDir, viewsArg] = process.argv.slice(2);
if (!project || !outDir) {
  console.error('usage: node engine/scripts/smoke.mjs <project> <outDir> [viewsJson]');
  process.exit(1);
}
const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const executablePath = process.env.CHROME_PATH ?? BROWSERS.find((p) => existsSync(p));
const views = viewsArg ? JSON.parse(viewsArg) : [{ name: 'spawn', view: 'tpp' }, { name: 'dollhouse', view: 'tpp', ceilings: 0, pitch: -60 }];
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath, headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,800'],
  defaultViewport: { width: 1280, height: 800 },
});
const errors = [];
let failed = false;
try {
  for (const v of views) {
    const page = await browser.newPage();
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${v.name}] ${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => { errors.push(`[${v.name}] pageerror: ${e.message}`); failed = true; });
    const qs = new URLSearchParams({ project, autoplay: '1', quality: v.quality ?? 'medium' });
    if (v.avatar) qs.set('avatar', v.avatar);
    if (v.vp) qs.set('vp', String(v.vp));
    if (v.time !== undefined) qs.set('time', String(v.time));
    if (v.pos) qs.set('pos', v.pos.join(','));
    if (v.heading !== undefined) qs.set('heading', String(v.heading));
    if (v.pitch !== undefined) qs.set('pitch', String(v.pitch));
    if (v.view) qs.set('view', v.view);
    if (v.ceilings === 0) qs.set('ceilings', '0');
    if (v.overview) qs.set("overview", "1");
    if (v.orbit !== undefined) qs.set("orbit", String(v.orbit));
    await page.goto(`http://localhost:5173/?${qs}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(
      '(window.__vk && window.__vk.ready) || document.getElementById("status").classList.contains("error")', { timeout: 240000 },
    ).catch(() => { failed = true; });
    if (await page.$eval('#status', (e) => e.classList.contains('error'))) failed = true;
    if (v.openAll) await page.evaluate(() => window.__vk.openAll());
    if (v.eval) await page.evaluate(v.eval);
    if (v.report) console.log('report', JSON.stringify(await page.evaluate(v.report)));
    await new Promise((r) => setTimeout(r, v.wait ?? 2500));
    const status = await page.$eval('#status', (e) => e.textContent).catch(() => '');
    const file = join(outDir, `${v.name}.png`);
    await page.screenshot({ path: file });
    console.log(`shot ${file}   status: ${status}`);
    await page.close();
  }
} finally {
  await browser.close();
}
const uniq = [...new Set(errors)];
for (const e of uniq.slice(0, 40)) console.log(e);
console.log(failed ? 'SMOKE FAILED' : `SMOKE OK (${uniq.length} console warnings/errors)`);
process.exit(failed ? 1 : 0);
