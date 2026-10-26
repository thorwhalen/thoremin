/**
 * A recorded hand-landmark stream, read from a file the player picks (or a URL), for replaying
 * into the instrument in place of the camera: the way to reproduce a glitch on a take of your own.
 *
 * Two shapes are read, one JSON object per line:
 *
 * - the Record tool's feature stream (`<take>.features.jsonl`, written when "Feature stream" is on):
 *   `{tick, t, key, value}` lines for every edge, of which the camera's hands (`cam.hands`) are
 *   kept;
 * - a recorded edge stream, as the test fixtures store them (`src.hands.ndjson`, gzipped or not):
 *   `{tick, t, value}` lines.
 *
 * The file is someone else's bytes, so every frame is checked before the graph sees it: the
 * frame's shape (the `HandsFrame` schema), at most two hands, exactly 21 finite keypoints per hand,
 * a positive frame size and a finite time. A line that fails is skipped and counted; a file with
 * no good frame, or over the size limits, is refused with the reason. Times are made relative to
 * the first frame and must not go backwards (a frame that does is skipped). Pure: text in.
 */
import { HandsFrameSchema, type HandsFrame } from '@thoremin/sdk/nodes/domain';

/** The key the camera's hands are logged under in the Record tool's feature stream. */
export const HANDS_EDGE = 'cam.hands';

/** Limits on what is read: a few minutes of two hands at 60 fps is well inside them. */
export const MAX_RECORDING_CHARS = 50 * 1024 * 1024;
export const MAX_RECORDING_FRAMES = 60 * 60 * 20; // twenty minutes at 60 fps
/** Lines read at most (a feature stream logs several edges per frame). */
export const MAX_RECORDING_LINES = 4 * MAX_RECORDING_FRAMES;

const KEYPOINTS = 21;
const MAX_HANDS = 2;

export interface HandRecording {
  /** The frames, in time order. */
  frames: HandsFrame[];
  /** Each frame's time, seconds from the first. */
  times: number[];
  /** Which shape the file was: the Record tool's feature stream, or a recorded edge stream. */
  format: 'features' | 'stream';
  /** Lines that were not a usable frame (malformed JSON, another edge's line excepted). */
  skipped: number;
}

export type ReadResult = { ok: true; recording: HandRecording } | { ok: false; reason: string };

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** A frame the graph can take: the schema, plus the counts and numbers the nodes index into. */
function checkFrame(value: unknown): HandsFrame | null {
  const parsed = HandsFrameSchema.safeParse(value);
  if (!parsed.success) return null;
  const f = parsed.data as HandsFrame;
  if (!(f.width > 0 && f.height > 0 && Number.isFinite(f.width) && Number.isFinite(f.height))) return null;
  if (f.hands.length > MAX_HANDS) return null;
  for (const h of f.hands) {
    if (h.keypoints.length !== KEYPOINTS) return null;
    if (!h.keypoints.every((k) => finite(k.x) && finite(k.y) && (k.z === undefined || finite(k.z)))) return null;
    if (h.worldKeypoints && (h.worldKeypoints.length !== KEYPOINTS || !h.worldKeypoints.every((k) => finite(k.x) && finite(k.y)))) return null;
  }
  return f;
}

/** Read a recording's text. */
export function readHandRecording(text: string): ReadResult {
  if (text.length > MAX_RECORDING_CHARS) return { ok: false, reason: `the file is larger than ${MAX_RECORDING_CHARS / 1024 / 1024} MB` };
  const frames: HandsFrame[] = [];
  const times: number[] = [];
  let format: HandRecording['format'] | null = null;
  let skipped = 0;
  let t0: number | null = null;
  // Line by line without splitting the whole text up front (a file of newlines would otherwise
  // build an array of millions of empty strings), and no more lines than a recording can have.
  let lines = 0;
  for (let at = 0; at < text.length; ) {
    const nl = text.indexOf('\n', at);
    const end = nl < 0 ? text.length : nl;
    const line = text.slice(at, end).trim();
    at = end + 1;
    if (++lines > MAX_RECORDING_LINES) return { ok: false, reason: `more than ${MAX_RECORDING_LINES} lines` };
    if (!line) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }
    if (!rec || typeof rec !== 'object') {
      skipped += 1;
      continue;
    }
    const r = rec as { t?: unknown; key?: unknown; value?: unknown };
    // A feature stream logs every edge: only the camera's hands are frames.
    if (typeof r.key === 'string') {
      format ??= 'features';
      if (r.key !== HANDS_EDGE) continue;
    } else format ??= 'stream';
    const frame = checkFrame(r.value);
    if (!frame || !finite(r.t)) {
      skipped += 1;
      continue;
    }
    t0 ??= r.t;
    const t = r.t - t0;
    if (times.length && t < times[times.length - 1]) {
      skipped += 1;
      continue;
    }
    if (frames.length >= MAX_RECORDING_FRAMES) return { ok: false, reason: `more than ${MAX_RECORDING_FRAMES} frames` };
    frames.push(frame);
    times.push(t);
  }
  if (!frames.length) {
    return {
      ok: false,
      reason:
        format === 'features'
          ? `no hand frames in it (record with "Feature stream" on and the ${HANDS_EDGE} edge included)`
          : 'no hand frames in it (expected a Record tool .features.jsonl or a hands .ndjson stream)',
    };
  }
  return { ok: true, recording: { frames, times, format: format ?? 'stream', skipped } };
}

/** Whether these bytes are gzipped (the magic number). */
export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}
