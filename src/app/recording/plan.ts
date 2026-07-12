/**
 * Recording plan (#88) — the pure function that turns a validated
 * {@link RecordingSession} + a stem + the negotiated MIME types into the exact
 * list of files a take will write, with correct primary/secondary extensions and
 * the one-folder-per-recording rule (plus the opt-in single-file escape hatch).
 *
 * This is the browser-independent heart of the naming scheme, unit-tested in
 * isolation; the browser {@link SessionRecorder} consumes the plan and does the
 * actual capture + writing. Keeping it pure means the naming contract can't drift
 * between the directory / zip / per-file sinks (they all write the same names).
 */
import { extForMime } from '../recorder';
import { recordingFormat, DEFAULT_RECORDING_FORMATS } from './formats';
import { fileName } from './naming';
import type { RecordingStreamKind } from './manifest';
import type { RecordingSession } from './schema';

/** File extension for a recorded VIDEO MIME type (`video/mp4` → mp4, else webm). */
export function videoExtForMime(mime: string): string {
  return mime.includes('mp4') ? 'mp4' : 'webm';
}

/** One file the take will produce. `kind==='manifest'` is a sidecar (not itself a
 * stream in the manifest); every other kind is a captured stream. */
export interface PlannedFile {
  name: string;
  kind: RecordingStreamKind | 'manifest';
  role?: string;
  ext: string;
  mime?: string;
  fps?: number;
}

export interface RecordingPlan {
  stem: string;
  /** Folder name (= stem) when {@link useFolder}; unused for a bare single file. */
  folderName: string;
  /** One-recording-one-folder (the default). False only for the single-file
   * escape hatch (one media stream, no features, opted in). */
  useFolder: boolean;
  files: PlannedFile[];
}

export interface PlanInput {
  session: RecordingSession;
  stem: string;
  /** Negotiated audio-capture MIME (native container, always WebM/Opus-ish). */
  audioMime: string;
  /** Negotiated overlay/pure-video MIME. */
  videoMime: string;
  /** Alpha (overlay-only) MIME — Chromium VP9; defaults to `video/webm;codecs=vp9`. */
  alphaMime?: string;
  /** Whether live annotations (#92) are active for this take — adds a `.annotations.jsonl`
   *  stream to the folder (and forces folder mode, since an annotation log needs the
   *  manifest to say what it segments). */
  includeAnnotations?: boolean;
}

/** Selected audio output formats, filtered to ids the registry knows (an unknown
 * id in a stale saved session is dropped, not fatal); empty heals to
 * {@link DEFAULT_RECORDING_FORMATS}. Exported because `SessionRecorder` must
 * convert audio in exactly this order — one definition, not two. */
export function audioFormatIds(session: RecordingSession): string[] {
  const ids = session.formats.filter((id) => recordingFormat(id));
  return ids.length ? ids : [...DEFAULT_RECORDING_FORMATS];
}

/** Number of selected MEDIA streams (audio counts once regardless of formats). */
function mediaStreamCount(session: RecordingSession): number {
  const s = session.streams;
  return [s.audio, s.overlayVideo, s.pureVideo, s.overlayAlpha].filter(Boolean).length;
}

/**
 * The one-file escape hatch is eligible only when the user opted in, exactly one
 * media stream is selected, there is no feature stream, and — if that stream is
 * audio — exactly one output format (two formats are two files, which needs a
 * folder).
 */
function singleFileEligible(session: RecordingSession): boolean {
  const s = session.streams;
  if (!session.singleFileWhenAlone || s.features) return false;
  if (mediaStreamCount(session) !== 1) return false;
  if (s.audio) return audioFormatIds(session).length === 1;
  return true;
}

function audioFiles(session: RecordingSession, stem: string, audioMime: string): PlannedFile[] {
  return audioFormatIds(session).map((id) => {
    const fmt = recordingFormat(id)!;
    // Native webm derives its ext from the recorder MIME; converted formats use
    // the registry ext. Audio files need no secondary ext: the native `.webm`
    // and any converted `.wav`/`.mp3` differ by PRIMARY ext, and the video
    // streams carry role secondary exts, so there is no collision.
    const ext = id === 'webm' ? extForMime(audioMime) : fmt.ext;
    return {
      name: fileName(stem, { ext }),
      kind: 'audio' as const,
      ext,
      mime: id === 'webm' ? audioMime : undefined,
    };
  });
}

/** Compute the full file plan for a take (pure). */
export function planRecording(input: PlanInput): RecordingPlan {
  const { session, stem, audioMime, videoMime } = input;
  const alphaMime = input.alphaMime ?? 'video/webm;codecs=vp9';
  const s = session.streams;
  const fps = session.fps;
  const videoExt = videoExtForMime(videoMime);
  const includeAnnotations = input.includeAnnotations === true;

  // --- single-file escape hatch: one bare media file, no folder, no manifest ---
  // A annotation log needs the folder + manifest, so it disqualifies the escape hatch.
  if (!includeAnnotations && singleFileEligible(session)) {
    let file: PlannedFile;
    if (s.audio) {
      file = audioFiles(session, stem, audioMime)[0];
    } else if (s.overlayVideo) {
      file = { name: fileName(stem, { ext: videoExt }), kind: 'overlayVideo', ext: videoExt, mime: videoMime, fps };
    } else if (s.pureVideo) {
      file = { name: fileName(stem, { ext: videoExt }), kind: 'pureVideo', ext: videoExt, mime: videoMime, fps };
    } else {
      file = { name: fileName(stem, { ext: 'webm' }), kind: 'overlayAlpha', ext: 'webm', mime: alphaMime, fps };
    }
    return { stem, folderName: stem, useFolder: false, files: [file] };
  }

  // --- one folder per recording (the default) ---
  const files: PlannedFile[] = [];
  // Video streams share the `.webm`/`.mp4` primary ext, so each carries its role
  // as a secondary ext (`.overlay.` / `.camera.` / `.alpha.`).
  if (s.overlayVideo)
    files.push({ name: fileName(stem, { role: 'overlay', ext: videoExt }), kind: 'overlayVideo', role: 'overlay', ext: videoExt, mime: videoMime, fps });
  if (s.pureVideo)
    files.push({ name: fileName(stem, { role: 'camera', ext: videoExt }), kind: 'pureVideo', role: 'camera', ext: videoExt, mime: videoMime, fps });
  if (s.overlayAlpha)
    files.push({ name: fileName(stem, { role: 'alpha', ext: 'webm' }), kind: 'overlayAlpha', role: 'alpha', ext: 'webm', mime: alphaMime, fps });
  if (s.audio) files.push(...audioFiles(session, stem, audioMime));
  if (s.features)
    files.push({ name: fileName(stem, { role: 'features', ext: 'jsonl' }), kind: 'features', role: 'features', ext: 'jsonl' });
  // The live-annotation stream (#92) drops in like features.jsonl: same folder, same
  // stem, same t0/JSONL convention, listed in the manifest as `kind: 'annotations'`.
  if (includeAnnotations)
    files.push({ name: fileName(stem, { role: 'annotations', ext: 'jsonl' }), kind: 'annotations', role: 'annotations', ext: 'jsonl' });

  // The manifest is always present (provenance + alignment SSOT), so a folder has
  // ≥ 2 files even for an audio-only take.
  files.push({ name: fileName(stem, { role: 'manifest', ext: 'json' }), kind: 'manifest', role: 'manifest', ext: 'json' });

  return { stem, folderName: stem, useFolder: true, files };
}
