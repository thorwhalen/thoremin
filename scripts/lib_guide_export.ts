/**
 * The player guide as one file, for reading offline, printing or pasting elsewhere: the built pages
 * (`lib_guide.ts`) joined in reading order into one self-contained HTML page (the stylesheet
 * inlined; printed, it is the PDF) and the same content as one Markdown file. Generated with the
 * pages by `scripts/gen_guide.ts`, so it cannot go stale apart from them.
 *
 * Every link between guide pages becomes an in-page anchor: a page is `#<path>` with the slashes
 * as dashes (`#instruments-air-drum`), an anchor inside it `#<page>--<id>` (`#settings--sound`).
 * Everything else (pictures, the manual, the app) becomes an absolute URL on the live guide, so the
 * file works wherever it is saved. Clips are left out; the pictures stay.
 */
import { GUIDE_EXPORTS, GUIDE_LIVE_URL } from '../src/app/guide/links';
import type { Built } from './lib_guide';

export interface ExportOptions {
  /** The guide's stylesheet, inlined in the HTML. */
  css: string;
  /** Where the live guide is served (ends in `/`): relative pictures and app links resolve here. */
  baseUrl?: string;
  /** The document's title. */
  title?: string;
}

/** `instruments/air-drum.html` -> `instruments-air-drum`: a page's anchor in the single file. */
export const pageAnchor = (out: string): string => out.replace(/\.html$/, '').replace(/\//g, '-');
/** An anchor inside a page, in the single file. */
export const innerAnchor = (out: string, id: string): string => `${pageAnchor(out)}--${id}`;

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s: string): string => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Rewrites an href written on page `from`: to an anchor when it names a guide page, else absolute. */
function hrefRewriter(pages: ReadonlySet<string>, baseUrl: string): (from: string, href: string) => string {
  const basePath = new URL(baseUrl).pathname;
  return (from, href) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
    if (href.startsWith('#')) return `#${innerAnchor(from, href.slice(1))}`;
    const url = new URL(href, baseUrl + from);
    const rel = decodeURI(url.pathname).slice(basePath.length);
    if (url.origin === new URL(baseUrl).origin && decodeURI(url.pathname).startsWith(basePath) && pages.has(rel) && !url.search) {
      return `#${url.hash ? innerAnchor(rel, url.hash.slice(1)) : pageAnchor(rel)}`;
    }
    return url.href;
  };
}

/** Rules the single page adds to the guide's stylesheet: its bar, its contents, and print. */
const EXPORT_CSS = `
.export-bar p { max-width: 46rem; margin: 0 auto; padding: .6rem 16px; display: flex; flex-wrap: wrap; gap: .4rem 1rem; align-items: center; font-size: .92rem; }
.export-bar button { font: inherit; color: var(--bg); background: var(--accent); border: 0; border-radius: 999px; padding: .25rem .9rem; cursor: pointer; }
nav.toc { display: block; padding: 0; max-width: none; font-size: 1rem; }
nav.toc ol { padding-left: 1.2rem; }
nav.toc ol ol { font-size: .93rem; }
section.page { border-top: 1px solid var(--line); margin-top: 2.5rem; }
@media print {
  :root { --bg: #fff; --fg: #000; --muted: #444; --accent: #0b5a4c; --card: #fff; --line: #bbb; --code: #eee; }
  header { position: static; display: none; }
  body { font-size: 11pt; }
  section.page { border-top: 0; margin-top: 0; break-before: page; }
  img { max-height: 9cm; width: auto; break-inside: avoid; }
  details > summary { list-style: none; }
  a { color: inherit; }
}
`;

/** `<ol>` from items in order, each one level at most deeper than the one before. */
function nestedList(items: { depth: number; html: string }[]): string {
  let out = '';
  let level = -1;
  for (const { depth, html } of items) {
    if (depth > level) out += '<ol>'.repeat(depth - level);
    else out += '</li>' + '</ol></li>'.repeat(level - depth);
    out += `<li>${html}`;
    level = depth;
  }
  return out + (level >= 0 ? '</li>' + '</ol></li>'.repeat(level) + '</ol>' : '');
}

/** The guide as one HTML page and one Markdown file: `GUIDE_EXPORTS.html` / `.md` -> text. */
export function buildExports(built: Built, opts: ExportOptions): Map<string, string> {
  const { css, baseUrl = GUIDE_LIVE_URL, title = 'Thoremin guide' } = opts;
  const rewrite = hrefRewriter(new Set(built.pages.keys()), baseUrl);
  const titleOf = (out: string): string => built.markdown.get(out)?.title ?? out;
  // An instrument sits under its area, an area under the instruments, a tool under the tools.
  const depth = (out: string): number => (out.startsWith('instruments/') ? 2 : out.includes('/') ? 1 : 0);

  // The contents: top pages, with the pages under them (an area's instruments, the tools) nested.
  const toc = (link: (out: string) => string): string[] => {
    const lines: string[] = [];
    for (const out of built.order) lines.push(`${'  '.repeat(depth(out))}${link(out)}`);
    return lines;
  };

  const sections = built.order.map((out) => {
    const main = built.pages.get(out)?.match(/<main>\n([\s\S]*?)\n<\/main>/)?.[1] ?? '';
    const inner = main
      .replace(/<figure><video[^>]*><\/video><\/figure>\n?/g, '')
      .replace(/ loading="lazy"/g, '')
      .replace(/<details>/g, '<details open>')
      .replace(/ id="([^"]+)"/g, (_m, id: string) => ` id="${innerAnchor(out, id)}"`)
      .replace(/ (href|src)="([^"]*)"/g, (_m, attr: string, v: string) => ` ${attr}="${esc(rewrite(out, unesc(v)))}"`);
    return `<section class="page" id="${pageAnchor(out)}">\n${inner}\n</section>`;
  });

  const tocHtml = `<nav class="toc" aria-label="Contents"><h2>Contents</h2>${nestedList(built.order.map((out) => ({ depth: depth(out), html: `<a href="#${pageAnchor(out)}">${esc(titleOf(out))}</a>` })))}</nav>`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="color-scheme" content="light dark">
<style>
${css}${EXPORT_CSS}</style>
</head>
<body>
<header class="export-bar"><p><strong>${esc(title)}</strong><span>The whole guide on one page.</span><button type="button" onclick="print()">Save as PDF</button><a href="${esc(baseUrl + GUIDE_EXPORTS.md)}">Markdown</a><a href="${esc(baseUrl)}index.html">The guide online</a></p></header>
<main>
<h1>${esc(title)}</h1>
<p>Thoremin turns your camera into a musical instrument. This is its player guide in one file; <a href="${esc(baseUrl)}index.html">the guide online</a> is always the latest.</p>
${tocHtml}
${sections.join('\n')}
</main>
<script>if (location.hash === '#print') addEventListener('load', function () { setTimeout(function () { print(); }, 300); });</script>
</body>
</html>
`;

  // Markdown: each page's headings one level down under its own anchor; `{#id}` headings get theirs.
  const mdPages = built.order.map((out) => {
    const md = (built.markdown.get(out)?.md ?? '')
      .replace(/^(#{1,5}) (.+?)(?: \{#([a-z0-9-]+)\})?$/gm, (_m, h: string, text: string, id?: string) => `${id ? `<a id="${innerAnchor(out, id)}"></a>\n\n` : ''}#${h} ${text}`)
      .replace(/\]\(([^)\s]+)\)/g, (_m, href: string) => `](${rewrite(out, href)})`);
    return `<a id="${pageAnchor(out)}"></a>\n\n${md.trim()}\n`;
  });
  const markdown = [
    `# ${title}`,
    `Thoremin turns your camera into a musical instrument. This is its player guide in one file; the guide online is at ${baseUrl}index.html.`,
    `## Contents`,
    toc((out) => `- [${titleOf(out)}](#${pageAnchor(out)})`).join('\n'),
    ...mdPages,
  ].join('\n\n');

  return new Map([
    [GUIDE_EXPORTS.html, html],
    [GUIDE_EXPORTS.md, markdown.trimEnd() + '\n'],
  ]);
}
