/**
 * The player guide covers everything a player can find (the maintenance guard).
 *
 * Every shipped instrument (the seeds), every tool and shell control, and every section of the
 * instrument editor has a guide page or section, and every instrument and tool page has its
 * picture. A new one without an entry FAILS here with the file to add; the how is the
 * `thoremin-dev-guide` skill (`skills/thoremin-dev-guide/SKILL.md`). Same pattern as the smoke's
 * tool sweep (`smoke/tests/helpers/allTools.ts`, the one list of tools).
 *
 * The data comes from the registries themselves (the seeds, the tool lists, the editor's
 * contributed sections), so nothing is listed here that the app could drift from. Runs only on
 * the shipped build: the core-alone build lists fewer seeds, tools and sections.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGuide } from '../scripts/lib_guide';
import { SEED_INSTRUMENTS } from '@/app/dials/instruments';
import { UI_CONTRIBUTIONS } from '@/app/host/contributions';
import { ALL_TOOLS } from '../smoke/tests/helpers/allTools';
import { guideSlug } from '@/app/guide/links';
import { INSTRUMENT_CLASSES } from '@/instruments/classes';
import extensions from '../extensions.json';
import { hasExtension } from './helpers/extensions';

const ROOT = join(__dirname, '..');
const SHIPPED = extensions.extensions.every((e) => hasExtension(e.id));

/** The editor's own sections (core's); every other section is an extension's contributed panel. */
export const CORE_SECTIONS = ['Sound', 'Hand', 'Face', 'Overlay', 'Keyboard'] as const;
/** Controls in the shell that are not tools (the take cluster at the bottom right). */
export const SHELL_CONTROLS = ['record', 'annotations'] as const;

const HOW = 'See skills/thoremin-dev-guide/SKILL.md ("Adding an entry").';

describe.runIf(SHIPPED)('the player guide covers everything a player can find', () => {
  const built = buildGuide(ROOT);

  it('builds with no problems (links resolve, front matter is complete)', () => {
    expect(built.problems).toEqual([]);
  });

  it('has a page for every shipped instrument, and none for one that is gone', () => {
    const seeds = SEED_INSTRUMENTS.map((s) => s.name);
    const missing = seeds.filter((n) => !built.covers.seeds.includes(n));
    const orphan = built.covers.seeds.filter((n) => !seeds.includes(n));
    expect(missing, `no guide page for: ${missing.join(', ')}. Add guide/instruments/<slug>.md with "seed: <name>" (slug: ${missing.map(guideSlug).join(', ')}). ${HOW}`).toEqual([]);
    expect(orphan, `guide pages for instruments that are not shipped: ${orphan.join(', ')}. Delete or rename them. ${HOW}`).toEqual([]);
  });

  it('has a page for every tool and shell control', () => {
    const tools = [...ALL_TOOLS.filter((t) => t.kind !== 'link').map((t) => t.id), ...SHELL_CONTROLS];
    const missing = tools.filter((id) => !built.covers.tools.includes(id));
    const orphan = built.covers.tools.filter((id) => !tools.includes(id));
    expect(missing, `no guide page for tool(s): ${missing.join(', ')}. Add guide/tools/<id>.md with "tool: <id>". ${HOW}`).toEqual([]);
    expect(orphan, `guide pages for tools that do not exist: ${orphan.join(', ')}. ${HOW}`).toEqual([]);
  });

  it('explains every section of the instrument editor', () => {
    const labels = [...CORE_SECTIONS, ...UI_CONTRIBUTIONS.panels.map((p) => p.section)];
    const missing = [...new Set(labels)].filter((l) => !built.covers.sections.includes(guideSlug(l)));
    expect(missing, `no guide section for editor section(s): ${missing.join(', ')}. Add "## <Name> {#${missing.map(guideSlug).join('}" / "{#')}}" to guide/settings.md. ${HOW}`).toEqual([]);
    const known = new Set(labels.map(guideSlug));
    const orphan = built.covers.sections.filter((s) => !known.has(s));
    expect(orphan, `guide/settings.md explains sections the editor no longer has: ${orphan.join(', ')}. ${HOW}`).toEqual([]);
  });

  it('has an area page for every instrument class (the editor\'s link for a player\'s own instrument)', () => {
    const areas = (JSON.parse(readFileSync(join(ROOT, 'guide', 'areas.json'), 'utf8')) as { id: string }[]).map((a) => a.id);
    const missing = INSTRUMENT_CLASSES.map((c) => c.id).filter((id) => !areas.includes(id));
    expect(missing, `no guide area for instrument class(es): ${missing.join(', ')}. Add an area with that id to guide/areas.json (and its instruments' pages). ${HOW}`).toEqual([]);
  });

  it('has a picture for every instrument and tool page', () => {
    const media = join(ROOT, 'public', 'guide', 'pics');
    const want = [...built.covers.seeds.map((n) => `${guideSlug(n)}.jpg`), ...built.covers.tools.map((t) => `tool-${guideSlug(t)}.jpg`)];
    const missing = want.filter((f) => !existsSync(join(media, f)));
    expect(missing, `missing pictures (run \`npm run guide:media\` against a build): ${missing.join(', ')}`).toEqual([]);
  });

  it('references only media that exist, and keeps the media small', () => {
    const dir = join(ROOT, 'public', 'guide');
    for (const [path, html] of built.pages) {
      for (const m of html.matchAll(/(?:src|href)="((?:\.\.\/)*media\/[^"]+)"/g)) {
        const target = join(dir, path, '..', m[1]);
        expect(existsSync(target), `${path} references ${m[1]}, which does not exist (npm run guide:media)`).toBe(true);
      }
    }
    const mediaDir = join(dir, 'pics');
    const bytes = existsSync(mediaDir) ? readdirSync(mediaDir).reduce((n, f) => n + statSync(join(mediaDir, f)).size, 0) : 0;
    const BUDGET = 6 * 1024 * 1024;
    expect(bytes, `public/guide/pics is ${(bytes / 1048576).toFixed(1)} MB, over the ${BUDGET / 1048576} MB budget: smaller captures, fewer clips`).toBeLessThanOrEqual(BUDGET);
  });

  it('is what the sources build: public/guide is up to date', () => {
    const dir = join(ROOT, 'public', 'guide');
    const css = readFileSync(join(ROOT, 'guide', 'guide.css'), 'utf8');
    const files = new Map<string, string>([...built.pages, ['guide.css', css]]);
    const stale = [...files].filter(([p, text]) => !existsSync(join(dir, p)) || readFileSync(join(dir, p), 'utf8') !== text).map(([p]) => p);
    expect(stale, `public/guide is stale for: ${stale.join(', ')}. Run \`npm run guide\` and commit the result.`).toEqual([]);
  });
});
