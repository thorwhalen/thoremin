/**
 * The musical context on the score player, in a real browser against the built bundle (#934): the
 * instrument's scale follows a modulating score and changes on the bar line. The walk a player
 * takes: Tap to play, Edit the instrument, Music: Scale from the music playing, Conductor: the
 * Modulation study, then the Conductor tool's Start conducting with the synthetic hand beating time
 * (`synthetic.conduct=1`, 80 beats a minute). Every animation frame the page records the musical
 * context's position (song seconds, the score at its marked 96 bpm: bar 5 at 10 s, bar 9 at 20 s)
 * and the scale the instrument plays (the interposer on the bridge's scales, fitted as the key's own
 * seven notes); before bar 5 it must be C major, after it G major, and after bar 9 F major.
 */
import { test, expect, type Page } from '@playwright/test';

const SYNTHETIC = '?slot.source=synthetic-hands&synthetic.conduct=1';

async function openSection(page: Page, name: string) {
  const section = page.locator(`details[data-section="${name}"]`);
  if (!(await section.evaluate((d) => (d as HTMLDetailsElement).open))) await section.locator('> summary').click();
  return section;
}

interface Sample {
  position: number;
  pcs: number[];
}

/** Record the context's position and the right hand's scale on every frame until `toS`. */
function record(page: Page, toS: number, timeoutMs: number): Promise<Sample[]> {
  return page.evaluate(
    ({ toS, timeoutMs }) =>
      new Promise<Sample[]>((resolve) => {
        const samples: Sample[] = [];
        const start = performance.now();
        const step = () => {
          const t = window.thoremin!;
          const status = t.getOutput('musicContext', 'status') as { active: boolean; moving: boolean; position: number } | undefined;
          const scale = t.getOutput('musicScale', 'scaleRight') as number[] | undefined;
          if (status?.active && status.moving && scale) samples.push({ position: status.position, pcs: [...new Set(scale.map((n) => ((n % 12) + 12) % 12))].sort((a, b) => a - b) });
          if ((samples.length && samples[samples.length - 1].position >= toS) || performance.now() - start > timeoutMs) resolve(samples);
          else requestAnimationFrame(step);
        };
        step();
      }),
    { toS, timeoutMs },
  );
}

const C = [0, 2, 4, 5, 7, 9, 11];
const G = [0, 2, 4, 6, 7, 9, 11];
const F = [0, 2, 4, 5, 7, 9, 10];
/** A frame this close to a bar line may read either side of it (the readings are a frame apart). */
const EDGE_S = 0.1;

test('a modulating score switches the instrument scale on its bar lines', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(SYNTHETIC);
  await page.getByRole('button', { name: /tap to play/i }).click({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: /tap to play/i })).toBeHidden();

  // The instrument's editor: its scale follows the music; the piece is the study.
  await page.getByRole('button', { name: 'Edit Pentatonic', exact: true }).click();
  const music = await openSection(page, 'Music');
  await music.getByLabel('Scale from').selectOption('music');
  // The key's own seven notes, so what is expected does not depend on the instrument's own scale.
  await music.getByLabel('Fit to the key').selectOption('key');
  const conductor = await openSection(page, 'Conductor');
  await conductor.getByLabel('Piece').selectOption('modulation-study');

  // The Conductor tool: start, and the synthetic hand beats time.
  await page.locator('[data-tools-bar] [data-tool="conductor"]').click();
  await page.getByRole('button', { name: 'Start conducting' }).click();
  await expect.poll(() => page.evaluate(() => (window.thoremin!.getOutput('musicContext', 'status') as { active?: boolean } | undefined)?.active ?? false), { timeout: 30_000 }).toBe(true);

  const samples = await record(page, 21, 80_000);
  const before5 = samples.filter((s) => s.position < 10 - EDGE_S);
  const after5 = samples.filter((s) => s.position > 10 + EDGE_S && s.position < 20 - EDGE_S);
  const after9 = samples.filter((s) => s.position > 20 + EDGE_S);
  expect(before5.length, 'frames before bar 5').toBeGreaterThan(10);
  expect(after5.length, 'frames in bars 5 to 8').toBeGreaterThan(10);
  expect(after9.length, 'frames after bar 9').toBeGreaterThan(0);
  expect(before5.filter((s) => JSON.stringify(s.pcs) !== JSON.stringify(C)), 'C major before bar 5').toEqual([]);
  expect(after5.filter((s) => JSON.stringify(s.pcs) !== JSON.stringify(G)), 'G major in bars 5 to 8').toEqual([]);
  expect(after9.filter((s) => JSON.stringify(s.pcs) !== JSON.stringify(F)), 'F major from bar 9').toEqual([]);
  await expect(music.getByTestId('music-context-readout')).toHaveAttribute('data-owns', 'yes');
  expect(errors).toEqual([]);
});
