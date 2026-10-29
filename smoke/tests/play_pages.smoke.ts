/**
 * The standalone game pages (`play/`) in a real browser against the built bundle: Match the Note
 * (and each field game: Pop the Notes, the Pitch Maze, Vowels) opens its own page, takes the synthetic sound (`?audio.source=synthetic`, no microphone), goes
 * live, draws its stage and runs; and it never requests the app (its entry, the shell, the
 * camera models): the runtime half of `scripts/check_play_bundle.ts`.
 */
import { test, expect } from '@playwright/test';
import { collectErrors } from '../helpers/boot';

type PlayHook = { view(): { title?: string; phase?: string } | null; mic(): string };

test('Match the Note runs on its own page, without the app', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  const requested: string[] = [];
  page.on('request', (r) => requested.push(r.url()));
  await page.goto('../play/match-the-note.html?audio.source=synthetic');
  await expect(page.getByRole('heading', { name: 'Match the Note' })).toBeVisible();
  await page.getByRole('button', { name: 'Start' }).click();
  const hook = () => page.evaluate(() => (window as unknown as { thoreminPlay: PlayHook }).thoreminPlay.mic());
  await expect.poll(hook, { timeout: 15_000 }).toBe('live');
  await expect.poll(() => page.evaluate(() => (window as unknown as { thoreminPlay: PlayHook }).thoreminPlay.view()?.phase), { timeout: 10_000 }).toBe('playing');
  expect(await page.evaluate(() => (window as unknown as { thoreminPlay: PlayHook }).thoreminPlay.view()?.title)).toBe('Find the notes of C major');
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  // Nothing of the app: no app entry, no shell, no hand or face model, no extension chunk.
  const app = requested.filter((u) => /\/assets\/(index|instruments|App|vision_bundle|lazy_ui|main)-/.test(u) || /mediapipe|\.task$|\.wasm$/.test(u));
  expect(app).toEqual([]);
  expect(errors).toEqual([]);
});

for (const [file, heading, hint] of [
  ['pop-the-notes', 'Pop the Notes', 'Sing louder to go up, softer to go down.'],
  ['pitch-maze', 'Pitch Maze', 'Hold the note of the opening until the ball is through.'],
  ['vowels', 'Vowels', 'Say a long vowel. Touch the chart to hear one.'],
] as const) {
  test(`${heading} runs on its own page, without the app`, async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    const requested: string[] = [];
    page.on('request', (r) => requested.push(r.url()));
    await page.goto(`../play/${file}.html?audio.source=synthetic`);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await page.getByRole('button', { name: 'Start' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { thoreminPlay: PlayHook }).thoreminPlay.mic()), { timeout: 15_000 }).toBe('live');
    await expect.poll(() => page.evaluate(() => (window as unknown as { thoreminPlay: PlayHook }).thoreminPlay.view()?.phase), { timeout: 10_000 }).toBe('playing');
    expect(await page.evaluate(() => (window as unknown as { thoreminPlay: { view(): { hint?: string } } }).thoreminPlay.view()?.hint)).toBe(hint);
    const app = requested.filter((u) => /\/assets\/(index|instruments|App|vision_bundle|lazy_ui|main)-/.test(u) || /mediapipe|\.task$|\.wasm$/.test(u));
    expect(app).toEqual([]);
    expect(errors).toEqual([]);
  });
}

// The timed games and the timing take: each page goes live and starts its count-in.
for (const [file, heading] of [
  ['sing-along', 'Sing Along'],
  ['play-along', 'Play Along Lessons'],
  ['audio-timing', 'Audio timing'],
] as const) {
  test(`${heading} runs on its own page, without the app`, async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await page.goto(`../play/${file}.html?audio.source=synthetic`);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await page.getByRole('button', { name: 'Start' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { thoreminPlay: PlayHook }).thoreminPlay.mic()), { timeout: 15_000 }).toBe('live');
    await expect.poll(() => page.evaluate(() => (window as unknown as { thoreminPlay: PlayHook }).thoreminPlay.view()?.phase), { timeout: 10_000 }).toMatch(/count-in|playing/);
    expect(errors).toEqual([]);
  });
}

test('the funfon home links every game', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('../play/');
  await expect(page).toHaveTitle('funfon');
  await page.getByRole('link', { name: /Vowels/ }).click();
  await expect(page.getByRole('heading', { name: 'Vowels' })).toBeVisible();
  expect(errors).toEqual([]);
});
