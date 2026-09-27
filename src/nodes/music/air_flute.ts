/**
 * `air-flute` node (#249) — play a flute that is not there: the fingers choose the note,
 * the mouth says when it sounds.
 *
 * What `docs/research/air-instruments.md` found decides both halves:
 *
 * - **The fingers, enrolled per player, as LARGE lifts** (§7.2). A real flute key press
 *   moves a fingertip a few millimetres, under the hand tracker's noise floor: fingering
 *   from both hands scored at chance across players and 27 to 45% even with ten seconds
 *   of the player's own footage per note. An air flautist has no tube in the way, so the
 *   lifts can be as big as they like, and a big, deliberate shape per note is the
 *   guitar-chord result again. So the notes are ENROLLED: the player shows each fingering
 *   and names it by its note ("D5"). The live shape is both hands' shape vectors
 *   (`src/features/hand_shape.ts`, prefixed `l.` / `r.` by the player's hand),
 *   classified against the `fingerModel` by the trainer's hysteretic tracker.
 * - **The mouth arms the note; it does not time it** (§7.2.1, #248). The embouchure moves
 *   a few hundred milliseconds before a note from rest, with a few hundred milliseconds
 *   of spread, and carries no note information inside a phrase. So the breath is a GATE,
 *   not an onset predictor: in `breath: 'mouth'` the player enrols two mouth states,
 *   blowing and resting (the `mouthModel`, over the face catalog's mouth, jaw and lip
 *   features), and the note sounds while the mouth reads as blowing. `breath: 'always'`
 *   plays whenever a fingering is held, for a player without the face model.
 *
 * Output: one sustained voice (`params`, the synth's continuous path, sound `flute`),
 * so an attack and a release are the synth's own smoothing and a fingering change under
 * one breath is a legato slur, as on the instrument. Plus the live `shape` (fingers) and
 * `mouth` vectors for enrolment, and a `status`. Off by default; pure and Node-safe.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import { createCategoryTracker, type CategoryTracker, type FeatureVector, type TrainedModel } from '@/enroll';
import { chordShapeVector } from '@/features/hand_shape';
import { parseNoteName } from '@/music/notes';
import { midiToFreq } from '@/music/theory';
import type { HandsFrame, SynthParams, VoiceParams } from '../domain';
import { labelFor, type PlayerHand } from './air_bass';

/** The flute's synth voice id: far above the hand (0-1), chord (2-10) and score (11+)
 *  voices, so a long score never collides with it. */
export const FLUTE_VOICE_ID = 1000;
/** The mouth vocabulary's two labels. */
export const MOUTH_BLOW = 'blowing';
export const MOUTH_REST = 'resting';
export const BREATH_MODES = ['mouth', 'always'] as const;
/** The face catalog groups the mouth vector is taken from (claimed while the flute is on). */
export const MOUTH_GROUPS = ['face.blendshape.mouth', 'face.blendshape.jaw', 'face.geom.mouth'] as const;
const MOUTH_PREFIXES = MOUTH_GROUPS.map((g) => `${g}.`);

const Params = z.object({
  /** Off by default: a player who never chooses an air flute hears nothing new. */
  enabled: z.boolean().default(false),
  /** What starts and stops the sound: the enrolled mouth, or a held fingering alone. */
  breath: z.enum(BREATH_MODES).default('mouth'),
  /** Flute loudness, 0..1. */
  volume: z.number().min(0).max(1).default(0.5),
  /** Frames a new fingering must win in a row before the note changes. */
  enterFrames: z.number().int().min(1).max(30).default(3),
  /** Frames the mouth must read the other way before the breath starts or stops. */
  breathFrames: z.number().int().min(1).max(30).default(2),
  /** The mirrored webcam reports the opposite hand label. Off for a third-person video. */
  mirrorHandedness: z.boolean().default(true),
});
type Params = z.infer<typeof Params>;

export const AirFluteDialSchema = Params;
export type AirFluteDialParams = Params;
export const DEFAULT_AIR_FLUTE_DIAL: AirFluteDialParams = AirFluteDialSchema.parse({});

/** What the Instruments view shows. */
export interface AirFluteStatus {
  enabled: boolean;
  breath: (typeof BREATH_MODES)[number];
  /** How many fingerings, and whether the mouth's two states, are enrolled. */
  knownFingers: number;
  mouthReady: boolean;
  /** Whether both hands, and a face, are in view. */
  hands: boolean;
  face: boolean;
  /** The fingering held now (its note name), or null. */
  note: string | null;
  /** False when the held fingering's name is not a note. */
  playable: boolean;
  /** Whether the flute is sounding now. */
  sounding: boolean;
}

export const IDLE_AIR_FLUTE_STATUS: AirFluteStatus = {
  enabled: false,
  breath: 'mouth',
  knownFingers: 0,
  mouthReady: false,
  hands: false,
  face: false,
  note: null,
  playable: true,
  sounding: false,
};

/** Both hands' shape vectors as one, prefixed by the player's hand (`l.` / `r.`). A hand
 *  out of view contributes no keys (no evidence), never zeros. Null with neither hand. */
export function fingeringVector(frame: HandsFrame, mirrorHandedness: boolean): FeatureVector | null {
  const out: FeatureVector = {};
  let any = false;
  for (const [hand, prefix] of [['left', 'l.'], ['right', 'r.']] as [PlayerHand, string][]) {
    const h = frame.hands.find((x) => x.handedness === labelFor(hand, mirrorHandedness));
    if (!h) continue;
    any = true;
    for (const [k, v] of Object.entries(chordShapeVector(h, frame))) out[prefix + k] = v;
  }
  return any ? out : null;
}

/** The mouth features of a face feature vector (null when there is no face). */
export function mouthVector(face: FeatureVector | null | undefined): FeatureVector | null {
  if (!face) return null;
  const out: FeatureVector = {};
  let any = false;
  for (const [k, v] of Object.entries(face)) {
    if (!MOUTH_PREFIXES.some((p) => k.startsWith(p)) || !Number.isFinite(v)) continue;
    out[k] = v;
    any = true;
  }
  return any ? out : null;
}

const silentVoice = (sound: VoiceParams['sound']): VoiceParams => ({ id: FLUTE_VOICE_ID, present: false, freq: 440, gain: 0, sound });

export const airFluteNode = defineNode<Params>({
  type: 'air-flute',
  roles: ['feature', 'mapping'],
  title: 'Air flute',
  description:
    "Play a flute in the air: large finger lifts of both hands, enrolled per player and named by their note, choose the note; the player's enrolled blowing mouth (or a held fingering alone) sounds it as a sustained voice. Off by default.",
  inputs: [
    { name: 'hands', kind: 'hands-frame' },
    // The face feature vector (the mouth groups are claimed while the flute is on).
    { name: 'face', kind: 'feature-vector' },
    { name: 'config', kind: 'air-flute-config' },
    { name: 'fingerModel', kind: 'shape-model' },
    { name: 'mouthModel', kind: 'shape-model' },
    { name: 'octaveShift', kind: 'number' },
  ],
  outputs: [
    { name: 'params', kind: 'synth-params' },
    { name: 'shape', kind: 'feature-vector' },
    { name: 'mouth', kind: 'feature-vector' },
    { name: 'status', kind: 'air-flute-status' },
    { name: 'enabled', kind: 'boolean' },
  ],
  params: Params,
  make(p) {
    let cfg: Params = p;
    let lastConfigRef: unknown = undefined;
    let fingers: CategoryTracker | null = null;
    let fingersFor: TrainedModel | null = null;
    let mouth: CategoryTracker | null = null;
    let mouthFor: TrainedModel | null = null;
    let trackersKey = '';
    let lastFrame: HandsFrame | undefined;
    let shape: FeatureVector | null = null;
    let mouthVec: FeatureVector | null = null;
    let note: string | null = null;
    let blowing = false;
    let status: AirFluteStatus = { ...IDLE_AIR_FLUTE_STATUS };
    const SOUND = 'flute' as const;

    const resolveConfig = (raw: unknown): Params => {
      if (raw === lastConfigRef) return cfg;
      lastConfigRef = raw;
      if (raw && typeof raw === 'object') {
        const parsed = Params.partial().safeParse(raw);
        if (parsed.success) {
          const overrides = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
          cfg = { ...p, ...overrides } as Params;
          return cfg;
        }
      }
      cfg = p;
      return cfg;
    };
    const labelOf = (model: TrainedModel | null, id: string | null) => (id && model ? (model.categories.find((c) => c.id === id)?.label ?? null) : null);
    /** A mouth model is usable when it knows both states. */
    const mouthUsable = (m: TrainedModel | null) => !!m && [MOUTH_BLOW, MOUTH_REST].every((l) => m.categories.some((c) => c.label === l));

    const reset = () => {
      fingers = mouth = null;
      fingersFor = mouthFor = null;
      trackersKey = '';
      lastFrame = undefined;
      shape = mouthVec = null;
      note = null;
      blowing = false;
      status = { ...IDLE_AIR_FLUTE_STATUS };
    };

    return {
      process(inputs) {
        const c = resolveConfig(inputs.config);
        if (!c.enabled) {
          if (trackersKey) reset();
          return { params: { voices: [] } satisfies SynthParams, shape: null, mouth: null, status, enabled: false };
        }
        const fingerModel = (inputs.fingerModel as TrainedModel | null | undefined) ?? null;
        const mouthModel = (inputs.mouthModel as TrainedModel | null | undefined) ?? null;
        const key = `${c.enterFrames}|${c.breathFrames}`;
        if (fingerModel !== fingersFor || mouthModel !== mouthFor || key !== trackersKey) {
          if (fingerModel !== fingersFor || key !== trackersKey) {
            fingers = fingerModel && fingerModel.categories.length > 0 ? createCategoryTracker(fingerModel, { enterFrames: c.enterFrames }) : null;
            note = null;
          }
          if (mouthModel !== mouthFor || key !== trackersKey) {
            mouth = mouthUsable(mouthModel) ? createCategoryTracker(mouthModel!, { enterFrames: c.breathFrames }) : null;
            blowing = false;
          }
          fingersFor = fingerModel;
          mouthFor = mouthModel;
          trackersKey = key;
        }
        const frame = inputs.hands as HandsFrame | undefined;
        const sameStamp = !!frame && !!lastFrame && frame.t !== undefined && frame.t === lastFrame.t;
        if (frame && frame !== lastFrame && !sameStamp) {
          shape = fingeringVector(frame, c.mirrorHandedness);
          if (shape && fingers) note = labelOf(fingerModel, fingers.push(shape).categoryId);
        }
        lastFrame = frame;
        // The face vector is re-emitted every tick; the tracker's frame counts are ticks
        // here, which only makes the breath hysteresis a little shorter at 60 Hz.
        mouthVec = mouthVector(inputs.face as FeatureVector | null | undefined);
        if (mouthVec && mouth) blowing = labelOf(mouthModel, mouth.push(mouthVec).categoryId) === MOUTH_BLOW;
        if (!mouthVec) blowing = false; // no face: no breath (the mouth mode stays silent)

        const bothHands = !!shape && Object.keys(shape).some((k) => k.startsWith('l.')) && Object.keys(shape).some((k) => k.startsWith('r.'));
        const parsed = note ? parseNoteName(note) : null;
        const breathOn = c.breath === 'always' ? bothHands : blowing;
        const sounding = parsed !== null && breathOn;
        const shift = typeof inputs.octaveShift === 'number' && Number.isFinite(inputs.octaveShift) ? Math.round(inputs.octaveShift) : 0;
        const voice: VoiceParams = sounding
          ? { id: FLUTE_VOICE_ID, present: true, freq: midiToFreq(parsed!.midi + 12 * shift), gain: c.volume, sound: SOUND, brightness: 1, vibrato: 0, pan: 0 }
          : silentVoice(SOUND);
        status = {
          enabled: true,
          breath: c.breath,
          knownFingers: fingerModel?.categories.length ?? 0,
          mouthReady: mouthUsable(mouthModel),
          hands: bothHands,
          face: mouthVec !== null,
          note,
          playable: note === null || parsed !== null,
          sounding,
        };
        return { params: { voices: [voice] } satisfies SynthParams, shape, mouth: mouthVec, status, enabled: true };
      },
      dispose() {
        reset();
      },
    };
  },
});
