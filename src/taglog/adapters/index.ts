/**
 * taglog — export adapters (the survey's non-negotiable I/O pattern, design §2/§4).
 *
 * The native log is `tags.jsonl` (raw events, written by the provider sink). These
 * adapters take the RESOLVED view (`ResolvedInterval[]` from `resolveIntervals`) and
 * emit standard interchange formats so a tag log opens in the tools researchers
 * already use — Audacity, Praat, a `<track>` preview, a spreadsheet, an NLE:
 *
 *  - **Audacity** label track (TSV `start\tend\tlabel`)
 *  - **WebVTT** cues (preview segments in an HTML `<track>`)
 *  - **CSV** (spreadsheet / pandas)
 *  - **Praat TextGrid** (IntervalTier per interval tag, PointTier per point tag)
 *  - **OTIO** (OpenTimelineIO JSON — RationalTime discipline, §2)
 *
 * Pure `ResolvedInterval[] -> string`. Adding a format is one entry in {@link ADAPTERS},
 * so the representation stays open/closed. By default each uses the lead-in-CORRECTED
 * times (the clean middle of the action); pass `time:'raw'` for the click instants.
 */
import type { ResolvedInterval, TagDef } from '../affordances/schema';
import { formatTimecode } from '../affordances/time';

// formatTimecode lives in the affordance layer (shared with presentation); re-exported
// here for convenience so existing `@/taglog/adapters` importers keep working.
export { formatTimecode };

/** Whether an adapter emits the corrected (default) or raw event times. */
export type TimeChoice = 'corrected' | 'raw';

/** Strip TAB/CR/LF from a label so it can't break a TSV column, a WebVTT cue, or a
 *  Praat mark (line/column-structured formats). JSON formats need no such guard. */
function sanitizeInline(s: string): string {
  return s.replace(/[\t\r\n]+/g, ' ');
}

export interface AdapterOptions {
  /** Human labels per tag id (falls back to the tag id). */
  defs?: readonly TagDef[];
  /** corrected (clean middle, default) | raw (click instants). */
  time?: TimeChoice;
  /** Timeline duration (seconds) — the tier/timeline extent. Defaults to max end. */
  duration?: number;
  /** Frame rate for OTIO RationalTime (default 30). */
  rate?: number;
}

/** The human label for a tag id, from the defs (else the id itself). */
function labelOf(tag: string, defs?: readonly TagDef[]): string {
  return defs?.find((d) => d.id === tag)?.label ?? tag;
}

/** The [start, end] an adapter should use for an interval, per the time choice. */
function span(iv: ResolvedInterval, time: TimeChoice): [number, number] {
  return time === 'raw' ? [iv.start, iv.end] : [iv.startCorrected, iv.endCorrected];
}

/** The timeline extent: the caller-supplied duration or the max end across intervals. */
function extent(intervals: readonly ResolvedInterval[], time: TimeChoice, duration?: number): number {
  if (typeof duration === 'number') return duration;
  return intervals.reduce((m, iv) => Math.max(m, span(iv, time)[1]), 0);
}

/** Audacity label track: `start<TAB>end<TAB>label` per line (points have start==end). */
export function toAudacityLabels(intervals: readonly ResolvedInterval[], opts: AdapterOptions = {}): string {
  const time = opts.time ?? 'corrected';
  return (
    intervals
      .map((iv) => {
        const [a, b] = span(iv, time);
        return `${a.toFixed(6)}\t${b.toFixed(6)}\t${sanitizeInline(labelOf(iv.tag, opts.defs))}`;
      })
      .join('\n') + (intervals.length ? '\n' : '')
  );
}

/** WebVTT: a cue per interval; a point becomes a 1ms cue so players still show it. */
export function toWebVTT(intervals: readonly ResolvedInterval[], opts: AdapterOptions = {}): string {
  const time = opts.time ?? 'corrected';
  const cues = intervals.map((iv, i) => {
    let [a, b] = span(iv, time);
    if (b <= a) b = a + 0.001; // WebVTT needs end > start
    return `${i + 1}\n${formatTimecode(a)} --> ${formatTimecode(b)}\n${sanitizeInline(labelOf(iv.tag, opts.defs))}`;
  });
  return `WEBVTT\n\n${cues.join('\n\n')}${cues.length ? '\n' : ''}`;
}

/** CSV: one row per resolved interval/point, with both raw and corrected times. */
export function toCSV(intervals: readonly ResolvedInterval[], opts: AdapterOptions = {}): string {
  const head = 'tag,label,kind,start,end,startCorrected,endCorrected,degenerate,openEnded';
  // Quote on any CR/LF/quote/comma so a lone \r can't corrupt a CRLF-strict parser.
  const esc = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = intervals.map((iv) =>
    [
      esc(iv.tag),
      esc(labelOf(iv.tag, opts.defs)),
      iv.kind,
      iv.start,
      iv.end,
      iv.startCorrected,
      iv.endCorrected,
      iv.degenerate,
      iv.openEnded,
    ].join(','),
  );
  return `${head}\n${rows.join('\n')}${rows.length ? '\n' : ''}`;
}

/** Praat TextGrid: an IntervalTier per interval tag (gaps filled with empty intervals,
 *  as Praat requires adjacency-completeness) and a PointTier per point tag. */
export function toTextGrid(intervals: readonly ResolvedInterval[], opts: AdapterOptions = {}): string {
  const time = opts.time ?? 'corrected';
  // The timeline must cover ALL content: never let an explicit `duration` shrink xmax
  // below an interval's end (Praat rejects a tier/interval xmax that exceeds the file
  // xmax). So take the larger of the content extent and the requested duration.
  const xmax = Math.max(extent(intervals, time), opts.duration ?? 0);
  const byTag = new Map<string, ResolvedInterval[]>();
  for (const iv of intervals) {
    const arr = byTag.get(iv.tag) ?? [];
    arr.push(iv);
    byTag.set(iv.tag, arr);
  }
  const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const tiers: string[] = [];
  for (const [tag, ivs] of byTag) {
    const isPoint = ivs.every((i) => i.kind === 'point');
    const name = sanitizeInline(labelOf(tag, opts.defs));
    if (isPoint) {
      // Praat requires point times strictly increasing — sort even if the input
      // ResolvedInterval[] wasn't time-ordered.
      const sortedPts = [...ivs].sort((p, q) => span(p, time)[0] - span(q, time)[0]);
      const pts = sortedPts
        .map((iv, i) => `        points [${i + 1}]:\n            number = ${span(iv, time)[0]}\n            mark = ${quote(name)}`)
        .join('\n');
      tiers.push(
        `    item [${tiers.length + 1}]:\n        class = "TextTier"\n        name = ${quote(name)}\n` +
          `        xmin = 0\n        xmax = ${xmax}\n        points: size = ${ivs.length}\n${pts}`,
      );
      continue;
    }
    // Interval tier: fill [0, xmax] with labelled + empty intervals, clamping overlaps.
    const sorted = ivs
      .map((iv) => span(iv, time))
      .filter(([a, b]) => b > a)
      .sort((p, q) => p[0] - q[0]);
    const cells: { a: number; b: number; text: string }[] = [];
    let cursor = 0;
    for (const [a0, b] of sorted) {
      const a = Math.max(a0, cursor);
      if (a >= b) continue; // fully overlapped by a previous interval
      if (a > cursor) cells.push({ a: cursor, b: a, text: '' });
      cells.push({ a, b, text: name });
      cursor = b;
    }
    if (cursor < xmax) cells.push({ a: cursor, b: xmax, text: '' });
    if (!cells.length) cells.push({ a: 0, b: xmax, text: '' });
    const body = cells
      .map((c, i) => `        intervals [${i + 1}]:\n            xmin = ${c.a}\n            xmax = ${c.b}\n            text = ${quote(c.text)}`)
      .join('\n');
    tiers.push(
      `    item [${tiers.length + 1}]:\n        class = "IntervalTier"\n        name = ${quote(name)}\n` +
        `        xmin = 0\n        xmax = ${xmax}\n        intervals: size = ${cells.length}\n${body}`,
    );
  }
  return (
    `File type = "ooTextFile"\nObject class = "TextGrid"\n\n` +
    `xmin = 0\nxmax = ${xmax}\ntiers? <exists>\nsize = ${tiers.length}\nitem []:\n${tiers.join('\n')}\n`
  );
}

/** OpenTimelineIO JSON: a timeline with one marker per interval/point (RationalTime,
 *  §2). A minimal, schema-valid OTIO document — enough for `otiotool` / an NLE import. */
export function toOTIO(intervals: readonly ResolvedInterval[], opts: AdapterOptions = {}): string {
  const time = opts.time ?? 'corrected';
  const rate = opts.rate ?? 30;
  const rt = (sec: number) => ({ OTIO_SCHEMA: 'RationalTime.1', rate, value: Math.round(sec * rate) });
  const markers = intervals.map((iv) => {
    const [a, b] = span(iv, time);
    return {
      OTIO_SCHEMA: 'Marker.2',
      name: labelOf(iv.tag, opts.defs),
      color: 'RED',
      marked_range: {
        OTIO_SCHEMA: 'TimeRange.1',
        start_time: rt(a),
        duration: rt(Math.max(0, b - a)),
      },
      metadata: { taglog: { tag: iv.tag, kind: iv.kind, openEnded: iv.openEnded, degenerate: iv.degenerate } },
    };
  });
  const doc = {
    OTIO_SCHEMA: 'Timeline.1',
    name: 'taglog',
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      children: [
        {
          OTIO_SCHEMA: 'Track.1',
          name: 'tags',
          kind: 'Video',
          markers,
          children: [],
        },
      ],
    },
  };
  return JSON.stringify(doc, null, 2) + '\n';
}

/** One export format: how to name/mime the file and how to render it. */
export interface Adapter {
  name: string;
  ext: string;
  mime: string;
  render(intervals: readonly ResolvedInterval[], opts?: AdapterOptions): string;
}

/** The shipped adapter registry (open for extension). Keyed by format name. */
export const ADAPTERS: Record<string, Adapter> = {
  audacity: { name: 'audacity', ext: 'txt', mime: 'text/plain', render: toAudacityLabels },
  webvtt: { name: 'webvtt', ext: 'vtt', mime: 'text/vtt', render: toWebVTT },
  csv: { name: 'csv', ext: 'csv', mime: 'text/csv', render: toCSV },
  textgrid: { name: 'textgrid', ext: 'TextGrid', mime: 'text/plain', render: toTextGrid },
  otio: { name: 'otio', ext: 'otio', mime: 'application/json', render: toOTIO },
};

/** Look up an adapter by name (undefined for an unknown format). */
export function getAdapter(name: string): Adapter | undefined {
  return ADAPTERS[name];
}
