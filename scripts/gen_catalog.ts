/**
 * Generate the user-facing manual from the node registry (the SSOT), so it can
 * never drift from the code. Emits:
 *   - docs/CATALOG.md     — human-readable markdown manual (repo browsing)
 *   - public/manual.html  — self-contained styled manual; Vite copies public/
 *     into the build, so the deployed app serves it at /thoremin/manual.html
 *   - public/catalog.json — machine catalog for a future in-app node browser
 *
 * Usage: vite-node scripts/gen_catalog.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog, type CatalogEntry, type ParamInfo, type PortInfo } from '@/catalog';
import { createAppRegistry } from '@/nodes/browser';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Layer grouping for the manual (type → category, in display order).
const CATEGORIES: Array<{ name: string; blurb: string; types: string[] }> = [
  { name: 'Inputs (sources)', blurb: 'Where signals enter the graph.', types: ['webcam-hands', 'webcam-face', 'keyboard-source', 'store-controls', 'synthetic-hands', 'replay-source'] },
  { name: 'Features', blurb: 'Raw sensor data → normalized control signals.', types: ['hand-features', 'face-features', 'face-expression', 'gesture-classifier'] },
  { name: 'Mapping (direct ↔ indirect)', blurb: 'Features → engine parameters, across the expression spectrum.', types: ['voice-mapping', 'indirect-map', 'keyboard-control', 'pick', 'one-euro', 'synth-merge'] },
  { name: 'Music logic (tonal guidance)', blurb: 'Harmony kept in-key.', types: ['chord', 'progression', 'expression-chord'] },
  { name: 'Conductor mode', blurb: 'Direct a fixed piece with gesture (tempo + dynamics).', types: ['transport', 'score', 'performance'] },
  { name: 'Synthesis & generation', blurb: 'Make sound — direct synthesis or steered AI music.', types: ['webaudio-synth', 'lyria'] },
  { name: 'Output', blurb: 'Audio + the captured video with overlaid guides.', types: ['canvas-overlay'] },
];

const OVERVIEW = `Thoremin turns live sensor streams (webcam hand gestures, facial expressions, computer keyboard, later MIDI) into a live audiovisual stream — musical audio plus the captured video with overlaid guides. You build instruments by wiring small, typed **nodes** into a dataflow graph (DAG): inputs → features → mapping → music-logic → synthesis/generation → output. Every edge can be recorded and replayed.

The mapping layer spans a spectrum: **direct** (a gesture *is* a note/parameter — e.g. hand position → scale-snapped pitch) through **indirect** (a gesture expresses a high-level idea — e.g. openness → musical density steering an AI model), including **conductor** mode (direct a fixed piece's tempo and dynamics).

This page catalogs the engine's building blocks — every node and how they connect. Some already run in the deployed app; wiring the full graph into the live instrument is in progress.`;

const EXAMPLES: Array<{ title: string; chain: string; note: string }> = [
  { title: 'Theremin (direct)', chain: 'webcam-hands → hand-features → voice-mapping → webaudio-synth ( + canvas-overlay)', note: 'Hand x → scale-snapped pitch, y → volume. Two hands = two voices.' },
  { title: 'Gesture → harmony', chain: "hand-features → pick('right.x') → progression → chord → webaudio-synth", note: 'Hand position walks an in-key chord progression.' },
  { title: 'Conductor', chain: 'control → performance → transport → score → webaudio-synth', note: 'A control signal directs a fixed piece\'s tempo + dynamics (accelerando/crescendo…).' },
  { title: 'Indirect / AI (gesture or expression)', chain: 'hand-features / face-features → indirect-map → lyria', note: 'Openness/smile/etc. steer weighted prompts + dials of Google Lyria RealTime.' },
  { title: 'Discrete triggers', chain: 'hand-features → gesture-classifier → (events)', note: 'Fist/open/pinch poses emit enter/exit events to trigger scale changes, stabs, mutes.' },
];

function ports(ps: PortInfo[]): string {
  if (!ps.length) return '—';
  return ps.map((p) => `${p.name}${p.kind ? `:${p.kind}` : ''}`).join(', ');
}
function params(ps: ParamInfo[]): string {
  if (!ps.length) return '—';
  return ps.map((p) => `${p.name} (${p.type}${p.default !== undefined ? `=${JSON.stringify(p.default)}` : ''})`).join(', ');
}
function grouped(catalog: CatalogEntry[]): Array<{ name: string; blurb: string; entries: CatalogEntry[] }> {
  const byType = Object.fromEntries(catalog.map((e) => [e.type, e]));
  const used = new Set<string>();
  const groups = CATEGORIES.map((c) => {
    const entries = c.types.map((t) => byType[t]).filter(Boolean) as CatalogEntry[];
    entries.forEach((e) => used.add(e.type));
    return { name: c.name, blurb: c.blurb, entries };
  });
  const rest = catalog.filter((e) => !used.has(e.type));
  if (rest.length) groups.push({ name: 'Other', blurb: '', entries: rest });
  return groups.filter((g) => g.entries.length);
}

function toMarkdown(catalog: CatalogEntry[]): string {
  const L: string[] = ['# Thoremin — Capabilities Manual', '', '_Auto-generated from the node registry (`scripts/gen_catalog.ts`). Do not edit by hand._', '', OVERVIEW, '', '## Example pipelines', ''];
  for (const ex of EXAMPLES) L.push(`- **${ex.title}** — \`${ex.chain}\`  \n  ${ex.note}`);
  L.push('', `## Nodes (${catalog.length})`, '');
  for (const g of grouped(catalog)) {
    L.push(`### ${g.name}`, g.blurb ? `_${g.blurb}_` : '', '');
    for (const e of g.entries) {
      L.push(`#### \`${e.type}\` — ${e.title}`, e.description, '', `- **roles:** ${e.roles.join(', ') || '—'}`, `- **in:** ${ports(e.inputs)}`, `- **out:** ${ports(e.outputs)}`, `- **params:** ${params(e.params)}`, '');
    }
  }
  return L.join('\n');
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function toHtml(catalog: CatalogEntry[]): string {
  const card = (e: CatalogEntry): string => `
    <div class="node">
      <h4><code>${esc(e.type)}</code> <span class="title">${esc(e.title)}</span></h4>
      <p>${esc(e.description)}</p>
      <dl>
        <dt>roles</dt><dd>${esc(e.roles.join(', ') || '—')}</dd>
        <dt>in</dt><dd>${esc(ports(e.inputs))}</dd>
        <dt>out</dt><dd>${esc(ports(e.outputs))}</dd>
        <dt>params</dt><dd>${esc(params(e.params))}</dd>
      </dl>
    </div>`;
  const sections = grouped(catalog)
    .map((g) => `<section><h3>${esc(g.name)}</h3>${g.blurb ? `<p class="blurb">${esc(g.blurb)}</p>` : ''}<div class="grid">${g.entries.map(card).join('')}</div></section>`)
    .join('\n');
  const examples = EXAMPLES.map((ex) => `<li><b>${esc(ex.title)}</b> — <code>${esc(ex.chain)}</code><br/><span class="note">${esc(ex.note)}</span></li>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Thoremin — Capabilities Manual</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0a0a0a; color: #e5e5e5; font: 15px/1.55 -apple-system, system-ui, sans-serif; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
  h1 { color: #10b981; letter-spacing: -.02em; }
  h3 { margin-top: 2.2rem; border-bottom: 1px solid #1f1f1f; padding-bottom: .35rem; color: #fff; }
  .gen { color: #666; font-size: 12px; }
  .blurb { color: #9aa; margin-top: -.3rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: .9rem; }
  .node { background: #111; border: 1px solid #1f1f1f; border-radius: 12px; padding: .85rem 1rem; }
  .node h4 { margin: 0 0 .35rem; font-size: 14px; }
  .node code { color: #10b981; }
  .node .title { color: #888; font-weight: 500; }
  .node p { margin: .3rem 0 .6rem; color: #cfcfcf; font-size: 13px; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 0; font-size: 12px; }
  dt { color: #10b981; text-transform: uppercase; font-size: 10px; letter-spacing: .08em; padding-top: 2px; }
  dd { margin: 0; color: #aab; font-family: ui-monospace, monospace; }
  ul.examples { padding-left: 1.1rem; } ul.examples li { margin-bottom: .6rem; }
  code { font-family: ui-monospace, SFMono-Regular, monospace; }
  .examples code { color: #7dd3fc; } .note { color: #9aa; font-size: 13px; }
</style></head><body><div class="wrap">
  <h1>θ Thoremin — Capabilities Manual</h1>
  <p class="gen">Auto-generated from the node registry. ${catalog.length} nodes.</p>
  <p>${esc(OVERVIEW).replace(/\n\n/g, '</p><p>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</p>
  <h3>Example pipelines</h3>
  <ul class="examples">${examples}</ul>
  ${sections}
</div></body></html>`;
}

function main(): void {
  const catalog = buildCatalog(createAppRegistry());
  mkdirSync(join(ROOT, 'public'), { recursive: true });
  writeFileSync(join(ROOT, 'docs', 'CATALOG.md'), toMarkdown(catalog) + '\n');
  writeFileSync(join(ROOT, 'public', 'manual.html'), toHtml(catalog) + '\n');
  writeFileSync(join(ROOT, 'public', 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
  console.log(`catalog: ${catalog.length} nodes -> docs/CATALOG.md, public/manual.html, public/catalog.json`);
}

main();
