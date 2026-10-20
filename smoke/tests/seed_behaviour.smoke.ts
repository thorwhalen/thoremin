/**
 * Every shipped instrument PLAYS, in a real browser, under the synthetic sources: the sound comes
 * from the hand and follows it (the seed sweep, `seeds.smoke.ts`, asks only that a seed loads and is
 * not silent right after the switch).
 *
 * Two pages, one instrument after another (a boot per instrument would cost a minute each):
 *
 * - with the synthetic hand (sweeping, or striking / beating time where the seed needs it,
 *   `SEED_PLAY`), every seed the manifest does not mark silent sounds for most of what is heard,
 *   and its spectral shape changes as the hand moves; a struck one hits again and again;
 * - with no hand at all (the replay source with nothing to replay: the graph composes and ticks,
 *   nobody is in view), every one of those seeds is silent. That pair is what says the sound is the
 *   hand's: an instrument that drones on its own, or holds a note with nobody there, fails here.
 *
 * What is heard is everything the page sends to its speakers (`audioTap.ts`), not only the master
 * gain, so a sink connected straight to the destination is heard too.
 */
import { test, expect, type Page } from '@playwright/test';
import manifest from '../seed_instruments.json';
import { installAudioTap, listen, hear, onsets, watchPeaks } from '../helpers/audioTap';
import { boot, bootUrl, collectErrors, play, type HandSource } from '../helpers/boot';
import { HEARING, SEED_PLAY } from '../helpers/seedBehaviour';

type Seed = { name: string; body: boolean; silent?: string };
const seeds = (manifest.seeds as Seed[]).filter((s) => !s.silent);

/** One page per address (hand source, body, extra query), its seeds played in turn. */
function group(hands: HandSource, list: Seed[]): Map<string, Seed[]> {
  const out = new Map<string, Seed[]>();
  for (const s of list) {
    const url = bootUrl({ hands, body: s.body, extra: hands === 'synthetic' ? SEED_PLAY[s.name]?.extra : undefined });
    out.set(url, [...(out.get(url) ?? []), s]);
  }
  return out;
}

for (const hands of ['synthetic', 'none'] as const) {
  for (const [url, list] of group(hands, seeds)) {
    test.describe(`${hands === 'synthetic' ? 'with the synthetic hand' : 'with no hand'} (${url})`, () => {
      let page: Page;
      let errors: string[];
      test.beforeAll(async ({ browser }) => {
        page = await browser.newPage();
        errors = collectErrors(page);
        await installAudioTap(page);
        await boot(page, url);
      });
      test.afterAll(async () => page.close());

      for (const seed of list) {
        const how = SEED_PLAY[seed.name]?.check;
        const title = hands === 'none' ? `${seed.name} is silent with nobody in view` : how === 'hits' ? `${seed.name} hits on every stroke` : `${seed.name} sounds and follows the moving hand`;
        test(title, async () => {
          await play(page, seed.name);
          await page.waitForTimeout(HEARING.settleMs);
          if (hands === 'synthetic' && how === 'hits') {
            const peaks = await watchPeaks(page, { forMs: HEARING.playMs });
            const loudest = peaks.reduce((m, p) => Math.max(m, p), 0);
            expect(onsets(peaks, HEARING.floor), `${seed.name}: loudest ${loudest.toFixed(4)} over ${peaks.length} peaks`).toBeGreaterThanOrEqual(HEARING.hits);
            expect(errors.splice(0)).toEqual([]);
            return;
          }
          const readings = await listen(page, { forMs: hands === 'none' ? HEARING.quietMs : HEARING.playMs });
          const h = hear(readings, HEARING.floor);
          const said = `${seed.name}: ${JSON.stringify(h)}`;
          if (hands === 'none') {
            expect(h.loudest, said).toBeLessThan(HEARING.floor);
          } else {
            expect(h.sounding, said).toBeGreaterThanOrEqual(HEARING.sounding);
            expect(h.shapeFlux, said).toBeGreaterThanOrEqual(HEARING.shapeFlux);
          }
          expect(errors.splice(0)).toEqual([]);
        });
      }
    });
  }
}
