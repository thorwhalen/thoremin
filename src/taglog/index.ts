/**
 * taglog — a live event-tagging tool, structured to lift out of thoremin into a
 * standalone reusable package (working name `taglog`). Toggle a small set of tags
 * on/off while recording; each toggle appends a `(t, tag, status)` row to a
 * `tags.jsonl` that later segments the recorded streams for analysis / ML training.
 *
 * Three layers, strict dependency direction **presentation -> affordances <- provider**
 * (that one rule is what makes extraction mechanical):
 *
 *  - {@link module:affordances} — Zod schemas + pure logic (toggle state machine,
 *    interval resolution, lead-in correction, the pluggable event codecs). No React,
 *    no storage, no timers.
 *  - {@link module:adapters} — pure exporters to Audacity / WebVTT / CSV / Praat
 *    TextGrid / OTIO from the resolved interval view.
 *  - {@link module:provider} — the `DataProvider<T>` tag-set persistence
 *    (localStorage default) + the append-only JSONL event sink.
 *
 * The thoremin-specific glue (a zustand runtime store, the recording integration,
 * the React button stack / overlay) lives OUTSIDE this folder (`src/app/tagging/*`,
 * `src/nodes/output/canvas_overlay.ts`) and only imports from here — never the reverse.
 *
 * Design research + prior art (BORIS, Praat, ELAN, OTIO, Allen's interval algebra):
 * discussion #81; issue #92.
 */
export * from './affordances';
export * as adapters from './adapters';
export * from './provider';
export * from './presentation';
