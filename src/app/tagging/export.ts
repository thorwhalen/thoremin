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
 *
 * THE OTHER ONE — lead-in correction. An annotation with a lead-in is trimmed
 * asymmetrically (open -> t+leadIn, close -> t-leadIn) to cut the reach-in/reach-out.
 * That is the useful default, but it is NOT what the user tapped, so the choice is
 * surfaced ({@link TIME_CHOICES}) and threaded to the adapters rather than silently
 * defaulted.
 */
import { resolveIntervals } from '@/taglog/affordances';
import type { EdgeEvent, ResolvedInterval } from '@/taglog/affordances';
import { ADAPTERS, getAdapter, type TimeChoice } from '@/taglog/adapters';
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
  /** Does the Times choice ({@link TIME_CHOICES}) actually change this file? Taken from
   *  the adapter itself (`Adapter.honorsTime`), never guessed here. False for CSV (both
   *  time columns) and for the raw log (absolute, uncorrected by construction) — for
   *  those the UI must NOT offer a picker, or it would claim an effect it cannot deliver. */
  honorsTime: boolean;
  /** When `honorsTime` is false: the one line that says why, shown where the picker would be. */
  timeNote?: string;
}

/**
 * The human copy for each adapter — the ONLY thing the picker adds to the registry.
 *
 * Format METADATA is derived from {@link ADAPTERS} (below) rather than listed by hand, so
 * the two cannot drift: a new adapter shows up in the UI by construction (with its id as
 * a fallback label), and a picker entry with no adapter behind it is unrepresentable.
 * `honorsTime` likewise comes from the adapter, which is the only thing that knows.
 */
const FORMAT_COPY: Record<string, { label: string; note: string; timeNote?: string }> = {
  audacity: { label: 'Audacity labels', note: 'Import as a label track (File → Import → Labels).' },
  csv: {
    label: 'CSV',
    note: 'One row per annotation — spreadsheets, pandas, anything.',
    timeNote: 'CSV carries both — raw and lead-in-corrected times are separate columns.',
  },
  webvtt: { label: 'WebVTT', note: 'Subtitle/cue track for a <video> element or a player.' },
  textgrid: { label: 'Praat TextGrid', note: 'A tier per annotation — phonetics/speech tooling.' },
  otio: { label: 'OTIO', note: 'OpenTimelineIO — NLE round-trip (Resolve, Premiere…).' },
};

/**
 * The picker's ORDER — declared here, in the app, not inherited from `Object.keys(ADAPTERS)`.
 *
 * `src/taglog/` is a library built to be lifted out into a standalone package: it has no
 * knowledge of this UI, and the declaration order of its registry is an implementation
 * detail. Deriving the order (and therefore the DEFAULT, which is just "the first one")
 * from that key order would let a harmless reshuffle inside taglog silently change which
 * file thoremin hands a user who never touched the picker. So ordering and default are
 * thoremin's decisions, stated as such — while the metadata stays derived, so a NEW
 * adapter still cannot go missing: unlisted ids are appended (alphabetically) rather than
 * dropped.
 */
const FORMAT_ORDER: readonly string[] = ['audacity', 'csv', 'webvtt', 'textgrid', 'otio'];

/** The format selected when the panel opens. Pinned by a test — changing it is a product
 *  decision, and must not be a side effect of editing a library file. */
export const DEFAULT_EXPORT_FORMAT = 'audacity';

/** Adapter ids in the picker's order: the ones we ranked, then anything shipped since. */
function orderedAdapterIds(): string[] {
  const ids = Object.keys(ADAPTERS);
  const ranked = FORMAT_ORDER.filter((id) => ids.includes(id));
  const rest = ids.filter((id) => !FORMAT_ORDER.includes(id)).sort();
  return [...ranked, ...rest];
}

/** The formats offered in the UI: every shipped adapter, plus the archival raw log. */
export const EXPORT_FORMATS: ExportFormat[] = [
  ...orderedAdapterIds().map((id) => ({
    id,
    label: FORMAT_COPY[id]?.label ?? id,
    note: FORMAT_COPY[id]?.note ?? `Rendered by the ${id} adapter.`,
    honorsTime: ADAPTERS[id].honorsTime,
    timeNote: FORMAT_COPY[id]?.timeNote,
  })),
  {
    id: RAW_FORMAT,
    label: 'Raw JSONL',
    note: 'The exact archival file written into the take folder.',
    honorsTime: false,
    timeNote: 'The raw log always carries the untouched event times.',
  },
];

/** The two time bases an export can carry — surfaced, never silently chosen (see the
 *  module docstring). `corrected` is the default because it is what a lead-in is FOR. */
export const TIME_CHOICES: { value: TimeChoice; label: string; note: string }[] = [
  {
    value: 'corrected',
    label: 'Lead-in corrected',
    note: 'Times are trimmed by each annotation’s lead-in (opens later, closes earlier).',
  },
  {
    value: 'raw',
    label: 'Raw taps',
    note: 'Times are the exact instants you tapped, with no lead-in correction.',
  },
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

/**
 * Render a finished take in `format`, on the chosen `time` basis. Returns the file body
 * + the name to save it as.
 *
 * The file stem is the take's `session` — which IS the take's folder name and file stem
 * (the recorder's `stem`, already sanitized to be filesystem-safe). So a downloaded
 * export can be matched back to the recording it came from by name alone, including when
 * the user NAMED the take in the recording sheet (in which case the stem carries no
 * timestamp at all, and anything derived from the clock would share nothing with it).
 */
export function renderTake(
  take: LastTake,
  format: string,
  time: TimeChoice = 'corrected',
): { body: string; filename: string; mime: string } {
  const stem = take.session;
  if (format === RAW_FORMAT) {
    return { body: take.jsonl, filename: `${stem}.annotations.${RAW_FORMAT}`, mime: 'application/x-ndjson' };
  }
  const adapter = getAdapter(format);
  if (!adapter) throw new Error(`Unknown annotation export format: ${format}`);
  const body = adapter.render(resolveTake(take), {
    defs: take.defs,
    duration: takeDuration(take),
    time,
  });
  return { body, filename: `${stem}.annotations.${adapter.ext}`, mime: adapter.mime };
}

/** Render + download a finished take. The one call the UI makes. */
export function downloadTake(take: LastTake, format: string, time: TimeChoice = 'corrected'): void {
  const { body, filename, mime } = renderTake(take, format, time);
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
