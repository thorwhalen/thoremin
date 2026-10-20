/**
 * The player guide's builder, pure of the file system's layout beyond reading `guide/`: Markdown
 * sources plus the registries' data in, a map of `path -> html` out. `scripts/gen_guide.ts` writes
 * it to `public/guide/`; the tests call it to check coverage and that the committed pages are the
 * ones the sources make.
 *
 * Source layout (`guide/`):
 *   areas.json            the instrument areas (id, title, blurb), in order
 *   *.md at the top (index, settings, troubleshooting, conduct-and-dance, teach-it-yourself, ...): free pages;
 *   settings.md has one `{#anchor}` heading per editor section
 *   instruments/<slug>.md one per shipped instrument: front matter `seed`, `area`, `do` (3 lines), `settings`
 *   tools/<id>.md         one per tool or shell control: front matter `tool`, `title`, `do`
 * Body Markdown (no hard wrap). `:::details Title` ... `:::` is a collapsed block (deferred disclosure).
 * Links between pages are `[text](instrument:Name)`, `(tool:id)`, `(settings:label)`, `(area:id)`,
 * `(manual:)`, `(app:)`; the builder resolves them and FAILS on a target that does not exist.
 * A picture is attached by name, not written: `pics/<slug>.jpg` (instruments), `pics/tool-<id>.jpg`
 * (tools), `pics/home.jpg` (the home page), plus `.webm` clips of the same name.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { marked } from 'marked';
import { guideSlug } from '../src/app/guide/links';

export interface Area {
  id: string;
  title: string;
  blurb: string;
}

interface Source {
  file: string;
  meta: Record<string, string | string[]>;
  body: string;
}

export interface Built {
  /** Output path (relative to `public/guide/`) -> HTML. */
  pages: Map<string, string>;
  /** The instrument names, tool ids and settings anchors the sources cover. */
  covers: { seeds: string[]; tools: string[]; sections: string[] };
  /** Files under `pics/` the pages reference. */
  media: string[];
  /** Problems the builder found (broken links, unknown fields, missing front matter). */
  problems: string[];
}

/** Front matter: `key: value` lines and `key:` followed by `- item` lines, between `---` fences. */
export function parseSource(file: string, text: string): Source {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { file, meta: {}, body: text };
  const meta: Record<string, string | string[]> = {};
  let list: string[] | null = null;
  for (const line of m[1].split('\n')) {
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && list) {
      list.push(item[1].trim());
      continue;
    }
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    if (kv[2] === '') meta[kv[1]] = list = [];
    else {
      meta[kv[1]] = kv[2].trim();
      list = null;
    }
  }
  return { file, meta, body: m[2] };
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const str = (v: string | string[] | undefined): string => (Array.isArray(v) ? v.join(' ') : (v ?? ''));
const list = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);

const listMd = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : []);

/** Build the whole guide from `root` (the repo root), reading `guide/` and `public/guide/pics/`. */
export function buildGuide(root: string): Built {
  const problems: string[] = [];
  const guideDir = join(root, 'guide');
  const mediaDir = join(root, 'public', 'guide', 'pics');
  const hasMedia = (name: string): boolean => existsSync(join(mediaDir, name));
  const media = new Set<string>();

  const areas = JSON.parse(readFileSync(join(guideDir, 'areas.json'), 'utf8')) as Area[];

  const read = (rel: string): Source => parseSource(rel, readFileSync(join(guideDir, rel), 'utf8'));
  const seeds = listMd(join(guideDir, 'instruments')).map((f) => read(`instruments/${f}`));
  const tools = listMd(join(guideDir, 'tools')).map((f) => read(`tools/${f}`));
  const free = listMd(guideDir).map(read);

  // The targets a link may name.
  const seedBySlug = new Map(seeds.map((s) => [guideSlug(str(s.meta.seed)), s]));
  const toolBySlug = new Map(tools.map((t) => [guideSlug(str(t.meta.tool)), t]));
  const settingsText = free.find((p) => p.file === 'settings.md')?.body ?? '';
  const anchors = [...settingsText.matchAll(/\{#([a-z0-9-]+)\}\s*$/gm)].map((m) => m[1]);
  const areaIds = new Set(areas.map((a) => a.id));

  for (const s of seeds) {
    if (!str(s.meta.seed)) problems.push(`${s.file}: front matter needs "seed: <instrument name>"`);
    if (guideSlug(str(s.meta.seed)) !== s.file.replace(/^instruments\/|\.md$/g, '')) problems.push(`${s.file}: the file name must be the slug of its seed "${str(s.meta.seed)}" (${guideSlug(str(s.meta.seed))}.md)`);
    if (!areaIds.has(str(s.meta.area))) problems.push(`${s.file}: area "${str(s.meta.area)}" is not in areas.json`);
    if (list(s.meta.do).length < 2) problems.push(`${s.file}: "do:" needs the two or three things to do`);
  }
  for (const t of tools) {
    if (!str(t.meta.tool) || !str(t.meta.title)) problems.push(`${t.file}: front matter needs "tool:" and "title:"`);
    if (guideSlug(str(t.meta.tool)) !== t.file.replace(/^tools\/|\.md$/g, '')) problems.push(`${t.file}: the file name must be the slug of its tool "${str(t.meta.tool)}"`);
    if (list(t.meta.do).length < 2) problems.push(`${t.file}: "do:" needs the two or three things to do`);
  }

  /** Where a page sits, for relative links. */
  const prefixOf = (out: string): string => '../'.repeat(out.split('/').length - 1);
  const hrefOf = (out: string, target: string): string => prefixOf(out) + target;

  /** Resolve `[text](kind:value)` links against the sources. */
  const resolveLinks = (md: string, out: string, from: string): string =>
    md.replace(/\]\((instrument|tool|settings|area|manual|app):([^)]*)\)/g, (_all, kind: string, value: string) => {
      let target: string | null = null;
      if (kind === 'instrument') target = seedBySlug.has(guideSlug(value)) ? `instruments/${guideSlug(value)}.html` : null;
      else if (kind === 'tool') target = toolBySlug.has(guideSlug(value)) ? `tools/${guideSlug(value)}.html` : null;
      else if (kind === 'settings') target = anchors.includes(guideSlug(value)) ? `settings.html#${guideSlug(value)}` : null;
      else if (kind === 'area') target = areaIds.has(value) ? `areas/${value}.html` : null;
      else if (kind === 'manual') return `](${prefixOf(out)}../manual.html${value})`;
      else return `](${prefixOf(out)}../${value})`;
      if (target === null) {
        problems.push(`${from}: the link ${kind}:${value} names nothing the guide has`);
        return '](#broken)';
      }
      return `](${hrefOf(out, target)})`;
    });

  /** Markdown to HTML, with `:::details Title` blocks and `{#id}` headings. */
  const render = (md: string, out: string, from: string): string => {
    const withLinks = resolveLinks(md, out, from);
    const inline = (s: string) => marked.parse(s, { async: false }) as string;
    const parts: string[] = [];
    let last = 0;
    for (const m of withLinks.matchAll(/^:::details (.+)\n([\s\S]*?)^:::\s*$/gm)) {
      parts.push(inline(headIds(withLinks.slice(last, m.index))));
      parts.push(`<details><summary>${esc(m[1])}</summary>\n${inline(headIds(m[2]))}</details>\n`);
      last = (m.index ?? 0) + m[0].length;
    }
    parts.push(inline(headIds(withLinks.slice(last))));
    return parts.join('\n');
  };
  const headIds = (md: string): string =>
    md.replace(/^(#{2,3}) (.+?) \{#([a-z0-9-]+)\}\s*$/gm, (_m, h: string, text: string, id: string) => `<h${h.length} id="${id}">${esc(text)}</h${h.length}>\n`);

  const nav = (out: string, current: string): string => {
    const p = prefixOf(out);
    const item = (key: string, label: string, href: string) => `<a href="${p}${href}"${key === current ? ' aria-current="page"' : ''}>${label}</a>`;
    return `<nav aria-label="Guide">${item('home', 'Guide', 'index.html')}${item('instruments', 'Instruments', 'instruments.html')}${item('tools', 'Tools', 'tools.html')}${item('settings', 'Settings', 'settings.html')}${item('troubleshooting', 'Troubleshooting', 'troubleshooting.html')}<a href="${p}../manual.html">Manual</a><a class="app" href="${p}../">Back to the app</a></nav>`;
  };

  const shell = (out: string, current: string, title: string, inner: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Thoremin guide</title>
<meta name="color-scheme" content="light dark">
<link rel="stylesheet" href="${prefixOf(out)}guide.css">
</head>
<body>
<header>${nav(out, current)}</header>
<main>
${inner}
</main>
<footer><p>Thoremin turns your camera into a musical instrument. Everything runs in your browser: nothing you play is uploaded. <a href="${prefixOf(out)}../">Open the app</a>.</p></footer>
</body>
</html>
`;

  /** A picture (and a clip) attached by name. */
  const figure = (out: string, name: string, alt: string): string => {
    let html = '';
    if (hasMedia(`${name}.jpg`)) {
      media.add(`${name}.jpg`);
      html += `<figure><img src="${prefixOf(out)}pics/${name}.jpg" alt="${esc(alt)}" loading="lazy"></figure>\n`;
    }
    if (hasMedia(`${name}.webm`)) {
      media.add(`${name}.webm`);
      html += `<figure><video src="${prefixOf(out)}pics/${name}.webm" muted loop playsinline controls preload="metadata" aria-label="${esc(alt)}"></video></figure>\n`;
    }
    return html;
  };

  const doList = (items: string[], out: string, from: string): string => `<ol class="do">${items.map((i) => `<li>${inlineOnly(i, out, from)}</li>`).join('')}</ol>`;
  const inlineOnly = (s: string, out: string, from: string): string => (marked.parseInline(resolveLinks(s, out, from), { async: false }) as string).trim();

  const pages = new Map<string, string>();

  // Free pages.
  for (const p of free) {
    const out = p.file.replace(/\.md$/, '.html');
    const key = out === 'index.html' ? 'home' : out.replace('.html', '');
    const title = str(p.meta.title) || 'Guide';
    pages.set(out, shell(out, key, title, `<h1>${esc(title)}</h1>\n${out === 'index.html' ? figure(out, 'home', 'Thoremin, with the instrument list open') : ''}${render(p.body, out, p.file)}`));
  }

  // Instruments: one page each, an area page, and the index of areas.
  const seedsOf = (area: string) => seeds.filter((s) => str(s.meta.area) === area);
  for (const s of seeds) {
    const name = str(s.meta.seed);
    const slug = guideSlug(name);
    const out = `instruments/${slug}.html`;
    const area = areas.find((a) => a.id === str(s.meta.area));
    const siblings = seedsOf(str(s.meta.area));
    const at = siblings.indexOf(s);
    const prev = siblings[at - 1];
    const next = siblings[at + 1];
    const settings = list(s.meta.settings).map((label) => `<a href="${hrefOf(out, `settings.html#${guideSlug(label)}`)}">${esc(label)}</a>`);
    for (const label of list(s.meta.settings)) if (!anchors.includes(guideSlug(label))) problems.push(`${s.file}: settings "${label}" is not a section of settings.md`);
    const inner = [
      `<p class="crumbs"><a href="${hrefOf(out, 'instruments.html')}">Instruments</a> › <a href="${hrefOf(out, `areas/${area?.id}.html`)}">${esc(area?.title ?? '')}</a></p>`,
      `<h1>${esc(name)}</h1>`,
      figure(out, slug, `${name}, as it looks on screen`),
      `<h2>What to do</h2>`,
      doList(list(s.meta.do), out, s.file),
      render(s.body, out, s.file),
      `<p class="more">${settings.length ? `Its settings: ${settings.join(', ')}. ` : ''}Every knob: <a href="${hrefOf(out, '../manual.html')}">the manual</a>.</p>`,
      `<p class="pager">${prev ? `<a href="${hrefOf(out, `instruments/${guideSlug(str(prev.meta.seed))}.html`)}">‹ ${esc(str(prev.meta.seed))}</a>` : '<span></span>'}${next ? `<a href="${hrefOf(out, `instruments/${guideSlug(str(next.meta.seed))}.html`)}">${esc(str(next.meta.seed))} ›</a>` : '<span></span>'}</p>`,
    ].join('\n');
    pages.set(out, shell(out, 'instruments', name, inner));
  }
  const card = (out: string, href: string, title: string, items: string[], img: string, from: string): string =>
    `<li class="card">${img ? `<a href="${hrefOf(out, href)}"><img src="${prefixOf(out)}pics/${img}" alt="" loading="lazy"></a>` : ''}<div><h3><a href="${hrefOf(out, href)}">${esc(title)}</a></h3><p>${inlineOnly(items[0] ?? '', out, from)}</p></div></li>`;
  for (const a of areas) {
    const out = `areas/${a.id}.html`;
    const cards = seedsOf(a.id).map((s) => {
      const slug = guideSlug(str(s.meta.seed));
      if (hasMedia(`${slug}.jpg`)) media.add(`${slug}.jpg`);
      return card(out, `instruments/${slug}.html`, str(s.meta.seed), list(s.meta.do), hasMedia(`${slug}.jpg`) ? `${slug}.jpg` : '', s.file);
    });
    pages.set(out, shell(out, 'instruments', a.title, `<p class="crumbs"><a href="${hrefOf(out, 'instruments.html')}">Instruments</a></p><h1>${esc(a.title)}</h1><p>${esc(a.blurb)}</p><ul class="cards">${cards.join('')}</ul>`));
  }
  {
    const out = 'instruments.html';
    const inner = areas
      .map((a) => `<h2><a href="${hrefOf(out, `areas/${a.id}.html`)}">${esc(a.title)}</a></h2><p>${esc(a.blurb)}</p><p class="chips">${seedsOf(a.id).map((s) => `<a href="${hrefOf(out, `instruments/${guideSlug(str(s.meta.seed))}.html`)}">${esc(str(s.meta.seed))}</a>`).join('')}</p>`)
      .join('\n');
    pages.set(out, shell(out, 'instruments', 'Instruments', `<h1>Instruments</h1><p>Every instrument that comes with thoremin, grouped by what you play it with. Open one for what to do, and how it works.</p>\n${inner}`));
  }

  // Tools: one page each and the index.
  for (const t of tools) {
    const id = str(t.meta.tool);
    const slug = guideSlug(id);
    const out = `tools/${slug}.html`;
    const settings = list(t.meta.settings).map((label) => `<a href="${hrefOf(out, `settings.html#${guideSlug(label)}`)}">${esc(label)}</a>`);
    for (const label of list(t.meta.settings)) if (!anchors.includes(guideSlug(label))) problems.push(`${t.file}: settings "${label}" is not a section of settings.md`);
    const inner = [
      `<p class="crumbs"><a href="${hrefOf(out, 'tools.html')}">Tools</a></p>`,
      `<h1>${esc(str(t.meta.title))}</h1>`,
      figure(out, `tool-${slug}`, `${str(t.meta.title)}, open in the app`),
      `<h2>What to do</h2>`,
      doList(list(t.meta.do), out, t.file),
      render(t.body, out, t.file),
      settings.length ? `<p class="more">Its settings: ${settings.join(', ')}.</p>` : '',
    ].join('\n');
    pages.set(out, shell(out, 'tools', str(t.meta.title), inner));
  }
  {
    const out = 'tools.html';
    const cards = tools.map((t) => {
      const slug = guideSlug(str(t.meta.tool));
      if (hasMedia(`tool-${slug}.jpg`)) media.add(`tool-${slug}.jpg`);
      return card(out, `tools/${slug}.html`, str(t.meta.title), list(t.meta.do), hasMedia(`tool-${slug}.jpg`) ? `tool-${slug}.jpg` : '', t.file);
    });
    pages.set(out, shell(out, 'tools', 'Tools', `<h1>Tools</h1><p>What you use ON an instrument: measuring, teaching it your own faces, recording, conducting. Open the Tools menu in the app to reach them.</p><ul class="cards">${cards.join('')}</ul>`));
  }

  return { pages, covers: { seeds: seeds.map((s) => str(s.meta.seed)), tools: tools.map((t) => str(t.meta.tool)), sections: anchors }, media: [...media], problems };
}
