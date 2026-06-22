/**
 * PerformanceRecorder — capture the live instrument output to a downloadable
 * audio file. It taps the master bus through a MediaStreamAudioDestinationNode
 * and records that stream with the browser's built-in MediaRecorder (no extra
 * dependency, no extra ML). The pure helpers (codec/extension/filename) are
 * unit-testable; the recorder itself only runs in the browser.
 */

/** Candidate record codecs, best first. */
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
] as const;

/** Pick the first codec the browser's MediaRecorder supports. */
export function pickMimeType(
  isSupported: (m: string) => boolean = (m) =>
    typeof MediaRecorder !== 'undefined' && !!MediaRecorder.isTypeSupported?.(m),
): string {
  for (const m of MIME_CANDIDATES) if (isSupported(m)) return m;
  return 'audio/webm';
}

/** File extension for a recorded MIME type. */
export function extForMime(mime: string): string {
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4')) return 'm4a';
  return 'webm';
}

/** A timestamped download name, e.g. thoremin-2026-06-22T07-30-00.webm. */
export function recordingFilename(isoStamp: string, ext: string): string {
  const safe = isoStamp.replace(/[:.]/g, '-').replace(/Z$/, '');
  return `thoremin-${safe}.${ext}`;
}

/** Trigger a browser download of a blob (browser-only). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has had a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface PerformanceRecorderOptions {
  audioContext: AudioContext;
  /** The node whose output to record (typically the host master gain). */
  source: AudioNode;
  mimeType?: string;
}

export class PerformanceRecorder {
  private readonly dest: MediaStreamAudioDestinationNode;
  private readonly source: AudioNode;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  readonly mimeType: string;

  constructor(opts: PerformanceRecorderOptions) {
    this.dest = opts.audioContext.createMediaStreamDestination();
    this.source = opts.source;
    // Tap the master bus: source still reaches the speakers; we also feed the
    // recorder destination. The stream is silent until voices actually play.
    this.source.connect(this.dest);
    this.mimeType = opts.mimeType ?? pickMimeType();
  }

  get recording(): boolean {
    return this.rec?.state === 'recording';
  }

  start(): void {
    if (this.recording) return;
    this.chunks = [];
    this.rec = new MediaRecorder(this.dest.stream, { mimeType: this.mimeType });
    this.rec.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.rec.start();
  }

  /** Stop and resolve with the recorded audio as a Blob. */
  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      const r = this.rec;
      if (!r || r.state === 'inactive') {
        resolve(new Blob(this.chunks, { type: this.mimeType }));
        return;
      }
      r.onstop = () => resolve(new Blob(this.chunks, { type: this.mimeType }));
      r.stop();
    });
  }

  dispose(): void {
    try {
      if (this.rec && this.rec.state !== 'inactive') this.rec.stop();
    } catch {
      /* already stopped */
    }
    try {
      this.source.disconnect(this.dest);
    } catch {
      /* already disconnected */
    }
  }
}
