/**
 * The guide's exports (`scripts/lib_guide_export.ts`): the whole guide as one HTML page and as one
 * Markdown file. Each must hold every page, in reading order, with every link between pages turned
 * into an anchor that exists in the same file and nothing left relative (a saved file has no
 * folder beside it). Reads only `guide/`, so it runs in the core-alone build too.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGuide } from '../scripts/lib_guide';
import { buildExports, pageAnchor } from '../scripts/lib_guide_export';
import { GUIDE_EXPORTS, GUIDE_LIVE_URL } from '@/app/guide/links';

const ROOT = join(__dirname, '..');
const built = buildGuide(ROOT);
const css = readFileSync(join(ROOT, 'guide', 'guide.css'), 'utf8');
const exports = buildExports(built, { css });
const html = exports.get(GUIDE_EXPORTS.html) ?? '';
const md = exports.get(GUIDE_EXPORTS.md) ?? '';

const all = (text: string, re: RegExp): string[] => [...text.matchAll(re)].map((m) => m[1]);

describe('the reading order', () => {
  it('lists every page once, home first, the free pages after the instruments and tools', () => {
    expect([...built.order].sort()).toEqual([...built.pages.keys()].sort());
    expect(built.order[0]).toBe('index.html');
    const at = (p: string) => built.order.indexOf(p);
    expect(at('instruments.html')).toBeLessThan(at('tools.html'));
    expect(at('tools.html')).toBeLessThan(at('conduct-and-dance.html'));
    expect(at('teach-it-yourself.html')).toBeLessThan(at('settings.html'));
    expect(at('settings.html')).toBeLessThan(at('troubleshooting.html'));
  });
});

describe('the single-page HTML', () => {
  const ids = new Set(all(html, / id="([^"]+)"/g));

  it('has a section for every page, in reading order', () => {
    const sections = all(html, /<section class="page" id="([^"]+)"/g);
    expect(sections).toEqual(built.order.map(pageAnchor));
  });

  it('inlines the stylesheet and loads nothing beside it', () => {
    expect(html).toContain(css.slice(0, 200));
    expect(html).not.toMatch(/<link rel="stylesheet"/);
  });

  it('links only to anchors that exist, or to absolute URLs', () => {
    const anchors = all(html, / href="#([^"]*)"/g);
    expect(anchors.filter((a) => !ids.has(a)), 'anchors with no target').toEqual([]);
    const refs = all(html, / (?:href|src)="([^"]*)"/g);
    expect(refs.filter((r) => !r.startsWith('#') && !/^(https?|mailto):/.test(r)), 'relative links left').toEqual([]);
  });

  it('keeps the pictures, from the live guide, and leaves the clips out', () => {
    expect(html).toContain(`src="${GUIDE_LIVE_URL}pics/home.jpg"`);
    expect(html).not.toContain('<video');
  });

  it('can print itself: the Save as PDF button and the #print route', () => {
    expect(html).toContain('onclick="print()"');
    expect(html).toContain("location.hash === '#print'");
    expect(html).toContain('@media print');
  });
});

describe('the Markdown', () => {
  const ids = new Set(all(md, /<a id="([^"]+)"><\/a>/g));

  it('has every page under its own anchor, its title one level down', () => {
    for (const out of built.order) {
      expect(ids.has(pageAnchor(out)), `${out} has no anchor`).toBe(true);
      expect(md, `${out}'s title`).toContain(`\n## ${built.markdown.get(out)?.title}\n`);
    }
    expect(md.split('\n').filter((l) => l.startsWith('# '))).toEqual(['# Thoremin guide']);
  });

  it('links only to anchors that exist, or to absolute URLs', () => {
    const links = all(md, /\]\(([^)\s]+)\)/g);
    expect(links.filter((l) => l.startsWith('#') && !ids.has(l.slice(1))), 'anchors with no target').toEqual([]);
    expect(links.filter((l) => !l.startsWith('#') && !/^(https?|mailto):/.test(l)), 'relative links left').toEqual([]);
  });

  it('carries no guide-only syntax and no hard wrap of the sources', () => {
    expect(md).not.toMatch(/^:::/m);
    expect(md).not.toMatch(/\{#[a-z0-9-]+\}/);
    expect(md).not.toMatch(/\]\((instrument|tool|settings|area|manual|app):/);
  });
});

describe('the Export menu', () => {
  it('is on every page, with the three exports', () => {
    for (const [path, page] of built.pages) {
      for (const kind of ['html', 'pdf', 'md']) expect(page, `${path}: export ${kind}`).toContain(`data-export="${kind}"`);
    }
  });
});
