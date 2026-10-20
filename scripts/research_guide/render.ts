/**
 * The guide's pages as static HTML: an overview that fits one screen, then research,
 * experiments, decisions and horizon pages, and one reading page per doc (repo docs and
 * private working docs alike, rendered from their Markdown so the guide reads on a
 * phone). Pure functions from a `GuideModel` to strings; `build.ts` writes them.
 *
 * Colours are CSS tokens with a dark-mode set; diagrams are Mermaid (loaded from a
 * pinned CDN build) and charts inline SVG, so the site is a folder with no build step.
 */
import { Marked } from 'marked';
import { GITHUB } from './config';
import { measureSvg } from './charts';
import type { Chart, Decision, Diagram, DocEntry, Experiment, GuideData, Idea } from './schema';
import type { DiskDoc, GhData, GhIssue } from './sources';
import type { StaleReport } from './staleness';

export interface GuideModel {
  data: GuideData;
  /** Curated entries (public and private), keyed by path. */
  entries: Map<string, DocEntry>;
  experiments: Experiment[];
  ideas: Idea[];
  disk: Map<string, DiskDoc>;
  gh: GhData;
  report: StaleReport;
  /** Every chart (public and private) and its rendered figure, by id. */
  charts: Chart[];
  chartHtml: Map<string, string>;
  diagrams: Diagram[];
  annals: Record<string, string>;
  /** Doc path -> the site-relative files of its figures (copied into the site). */
  figures: Map<string, string[]>;
  builtAt: string;
}

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const slugOf = (path: string) => path.replace(/^private:/, 'p-').replace(/\.md$/, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const docPage = (path: string) => `doc/${slugOf(path)}.html`;
const githubBlob = (path: string) => `${GITHUB}/blob/main/${path}`;

const STATUS_TONE: Record<string, string> = {
  current: 'ok', implemented: 'ok', accepted: 'ok', positive: 'ok',
  'design-record': 'info', proposed: 'info', mixed: 'info', inconclusive: 'muted',
  open: 'warn', 'measured-negative': 'neg', negative: 'neg', rejected: 'neg',
  superseded: 'muted', moved: 'muted',
};
const badge = (s: string) => `<span class="badge ${STATUS_TONE[s] ?? 'muted'}">${esc(s.replace('-', ' '))}</span>`;

function refLinks(m: GuideModel, { issues = [], prs = [] }: { issues?: number[]; prs?: number[] }): string {
  const issueBy = new Map(m.gh.issues.map((i) => [i.number, i]));
  const prBy = new Map(m.gh.prs.map((p) => [p.number, p]));
  const one = (n: number, kind: 'issue' | 'pr') => {
    const i = issueBy.get(n), p = prBy.get(n);
    const title = p?.title ?? i?.title ?? '';
    const url = p?.url ?? i?.url ?? `${GITHUB}/${kind === 'pr' ? 'pull' : 'issues'}/${n}`;
    const closed = i?.state === 'CLOSED' || !!p;
    return `<a class="ref${closed ? ' closed' : ''}" href="${url}" title="${esc(title)}">#${n}</a>`;
  };
  const all = [...new Set(issues)].map((n) => one(n, 'issue')).concat([...new Set(prs)].map((n) => one(n, 'pr')));
  return all.length ? `<span class="refs">${all.join(' ')}</span>` : '';
}

const NAV: Array<[string, string]> = [
  ['index.html', 'Overview'], ['research.html', 'Research'], ['experiments.html', 'Experiments'],
  ['decisions.html', 'Decisions'], ['timeline.html', 'Timeline'], ['horizon.html', 'Horizon'],
];

const CSS = `
:root{--bg:#fbfaf7;--fg:#1d1d1f;--muted:#6b6b70;--card:#fff;--line:#e4e2dc;--accent:#3b5bdb;--ok:#2b8a3e;--info:#1971c2;--warn:#e67700;--neg:#c92a2a;--chip:#f1efe9;--bar:#91a7ff;--top:#3b5bdb}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#141416;--fg:#ececee;--muted:#9a9aa2;--card:#1c1c20;--line:#2e2e34;--accent:#91a7ff;--ok:#69db7c;--info:#74c0fc;--warn:#ffc078;--neg:#ff8787;--chip:#26262c;--bar:#4c6ef5;--top:#91a7ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}header{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line)}
nav{display:flex;gap:4px;overflow-x:auto;padding:8px 16px;max-width:1100px;margin:0 auto}nav a{padding:6px 10px;border-radius:8px;text-decoration:none;white-space:nowrap;color:var(--fg)}nav a.on{background:var(--chip);font-weight:600}
main{max-width:1100px;margin:0 auto;padding:16px}h1{font-size:1.6rem;margin:.4em 0}h2{margin-top:1.6em;border-bottom:1px solid var(--line);padding-bottom:4px}
.lede{color:var(--muted);max-width:60ch}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px}.card h3{margin:.1em 0 .3em;font-size:1.05rem}
.meta{color:var(--muted);font-size:.85rem}.badge{display:inline-block;font-size:.72rem;padding:1px 7px;border-radius:999px;border:1px solid currentColor;margin-right:4px;vertical-align:middle}
.ok{color:var(--ok)}.info{color:var(--info)}.warn{color:var(--warn)}.neg{color:var(--neg)}.muted{color:var(--muted)}
.refs{display:inline-flex;flex-wrap:wrap;gap:4px}.ref{font-size:.8rem;background:var(--chip);padding:0 6px;border-radius:6px;text-decoration:none}.ref.closed{opacity:.75}
.links{display:flex;flex-wrap:wrap;gap:10px;font-size:.9rem;margin-top:6px}ul.nums{margin:.4em 0;padding-left:1.1em;font-size:.92rem}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.tile{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px;text-decoration:none;color:var(--fg)}.tile b{font-size:1.6rem;display:block}
.needs{border-left:4px solid var(--warn)}.progress{height:8px;background:var(--chip);border-radius:4px;overflow:hidden}.progress span{display:block;height:100%;background:var(--ok)}
details>summary{cursor:pointer;font-weight:600}details{margin:.4em 0}table{border-collapse:collapse;width:100%;font-size:.92rem}td,th{border-bottom:1px solid var(--line);padding:5px 6px;text-align:left;vertical-align:top}
.chart{width:100%;max-width:460px}.ch-label,.ch-value,.ch-axis{font-size:13px;fill:var(--fg)}.ch-axis{fill:var(--muted)}.ch-bar{fill:var(--bar)}.ch-pass{fill:var(--ok)}.ch-fail{fill:var(--neg)}.ch-base{fill:var(--line)}.ch-ref{stroke:var(--warn);stroke-width:2;stroke-dasharray:4 3}
.media{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin:8px 0}.media figure{margin:0}.media img,.media video{width:100%;border-radius:10px;border:1px solid var(--line)}
.pics{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,460px),1fr));gap:12px;margin:10px 0}.pic{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px;min-width:0}.pic h4{margin:0 0 4px}
.tl{list-style:none;padding:0;margin:0;border-left:2px solid var(--line)}.tl li{position:relative;padding:4px 0 4px 16px}.tl li::before{content:"";position:absolute;left:-6px;top:11px;width:10px;height:10px;border-radius:50%;background:var(--muted)}
.tl li.k-doc::before{background:var(--info)}.tl li.k-decision::before{background:var(--warn)}.tl li.k-experiment::before{background:var(--ok)}.tl li.k-pr::before{background:var(--bar)}.tl .when{color:var(--muted);font-size:.8rem;margin-right:6px}.ch-top{fill:var(--top)}
.doc{max-width:760px}.doc img{max-width:100%}.doc pre{overflow-x:auto;background:var(--chip);padding:8px;border-radius:8px}.doc table{display:block;overflow-x:auto}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}.gallery img{width:100%;border-radius:8px}
.filters{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}.filters label{background:var(--chip);padding:3px 10px;border-radius:999px;font-size:.88rem}
@media (max-width:640px){table.stack tr{display:block;border-bottom:1px solid var(--line);padding:6px 0}table.stack td,table.stack th{display:block;border:0;padding:2px 0}table.stack tr:first-child{display:none}}
.mermaid{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:8px;overflow-x:auto}footer{color:var(--muted);font-size:.8rem;padding:24px 16px;text-align:center}
`;

function page(m: GuideModel, { file, title, body, depth = 0, mermaid = false }: {
  file: string; title: string; body: string; depth?: number; mermaid?: boolean;
}): string {
  const up = depth ? '../'.repeat(depth) : '';
  const nav = NAV.map(([href, label]) => `<a href="${up}${href}"${href === file ? ' class="on"' : ''}>${label}</a>`).join('');
  const mer = mermaid
    ? `<script type="module">import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.esm.min.mjs';`
      + `mermaid.initialize({startOnLoad:true,theme:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'default'});</script>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${esc(title)}</title><style>${CSS}</style></head><body><header><nav>${nav}</nav></header><main>${body}</main>`
    + `<footer>thoremin research guide, private. Built ${esc(m.builtAt.slice(0, 16).replace('T', ' '))}Z from the repo, GitHub (fetched ${esc(m.gh.fetchedAt.slice(0, 16).replace('T', ' '))}Z) and the working notes. Rebuild: <code>npm run research-guide -- --publish</code>.</footer>${mer}</body></html>`;
}

function docCard(m: GuideModel, e: DocEntry): string {
  const d = m.disk.get(e.path);
  const dates = d ? `${d.created && d.created !== d.updated ? `${d.created} → ` : ''}${d.updated}` : 'missing on disk';
  const annals = e.annals ?? m.annals[e.path];
  const pictures = m.diagrams.filter((g) => g.doc === e.path).length;
  const links = [
    d ? `<a href="${docPage(e.path)}">Read</a>` : '',
    e.path.startsWith('private:') ? '<span class="muted">private note</span>' : `<a href="${githubBlob(e.path)}">GitHub</a>`,
    annals ? `<a href="${esc(annals)}">annals page</a>` : '',
    pictures ? `<a href="#pics-${e.area}">${pictures} diagram${pictures > 1 ? 's' : ''}</a>` : '',
  ].filter(Boolean).join(' · ');
  const chart = m.charts.filter((c) => c.doc === e.path).map((c) => m.chartHtml.get(c.id) ?? '').join('');
  const figs = (m.figures.get(e.path) ?? []).filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f)).slice(0, 3)
    .map((f) => `<img src="${f}" alt="" loading="lazy">`).join('');
  return `<article class="card" id="${slugOf(e.path)}"><h3>${esc(e.title)}</h3>`
    + `<div class="meta">${badge(e.status)} ${esc(dates)}</div><p>${esc(e.abstract)}</p>`
    + (e.numbers?.length ? `<ul class="nums">${e.numbers.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '')
    + chart + (figs ? `<div class="gallery">${figs}</div>` : '')
    + `<div class="links">${links} ${refLinks(m, e)}</div></article>`;
}

function needsYou(m: GuideModel): { html: string; count: number } {
  const manual = m.gh.issues.filter((i) => i.state === 'OPEN' && i.labels.includes('manual-task'));
  const openDecisions = m.data.decisions.filter((d) => d.status === 'open');
  const rows = manual.map((i) => `<li><a href="${i.url}">#${i.number}</a> ${esc(i.title)}</li>`).join('');
  const dec = openDecisions.map((d) => `<li>${d.issue ? `<a href="${GITHUB}/issues/${d.issue}">#${d.issue}</a> ` : ''}${esc(d.title)}</li>`).join('');
  return {
    count: manual.length + openDecisions.length,
    html: `<section class="card needs"><h3>Needs you</h3><p class="meta">Tasks only you can do (the <code>manual-task</code> label), then decisions still open.</p>`
      + `<ul>${rows}</ul>${dec ? `<details><summary>Open decisions (${openDecisions.length})</summary><ul>${dec}</ul></details>` : ''}</section>`,
  };
}

function changedSince(m: GuideModel): string {
  const r = m.report;
  const items = [
    ...r.newDocs.map((d) => `New doc: <a href="${docPage(d.path)}">${esc(d.title)}</a>`),
    ...r.changedDocs.map((d) => `Changed: <a href="${docPage(d.path)}">${esc(d.title)}</a>`),
    ...r.decisionsMoved.map((d) => `Decision moved: <a href="${GITHUB}/issues/${d.issue}">#${d.issue}</a> ${esc(d.title)}`),
    ...r.newManualTasks.map((i) => `New task for you: <a href="${GITHUB}/issues/${i.number}">#${i.number}</a> ${esc(i.title)}`),
  ];
  const unc = r.uncurated.length ? `<p class="meta">${r.uncurated.length} doc(s) have no abstract yet: see <a href="research.html#uncurated">Research</a>.</p>` : '';
  return `<section class="card"><h3>Since the last build${r.since ? ` (${esc(r.since.slice(0, 10))})` : ''}</h3>`
    + (items.length ? `<ul>${items.map((s) => `<li>${s}</li>`).join('')}</ul>` : '<p class="meta">Nothing new.</p>') + unc + '</section>';
}

export function renderIndex(m: GuideModel): string {
  const entries = [...m.entries.values()];
  const neg = m.experiments.filter((e) => e.verdict === 'negative').length;
  const openIssues = m.gh.issues.filter((i) => i.state === 'OPEN').length;
  const nd = needsYou(m);
  const tiles = [
    ['research.html', entries.length, 'research and design docs'],
    ['experiments.html', m.experiments.length, `experiments (${neg} measured negative)`],
    ['decisions.html', m.data.decisions.length, `decisions (${m.data.decisions.filter((d) => d.status === 'open').length} open)`],
    ['timeline.html', m.gh.prs.length, 'merged PRs on the timeline'],
    ['horizon.html', openIssues, 'open issues'],
    ['horizon.html#needs', nd.count, 'waiting on you'],
  ].map(([href, n, label]) => `<a class="tile" href="${href}"><b>${n}</b>${label}</a>`).join('');
  const areas = m.data.areas.map((a) => {
    const n = entries.filter((e) => e.area === a.id).length;
    const x = m.experiments.filter((e) => e.area === a.id).length;
    return `<a class="tile" href="research.html#area-${a.id}"><strong>${esc(a.title)}</strong><br><span class="meta">${n} docs · ${x} experiments</span></a>`;
  }).join('');
  const diagrams = m.diagrams.filter((d) => !d.area).map((d) => `<h3>${esc(d.title)}</h3><p class="meta">${esc(d.caption)}</p><pre class="mermaid">${esc(d.mermaid)}</pre>`).join('');
  const body = `<h1>thoremin: research, decisions, horizon</h1><p class="lede">Everything thoremin has researched, measured and decided, and what is planned. Private to you; rebuilt from the repo, GitHub and the working notes.</p>`
    + `<div class="tiles">${tiles}</div><div class="grid" style="margin-top:12px">${nd.html}${changedSince(m)}</div>`
    + `<h2>By area</h2><div class="tiles">${areas}</div>`
    + (diagrams ? `<h2>The architecture in pictures</h2>${diagrams}` : '');
  return page(m, { file: 'index.html', title: 'thoremin research guide', body, mermaid: !!diagrams });
}

/** An area's diagrams and its charts not shown on a card: the pictures strip above the cards. */
function areaPictures(m: GuideModel, area: string): string {
  const title = (path?: string) => (path ? m.entries.get(path)?.title ?? path : '');
  const from = (path?: string) => (path && m.entries.has(path) ? `<p class="meta">From <a href="#${slugOf(path)}">${esc(title(path))}</a></p>` : '');
  const diagrams = m.diagrams.filter((d) => d.area === area).map((d) =>
    `<div class="pic"><h4>${esc(d.title)}</h4><p class="meta">${esc(d.caption)}</p><pre class="mermaid">${esc(d.mermaid)}</pre>${from(d.doc)}</div>`);
  const charts = m.charts.filter((c) => c.area === area && !(c.doc && m.entries.has(c.doc))).map((c) =>
    `<div class="pic"><h4>${esc(c.title)}</h4>${m.chartHtml.get(c.id) ?? ''}${from(c.doc)}</div>`);
  const all = [...diagrams, ...charts];
  return all.length ? `<div class="pics" id="pics-${area}">${all.join('')}</div>` : '';
}

export function renderResearch(m: GuideModel): string {
  const entries = [...m.entries.values()];
  const sections = m.data.areas.map((a) => {
    const cards = entries.filter((e) => e.area === a.id);
    const pics = areaPictures(m, a.id);
    if (!cards.length && !pics) return '';
    const guide = a.guide ? `<p><a href="${esc(a.guide.url)}">${esc(a.guide.label)}</a> (the player guide)</p>` : '';
    // Served by the app (the player guide): a picture not deployed yet hides itself rather than showing a broken image.
    const media = a.media.length ? `<div class="media">${a.media.map((x) => {
      const el = x.kind === 'video'
        ? `<video src="${esc(x.src)}" muted loop playsinline autoplay preload="metadata" aria-label="${esc(x.alt)}" onerror="this.closest('figure').hidden=true"></video>`
        : `<img src="${esc(x.src)}" alt="${esc(x.alt)}" loading="lazy" onerror="this.closest('figure').hidden=true">`;
      return `<figure>${x.href ? `<a href="${esc(x.href)}">${el}</a>` : el}<figcaption class="meta">${esc(x.alt)}</figcaption></figure>`;
    }).join('')}</div>` : '';
    return `<h2 id="area-${a.id}">${esc(a.title)}</h2><p class="lede">${esc(a.blurb)}</p>${guide}${media}${pics}<div class="grid">${cards.map((e) => docCard(m, e)).join('')}</div>`;
  }).join('');
  const unc = m.report.uncurated.length
    ? `<h2 id="uncurated">New, needs an abstract</h2><p class="lede">On disk but not in the curation file yet. Add an entry to <code>scripts/research_guide/guide.json</code> (repo docs) or to the private overlay (private docs).</p><ul>`
      + m.report.uncurated.map((d) => `<li><a href="${docPage(d.path)}">${esc(d.title)}</a> <span class="meta">${esc(d.path)} · ${esc(d.updated)}</span></li>`).join('') + '</ul>'
    : '';
  const toc = m.data.areas.filter((a) => entries.some((e) => e.area === a.id)).map((a) => `<a href="#area-${a.id}">${esc(a.title)}</a>`).join(' · ');
  return page(m, { file: 'research.html', title: 'Research · thoremin', mermaid: m.diagrams.some((d) => d.area), body: `<h1>Research</h1><p class="lede">One card per research map, measurement write-up and design record, by area. "Read" opens the doc here; GitHub opens it in the repo.</p><p>${toc}</p>${unc}${sections}` });
}

export function renderExperiments(m: GuideModel): string {
  const verdicts = ['positive', 'negative', 'mixed', 'inconclusive'] as const;
  const filters = verdicts.map((v) => `<label><input type="checkbox" checked data-v="${v}"> ${v} (${m.experiments.filter((e) => e.verdict === v).length})</label>`).join('');
  const sections = m.data.areas.map((a) => {
    const xs = m.experiments.filter((e) => e.area === a.id);
    if (!xs.length) return '';
    return `<h2>${esc(a.title)}</h2><div class="grid">` + xs.map((e) => `<article class="card x" data-v="${e.verdict}"><h3>${esc(e.title)}</h3>`
      + `<div class="meta">${badge(e.verdict)} ${esc(e.date ?? '')}${e.source ? ' · from a working note' : ''}</div>`
      + `<p><strong>${esc(e.number)}</strong></p>${e.measure ? measureSvg(e.measure) : ''}<p>${esc(e.summary)}</p><div class="links">`
      + (e.doc && m.disk.has(e.doc) ? `<a href="${docPage(e.doc)}">doc</a>` : '') + ` ${refLinks(m, e)}</div></article>`).join('') + '</div>';
  }).join('');
  const js = `<script>document.querySelectorAll('.filters input').forEach(c=>c.addEventListener('change',()=>{const on=[...document.querySelectorAll('.filters input:checked')].map(i=>i.dataset.v);document.querySelectorAll('.x').forEach(x=>x.style.display=on.includes(x.dataset.v)?'':'none')}))</script>`;
  return page(m, { file: 'experiments.html', title: 'Experiments · thoremin', body: `<h1>Experiments and measurements</h1><p class="lede">What was measured, the headline number, and the verdict. Negatives are kept: each one is a door closed with a reason.</p><div class="filters">${filters}</div>${sections}${js}` });
}

function decisionRow(m: GuideModel, d: Decision): string {
  const where = d.path && m.disk.has(d.path) ? `<a href="${docPage(d.path)}">${esc(d.title)}</a>` : d.issue ? `<a href="${GITHUB}/issues/${d.issue}">${esc(d.title)}</a>` : esc(d.title);
  return `<tr><td>${badge(d.status)}</td><td>${where}${d.supersededBy ? `<br><span class="meta">superseded by ${esc(d.supersededBy)}</span>` : ''}</td><td>${esc(d.decided)} ${refLinks(m, { prs: d.prs })}</td></tr>`;
}

export function renderDecisions(m: GuideModel): string {
  const adrs = m.data.decisions.filter((d) => d.kind !== 'decision');
  const byIssue = new Map<number, Decision[]>();
  for (const d of m.data.decisions.filter((x) => x.kind === 'decision')) byIssue.set(d.issue ?? 0, [...(byIssue.get(d.issue ?? 0) ?? []), d]);
  const issueBy = new Map(m.gh.issues.map((i) => [i.number, i]));
  const table = (ds: Decision[]) => `<table class="stack"><tr><th>Status</th><th>What</th><th>Decided</th></tr>${ds.map((d) => decisionRow(m, d)).join('')}</table>`;
  const groups = [...byIssue].map(([n, ds]) => {
    const i = issueBy.get(n);
    const open = ds.filter((d) => d.status === 'open').length;
    return `<details${open ? ' open' : ''}><summary>${n ? `#${n} ` : ''}${esc(i?.title ?? 'Other decisions')} <span class="meta">(${ds.length}${open ? `, ${open} open` : ''})</span></summary>${n ? `<p><a href="${GITHUB}/issues/${n}">Open the issue</a></p>` : ''}${table(ds)}</details>`;
  }).join('');
  return page(m, { file: 'decisions.html', title: 'Decisions · thoremin', body: `<h1>ADRs, design records and decisions</h1><p class="lede">The design documents (each the single source of truth for its subsystem), then the decisions taken on issues, one row per choice.</p><h2>Design documents and ADRs</h2>${table(adrs)}<h2>Decisions on issues</h2>${groups}` });
}

export interface TimelineItem { date: string; kind: 'doc' | 'decision' | 'experiment' | 'pr'; html: string; area?: string }

/** Research, decisions, experiments and merges on one dated line, newest first. */
export function timelineItems(m: GuideModel): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const e of m.entries.values()) {
    const d = m.disk.get(e.path);
    if (d?.created) items.push({ date: d.created, kind: 'doc', area: e.area, html: `Research: <a href="${docPage(e.path)}">${esc(e.title)}</a>` });
    else if (d) items.push({ date: d.updated, kind: 'doc', area: e.area, html: `Note: <a href="${docPage(e.path)}">${esc(e.title)}</a>` });
  }
  const issueBy = new Map(m.gh.issues.map((i) => [i.number, i]));
  for (const d of m.data.decisions) {
    const disk = d.path ? m.disk.get(d.path) : undefined;
    const date = d.date ?? disk?.created ?? (d.issue ? issueBy.get(d.issue)?.createdAt.slice(0, 10) : undefined);
    if (date) items.push({ date, kind: 'decision', html: `Decision ${badge(d.status)} ${d.issue ? `<a href="${GITHUB}/issues/${d.issue}">${esc(d.title)}</a>` : esc(d.title)}` });
  }
  for (const x of m.experiments) if (x.date) items.push({ date: x.date, kind: 'experiment', area: x.area, html: `Measured ${badge(x.verdict)} <a href="experiments.html">${esc(x.title)}</a>: ${esc(x.number)}` });
  for (const p of m.gh.prs) items.push({ date: p.mergedAt.slice(0, 10), kind: 'pr', html: `Merged <a href="${p.url}">#${p.number}</a> ${esc(p.title)}` });
  return items.sort((a, b) => b.date.localeCompare(a.date));
}

export function renderTimeline(m: GuideModel): string {
  const items = timelineItems(m);
  const kinds: Array<[TimelineItem['kind'], string]> = [['doc', 'research'], ['decision', 'decisions'], ['experiment', 'experiments'], ['pr', 'merged PRs']];
  const filters = kinds.map(([k, label]) => `<label><input type="checkbox" data-k="${k}"${k === 'pr' ? '' : ' checked'}> ${label} (${items.filter((i) => i.kind === k).length})</label>`).join('');
  const months = new Map<string, TimelineItem[]>();
  for (const i of items) months.set(i.date.slice(0, 7), [...(months.get(i.date.slice(0, 7)) ?? []), i]);
  const body = [...months].map(([month, is], n) => {
    const counts = kinds.map(([k, label]) => [is.filter((i) => i.kind === k).length, label] as const).filter(([c]) => c).map(([c, l]) => `${c} ${l}`).join(', ');
    return `<details${n < 2 ? ' open' : ''}><summary>${month} <span class="meta">(${counts})</span></summary><ul class="tl">`
      + is.map((i) => `<li class="k-${i.kind}" data-k="${i.kind}"${i.kind === 'pr' ? ' style="display:none"' : ''}><span class="when">${i.date}</span>${i.html}</li>`).join('') + '</ul></details>';
  }).join('');
  const js = `<script>const f=()=>{const on=[...document.querySelectorAll('.filters input:checked')].map(i=>i.dataset.k);document.querySelectorAll('.tl li').forEach(l=>l.style.display=on.includes(l.dataset.k)?'':'none')};document.querySelectorAll('.filters input').forEach(c=>c.addEventListener('change',f))</script>`;
  return page(m, { file: 'timeline.html', title: 'Timeline · thoremin', body: `<h1>Timeline</h1><p class="lede">Research written, decisions taken, experiments measured and pull requests merged, by month, newest first. Merged PRs are hidden until you tick them.</p><div class="filters">${filters}</div>${body}${js}` });
}

function themeOf(m: GuideModel, i: GhIssue): string {
  const t = i.title.toLowerCase();
  return m.data.themes.find((th) => th.labels?.some((l) => i.labels.includes(l)) || th.keywords.some((k) => t.includes(k.toLowerCase())))?.id ?? 'other';
}

export function renderHorizon(m: GuideModel): string {
  const nd = needsYou(m);
  const epics = m.gh.epics.map((e) => {
    const total = e.subTotal || e.boxTotal, done = e.subTotal ? e.subDone : e.boxDone;
    const pct = total ? Math.round((100 * done) / total) : 0;
    return `<article class="card"><h3><a href="${e.url}">#${e.number}</a> ${esc(e.title)}</h3><div class="meta">${badge(e.state === 'OPEN' ? 'open' : 'implemented')} ${total ? `${done} of ${total} ${e.subTotal ? 'sub-issues' : 'items'} done` : 'no checklist'}</div>`
      + (total ? `<div class="progress"><span style="width:${pct}%"></span></div>` : '') + '</article>';
  }).join('');
  const open = m.gh.issues.filter((i) => i.state === 'OPEN' && !i.labels.includes('manual-task'));
  const themes = [...m.data.themes, { id: 'other', title: 'Everything else', keywords: [] as string[] }].map((th) => {
    const is = open.filter((i) => themeOf(m, i) === th.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (!is.length) return '';
    return `<details><summary>${esc(th.title)} <span class="meta">(${is.length})</span></summary><ul>${is.map((i) => `<li><a href="${i.url}">#${i.number}</a> ${esc(i.title)} <span class="meta">${i.updatedAt.slice(0, 10)}</span></li>`).join('')}</ul></details>`;
  }).join('');
  const disc = m.gh.discussions.map((d) => `<article class="card"><h3><a href="${d.url}">Discussion #${d.number}</a> ${esc(d.title)}</h3><div class="meta">${d.comments} comments · updated ${d.updatedAt.slice(0, 10)}</div><p>${esc(d.excerpt)}</p></article>`).join('');
  const ideas = m.ideas.map((i) => `<tr><td>${esc(i.title)}</td><td>${esc(i.summary)}</td><td>${i.issue ? refLinks(m, { issues: [i.issue] }) : '<span class="warn">untracked</span>'}</td></tr>`).join('');
  return page(m, { file: 'horizon.html', title: 'Horizon · thoremin', body: `<h1>On the horizon</h1><p class="lede">What waits on you, the epics with their progress, every open issue by theme, the design discussions, and the ideas recorded along the way.</p>`
    + `<div id="needs">${nd.html}</div><h2>Epics</h2><div class="grid">${epics}</div><h2>Open issues by theme</h2>${themes}<h2>Discussions</h2><div class="grid">${disc}</div>`
    + (ideas ? `<h2>Ideas</h2><table class="stack"><tr><th>Idea</th><th>What</th><th>Tracked</th></tr>${ideas}</table>` : '') });
}

/** A doc's reading page: its Markdown rendered, links into the repo rewritten to GitHub or to the guide's own page. */
export function renderDoc(m: GuideModel, d: DiskDoc, markdown: string): string {
  const marked = new Marked({ gfm: true });
  marked.use({
    walkTokens(token) {
      if (token.type !== 'link' && token.type !== 'image') return;
      const href = token.href;
      if (/^(https?:|mailto:|#)/.test(href) || d.isPrivate) return;
      const base = d.path.split('/').slice(0, -1);
      const [target, hash] = href.split('#');
      const parts = [...base];
      for (const seg of target.split('/')) seg === '..' ? parts.pop() : seg && seg !== '.' && parts.push(seg);
      const repoPath = parts.join('/');
      token.href = m.disk.has(repoPath) && token.type === 'link'
        ? `../${docPage(repoPath)}${hash ? `#${hash}` : ''}`
        : `${GITHUB}/${token.type === 'image' ? 'raw' : 'blob'}/main/${repoPath}${hash ? `#${hash}` : ''}`;
    },
  });
  const e = m.entries.get(d.path);
  const figs = (m.figures.get(d.path) ?? []).filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f));
  const head = `<p class="meta">${e ? badge(e.status) : ''}${esc(d.path)} · ${esc(d.updated)} · `
    + (d.isPrivate ? 'private working note' : `<a href="${githubBlob(d.path)}">on GitHub</a>`) + ` · <a href="../research.html#${slugOf(d.path)}">its card</a></p>`;
  const gallery = figs.length ? `<h2>Figures</h2><div class="gallery">${figs.map((f) => `<a href="../${f}"><img src="../${f}" alt="" loading="lazy"></a>`).join('')}</div>` : '';
  return page(m, { file: '', title: `${d.title} · thoremin`, depth: 1, body: `${head}<article class="doc">${marked.parse(markdown) as string}</article>${gallery}` });
}
