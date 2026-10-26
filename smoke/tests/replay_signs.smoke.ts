/**
 * The sign instruments in a real browser, on a REAL signer: the stability harness's signer
 * (`test/fixtures/real_hands_signs`, SignAlphaSet, CC BY 4.0) replayed into the app through the
 * Replay tool's `?replay=` link, in place of the camera. The seed sweep marks these seeds silent
 * (the synthetic hand signs nothing); here each must play chords the signer signs, and hold them:
 * no chord shorter than a flicker between two others, read off the chord display each frame.
 *
 * The headless numbers for the same stream are `docs/testing/stability.md`; this is the check that
 * the built app, its lazy sign reader and its audio do the same in a browser.
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { boot, collectErrors, play } from '../helpers/boot';

const FIXTURE = join(__dirname, '../../test/fixtures/real_hands_signs/gaps.hands.ndjson.gz');
const SEEDS = ['ASL Chords', 'Sign Map', 'Sign Wheel'] as const;
/** How long each seed is watched: long enough for several signs of the 43 s take. */
const WATCH_MS = 15_000;
/** A chord held for less than this between two others is a flicker (the harness's 200 ms). */
const FLICKER_MS = 200;

/** The chord display's chord, every animation frame for `forMs`, with the page's own clock. */
async function watchChords(page: Page, forMs: number): Promise<{ t: number; chord: string | null; level: number }[]> {
  return page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const out: { t: number; chord: string | null; level: number }[] = [];
        const t0 = performance.now();
        const step = () => {
          const notes = window.thoremin!.getOutput('chordSel', 'chord') as number[] | undefined;
          const chord = notes && notes.length ? [...new Set(notes.map((n) => ((Math.round(n) % 12) + 12) % 12))].sort((a, b) => a - b).join('.') : null;
          out.push({ t: performance.now() - t0, chord, level: window.thoremin!.level() ?? 0 });
          if (performance.now() - t0 < ms) requestAnimationFrame(step);
          else resolve(out);
        };
        requestAnimationFrame(step);
      }),
    forMs,
  );
}

test.describe('the sign instruments on a real signer (replayed)', () => {
  let page: Page;
  let errors: string[];
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    errors = collectErrors(page);
    const body = readFileSync(FIXTURE);
    await page.route('**/smoke-replay/signs.ndjson.gz', (route) => route.fulfill({ status: 200, body, contentType: 'application/octet-stream' }));
    // Camera-free: the replay source in the slot from the start, the recording from the link.
    await boot(page, `?slot.source=replay-hands&replay=${encodeURIComponent('smoke-replay/signs.ndjson.gz')}`);
    await expect.poll(() => page.evaluate(() => !!document.querySelector('[data-running="replay"]')), { timeout: 20_000 }).toBe(true);
  });
  test.afterAll(async () => page.close());

  for (const seed of SEEDS) {
    test(`${seed} plays the signed chords and holds them`, async () => {
      test.setTimeout(WATCH_MS + 60_000);
      await play(page, seed);
      const seen = await watchChords(page, WATCH_MS);
      const chords = new Set(seen.map((s) => s.chord).filter(Boolean));
      // Runs of one chord; a short one between two others is a flicker.
      const runs: { chord: string | null; from: number; to: number }[] = [];
      for (const s of seen) {
        const last = runs[runs.length - 1];
        if (last && last.chord === s.chord) last.to = s.t;
        else runs.push({ chord: s.chord, from: s.t, to: s.t });
      }
      const flickers = runs.slice(1, -1).filter((r, i) => r.chord !== null && runs[i].chord !== null && runs[i + 2].chord !== null && r.to - r.from < FLICKER_MS);
      const said = `${seed}: chords ${[...chords].join(' ')}; runs ${runs.map((r) => `${r.chord ?? '-'}:${Math.round(r.to - r.from)}`).join(' ')}`;
      expect(chords.size, said).toBeGreaterThanOrEqual(2);
      expect(Math.max(...seen.map((s) => s.level)), said).toBeGreaterThan(0.001);
      expect(flickers, said).toEqual([]);
      expect(errors.splice(0)).toEqual([]);
    });
  }
});
