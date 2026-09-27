/**
 * Occlusion smoke: every shell control a player can see is a control they can press.
 *
 * `reachability.smoke.ts` proves each tool OPENS from a cold load. It could not catch the
 * failure this file exists for: a control that renders, is "visible" to every locator,
 * and still sits UNDER another surface. On main as of Round 4, four did:
 *   - the Record button rendered beneath the Instruments panel, which is open on load, so
 *     recording was unreachable until the player happened to close the list;
 *   - the assistant's robot sat on top of the Instruments panel's last rows;
 *   - an open tool panel (anchored a fixed 3.5rem up) covered the first row of the tools
 *     bar as soon as the bar wrapped to two rows, so switching tool meant closing first;
 *   - and the recording settings sheet, once Record was reachable, opened beneath the
 *     panel too.
 * Each test passes Playwright's `toBeVisible`. None of them passes a hit test.
 *
 * So this suite hit-tests: for each control, sample five points inside it (its centre and
 * the four points a quarter of the way in) and ask the document what is on top there
 * (`elementFromPoint`). Any sample landing on something else is an occlusion. The list of
 * controls is the shell's own: the tools bar is read from `src/app/tools.ts`, the rest by
 * the aria-labels the shell gives them.
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import { TOOLS } from '../../src/app/tools';

const SYNTHETIC = '?slot.source=synthetic-hands';

/** A tool's button in the bar. Scoped to the bar: a panel may carry `data-tool` too. */
const barButton = (page: Page, id: string) => page.locator(`[data-tools-bar] [data-tool="${id}"]`);

/** The desktop viewports the shell is laid out for (the smallest common laptop, a large one). */
const DESKTOP = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
];

/** The first of `sampled` points inside `el` where something else is on top, or null. */
async function occluder(el: Locator): Promise<string | null> {
  return el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const pts: [number, number][] = [
      [0.5, 0.5],
      [0.25, 0.5],
      [0.75, 0.5],
      [0.5, 0.25],
      [0.5, 0.75],
    ];
    for (const [fx, fy] of pts) {
      const top = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
      if (top && !node.contains(top)) {
        const owner = top.closest('[aria-label],[data-tool],[role=group]');
        return owner?.getAttribute('aria-label') ?? owner?.getAttribute('data-tool') ?? top.tagName.toLowerCase();
      }
    }
    return null;
  });
}

async function expectPressable(page: Page, el: Locator, name: string) {
  await expect(el, `${name} is on screen`).toBeVisible();
  expect(await occluder(el), `${name} is not covered by another surface`).toBeNull();
}

/** The shell's always-there controls: the tools bar, plus the three launchers beside it. */
async function expectShellPressable(page: Page, { withRecord = true } = {}) {
  for (const tool of TOOLS) await expectPressable(page, barButton(page, tool.id), `tool ${tool.id}`);
  await expectPressable(page, page.getByRole('button', { name: 'Open assistant' }), 'assistant');
  await expectPressable(page, page.getByRole('button', { name: 'Annotation mode' }), 'annotations');
  if (withRecord) await expectPressable(page, page.getByRole('button', { name: 'Record' }), 'record');
}

async function coldLoadPlaying(page: Page) {
  await page.goto(SYNTHETIC);
  const play = page.getByRole('button', { name: /tap to play/i });
  await expect(play).toBeVisible({ timeout: 60_000 });
  await play.click();
  await expect(page.getByRole('button', { name: 'Record' })).toBeVisible();
}

for (const vp of DESKTOP) {
  test.describe(`${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp });

    test('cold load, playing, Instruments open: every shell control is pressable', async ({ page }) => {
      await coldLoadPlaying(page);
      // The Instruments panel is open on load; that is the case that hid Record.
      await expect(page.getByRole('group', { name: /instruments/i }).first()).toBeVisible();
      await expectShellPressable(page);
    });

    test('every instrument row the list shows is pressable (nothing floats over the list)', async ({ page }) => {
      await coldLoadPlaying(page);
      const list = page.getByRole('group', { name: /instruments/i }).first().locator('xpath=..');
      const box = await list.boundingBox();
      expect(box).not.toBeNull();
      const edits = page.getByRole('button', { name: /^Edit / });
      const n = await edits.count();
      expect(n).toBeGreaterThan(0);
      for (let i = 0; i < n; i++) {
        const b = await edits.nth(i).boundingBox();
        // Only the rows the list's own scroll box shows; the rest are scrolled away, not covered.
        if (!b || b.y < box!.y || b.y + b.height > box!.y + box!.height) continue;
        const name = (await edits.nth(i).getAttribute('aria-label')) ?? `row ${i}`;
        expect(await occluder(edits.nth(i)), `${name} is not covered`).toBeNull();
      }
    });

    test('the recording settings sheet opens on top of the Instruments panel', async ({ page }) => {
      await coldLoadPlaying(page);
      await page.getByRole('button', { name: 'Record' }).click();
      await expectPressable(page, page.getByRole('button', { name: 'Close recording settings' }), 'sheet close');
      await expectPressable(page, page.getByRole('button', { name: /rec now/i }), 'rec now');
      // Every control inside the sheet, not only its two ends.
      const sheet = page.getByRole('button', { name: 'Close recording settings' }).locator('xpath=ancestor::div[contains(@class,"rounded")][1]');
      const inputs = sheet.locator('input, select');
      for (let i = 0; i < (await inputs.count()); i++) {
        if (await inputs.nth(i).isVisible()) expect(await occluder(inputs.nth(i)), `sheet control ${i}`).toBeNull();
      }
    });

    for (const tool of TOOLS.filter((t) => t.kind === 'panel')) {
      test(`with the ${tool.label} panel open, the tools bar is still pressable`, async ({ page }) => {
        await coldLoadPlaying(page);
        await barButton(page, tool.id).click();
        await expect(page.getByRole('button', { name: new RegExp(`close the ${tool.label}`, 'i') })).toBeVisible();
        for (const t of TOOLS) await expectPressable(page, barButton(page, t.id), `tool ${t.id}`);
      });
    }
  });
}
