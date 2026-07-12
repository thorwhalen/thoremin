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
import { PROVIDER_LIST } from '@/plugins/assistant/providers';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Layer grouping for the manual (type → category, in display order).
const CATEGORIES: Array<{ name: string; blurb: string; types: string[] }> = [
  { name: 'Inputs (sources)', blurb: 'Where signals enter the graph.', types: ['webcam-hands', 'webcam-face', 'keyboard-source', 'store-controls', 'synthetic-hands', 'replay-source'] },
  { name: 'Features', blurb: 'Raw sensor data → normalized control signals.', types: ['hand-features', 'face-features', 'face-controls', 'face-expression', 'gesture-classifier', 'face-feature-vector', 'hand-feature-vector'] },
  { name: 'Mapping (direct ↔ indirect)', blurb: 'Features → engine parameters, across the expression spectrum.', types: ['voice-mapping', 'indirect-map', 'keyboard-control', 'pick', 'one-euro', 'synth-merge', 'chord-select'] },
  { name: 'Music logic (tonal guidance)', blurb: 'Harmony kept in-key.', types: ['chord', 'progression', 'expression-chord', 'pose-chord'] },
  { name: 'Conductor mode', blurb: 'Direct a fixed piece with gesture (tempo + dynamics).', types: ['transport', 'score', 'performance'] },
  { name: 'Synthesis & generation', blurb: 'Make sound — direct synthesis, steered AI music, or an external MIDI instrument.', types: ['webaudio-synth', 'lyria', 'midi-out'] },
  { name: 'Output', blurb: 'Audio + the captured video with overlaid guides.', types: ['canvas-overlay'] },
];

/** Where the human-facing user manual lives (this page is the *node* catalog). */
const USER_GUIDE_URL = 'https://github.com/thorwhalen/thoremin/blob/main/docs/USER_GUIDE.md';

const OVERVIEW = `Thoremin turns live sensor streams (webcam hand gestures, facial expressions and head pose, computer keyboard, MIDI out) into a live audiovisual stream — musical audio plus the captured video with overlaid guides. You build sounds by wiring small, typed **nodes** into a dataflow graph (DAG): inputs → features → mapping → music-logic → synthesis/generation → output. Every edge can be recorded and replayed.

The mapping layer spans a spectrum: **direct** (a gesture *is* a note/parameter — e.g. hand position → scale-snapped pitch) through **indirect** (a gesture expresses a high-level idea — e.g. openness → musical density steering an AI model), including **conductor** mode (direct a fixed piece's tempo and dynamics).

Everything runs **client-side**: gesture/face inference (MediaPipe), synthesis (Web Audio) and rendering (canvas) all happen in your browser. There is no backend — nothing you play, record, or annotate is uploaded anywhere. The only network calls are the ones you opt into by pasting your own API key (the AI assistant, and Lyria generative music), and those go straight from your browser to that provider.

This page catalogs the engine's building blocks — every node, its ports and its params. The DAG *is* the deployed instrument; a few nodes here (the generative and conductor-mode ones) are built and tested but are not wired into the default graph.`;

/**
 * The AI-assistant section. The model table is generated from the SAME registry the app
 * ships (`src/plugins/assistant/providers.ts`), so the manual cannot quietly disagree
 * with the picker — a model retired in code disappears from the docs in the same commit.
 */
const ASSISTANT_INTRO = `The assistant is a chat panel that **operates the instrument for you** — "add face expression chords", "make the left hand an octave lower", "save this as Glassy". It doesn't type into a text box on your behalf; it calls the very same commands the palette and the keyboard shortcuts call, so it can only ever do things you could have done yourself. Anything destructive (saving over an instrument, for instance) stops and asks you first.

It is **bring-your-own-key**: you paste an API key for one of the providers below, it is stored in your browser's localStorage, and it is sent only to that provider. There is no thoremin server in the middle.

## Choosing a model

The assistant's job is *read the state, decide, call a tool* — not write essays. That makes it a **function-calling** workload, and the thing that matters is whether a model reliably stays inside a tool schema, not how clever it is. Reliability × latency × cost beats raw IQ here.

So the rule of thumb is: **default to the fast mid-tier, and escalate only when you hit something it can't do.** The flagship tier is worth it for genuinely hard, ambiguous, multi-step requests — and is mostly wasted on "turn the reverb up". Each provider below is offered as three rungs, with the recommended one marked; the app picks it for you when you switch provider.

Two things worth knowing:

- **Reasoning tokens bill as output**, on every provider. A "cheap" model that thinks hard about a hard turn can cost more than its rate card suggests.
- **Prices below are list prices per 1M tokens** and they move constantly. Treat them as directional. Model ids are re-verified against each provider's live API with \`npm run check:models\` — a model can be silently retired while the provider's own docs still list it as stable, which is exactly how \`gemini-2.5-flash\` broke.`;

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
  const L: string[] = [
    '# Thoremin — Capabilities Manual',
    '',
    '_Auto-generated from the node registry (`scripts/gen_catalog.ts`). Do not edit by hand — run `npm run catalog`._',
    '',
    `**Looking for how to _use_ the app?** → [the User Guide](${USER_GUIDE_URL}).`,
    '',
    OVERVIEW,
    '',
    '## Example pipelines',
    '',
  ];
  for (const ex of EXAMPLES) L.push(`- **${ex.title}** — \`${ex.chain}\`  \n  ${ex.note}`);

  L.push('', '## The AI assistant', '', ASSISTANT_INTRO, '');
  for (const p of PROVIDER_LIST) {
    L.push(`### ${p.label}`, '', '| Model | | When to pick it |', '|---|---|---|');
    for (const m of p.models) {
      // The recommended model is bolded — the single "just pick this" signal.
      const name = m.recommended ? `**\`${m.id}\`**` : `\`${m.id}\``;
      L.push(`| ${name} | ${m.recommended ? '**recommended**' : ''} | ${m.note} |`);
    }
    L.push('', `[Get an API key](${p.keyHelpUrl})`, '');
  }

  L.push('', `## Nodes (${catalog.length})`, '');
  for (const g of grouped(catalog)) {
    L.push(`### ${g.name}`, g.blurb ? `_${g.blurb}_` : '', '');
    for (const e of g.entries) {
      L.push(`#### \`${e.type}\` — ${e.title}`, e.description, '', `- **roles:** ${e.roles.join(', ') || '—'}`, `- **in:** ${ports(e.inputs)}`, `- **out:** ${ports(e.outputs)}`, `- **params:** ${params(e.params)}`, '');
    }
  }
  return L.join('\n');
}

/** HTML-escape. A `function` declaration (not a `const`) so it hoists like the callers
 *  below it, which are themselves hoisted `function`s — a `const` here would be in the
 *  temporal dead zone for any of them called before this line was evaluated. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Minimal inline markdown (bold / code / links) → HTML, for the prose constants above. */
function inlineMd(s: string): string {
  return esc(s)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>');
}

/** Prose block → paragraphs, with `## x` headings and `- x` bullets honoured. */
function proseHtml(s: string): string {
  return s
    .split('\n\n')
    .map((block) => {
      if (block.startsWith('## ')) return `<h4 class="sub">${inlineMd(block.slice(3))}</h4>`;
      if (block.startsWith('- ')) {
        const items = block.split('\n- ').map((b) => `<li>${inlineMd(b.replace(/^- /, ''))}</li>`).join('');
        return `<ul class="prose">${items}</ul>`;
      }
      return `<p>${inlineMd(block)}</p>`;
    })
    .join('');
}

/** The assistant's provider/model tables — recommended row highlighted. */
function assistantHtml(): string {
  const tables = PROVIDER_LIST.map((p) => {
    const rows = p.models
      .map(
        (m) => `<tr class="${m.recommended ? 'rec' : ''}">
        <td><code>${esc(m.id)}</code>${m.recommended ? ' <span class="pill">recommended</span>' : ''}</td>
        <td>${esc(m.note)}</td>
      </tr>`,
      )
      .join('');
    return `<div class="prov">
      <h4>${esc(p.label)} <a class="keylink" href="${esc(p.keyHelpUrl)}">get a key ↗</a></h4>
      <table class="models"><tbody>${rows}</tbody></table>
    </div>`;
  }).join('');
  return `<section><h3>The AI assistant</h3>${proseHtml(ASSISTANT_INTRO)}${tables}</section>`;
}

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
  .guide { margin: .2rem 0 1.4rem; padding: .6rem .9rem; background: #10281f; border: 1px solid #14523c; border-radius: 10px; font-size: 14px; }
  .guide a { color: #34d399; }
  h4.sub { margin: 1.4rem 0 .4rem; color: #fff; font-size: 15px; }
  ul.prose { padding-left: 1.1rem; color: #cfcfcf; } ul.prose li { margin-bottom: .35rem; }
  .prov { margin-top: 1.2rem; }
  .prov h4 { margin: 0 0 .4rem; font-size: 14px; color: #fff; }
  .keylink { color: #10b981; font-size: 11px; font-weight: 400; text-decoration: none; margin-left: .4rem; }
  .keylink:hover { text-decoration: underline; }
  table.models { width: 100%; border-collapse: collapse; font-size: 13px; }
  table.models td { border-top: 1px solid #1f1f1f; padding: .5rem .6rem; vertical-align: top; color: #cfcfcf; }
  table.models td:first-child { white-space: nowrap; width: 1%; }
  table.models code { color: #7dd3fc; }
  /* The recommended model is the one signal a reader needs — make it unmissable
     without shouting: a left rule, a lift, and a small pill. */
  tr.rec td { background: #0e1a15; }
  tr.rec td:first-child { border-left: 2px solid #10b981; }
  tr.rec code { color: #10b981; font-weight: 600; }
  .pill { background: #10b981; color: #06281c; font-size: 9px; font-weight: 700; text-transform: uppercase;
          letter-spacing: .06em; border-radius: 999px; padding: .1rem .4rem; margin-left: .35rem; vertical-align: 1px; }
</style></head><body><div class="wrap">
  <h1>θ Thoremin — Capabilities Manual</h1>
  <p class="gen">Auto-generated from the node registry. ${catalog.length} nodes.</p>
  <p class="guide">Looking for how to <b>use</b> the app — playing, instruments, shortcuts, the assistant, recording, annotations, the Feature Lab? → <a href="${USER_GUIDE_URL}">the User Guide</a>. This page is the <b>node</b> catalog.</p>
  <p>${esc(OVERVIEW).replace(/\n\n/g, '</p><p>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</p>
  <h3>Example pipelines</h3>
  <ul class="examples">${examples}</ul>
  ${assistantHtml()}
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
