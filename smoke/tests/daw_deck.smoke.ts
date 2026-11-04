/**
 * The DJ deck, in a real browser against a build that lists the DAW extension (the gated app's
 * manifest, `extensions.daw.json`; `@thoremin/ext-daw`, thorwhalen/thoremin-daw).
 *
 * The public build does not list the DAW, so against it this test SKIPS (the DJ deck is not in
 * the Instruments view). Run it against the DAW's list, which the harness's own build honours:
 *
 *   THOREMIN_EXTENSIONS=extensions.daw.json npm run smoke:run -- daw_deck
 *
 * (the web server builds with that manifest; stop a preview of the public build first, which the
 * harness would otherwise reuse locally).
 *
 * The walk: Tap to play on the synthetic hands, pick DJ deck (the daw's code loads then, never on a
 * cold load), and the daw's session clock publishes a musical time. A click track generated here
 * (no audio file committed) is loaded in the Song tool and played: the song player takes the
 * daw's stretcher through the song's stretcher seam (`ctx.resources.createStretcher`, #976), so
 * the song plays through the daw's chain (`owned`) and the clock follows it. Then "DAW: hold beat
 * repeat", run from the command palette as a player would, engages the beat repeat on the chain,
 * and "DAW: release beat repeat" releases it. The assertions are the daw repository's own browser
 * check's (`dev/browser-check.mjs`), on thoremin's debug handle (`window.thoremin`).
 */
import { test, expect, type Page } from '@playwright/test';

/** One synthetic hand: its pinches drive only the filter, so a held repeat is the command's. */
const SYNTHETIC = '?slot.source=synthetic-hands';
/** A string only the daw's deferred half carries (the `daw-clock` node's description). */
const DEFERRED_MARKER = "The session's tempo, meter and bar:beat";
const BPM = 120;

/** A 16-bit mono WAV click track: a 5 ms 1 kHz burst on every beat (`conduct_recording.smoke.ts`'s recipe). */
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

/** A node's output port, read through the debug handle (JSON-safe). */
const out = (page: Page, node: string, port: string): Promise<unknown> =>
  page.evaluate(([n, p]) => {
    const v = window.thoremin?.getOutput(n, p);
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'function' ? undefined : x)));
  }, [node, port] as const);

/** Run a command from the palette (Cmd/Ctrl-K) by its title; the palette then asks for each
 *  parameter in turn ("Pick length..."), answered by `picks`, in order. */
async function runFromPalette(page: Page, title: string, picks: readonly string[] = []): Promise<void> {
  await page.keyboard.press('ControlOrMeta+k');
  const input = page.locator('[cmdk-input]').first();
  await expect(input).toBeVisible();
  await input.fill(title);
  await page.locator('[cmdk-item]').filter({ hasText: title }).first().click();
  for (const pick of picks) await page.locator('[cmdk-item]').filter({ hasText: pick }).first().click();
  await expect(input).toBeHidden();
}

test.describe('the DJ deck (the DAW extension, gated app)', () => {
  test('DJ deck loads the daw on demand; its clock keeps musical time; a song plays through its chain; the palette holds a beat repeat', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    const scripts: { url: string; body: Promise<string> }[] = [];
    page.on('response', (res) => {
      if (/\.m?js(\?|$)/.test(res.url())) scripts.push({ url: res.url(), body: res.text().catch(() => '') });
    });

    await page.goto(SYNTHETIC);
    await page.getByRole('button', { name: /tap to play/i }).click({ timeout: 60_000 });
    await expect.poll(() => page.evaluate(() => window.thoremin?.liveVectorTime() ?? -1), { timeout: 10_000 }).toBeGreaterThan(0);
    await page.waitForLoadState('networkidle');

    const deck = page.getByRole('button', { name: /^DJ deck\b/ }).first();
    const listed = (await deck.count()) > 0 || (await page.locator('section[data-category="daw"]').count()) > 0;
    test.skip(!listed, 'this build does not list the DAW extension: run with THOREMIN_EXTENSIONS=extensions.daw.json');

    // A cold load fetched none of the daw's deferred code.
    const cold = scripts.length;
    const bodies = async (from: number, to = scripts.length) => Promise.all(scripts.slice(from, to).map((s) => s.body));
    expect((await bodies(0, cold)).some((b) => b.includes(DEFERRED_MARKER)), 'the cold load fetched the daw\'s deferred code').toBe(false);

    // Pick DJ deck (its class may be collapsed).
    if (!(await deck.isVisible())) await page.locator('section[data-category="daw"] button').first().click();
    await deck.click();
    await expect.poll(async () => (await bodies(cold)).some((b) => b.includes(DEFERRED_MARKER)), { timeout: 20_000 }).toBe(true);

    // The session clock publishes a musical time, at its own tempo while no song plays.
    await expect.poll(async () => {
      const t = (await out(page, 'dawClock', 'time')) as { beat?: number; tempo?: number; period?: number } | undefined;
      return !!t && Number.isFinite(t.beat) && (t.tempo ?? 0) > 0 && (t.period ?? 0) > 0;
    }, { timeout: 20_000 }).toBe(true);
    const before = (await out(page, 'dawClock', 'time')) as { beat: number };
    await page.waitForTimeout(1000);
    expect(((await out(page, 'dawClock', 'time')) as { beat: number }).beat, 'the clock does not advance').toBeGreaterThan(before.beat);

    // The instruments panel covers the shell: close it (the instrument stays chosen).
    const close = page.getByRole('button', { name: 'Close', exact: true }).first();
    if (await close.isVisible()) await close.click();

    // A song through the Song tool, then Play: it plays through the daw's chain.
    await page.locator('[data-tools-launcher]').click();
    await page.getByRole('dialog').getByText('Song', { exact: true }).click();
    await page.getByTestId('song-file').setInputFiles({ name: 'clicks.wav', mimeType: 'audio/wav', buffer: clickTrackWav(BPM, 30) });
    const play = page.getByRole('button', { name: 'Play', exact: true });
    await expect(play).toBeEnabled({ timeout: 30_000 });
    await play.click();
    await expect.poll(() => out(page, 'dawSongChain', 'status'), { timeout: 30_000 }).toBe('owned');
    await expect.poll(() => out(page, 'dawClock', 'following'), { timeout: 30_000 }).toBe('song');
    await page.keyboard.press('Escape');

    // "DAW: hold beat repeat" from the palette engages the repeat on the chain; release ends it.
    await runFromPalette(page, 'DAW: hold beat repeat', ['1/8']);
    await expect.poll(async () => ((await out(page, 'dawFx', 'status')) as { repeat?: unknown } | undefined)?.repeat ?? null, { timeout: 10_000 }).not.toBeNull();
    const held = ((await out(page, 'dawFx', 'status')) as { repeat: { by?: string } }).repeat;
    expect(held.by, 'the repeat is the command\'s, not a hand\'s').not.toBe('hand');
    await runFromPalette(page, 'DAW: release beat repeat');
    await expect.poll(async () => ((await out(page, 'dawFx', 'status')) as { repeat?: unknown } | undefined)?.repeat ?? null, { timeout: 10_000 }).toBeNull();

    expect(errors, errors.join('\n')).toEqual([]);
  });
});
