/**
 * The sound mapper's page (`play/sound-mapper.html`, docs/design/apps.md) in a real browser (#866):
 * it loads nothing of the camera app, the audio-input worklet loads from the built bundle,
 * hears the synthetic taps (`?audio.source=synthetic`: seeded modal taps through the same worklet a
 * microphone feeds), is taught one sound from them, and then plays its drum on every tap, a few
 * milliseconds after it, loud enough to hear at the master output.
 */
import { test, expect } from '@playwright/test';
import { installAudioTap, listen, hear } from '../helpers/audioTap';
import { collectErrors } from '../helpers/boot';
import { HEARING } from '../helpers/seedBehaviour';

test('Sound mapper: taught from the taps it hears, it plays its drum on each tap', async ({ page }) => {
  const errors = collectErrors(page);
  await installAudioTap(page);
  const requested: string[] = [];
  page.on('request', (r) => requested.push(r.url()));
  await page.goto('../play/sound-mapper.html?audio.source=synthetic');
  await expect(page.getByRole('heading', { name: 'Sound mapper' })).toBeVisible();
  const panel = page.getByTestId('sound-mapper-panel');
  await expect(panel).toBeVisible();

  await panel.getByRole('button', { name: 'Add a sound' }).click();
  await panel.getByRole('button', { name: 'Teach', exact: true }).click();
  // The synthetic take taps every 0.35 to 0.7 s: six taught taps in a few seconds.
  await expect.poll(async () => Number((await panel.getByTestId('sound-class-count').textContent())?.split(' ')[0] ?? 0), { timeout: 20_000 }).toBeGreaterThanOrEqual(6);
  // Teaching is silent: taps are examples, not notes.
  expect(hear(await listen(page, { forMs: 1_500 }), HEARING.floor).loudest, 'teaching is silent').toBeLessThan(HEARING.floor);
  await panel.getByRole('button', { name: 'Done' }).click();

  await panel.getByRole('button', { name: 'Play' }).click();
  const hit = panel.getByTestId('sound-hit');
  await expect(hit).toBeVisible({ timeout: 10_000 });
  const heard = hear(await listen(page, { forMs: 3_000 }), HEARING.floor);
  expect(heard.sounding, `the drums sound: ${JSON.stringify(heard)}`).toBeGreaterThanOrEqual(HEARING.sounding);
  const ms = Number((await hit.getByTestId('sound-hit-ms').textContent())?.replace(' ms', ''));
  expect(ms, 'tap to drum inside the app').toBeLessThan(8);

  await panel.getByRole('button', { name: 'Stop' }).click();
  // Nothing of the camera app: no app entry, no shell, no hand or face model.
  const app = requested.filter((u) => /\/assets\/(index|instruments|App|vision_bundle|lazy_ui|main)-/.test(u) || /mediapipe|\.task$|\.wasm$/.test(u));
  expect(app).toEqual([]);
  expect(errors).toEqual([]);
});
