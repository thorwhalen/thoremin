/**
 * The landing (`index.html`) carries nothing of an app (docs/design/apps.md): no module script, no
 * camera or microphone call, cards that point at real build entries and pictures the build ships;
 * and its one inline script forwards an old link (any query or hash) to the camera app unchanged.
 * The camera app's own page keeps its relative addresses where they were (`<base href="../">`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const ROOT = resolve(__dirname, '..');
const landing = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
const inlineScripts = [...landing.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];

/** Run the landing's inline script against a pretend location; returns where it forwarded, if anywhere. */
function forward(search: string, hash: string): string | null {
  let to: string | null = null;
  const location = { search, hash, replace: (u: string) => void (to = u) };
  for (const [, code] of inlineScripts) runInNewContext(code, { location });
  return to;
}

describe('the landing', () => {
  it('loads no script file and asks for no device', () => {
    expect(landing).not.toMatch(/<script[^>]*\bsrc=/);
    expect(landing).not.toMatch(/type=["']module["']/);
    expect(landing).not.toMatch(/getUserMedia|mediaDevices|mediapipe|tasks-vision/i);
  });

  it('links each card to a build entry, with a picture the build ships', () => {
    const cards = [...landing.matchAll(/<a class="app" data-app="([^"]+)" href="([^"]+)">[\s\S]*?<img src="([^"]+)"/g)];
    expect(cards.map((c) => c[1])).toEqual(['instruments', 'listen']);
    for (const [, , href, img] of cards) {
      expect(existsSync(resolve(ROOT, href, 'index.html')), href).toBe(true);
      expect(existsSync(resolve(ROOT, 'public', img)), img).toBe(true);
    }
    const vite = readFileSync(resolve(ROOT, 'vite.config.ts'), 'utf8');
    expect(vite).toMatch(/instruments: path\.resolve\(__dirname, 'instruments', 'index\.html'\)/);
  });

  it('stays put on a bare arrival', () => {
    expect(forward('', '')).toBeNull();
  });

  it('forwards an old link to the camera app, query and hash intact', () => {
    expect(forward('?slot.source=synthetic-hands', '')).toBe('instruments/?slot.source=synthetic-hands');
    expect(forward('?engine=legacy', '#x')).toBe('instruments/?engine=legacy#x');
    expect(forward('', '#top')).toBe('instruments/#top');
  });
});

describe('the camera app page', () => {
  it('resolves its relative addresses under the site base, as before the move', () => {
    const page = readFileSync(resolve(ROOT, 'instruments', 'index.html'), 'utf8');
    expect(page).toMatch(/<base href="\.\.\/"\s*\/?>/);
    expect(page).toMatch(/<script type="module" src="\/src\/main\.tsx"><\/script>/);
  });
});
