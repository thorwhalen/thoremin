/**
 * Regenerate the player guide's pictures and clips from the app itself (`npm run guide:media`).
 *
 * Playwright drives the BUILT app (run `npm run build` first) on the synthetic sources, never a
 * real person: `?slot.source=synthetic-hands`, `slot.body=synthetic-body` where an instrument
 * composes the body, `?carve.source=synthetic` for the carve tools. For every instrument page in
 * `guide/instruments/` and every tool page in `guide/tools/` it writes `public/guide/media/<slug>.jpg`
 * (instruments) or `tool-<id>.jpg` (tools); a scene with `"clip": true` in `guide_scenes.json` also gets
 * a short silent `<slug>.webm` (needs ffmpeg; `--no-clips` skips them). The pages pick the files up by
 * name (`scripts/lib_guide.ts`); `test/guide_coverage.test.ts` fails when a page has no picture.
 *
 * Usage (from the repo root, after `npm run build`):
 *   npm run guide:media                       all scenes
 *   npm run guide:media -- --only "Air Drum"  just those (`home`, instrument names or `tool:<id>`)
 *   npm run guide:media -- --port 4392 --no-clips
 *
 * The scenes' knobs are data (`smoke/guide_scenes.json`): per instrument or `tool:<id>` entry, `ms` (settle
 * time before the picture), `body` (add the synthetic body), `query` (extra query), `clip`, `clipMs`.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'smoke', 'package.json'));
const { chromium } = require('@playwright/test');

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const PORT = Number(opt('port', '4392'));
const ONLY = args.flatMap((a, i) => (args[i - 1] === '--only' ? [a] : []));
const CLIPS = !flag('no-clips');
const BASE = `http://localhost:${PORT}/thoremin/`;
const OUT = join(ROOT, 'public', 'guide', 'media');
const VIEW = { width: 960, height: 600 };
const JPEG_QUALITY = 68;

const slug = (n) => n.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const front = (file) => Object.fromEntries([...readFileSync(file, 'utf8').split('\n---')[0].matchAll(/^([A-Za-z][\w-]*):\s*(.+)$/gm)].map((m) => [m[1], m[2].trim()]));
const scenes = existsSync(join(ROOT, 'smoke', 'guide_scenes.json')) ? JSON.parse(readFileSync(join(ROOT, 'smoke', 'guide_scenes.json'), 'utf8')) : {};
const SCENE_DEFAULT = { ms: 3500, body: false, query: '', clip: false, clipMs: 3500 };

const dir = (d) => join(ROOT, 'guide', d);
const instruments = readdirSync(dir('instruments')).filter((f) => f.endsWith('.md')).map((f) => front(join(dir('instruments'), f)).seed);
const tools = readdirSync(dir('tools')).filter((f) => f.endsWith('.md')).map((f) => front(join(dir('tools'), f)).tool);
const wanted = (key) => ONLY.length === 0 || ONLY.includes(key);

mkdirSync(OUT, { recursive: true });

// The built app, served the way CI serves it.
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
const stop = () => server.kill();
process.on('exit', stop);
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(BASE)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });

async function boot(context, query) {
  const page = await context.newPage();
  await page.goto(`${BASE}?${query}`);
  const tap = page.getByRole('button', { name: /tap to play/i });
  await tap.waitFor({ timeout: 60_000 });
  await tap.click();
  return page;
}

/** The instruments panel covers the picture: close it (the instrument stays chosen). */
async function closeInstruments(page) {
  const close = page.getByRole('button', { name: 'Close', exact: true }).first();
  if (await close.isVisible()) await close.click();
}

async function openInstrument(page, name) {
  const row = page.locator(`li[data-instrument="${name}"]`).first();
  if (!(await row.isVisible())) await page.getByPlaceholder(/filter/i).first().fill(name);
  await row.getByRole('button', { name }).first().click();
  await closeInstruments(page);
}

async function openTool(page, id) {
  if (id === 'record') return void (await page.getByRole('button', { name: 'Record' }).click());
  if (id === 'annotations') return void (await page.getByRole('button', { name: 'Annotation mode' }).click());
  const pinned = page.locator(`[data-tools-bar] [data-tool="${id}"]`);
  if (await pinned.count()) return void (await pinned.first().click());
  await page.locator('[data-tools-launcher]').click();
  await page.locator(`[data-launcher-tool="${id}"]`).locator('button').first().click();
}

async function shoot(page, file) {
  await page.screenshot({ path: join(OUT, file), type: 'jpeg', quality: JPEG_QUALITY });
}

/** Record `ms` of the same scene as a silent webm, then shrink it with ffmpeg. */
async function clip(name, queryFor, act, ms, file) {
  const tmp = mkdtempSync(join(tmpdir(), 'guide-clip-'));
  const context = await browser.newContext({ viewport: { width: 640, height: 400 }, recordVideo: { dir: tmp, size: { width: 640, height: 400 } } });
  const page = await boot(context, queryFor);
  await act(page);
  await page.waitForTimeout(ms);
  await context.close();
  const raw = join(tmp, readdirSync(tmp).find((f) => f.endsWith('.webm')));
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', raw, '-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '40', '-vf', 'fps=12', join(OUT, file)]);
  rmSync(tmp, { recursive: true, force: true });
}

let n = 0;
try {
  if (wanted('home')) {
    const context = await browser.newContext({ viewport: VIEW });
    const page = await boot(context, 'slot.source=synthetic-hands');
    await page.waitForTimeout(2500);
    await shoot(page, 'home.jpg');
    await context.close();
    console.log('guide:media home');
    n++;
  }
  for (const name of instruments) {
    if (!wanted(name)) continue;
    const s = { ...SCENE_DEFAULT, ...(scenes[name] ?? {}) };
    const query = `slot.source=synthetic-hands${s.body ? '&slot.body=synthetic-body' : ''}${s.query ? '&' + s.query : ''}`;
    const act = async (page) => openInstrument(page, name);
    const context = await browser.newContext({ viewport: VIEW });
    const page = await boot(context, query);
    await act(page);
    await page.waitForTimeout(s.ms);
    await shoot(page, `${slug(name)}.jpg`);
    await context.close();
    if (CLIPS && s.clip) await clip(name, query, act, s.clipMs, `${slug(name)}.webm`);
    console.log(`guide:media ${name}`);
    n++;
  }
  for (const id of tools) {
    if (!wanted(`tool:${id}`)) continue;
    const s = { ...SCENE_DEFAULT, ...(scenes[`tool:${id}`] ?? {}) };
    const query = `slot.source=synthetic-hands&carve.source=synthetic${s.body ? '&slot.body=synthetic-body' : ''}${s.query ? '&' + s.query : ''}`;
    const context = await browser.newContext({ viewport: VIEW });
    const page = await boot(context, query);
    await closeInstruments(page);
    await openTool(page, id);
    await page.waitForTimeout(s.ms);
    await shoot(page, `tool-${slug(id)}.jpg`);
    await context.close();
    console.log(`guide:media tool:${id}`);
    n++;
  }
} finally {
  await browser.close();
  stop();
}
console.log(`guide:media ${n} scenes -> public/guide/media`);
