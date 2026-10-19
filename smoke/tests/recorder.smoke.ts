/**
 * The recorder's save paths in a real browser, with no camera (the synthetic hand): a take with the
 * default location downloads as ONE zip holding the take's folder (its manifest, the audio and the
 * feature stream); and a take aimed at a folder the browser then refuses to write falls back to a
 * zip with a toast that says so, keeping what was added so far (#308).
 */
import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const URL_PARAMS = '?slot.source=synthetic-hands';

/** No save dialog (a headless browser has no one to answer it): a zip is a plain download, as in Safari. */
const NO_SAVE_DIALOG = () => {
  delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
};

async function booted(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: /tap to play/i })).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.thoremin?.liveVectorTime() ?? -1), { timeout: 20_000 }).toBeGreaterThan(0);
  await page.getByRole('button', { name: /tap to play/i }).click();
}

/** Open the sheet, pick audio + the feature stream, record about two seconds, stop. */
async function takeTwoSeconds(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  const feature = page.getByLabel('Feature stream (JSONL)');
  if (!(await feature.isChecked())) await feature.check();
  await page.getByRole('button', { name: /Rec now/ }).click();
  await page.waitForTimeout(2_500);
}

/** The zip's entries, by name, and a file's text. */
function entries(path: string): string[] {
  return execFileSync('unzip', ['-Z1', path], { encoding: 'utf8' }).split('\n').filter(Boolean);
}
function textOf(path: string, entry: string): string {
  return execFileSync('unzip', ['-p', path, entry], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

test('a take with the default location downloads as one zip with its manifest, audio and features', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.addInitScript(NO_SAVE_DIALOG);
  await page.goto(URL_PARAMS);
  await booted(page);
  await takeTwoSeconds(page);
  const download = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Stop recording' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.zip$/);
  const path = (await file.path())!;
  const names = entries(path);
  const manifest = names.find((n) => n.endsWith('manifest.json'));
  expect(manifest, names.join(', ')).toBeDefined();
  expect(names.some((n) => /\.(webm|wav|flac|ogg|m4a|mp3)$/.test(n)), names.join(', ')).toBe(true);
  expect(names.some((n) => n.endsWith('.jsonl')), names.join(', ')).toBe(true);
  // One folder holds the take.
  const folders = new Set(names.map((n) => n.split('/')[0]));
  expect(folders.size).toBe(1);
  const m = JSON.parse(textOf(path, manifest!)) as { streams?: unknown };
  expect(m.streams).toBeDefined();
  // The feature stream has rows: the engine ran during the take.
  const jsonl = names.find((n) => n.endsWith('.jsonl'))!;
  expect(textOf(path, jsonl).split('\n').filter(Boolean).length).toBeGreaterThan(5);
  expect(errors).toEqual([]);
});

test('a folder that refuses writes falls back to a zip, with a toast that says so', async ({ page }) => {
  test.setTimeout(90_000);
  // A folder picker whose folder takes a subfolder and then refuses every file.
  await page.addInitScript(NO_SAVE_DIALOG);
  await page.addInitScript(() => {
    const refusing = {
      name: 'RefusingFolder',
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      // Looking for a name that is taken finds nothing; making one gives the (refusing) subfolder.
      getDirectoryHandle: async (_name: string, opts?: { create?: boolean }) => {
        if (!opts?.create) throw new DOMException('not found', 'NotFoundError');
        return refusing;
      },
      getFileHandle: async () => ({
        createWritable: async () => {
          throw new Error('disk full');
        },
      }),
    };
    (window as unknown as { showDirectoryPicker: () => Promise<unknown> }).showDirectoryPicker = async () => refusing;
  });
  await page.goto(URL_PARAMS);
  await booted(page);
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await page.getByRole('radio', { name: /Choose folder/ }).check();
  const feature = page.getByLabel('Feature stream (JSONL)');
  if (!(await feature.isChecked())) await feature.check();
  await page.getByRole('button', { name: /Rec now/ }).click();
  await page.waitForTimeout(2_500);
  const download = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Stop recording' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.zip$/);
  const names = entries((await file.path())!);
  expect(names.some((n) => n.endsWith('manifest.json')), names.join(', ')).toBe(true);
  await expect(page.getByText(/could not be written \(disk full\).*saved as a zip instead/)).toBeVisible({ timeout: 10_000 });
});
