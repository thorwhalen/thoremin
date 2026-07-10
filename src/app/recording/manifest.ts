/**
 * Recording manifest (#88) — the per-folder alignment SSOT. Every recording is a
 * folder containing a `{stem}.manifest.json` that records the shared clock origin
 * (`startedAt`, `t0`), the instrument, and one entry per captured stream
 * (`{file, kind, mime?, fps?}`). A future importer/aligner (and the live-tagging
 * `.tags.jsonl`, which drops into the same folder on the same clock) reads this
 * to line the streams up frame-accurately. Pure and unit-testable — no DOM, no
 * filesystem.
 */

export const RECORDING_MANIFEST_VERSION = 1 as const;

/** The kind of a captured stream (drives how a consumer decodes/aligns it). */
export type RecordingStreamKind =
  | 'audio'
  | 'overlayVideo'
  | 'pureVideo'
  | 'overlayAlpha'
  | 'features'
  | 'tags';

/** One stream's entry in the manifest. `file` is the name within the folder. */
export interface RecordingStreamEntry {
  file: string;
  kind: RecordingStreamKind;
  /** Media MIME (video/audio streams) — absent for JSONL streams. */
  mime?: string;
  /** Frames-per-second for canvas/video streams. */
  fps?: number;
}

export interface RecordingManifest {
  version: typeof RECORDING_MANIFEST_VERSION;
  /** Wall-clock ISO time the take started. */
  startedAt: string;
  /** The DAG clock origin at record start, in seconds — the same clock the engine
   * ticks on (`performance.now()/1000`), so every stream's JSONL `t` minus `t0`
   * is its offset into the take. (NOT AudioContext.currentTime, a different
   * origin.) */
  t0: number;
  /** The active instrument/sound id, for provenance. */
  instrument?: string;
  /** The recording stem (= folder name = file base name). */
  stem: string;
  streams: RecordingStreamEntry[];
}

/** Build a manifest from the take's clock + the list of streams actually
 * captured. Pure: callers stamp `startedAt`/`t0` from the browser and pass them
 * in, so this stays deterministic and testable. */
export function buildManifest(input: {
  startedAt: string;
  t0: number;
  stem: string;
  instrument?: string;
  streams: RecordingStreamEntry[];
}): RecordingManifest {
  return {
    version: RECORDING_MANIFEST_VERSION,
    startedAt: input.startedAt,
    t0: input.t0,
    instrument: input.instrument,
    stem: input.stem,
    streams: input.streams,
  };
}

/** Serialize a manifest to pretty JSON (trailing newline, like the JSONL files). */
export function serializeManifest(manifest: RecordingManifest): string {
  return JSON.stringify(manifest, null, 2) + '\n';
}
