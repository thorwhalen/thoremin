/**
 * Recording capability detection (#88) — feature-detect (never UA-sniff) which
 * capture/save mechanisms the current browser supports, and pick MIME types. The
 * one pure decision (`chooseSinkKind`) is unit-tested; the probes read live
 * browser globals and are guarded so they no-op safely under the Node test
 * runtime.
 */
import { pickMimeType } from '../recorder';
import type { RecordingLocation } from './schema';

/** The concrete sink backend a recording will use (see `./sink`). */
export type SinkKind = 'directory' | 'zip' | 'perFile';

/** Runtime capabilities that steer sink selection. */
export interface RecordingCaps {
  /** File System Access API directory picker (`showDirectoryPicker`). */
  directoryPicker: boolean;
  /** Single-file save picker (`showSaveFilePicker`). */
  filePicker: boolean;
}

const g: typeof globalThis & {
  showDirectoryPicker?: unknown;
  showSaveFilePicker?: unknown;
} = globalThis;

/** Detect the current browser's save capabilities. */
export function detectCaps(): RecordingCaps {
  return {
    directoryPicker: typeof g.showDirectoryPicker === 'function',
    filePicker: typeof g.showSaveFilePicker === 'function',
  };
}

/**
 * Map the user's location preference + detected capabilities to a concrete sink
 * backend (pure). `directory` uses the folder picker when available and otherwise
 * degrades to a single zip; `downloads` always produces one zip (which lands in
 * the browser's Downloads folder). Per-file is only the last resort when even a
 * zip can't be assembled — currently unreachable since fflate is bundled lazily,
 * but kept in the type so a future constrained target has a path.
 */
export function chooseSinkKind(location: RecordingLocation, caps: RecordingCaps): SinkKind {
  if (location === 'directory') return caps.directoryPicker ? 'directory' : 'zip';
  return 'zip';
}

const VIDEO_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
] as const;

const ALPHA_MIME_CANDIDATES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8'] as const;

function isTypeSupported(mime: string): boolean {
  return typeof MediaRecorder !== 'undefined' && !!MediaRecorder.isTypeSupported?.(mime);
}

/** Pick the best supported audio-capture MIME (delegates to the recorder's). */
export function pickAudioMime(): string {
  return pickMimeType();
}

/** Pick the best supported video-capture MIME (VP9 → VP8 → webm → mp4). */
export function pickVideoMime(): string {
  for (const m of VIDEO_MIME_CANDIDATES) if (isTypeSupported(m)) return m;
  return 'video/webm';
}

/** Best supported alpha (transparent) video MIME, or null if none — alpha WebM in
 * MediaRecorder is effectively Chromium-only (Firefox flattens alpha, Safari has
 * no alpha WebM), which `isTypeSupported` reflects on those engines. */
export function pickAlphaMime(): string | null {
  for (const m of ALPHA_MIME_CANDIDATES) if (isTypeSupported(m)) return m;
  return null;
}

/** Whether the transparent overlay-only stream can be captured here. Feature-based
 * (a supported alpha VP MIME) rather than a UA check; in practice this is true only
 * on Chromium engines. */
export function supportsOverlayAlpha(): boolean {
  return pickAlphaMime() !== null;
}
