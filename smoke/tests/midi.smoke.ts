/**
 * MIDI in a real browser, both ways, through a stand-in device (`fakeMidi.ts`: headless Chromium
 * has none):
 *
 * - out: an instrument with "Send to MIDI output" ticked (Edit, the MIDI section, the way a player
 *   turns it on) sends note-ons to the port, and the notes change as the synthetic hand sweeps;
 * - in: Play Along (MIDI) plays the chord a keyboard holds: C-E-G lights C and sounds, A-C-E then
 *   lights Am; with no key held and no hand, it is silent.
 */
import { test, expect } from '@playwright/test';
import { installAudioTap, listen, hear } from '../helpers/audioTap';
import { installFakeMidi, noteOns } from '../helpers/fakeMidi';
import { boot, bootUrl, collectErrors, play } from '../helpers/boot';
import { HEARING } from '../helpers/seedBehaviour';

test('MIDI out: the instrument sends the notes the moving hand plays', async ({ page }) => {
  const errors = collectErrors(page);
  await installFakeMidi(page);
  await boot(page, bootUrl({ hands: 'synthetic' }));
  await play(page, 'Pentatonic');
  await page.getByRole('button', { name: 'Edit Pentatonic', exact: true }).click();
  const section = page.locator('details[data-section="MIDI"]');
  if (!(await section.evaluate((d) => (d as HTMLDetailsElement).open))) await section.locator('> summary').click();
  await section.getByLabel('Send to MIDI output').check();
  // The stand-in port is offered once the output has opened.
  await expect(section.locator('option', { hasText: 'Smoke MIDI out' })).toHaveCount(1, { timeout: 15_000 });
  await page.evaluate(() => window.__smokeMidi!.clear());
  await page.waitForTimeout(4_000);
  const notes = noteOns(await page.evaluate(() => window.__smokeMidi!.sent()));
  expect(notes.length, 'note-ons sent').toBeGreaterThanOrEqual(3);
  expect(new Set(notes).size, `distinct notes as the hand sweeps: ${notes.join(',')}`).toBeGreaterThanOrEqual(3);
  expect(errors).toEqual([]);
});

test('MIDI in: Play Along (MIDI) plays the chord the keyboard holds', async ({ page }) => {
  const errors = collectErrors(page);
  await installFakeMidi(page);
  await installAudioTap(page);
  await boot(page, bootUrl({ hands: 'none' }));
  await play(page, 'Play Along (MIDI)');
  const chord = () => page.evaluate(() => (window.thoremin!.getOutput('chordMap', 'status') as { chord?: string | null } | undefined)?.chord ?? null);

  await page.waitForTimeout(HEARING.settleMs);
  expect(hear(await listen(page, { forMs: HEARING.quietMs }), HEARING.floor).loudest, 'no key held: silent').toBeLessThan(HEARING.floor);

  await page.evaluate(() => [60, 64, 67].forEach((n) => window.__smokeMidi!.noteOn(n)));
  await expect.poll(chord, { timeout: 10_000 }).toBe('C');
  const held = hear(await listen(page, { forMs: 2_000 }), HEARING.floor);
  expect(held.sounding, `C held: ${JSON.stringify(held)}`).toBeGreaterThanOrEqual(HEARING.sounding);

  await page.evaluate(() => {
    [60, 64, 67].forEach((n) => window.__smokeMidi!.noteOff(n));
    [57, 60, 64].forEach((n) => window.__smokeMidi!.noteOn(n));
  });
  await expect.poll(chord, { timeout: 10_000 }).toBe('Am');
  expect(errors).toEqual([]);
});
