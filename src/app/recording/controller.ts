/**
 * The recording controller (#163 §6) — how a host-side consumer other than the Record
 * button starts and stops a take.
 *
 * The `SessionRecorder` is built inside `useEngine` from React refs (the audio context,
 * the canvas, the camera stream, the engine). A store cannot reach those, and must not:
 * the trainer wants to say "record this take: the clean camera, the features, and my
 * annotations" and be handed the same recorder the button uses. So `useEngine`
 * REGISTERS an implementation here, and the trainer store calls it. Absent a
 * registration (headless, tests), starting a take is a no-op that reports `false`.
 *
 * One take at a time: the controller owns the "is a take running" truth, whichever
 * surface started it.
 */
import type { RecordingSession } from './schema';
import type { TagStreamSource } from './tagStream';

export interface StartTakeOptions {
  /** The annotation source for this take (the trainer's cue/verdict tags). Absent =
   *  whatever the host uses by default (the live-tagging store). */
  tagSource?: TagStreamSource;
  /** For the manifest / file names. */
  instrument?: string;
}

export interface RecordingController {
  /** Start a take with `session`'s streams. Resolves `true` once recording, `false`
   *  if it could not start (no audio yet, a dismissed picker, already recording). */
  start(session: RecordingSession, opts?: StartTakeOptions): Promise<boolean>;
  /** Stop the running take and write its files. No-op if none. */
  stop(): Promise<void>;
  isRecording(): boolean;
}

let controller: RecordingController | null = null;

/** `useEngine` installs its implementation; returns the uninstall. */
export function registerRecordingController(c: RecordingController): () => void {
  controller = c;
  return () => {
    if (controller === c) controller = null;
  };
}

/** The registered controller, or a no-op one that reports it could not start. */
export function recordingController(): RecordingController {
  return (
    controller ?? {
      start: async () => false,
      stop: async () => undefined,
      isRecording: () => false,
    }
  );
}
