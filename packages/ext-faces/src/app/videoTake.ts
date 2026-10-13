/**
 * The take's video, kept in memory (#330 P2): a `MediaRecorder` over the clean stream, started
 * with the take and stopped with it, whose blob the exemplar frames are seeked from. Nothing is
 * written to disk or downloaded: a face session is not a recording the player asked to keep, and
 * a video of their face does not leave the page unless they choose to (the Record sheet).
 *
 * `t0` is the engine-clock time (ms) the recorder started, so a still-point at `t` is at
 * `(t - t0) / 1000` seconds into the blob.
 */

export interface VideoTake {
  /** Engine ms at which recording started. */
  readonly t0: number;
  /** Stop and hand back the video (null when the recorder produced nothing). */
  stop(): Promise<Blob | null>;
  /** Stop and drop it. */
  cancel(): void;
}

/** Start recording `stream`, or null when it cannot be recorded here (no stream, no MediaRecorder). */
export function startVideoTake(stream: MediaStream | null, now: () => number = () => performance.now()): VideoTake | null {
  if (!stream || stream.getVideoTracks().length === 0 || typeof MediaRecorder === 'undefined') return null;
  // A video-only copy: the camera stream may carry no audio, but a caller's might.
  const video = new MediaStream(stream.getVideoTracks());
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(video);
    recorder.start(250);
  } catch {
    return null;
  }
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  const t0 = now();
  return {
    t0,
    stop: () =>
      new Promise<Blob | null>((resolve) => {
        if (recorder.state === 'inactive') return resolve(chunks.length ? new Blob(chunks, { type: recorder.mimeType || 'video/webm' }) : null);
        recorder.onstop = () => resolve(chunks.length ? new Blob(chunks, { type: recorder.mimeType || 'video/webm' }) : null);
        recorder.stop();
      }),
    cancel: () => {
      if (recorder.state !== 'inactive') recorder.stop();
      chunks.length = 0;
    },
  };
}
