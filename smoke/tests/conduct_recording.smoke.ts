/**
 * "Conduct a recording", in a real browser against the built bundle (#187 PR 7).
 *
 * The lazy rule's network half for the song's time-stretch: the Signalsmith Stretch chunk
 * (its WebAssembly worklet inlined) is fetched only once a recording is chosen, never on a
 * cold load and never by opening the Conductor. Then the walk the PR states, click by
 * click: Tap to play, Conductor, Conduct a recording, Choose a recording (a click track
 * generated here, so no audio file is committed), Start conducting. The synthetic hands
 * do not beat (they sweep sideways), so the recording is proven loaded into the worklet
 * (the Song tool's readout `ready`) and held by the conductor, cued on its first beat and
 * waiting for his; the following itself is the node tests' (`song_conduct.test.ts`, an
 * exact position integral). A worklet that failed to start would fall back to the media
 * element and say so on the console, which fails the test: what is proven is the
 * Signalsmith path.
 */
import { test, expect } from '@playwright/test';

const SYNTHETIC = '?slot.source=synthetic-hands';
/** The package's own file, emitted verbatim as an asset (never bundled: see
 *  `song_stretcher_signalsmith.ts`). */
const STRETCH_CHUNK = /SignalsmithStretch-[^/]*\.mjs$/;

/** A 16-bit mono WAV click track: a 5 ms 1 kHz burst on every beat. */
function clickTrackWav(bpm: number, seconds: number, sampleRate = 22050): Buffer {
  const n = Math.round(seconds * sampleRate);
  const data = Buffer.alloc(n * 2);
  const period = (60 / bpm) * sampleRate;
  const burst = Math.round(0.005 * sampleRate);
  for (let k = 0; k * period < n; k++) {
    const start = Math.round(k * period);
    for (let i = 0; i < burst && start + i < n; i++) data.writeInt16LE(Math.round(20000 * Math.sin((2 * Math.PI * 1000 * i) / sampleRate)), (start + i) * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

test('a recording follows the conductor through the lazily loaded Signalsmith worklet', async ({ page }) => {
  const fetched: string[] = [];
  page.on('request', (r) => {
    if (STRETCH_CHUNK.test(r.url())) fetched.push(new URL(r.url()).pathname);
  });
  const fellBack: string[] = [];
  page.on('console', (m) => {
    if (/Signalsmith Stretch could not start/.test(m.text())) fellBack.push(m.text());
  });
  await page.goto(SYNTHETIC);

  // Click 1: audio on.
  await page.getByRole('button', { name: /tap to play/i }).click({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: /tap to play/i })).toBeHidden();

  // Clicks 2 and 3: the Conductor (pinned), then its second mode. Nothing of the stretcher yet.
  await page.locator('[data-tools-bar] [data-tool="conductor"]').click();
  await page.getByRole('radio', { name: 'Conduct a recording' }).click();
  await expect(page.getByText('Choose a recording...')).toBeVisible();
  await page.waitForTimeout(1000);
  expect(fetched, 'no stretcher before a recording is chosen').toEqual([]);

  // Click 4: the recording (the picker, filled by Playwright). Its beat is tracked on load.
  await page.getByTestId('conductor-recording-file').setInputFiles({ name: 'clicks.wav', mimeType: 'audio/wav', buffer: clickTrackWav(120, 30) });
  await expect(page.getByTestId('conductor-recording').getByText('clicks.wav')).toBeVisible({ timeout: 30_000 });

  // Click 5: Start. The recording waits, cued, for the conductor's first beat.
  await page.getByRole('button', { name: 'Start conducting' }).click();
  await expect(page.getByTestId('conductor-recording-live')).toHaveText('The recording waits on its first beat for yours.');
  expect(fetched.length, 'the Signalsmith file was fetched').toBeGreaterThan(0);

  // The Song tool: the recording is loaded (decoded into the worklet) and the conductor leads it.
  await page.locator('[data-tools-launcher]').click();
  await page.getByRole('dialog').getByText('Song', { exact: true }).click();
  await expect(page.getByTestId('song-conducted')).toBeVisible();
  await expect(page.getByTestId('song-panel').locator('[data-load-phase]').first()).toHaveAttribute('data-load-phase', 'ready', { timeout: 30_000 });
  expect(fellBack, 'the worklet started (no media-element fallback)').toEqual([]);
});
