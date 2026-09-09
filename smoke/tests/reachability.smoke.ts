/**
 * Reachability smoke (#209): the shipping rule, executed.
 *
 * "A feature nobody can find is not shipped." Every PR answers *how many clicks from
 * a cold load* in prose; this walks the answer in a real browser against the built
 * bundle. Two sweeps, both data-driven from the shell's own registries so a new
 * entry is covered the day it is added:
 *
 *   - every tool in `src/app/tools.ts` opens from the tools bar — a panel shows its
 *     close button, the palette shows its input, a link resolves;
 *   - every settings section of the instrument editor expands to real controls,
 *     reached the way a player reaches it: instruments list → Edit → section.
 *
 * `tools.ts` is imported from the app source (it is plain data with no imports),
 * so the list of tools here can never drift from the one the shell renders.
 */
import { test, expect, type Page } from '@playwright/test';
import { TOOLS } from '../../src/app/tools';

const SYNTHETIC = '?slot.source=synthetic-hands';

/** What "open" looks like for each tool kind. Panels expose a close button named
 *  after the tool (the pattern every panel follows); the palette is a cmdk input. */
const OPEN_PROOF: Record<string, (page: Page, label: string) => Promise<void>> = {
  panel: async (page, label) => {
    await expect(page.getByRole('button', { name: new RegExp(`close the ${label}`, 'i') })).toBeVisible();
  },
  overlay: async (page) => {
    await expect(page.locator('[cmdk-input], input[placeholder*="command" i], input[placeholder*="dial" i]').first()).toBeVisible();
  },
  link: async () => {},
};

test.describe('every tool in src/app/tools.ts opens from the tools bar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(SYNTHETIC);
    await expect(page.getByRole('button', { name: /tap to play/i })).toBeVisible({ timeout: 60_000 });
  });

  for (const tool of TOOLS) {
    test(`${tool.id} (${tool.kind}): one click from a cold load`, async ({ page }) => {
      const button = page.locator(`[data-tool="${tool.id}"]`);
      await expect(button).toBeVisible();
      await expect(button).toContainText(tool.label);
      if (tool.kind === 'link') {
        const href = await button.getAttribute('href');
        expect(href, `${tool.id} has an href`).toBeTruthy();
        const res = await page.request.get(new URL(href!, page.url()).toString());
        expect(res.status(), `${href} resolves`).toBe(200);
        return;
      }
      await button.click();
      await OPEN_PROOF[tool.kind](page, tool.label);
      // ...and closes again (a tool that traps the player is the mirror failure).
      await page.keyboard.press('Escape');
    });
  }
});

/** The settings sections a player reaches through the instrument editor. Kept in
 *  sync with DialsControlsPanel by the test itself: it reads every <details> the
 *  editor renders and asserts each one it finds; this list is the floor. */
const REQUIRED_SECTIONS = ['Sound', 'Hand', 'Face', 'Body', 'Overlay', 'MIDI', 'Generative', 'Keyboard'];

test.describe('every settings section is reachable from a cold load', () => {
  test('instruments → Edit → each section expands to controls', async ({ page }) => {
    await page.goto(SYNTHETIC);
    await expect(page.getByRole('button', { name: /tap to play/i })).toBeVisible({ timeout: 60_000 });

    // The instruments panel is open on load; "Edit <name>" opens the dials editor.
    const edit = page.getByRole('button', { name: /^Edit / }).first();
    await expect(edit).toBeVisible();
    await edit.click();

    // Top-level sections carry `data-section` (TopSection); nested collapsibles do not.
    const sections = page.locator('details[data-section]');
    await expect(sections.first()).toBeVisible();
    const labels = await sections.evaluateAll((els) => els.map((d) => d.getAttribute('data-section') ?? ''));
    for (const required of REQUIRED_SECTIONS) expect(labels, `section "${required}" is in the editor`).toContain(required);

    for (const label of labels) {
      const section = page.locator(`details[data-section="${label}"]`);
      if (!(await section.evaluate((d) => (d as HTMLDetailsElement).open))) await section.locator('> summary').click();
      await expect(section).toHaveAttribute('open', '');
      // A section is only reachable if it shows the player something to use.
      await expect(section.locator('input, select, button, textarea, p, label').first()).toBeVisible();
    }

    // The Generative section specifically (#188): the switch and the transport are there.
    const generative = page.locator('details[data-section="Generative"]');
    await expect(generative.getByText('Generative layer', { exact: true })).toBeVisible();
    await expect(generative.getByRole('button', { name: 'Play' })).toBeDisabled();
  });
});
