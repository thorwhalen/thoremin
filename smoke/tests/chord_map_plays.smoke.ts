/**
 * The Chord Map PLAYS in a real browser, with no camera (extends `chord_map.smoke.ts`, which pins
 * the grid): the synthetic right hand sweeps across the map, so the hand that points reads a
 * chord at a time. The chord names it reads must be diatonic to C and change as the hand moves;
 * the triad in force is three pitches; the synth is handed voices for them. In Chord Map Strum the
 * strumming needs a second hand, which the synthetic source does not show: it points and reads
 * chords but strums nothing (no phantom strum from one hand).
 */
import { test, expect, type Page } from '@playwright/test';

const DIATONIC = new Set(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'B°']);

async function choose(page: Page, name: string): Promise<void> {
  const row = page.locator(`li[data-instrument="${name}"]`).first();
  if (!(await row.isVisible())) await page.getByPlaceholder(/filter/i).first().fill(name);
  await row.getByRole('button', { name }).first().click();
}

type Status = { play: string; pointing: boolean; chord: string | null; strums: number };

/** Sample the node for `ms`: the chords read, the triads and note events seen. */
async function sample(page: Page, ms: number) {
  const chords = new Set<string>();
  let triads = 0;
  let strums = 0;
  let voiced = 0;
  for (let t = 0; t < ms; t += 100) {
    await page.waitForTimeout(100);
    const r = await page.evaluate(() => ({
      s: window.thoremin!.getOutput('chordMap', 'status') as Status | undefined,
      triad: window.thoremin!.getOutput('chordMap', 'triad') as number[] | undefined,
      params: window.thoremin!.getOutput('chordMap', 'params') as { voices?: unknown[] } | null | undefined,
    }));
    if (r.s?.chord) chords.add(r.s.chord);
    if (r.triad && r.triad.length === 3) triads++;
    strums = Math.max(strums, r.s?.strums ?? 0);
    if ((r.params?.voices?.length ?? 0) > 0) voiced++;
  }
  return { chords, triads, strums, voiced };
}

test('Chord Map reads changing diatonic chords as the hand moves, and voices them', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto('?slot.source=synthetic-hands');
  await expect(page.getByRole('button', { name: /tap to play/i })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: /tap to play/i }).click();
  await choose(page, 'Chord Map');
  await expect.poll(() => page.evaluate(() => (window.thoremin!.getOutput('chordMap', 'status') as Status | undefined)?.pointing), { timeout: 20_000 }).toBe(true);
  const r = await sample(page, 6_000);
  expect(r.chords.size, [...r.chords].join(',')).toBeGreaterThanOrEqual(3);
  for (const c of r.chords) expect(DIATONIC.has(c), `${c} is not diatonic to C`).toBe(true);
  expect(r.triads).toBeGreaterThan(5);
  expect(r.voiced, 'the synth was handed voices for the chord').toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('Chord Map Strum points and reads chords but one hand strums nothing', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('?slot.source=synthetic-hands');
  await expect(page.getByRole('button', { name: /tap to play/i })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: /tap to play/i }).click();
  await choose(page, 'Chord Map Strum');
  await expect.poll(() => page.evaluate(() => (window.thoremin!.getOutput('chordMap', 'status') as Status | undefined)?.play), { timeout: 20_000 }).toBe('strum');
  const r = await sample(page, 4_000);
  expect(r.chords.size).toBeGreaterThanOrEqual(2);
  expect(r.strums).toBe(0);
});
