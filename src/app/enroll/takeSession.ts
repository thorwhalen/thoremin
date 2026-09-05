/**
 * The recording session a training take uses (#163 §6) — a `RecordingSession` config
 * like the Record sheet's, fixed here so the trainer records the same thing every time:
 *
 * - `pureVideo`: the CLEAN camera stream — no overlay, no guidance banner, no text.
 *   `plan.ts` distinguishes it from `overlayVideo`; only the pure stream is selected.
 * - `features`: the feature vectors the trainer itself learns from (`features.jsonl`),
 *   so a recorded take can be re-trained headlessly and its points projected. The EDGES
 *   are **pinned** to {@link FEATURE_VECTOR_EDGES} — the same constant `LiveVectorTap`
 *   filters on, so the take contains exactly what the trainer learned from.
 *
 *   This is a fix, not a tidy-up. `featureEdges` is a subset filter where **empty means
 *   every edge** (`FeatureJsonlTap` only builds a filter set when the list is non-empty),
 *   and nothing in the app has ever written it — no Record-sheet control, no dial. So it
 *   was always `[]`, and a training take recorded *every output port of every node*.
 *   That includes `camFace.face`, which carries all 478 face-mesh landmarks per tick
 *   (`blendshapesToFaceFrame`, `src/nodes/sources/webcam_face.ts`). Two consequences,
 *   both bad: a multi-minute routine wrote hundreds of megabytes, and a **face mesh** —
 *   biometric geometry, unlike the blendshape coefficients and pose the catalog derives —
 *   sat in a file the player is invited to hand to a fixture converter. Pinning the edges
 *   keeps the mesh out of the recording at the source rather than stripping it later.
 * - annotations ride along through the trainer's own tag source (cue intervals, verdict
 *   points) — see `annotations.ts`.
 *
 * Audio is off: the trainer changes nothing about what you hear, and a training take
 * is not a performance. The sink is the player's recording location (downloads by
 * default), like any other take.
 */
import { DEFAULT_RECORDING_SESSION, type RecordingSession } from '../recording/schema';
import { prefillName } from '../recording/naming';
import { FEATURE_VECTOR_EDGES } from './liveVector';

/** The instrument label a training take is filed under. */
export const TRAINER_TAKE_INSTRUMENT = 'trainer';

/**
 * The recording session a training take uses. The STREAMS are fixed (the clean camera
 * + the features + the annotations — never the overlay or audio) and so are the feature
 * EDGES; the name is always the trainer's. Everything else the player has chosen — where
 * recordings go, the frame rate, the media formats — is inherited from `base` (their last
 * Record-sheet config, so a training take lands wherever their other takes do).
 *
 * The split is: what the take *is* belongs to the trainer, because a downstream consumer
 * (the fixture converter, a headless re-train) depends on it; where it *goes* belongs to
 * the player.
 */
export function trainerTakeSession(base: RecordingSession = DEFAULT_RECORDING_SESSION, now: Date = new Date()): RecordingSession {
  return {
    ...base,
    name: prefillName({ instrument: TRAINER_TAKE_INSTRUMENT, date: now }),
    singleFileWhenAlone: false,
    streams: {
      ...base.streams,
      audio: false,
      overlayVideo: false,
      overlayAlpha: false,
      pureVideo: true,
      features: true,
      featureEdges: [...FEATURE_VECTOR_EDGES],
    },
  };
}
