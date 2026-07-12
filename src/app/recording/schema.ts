/**
 * Recording-session schema (#88) — the config for a recording take, modeled as
 * its OWN Zod schema, deliberately separate from the instrument dials/presets
 * (`src/settings/schema.ts`). Recording config is a tooling preference, not an
 * instrument parameter, and must never live in a preset. The last-used session is
 * persisted as a single JSON value under `recording.session.last` (localStorage),
 * validated back through this schema on read (`parseSession`).
 *
 * Every field carries a `.default(...)` so a session blob saved by an older build
 * still parses after new fields are added — the same forward-compat discipline as
 * the settings schema. The picked directory handle is NOT stored here (handles
 * can't be JSON-serialized); it lives in IndexedDB (`./idb`).
 */
import { z } from 'zod';
import { DEFAULT_RECORDING_FORMATS } from './formats';

/** localStorage key holding the last-used recording session config. */
export const RECORDING_SESSION_KEY = 'recording.session.last';

/** Which of the five streams to capture. Each is independently selectable; all
 * default off except audio (the built, always-available stream). */
export const RecordingStreamsSchema = z.object({
  /** Master-bus audio (the built stream). */
  audio: z.boolean().default(true),
  /** Composited canvas: webcam + overlays, "what you see". */
  overlayVideo: z.boolean().default(false),
  /** Raw webcam, no overlays — clean training/input footage. */
  pureVideo: z.boolean().default(false),
  /** Include the synth audio in the pure-webcam file (default off — it's input,
   * not output). */
  pureVideoAudio: z.boolean().default(false),
  /** Overlay landmarks on transparency (alpha WebM). Chromium-only; the UI
   * disables it elsewhere. */
  overlayAlpha: z.boolean().default(false),
  /** DAG feature stream → JSONL. */
  features: z.boolean().default(false),
  /** Which DAG edges (`"<node>.<port>"`) to log; empty = all. */
  featureEdges: z.array(z.string()).default([]),
});
export type RecordingStreams = z.infer<typeof RecordingStreamsSchema>;

/** All-defaults streams (audio on, everything else off) — the value the parent
 * `streams` field defaults to when absent (Zod 4's `.default` wants the full
 * output type, so we materialize it once from the inner field defaults). */
export const DEFAULT_RECORDING_STREAMS: RecordingStreams = RecordingStreamsSchema.parse({});

/** Where the recording folder goes. `directory` = File System Access API folder
 * picker (Chromium; falls back to a zip if unsupported); `downloads` = a single
 * zip that lands in the browser's Downloads folder (works everywhere). */
export const RecordingLocationSchema = z.enum(['directory', 'downloads']).default('downloads');
export type RecordingLocation = z.infer<typeof RecordingLocationSchema>;

export const RecordingSessionSchema = z.object({
  /** Prefilled at open (`{tag?-}{instrument}-{stamp}`); fully overwritable. */
  name: z.string().default(''),
  location: RecordingLocationSchema,
  /** Capture frame-rate for canvas/video streams. */
  fps: z.number().int().min(1).max(60).default(30),
  /** Output audio formats (ids from the RECORDING_FORMATS registry). Open list —
   * a new format needs no schema change. Defaults to (and empty heals back to)
   * {@link DEFAULT_RECORDING_FORMATS}, the registry's SSOT for the shipped choice. */
  formats: z.array(z.string()).default(() => [...DEFAULT_RECORDING_FORMATS]),
  streams: RecordingStreamsSchema.default(() => structuredClone(DEFAULT_RECORDING_STREAMS)),
  /** Escape hatch: when exactly one media stream (no features) is selected, save a
   * bare file instead of a folder+manifest. Default off (one-recording-one-folder
   * is the predictable model). */
  singleFileWhenAlone: z.boolean().default(false),
});
export type RecordingSession = z.infer<typeof RecordingSessionSchema>;

/** The shipped defaults (audio-only, downloads, 30fps, webm). */
export const DEFAULT_RECORDING_SESSION: RecordingSession = RecordingSessionSchema.parse({});

/**
 * Validate a raw persisted blob back into a session config, healing any
 * missing/invalid fields to their defaults (never throws). Mirrors the
 * `safeParse`-with-fallback pattern the settings layer uses.
 */
export function parseSession(raw: unknown): RecordingSession {
  const parsed = RecordingSessionSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_RECORDING_SESSION;
}

/** True if at least one stream is selected (a take with nothing to record is a
 * no-op the UI should block). */
export function hasAnyStream(streams: RecordingStreams): boolean {
  return (
    streams.audio ||
    streams.overlayVideo ||
    streams.pureVideo ||
    streams.overlayAlpha ||
    streams.features
  );
}
