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
/** The tools the bar shows on a cold load (the shipped pins). */
const PINNED = TOOLS.filter((t) => t.defaultPinned);

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

/** The bar: the Tools launcher button and every pinned tool. */
async function expectBarPressable(page: Page, { pins = true } = {}) {
  await expectPressable(page, page.locator('[data-tools-launcher]'), 'the Tools launcher');
  if (pins) for (const t of PINNED) await expectPressable(page, barButton(page, t.id), `tool ${t.id}`);
}

/** The shell's always-there controls: the bar, and the take cluster (Annotations, Record). */
async function expectShellPressable(page: Page, { withRecord = true, pins = true } = {}) {
  await expectBarPressable(page, { pins });
  await expectPressable(page, page.getByRole('button', { name: 'Annotation mode' }), 'annotations');
  if (withRecord) await expectPressable(page, page.getByRole('button', { name: 'Record' }), 'record');
}

/** Open a tool: its bar button if pinned, else through the launcher. */
async function openTool(page: Page, tool: (typeof TOOLS)[number]) {
  if (tool.defaultPinned) return barButton(page, tool.id).click();
  await page.locator('[data-tools-launcher]').click();
  await page.locator(`[data-launcher-tool="${tool.id}"]`).locator('button').first().click();
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

    test('the gallery view: every visible card and every shell control is pressable', async ({ page }) => {
      await coldLoadPlaying(page);
      await page.getByRole('button', { name: 'Gallery view' }).click();
      await expect(page.locator('li[data-instrument] .aspect-\\[16\\/10\\]').first()).toBeVisible();
      await expectShellPressable(page);
      const list = page.getByRole('group', { name: /instruments/i }).first().locator('xpath=..');
      const box = (await list.boundingBox())!;
      const edits = page.getByRole('button', { name: /^Edit / });
      for (let i = 0; i < (await edits.count()); i++) {
        const b = await edits.nth(i).boundingBox();
        if (!b || b.y < box.y || b.y + b.height > box.y + box.height) continue;
        expect(await occluder(edits.nth(i)), `card ${i} is not covered`).toBeNull();
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
        await openTool(page, tool);
        await expect(page.getByRole('button', { name: new RegExp(`close the ${tool.label}`, 'i') })).toBeVisible();
        await expectBarPressable(page);
      });
    }
  });
}

test.describe('the Tools launcher', () => {
  test.use({ viewport: DESKTOP[0] });

  test('opens over an open tool panel, and every row and pin in it is pressable', async ({ page }) => {
    await coldLoadPlaying(page);
    await barButton(page, 'conductor').click();
    await page.locator('[data-tools-launcher]').click();
    const rows = page.locator('[data-launcher-tool]');
    await expect(rows).toHaveCount(TOOLS.length);
    for (let i = 0; i < TOOLS.length; i++) {
      for (const el of [rows.nth(i).locator('a, button').first(), rows.nth(i).locator('button[aria-pressed]')]) {
        expect(await occluder(el), `launcher row ${i}`).toBeNull();
      }
    }
  });
});

/** Every visible control inside `root` lies within the viewport (nothing cut off). */
async function expectOnScreen(page: Page, root: Locator, name: string) {
  const vw = page.viewportSize()!.width;
  const controls = root.locator('button, input, select');
  for (let i = 0; i < (await controls.count()); i++) {
    const b = await controls.nth(i).boundingBox();
    if (!b) continue;
    expect(b.x, `${name}: control ${i} starts on screen`).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, `${name}: control ${i} ends on screen`).toBeLessThanOrEqual(vw);
  }
}

for (const phone of [
  { width: 390, height: 844 },
  { width: 360, height: 740 },
]) {
  test.describe(`${phone.width}x${phone.height} (a phone)`, () => {
    test.use({ viewport: phone });

    test('cold load, before playing: Tap to play and the Instruments icon are pressable, the video uncovered', async ({ page }) => {
      await page.goto(SYNTHETIC);
      const play = page.getByRole('button', { name: /tap to play/i });
      await expect(play).toBeVisible({ timeout: 60_000 });
      await expectPressable(page, play, 'tap to play');
      // The list starts closed on a phone: open on load it covered the whole screen.
      await expectPressable(page, page.getByRole('button', { name: 'Open instruments' }), 'the Instruments icon');
    });

    test('the Instruments list, opened, shows its rows pressable', async ({ page }) => {
      await coldLoadPlaying(page);
      await page.getByRole('button', { name: 'Open instruments' }).click();
      const list = page.getByRole('group', { name: /instruments/i }).first().locator('xpath=..');
      const box = (await list.boundingBox())!;
      const edits = page.getByRole('button', { name: /^Edit / });
      await expect(edits.first()).toBeVisible();
      for (let i = 0; i < (await edits.count()); i++) {
        const b = await edits.nth(i).boundingBox();
        if (!b || b.y < box.y || b.y + b.height > box.y + box.height) continue;
        expect(await occluder(edits.nth(i)), `row ${i} is not covered`).toBeNull();
      }
    });

    test('cold load, playing: the launcher and the take cluster are pressable', async ({ page }) => {
      await coldLoadPlaying(page);
      // On a phone-width screen the bar is the launcher alone; the pins are one tap in.
      await expectShellPressable(page, { pins: false });
    });

    test('the Annotations sheet opens fully on screen', async ({ page }) => {
      await coldLoadPlaying(page);
      await page.getByRole('button', { name: 'Annotation mode' }).click();
      const sheet = page.locator('[data-annotations-sheet]');
      await expect(sheet).toBeVisible();
      const box = (await sheet.boundingBox())!;
      expect(box.x, 'the sheet starts on screen').toBeGreaterThanOrEqual(0);
      await expectOnScreen(page, sheet, 'annotations sheet');
    });

    test('during a take, the take cluster does not cover the Tools button', async ({ page }) => {
      await coldLoadPlaying(page);
      await page.getByRole('button', { name: 'Record' }).click();
      await page.getByRole('button', { name: /rec now/i }).click();
      await expect(page.getByRole('button', { name: /stop recording|saving recording/i })).toBeVisible();
      await expectPressable(page, page.locator('[data-tools-launcher]'), 'the Tools launcher');
      await expectPressable(page, page.getByRole('button', { name: /stop recording/i }), 'stop recording');
    });
  });
}

test.describe('820x1180 (a tablet)', () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  for (const tool of TOOLS.filter((t) => t.kind === 'panel')) {
    test(`the gallery beside the open ${tool.label} panel: no card is covered`, async ({ page }) => {
      await coldLoadPlaying(page);
      // The list starts open above phone widths; open it only if it is closed.
      const openIt = page.getByRole('button', { name: 'Open instruments' });
      if (await openIt.isVisible()) await openIt.click();
      await page.getByRole('button', { name: 'Gallery view' }).click();
      await openTool(page, tool);
      await expect(page.getByRole('button', { name: new RegExp(`close the ${tool.label}`, 'i') })).toBeVisible();
      const list = page.getByRole('group', { name: /instruments/i }).first().locator('xpath=..');
      const box = (await list.boundingBox())!;
      const edits = page.getByRole('button', { name: /^Edit / });
      for (let i = 0; i < (await edits.count()); i++) {
        const b = await edits.nth(i).boundingBox();
        if (!b || b.y < box.y || b.y + b.height > box.y + box.height) continue;
        expect(await occluder(edits.nth(i)), `card ${i} is not covered`).toBeNull();
      }
    });
  }
});
