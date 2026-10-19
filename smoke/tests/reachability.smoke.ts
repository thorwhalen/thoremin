/**
 * Reachability smoke (#209): the shipping rule, executed.
 *
 * "A feature nobody can find is not shipped." Every PR answers *how many clicks from
 * a cold load* in prose; this walks the answer in a real browser against the built
 * bundle. Two sweeps, both data-driven from the shell's own registries so a new
 * entry is covered the day it is added:
 *
 *   - every tool opens from the shell — core's (`src/app/tools.ts`) and every shipped
 *     extension's (#600: a built-in feature moved into a slice takes its tool with it) — a
 *     pinned tool from its bar button, any other from the Tools launcher (Round 4, #271) —
 *     and a panel shows its close button, the palette its input, the assistant its chat, a
 *     link resolves; and the launcher lists EXACTLY the tools swept here, so a tool that
 *     moves, or a new one, can never leave the sweep silently (#600 S16b);
 *   - every settings section of the instrument editor expands to real controls,
 *     reached the way a player reaches it: instruments list → Edit → section.
 *
 * `tools.ts` and the extensions' tool modules are imported from the source (plain data with
 * no runtime imports), so the list of tools here can never drift from the one the shell renders.
 */
import { test, expect, type Page } from '@playwright/test';
import { TOOLS } from '../../src/app/tools';
import { SONG_TOOL } from '../../src/slices/song/tool';
import { LAB_TOOL } from '../../src/slices/lab/tool';
import { FACES_TOOL, HANDS_TOOL, POSES_TOOL } from '../../packages/ext-faces/src/tools';

/** A tool as the sweep needs it: core's entries, and an extension's (always a panel). */
type SweptTool = Pick<(typeof TOOLS)[number], 'id' | 'label' | 'kind' | 'defaultPinned'>;

/** Every shipped extension's tools (each a panel the shell frames). A slice that brings a tool adds
 *  its data module here; the launcher check below fails until it does. */
const EXTENSION_TOOLS: readonly SweptTool[] = [SONG_TOOL, LAB_TOOL, FACES_TOOL, HANDS_TOOL, POSES_TOOL].map((t) => ({ id: t.id, label: t.label, kind: 'panel' as const, defaultPinned: t.defaultPinned }));

const ALL_TOOLS: readonly SweptTool[] = [...TOOLS, ...EXTENSION_TOOLS];

const SYNTHETIC = '?slot.source=synthetic-hands';

/** What "open" looks like for each tool kind. Panels expose a close button named
 *  after the tool (the pattern every panel follows); the palette is a cmdk input; the
 *  assistant (an overlay with no input until a key is set) shows its chat's close. */
const OPEN_PROOF: Record<string, (page: Page, label: string) => Promise<void>> = {
  panel: async (page, label) => {
    await expect(page.getByRole('button', { name: new RegExp(`close the ${label}`, 'i') })).toBeVisible();
  },
  overlay: async (page, label) => {
    if (label === 'Assistant') {
      await expect(page.getByRole('button', { name: 'Close assistant' })).toBeVisible();
      return;
    }
    await expect(page.locator('[cmdk-input], input[placeholder*="command" i], input[placeholder*="dial" i]').first()).toBeVisible();
  },
  link: async () => {},
};

/** The element that opens `tool` from a cold load: its bar button if it ships pinned,
 *  otherwise its row in the Tools launcher (opened first). Two clicks at most. */
async function entryPoint(page: Page, tool: SweptTool) {
  if (tool.defaultPinned) return page.locator(`[data-tools-bar] [data-tool="${tool.id}"]`);
  await page.locator('[data-tools-launcher]').click();
  return page.locator(`[data-launcher-tool="${tool.id}"]`).locator('a, button').first();
}

test.describe('every tool, core\'s and the extensions\', opens from the shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(SYNTHETIC);
    await expect(page.getByRole('button', { name: /tap to play/i })).toBeVisible({ timeout: 60_000 });
  });

  test('the launcher lists exactly the tools this sweep covers (a moved or new tool cannot drop out)', async ({ page }) => {
    await page.locator('[data-tools-launcher]').click();
    const listed = await page.locator('[data-launcher-tool]').evaluateAll((els) => els.map((e) => e.getAttribute('data-launcher-tool')));
    expect([...listed].sort()).toEqual(ALL_TOOLS.map((t) => t.id).sort());
  });

  for (const tool of ALL_TOOLS) {
    test(`${tool.id} (${tool.kind}): ${tool.defaultPinned ? 'one click' : 'two clicks'} from a cold load`, async ({ page }) => {
      const button = await entryPoint(page, tool);
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
