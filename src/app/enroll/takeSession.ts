/**
 * The recording session a training take uses (#163 §6) — a `RecordingSession` config
 * like the Record sheet's, fixed here so the trainer records the same thing every time:
 *
 * - `pureVideo`: the CLEAN camera stream — no overlay, no guidance banner, no text.
 *   `plan.ts` distinguishes it from `overlayVideo`; only the pure stream is selected.
 * - `features`: the feature vectors the trainer itself learns from (`features.jsonl`),
 *   so a recorded take can be re-trained headlessly and its points projected.
 * - annotations ride along through the trainer's own tag source (cue intervals, verdict
 *   points) — see `annotations.ts`.
 *
 * Audio is off: the trainer changes nothing about what you hear, and a training take
 * is not a performance. The sink is the player's recording location (downloads by
 * default), like any other take.
 */
import { DEFAULT_RECORDING_SESSION, type RecordingSession } from '../recording/schema';
import { prefillName } from '../recording/naming';

/** The instrument label a training take is filed under. */
export const TRAINER_TAKE_INSTRUMENT = 'trainer';

/**
 * The recording session a training take uses. The STREAMS are fixed (the clean camera
 * + the features + the annotations — never the overlay or audio), and the name is
 * always the trainer's; everything else the player has chosen — where recordings go,
 * the frame rate, the media formats — is inherited from `base` (their last Record-sheet
 * config, so a training take lands wherever their other takes do).
 */
export function trainerTakeSession(base: RecordingSession = DEFAULT_RECORDING_SESSION, now: Date = new Date()): RecordingSession {
  return {
    ...base,
    name: prefillName({ instrument: TRAINER_TAKE_INSTRUMENT, date: now }),
    singleFileWhenAlone: false,
    streams: { ...base.streams, audio: false, overlayVideo: false, overlayAlpha: false, pureVideo: true, features: true },
  };
}
