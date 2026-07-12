/**
 * Annotation export (#92) — turn the last finished take into a file the user can
 * actually open, in the tool they actually use.
 *
 * This is the missing half of live annotating. Until now the ONLY egress was the raw
 * `<take>.annotations.jsonl` the recorder drops in the take folder: absolute-clock edge
 * events, one JSON object per line. That is the right *archival* format (self-describing,
 * losslessly re-resolvable, aligned to the manifest), but it is not something you can
 * drag into Audacity — and if you never found the folder, it may as well not exist.
 *
 * `src/taglog/adapters/` already knew how to render Audacity label tracks, WebVTT cues,
 * CSV, Praat TextGrids, and OTIO; nothing had ever called it. This module is the wiring.
 *
 * THE ONE SUBTLETY — the clock. Edge events are stamped on the ABSOLUTE engine clock
 * (`performance.now()/1000`), the same clock `features.jsonl` uses, and the manifest's
 * rule is that a stream's offset into the take is `t - t0`. Every consumer here wants
 * take-relative seconds (an Audacity label at 0.0 = the first frame of the recording),
 * so we shift by `t0` exactly once, right here, before resolving. Shifting the EDGES
 * rather than the resolved intervals keeps it a single subtraction on one field, instead
 * of four (start/end/startCorrected/endCorrected) — fewer places to forget one.
 */
import { resolveIntervals } from '@/taglog/affordances';
import type { EdgeEvent, ResolvedInterval } from '@/taglog/affordances';
import { ADAPTERS, getAdapter } from '@/taglog/adapters';
import { downloadBlob } from '@/app/recorder';
import type { LastTake } from './store';

/** The raw recorded JSONL, offered alongside the rendered formats. It is the archival
 *  artifact (identical to the file in the take folder), so it is a first-class choice —
 *  not an adapter, because nothing needs to be rendered. */
export const RAW_FORMAT = 'jsonl' as const;

export interface ExportFormat {
  id: string;
  label: string;
  /** What the format is good for — shown next to the picker. */
  note: string;
}

/** The formats offered in the UI, in the order a user is likely to want them. */
export const EXPORT_FORMATS: ExportFormat[] = [
  { id: 'audacity', label: 'Audacity labels', note: 'Import as a label track (File → Import → Labels).' },
  { id: 'csv', label: 'CSV', note: 'One row per annotation — spreadsheets, pandas, anything.' },
  { id: 'webvtt', label: 'WebVTT', note: 'Subtitle/cue track for a <video> element or a player.' },
  { id: 'textgrid', label: 'Praat TextGrid', note: 'A tier per annotation — phonetics/speech tooling.' },
  { id: 'otio', label: 'OTIO', note: 'OpenTimelineIO — NLE round-trip (Resolve, Premiere…).' },
  { id: RAW_FORMAT, label: 'Raw JSONL', note: 'The exact archival file written into the take folder.' },
];

/**
 * Resolve a finished take into intervals on the TAKE clock (0 = start of recording).
 *
 * Still-open annotations are closed at the take's end (`endT`) rather than being dropped,
 * so holding a button until you hit Stop yields an interval running to the end of the
 * recording — which is what the gesture plainly means.
 */
export function resolveTake(take: LastTake): ResolvedInterval[] {
  const shifted: EdgeEvent[] = take.edges.map((e) => ({
    ...e,
    t: e.t - take.t0,
    tCorrected: e.tCorrected - take.t0,
  }));
  return resolveIntervals(shifted, { endT: take.endT - take.t0 });
}

/** Take duration in seconds — the timeline extent an adapter should span. */
export const takeDuration = (take: LastTake): number => Math.max(0, take.endT - take.t0);

/** Render a finished take in `format`. Returns the file body + the name to save it as. */
export function renderTake(take: LastTake, format: string): { body: string; filename: string; mime: string } {
  // `startedAt` is an ISO stamp; `:` is illegal in filenames on Windows and awkward
  // everywhere, so flatten it the same way the recorder's stem does.
  const stamp = take.startedAt.replace(/[:.]/g, '-').replace(/Z$/, '');
  if (format === RAW_FORMAT) {
    return { body: take.jsonl, filename: `${stamp}.annotations.jsonl`, mime: 'application/x-ndjson' };
  }
  const adapter = getAdapter(format);
  if (!adapter) throw new Error(`Unknown annotation export format: ${format}`);
  const body = adapter.render(resolveTake(take), {
    defs: take.defs,
    duration: takeDuration(take),
  });
  return { body, filename: `${stamp}.annotations.${adapter.ext}`, mime: adapter.mime };
}

/** Render + download a finished take. The one call the UI makes. */
export function downloadTake(take: LastTake, format: string): void {
  const { body, filename, mime } = renderTake(take, format);
  downloadBlob(new Blob([body], { type: mime }), filename);
}

/** A one-line summary of what a take actually captured, for the sheet's export panel. */
export function summarizeTake(take: LastTake): { intervals: number; points: number; seconds: number } {
  const resolved = resolveTake(take);
  return {
    intervals: resolved.filter((iv) => iv.kind === 'interval').length,
    points: resolved.filter((iv) => iv.kind === 'point').length,
    seconds: takeDuration(take),
  };
}

/** Guard: every id in {@link EXPORT_FORMATS} must be renderable (raw, or a known
 *  adapter). Exported for the test that pins the two registries together, so adding a
 *  format to the picker without an adapter fails in CI rather than at the user's click. */
export const isRenderableFormat = (id: string): boolean => id === RAW_FORMAT || id in ADAPTERS;
