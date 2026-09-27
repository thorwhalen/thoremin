/**
 * `air-guitar` node (#249) — strum chords on a guitar that is not there.
 *
 * Two hands, two problems, each answered by what `docs/research/air-instruments.md` found:
 *
 * - **The fretting hand says WHICH chord, by its shape, against the player's own
 *   vocabulary.** A chord is not a shape (§6.4): players finger the same chord
 *   differently, and a shared model scored 24% across players against 90 to 98% for two
 *   seconds of a player's own hand per chord. So the chords are ENROLLED: the player holds
 *   each shape they want and names it, and the `model` input is the classifier trained
 *   from those samples (`src/air/vocabulary.ts`). The live shape is the same featurizer
 *   the footage model used (`src/features/hand_shape.ts`), classified by the trainer's
 *   hysteretic tracker (`src/enroll/classify.ts`): a new chord must win a few frames in a
 *   row, and a moment of doubt HOLDS the last chord rather than dropping it.
 * - **The strumming hand says WHEN, and it is the drum problem** (§7.3): a strum's moment
 *   is predicted before the frame that shows it by the air drum's impact predictor
 *   (`src/ictus/impact.ts`). The chord is latched at the prediction.
 *
 * A strum sounds the chord's name as a guitarist would voice it (`src/music/guitar.ts`:
 * the open-chord rule on six strings), low string first, each string a few milliseconds
 * after the one below, each on its own `voice` so re-strumming damps only the same
 * string. Notes go to `pluck-out` (timbre `guitar`) on the audio clock.
 *
 * The node also emits the fretting hand's live shape vector (`shape`): the enrolment UI
 * captures its samples from there, so enrolment and play see exactly the same numbers.
 * Off by default; pure and Node-safe.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';
import { createImpactPredictor, type ImpactPredictor } from '@/ictus';
import { createCategoryTracker, type CategoryTracker, type FeatureVector, type TrainedModel } from '@/enroll';
import { chordShapeVector } from '@/features/hand_shape';
import { guitarVoicing, parseChordName } from '@/music/guitar';
import { LM, frameTime, type HandsFrame } from '../domain';
import { NoteEventsSchema, type NoteEvent } from './note_events';
import { PLAYER_HANDS, labelFor, type PlayerHand } from './air_bass';

export const STRUM_POINTS = ['wrist', 'indexTip'] as const;

const Params = z.object({
  /** Off by default: a player who never chooses an air guitar hears nothing new. */
  enabled: z.boolean().default(false),
  /** The hand that strums; the other one holds the chord shapes. */
  strumHand: z.enum(PLAYER_HANDS).default('right'),
  /** The strumming hand's tracked point: the wrist (a whole-hand strum) or the index tip. */
  strumPoint: z.enum(STRUM_POINTS).default('wrist'),
  /** Seconds between one string and the next in a strum (low string first). */
  strumSpread: z.number().min(0).max(0.05).default(0.012),
  /** How far ahead of the strum it is committed, seconds (the air drum's lead). */
  minLead: z.number().min(0).max(0.2).default(0.05),
  /** The smallest strum that counts, as a fraction of the frame height. */
  minStroke: z.number().min(0.005).max(0.2).default(0.03),
  /** The slowest approach that is a strum, frame heights per second. */
  minSpeed: z.number().min(0).max(5).default(0.5),
  /** Strum loudness, 0..1 (the stroke's own strength scales it). */
  volume: z.number().min(0).max(1).default(0.7),
  /** Frames a new chord shape must win in a row before it takes over. */
  enterFrames: z.number().int().min(1).max(30).default(3),
  /** The mirrored webcam reports the opposite hand label. Off for a third-person video. */
  mirrorHandedness: z.boolean().default(true),
});
type Params = z.infer<typeof Params>;

export const AirGuitarDialSchema = Params;
export type AirGuitarDialParams = Params;
export const DEFAULT_AIR_GUITAR_DIAL: AirGuitarDialParams = AirGuitarDialSchema.parse({});

/** What the Instruments view shows. */
export interface AirGuitarStatus {
  enabled: boolean;
  /** How many chords the enrolled model knows (0 = nothing enrolled yet). */
  known: number;
  /** Whether the fretting hand is in view. */
  fretting: boolean;
  /** The chord the fretting hand is holding now (the player's name for it), or null. */
  chord: string | null;
  /** False when the held chord's name is not a chord the app can voice. */
  playable: boolean;
  strums: number;
  predicted: number;
  lastChord: string | null;
  /** The last strum's lead in seconds (negative = late). */
  lastLead: number;
  /** Whether the strumming hand's stroke floor has been learned. */
  ready: boolean;
}

export const IDLE_AIR_GUITAR_STATUS: AirGuitarStatus = {
  enabled: false,
  known: 0,
  fretting: false,
  chord: null,
  playable: true,
  strums: 0,
  predicted: 0,
  lastChord: null,
  lastLead: 0,
  ready: false,
};

/** Velocity of a strum sounded on confirmation instead of prediction. */
const LATE_VELOCITY = 0.6;
/** Two samples closer than this are not two camera frames (the air drum's rule). */
const MIN_SAMPLE_SPACING = 0.004;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * The notes of one strum of `chordName` at time `t`: the chord's guitar voicing, low
 * string first, `spread` seconds apart, each on its string's voice. Empty for a name that
 * is not a chord.
 */
export function strumNotes(chordName: string, t: number, velocity: number, spread: number, extra: Pick<NoteEvent, 'predicted' | 'lead'>, octaveShift = 0): NoteEvent[] {
  const chord = parseChordName(chordName);
  if (!chord) return [];
  const notes: NoteEvent[] = [];
  let k = 0;
  guitarVoicing(chord).forEach((midi, string) => {
    if (midi === null) return;
    notes.push({ t: t + k * spread, midi: midi + 12 * octaveShift, velocity, voice: string, ...extra });
    k += 1;
  });
  return notes;
}

export const airGuitarNode = defineNode<Params>({
  type: 'air-guitar',
  roles: ['feature', 'mapping'],
  title: 'Air guitar',
  description:
    "Strum chords in the air: the fretting hand's shape is classified against the player's own enrolled chords, and a strum of the other hand, predicted before the frame that shows it, sounds that chord's guitar voicing. Off by default.",
  inputs: [
    { name: 'hands', kind: 'hands-frame' },
    { name: 'config', kind: 'air-guitar-config' },
    // The classifier trained from the player's enrolled chord shapes (null: none yet).
    { name: 'model', kind: 'shape-model' },
    { name: 'octaveShift', kind: 'number' },
  ],
  outputs: [
    { name: 'notes', kind: 'note-events', schema: NoteEventsSchema },
    // The fretting hand's live shape, for enrolment (null with no fretting hand).
    { name: 'shape', kind: 'feature-vector' },
    { name: 'status', kind: 'air-guitar-status' },
    { name: 'enabled', kind: 'boolean' },
  ],
  params: Params,
  make(p) {
    let cfg: Params = p;
    let lastConfigRef: unknown = undefined;
    let predictor: ImpactPredictor | null = null;
    let predictorKey = '';
    let tracker: CategoryTracker | null = null;
    let trackerModel: TrainedModel | null = null;
    let trackerFrames = 0;
    let lastT = -Infinity;
    let lastFrame: HandsFrame | undefined;
    let shape: FeatureVector | null = null;
    let status: AirGuitarStatus = { ...IDLE_AIR_GUITAR_STATUS };

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

    const strokeKey = (c: Params) => `${c.strumHand}|${c.strumPoint}|${c.mirrorHandedness}|${c.minStroke}|${c.minSpeed}`;
    const labelOf = (model: TrainedModel | null, id: string | null) => (id && model ? (model.categories.find((c) => c.id === id)?.label ?? null) : null);

    const reset = () => {
      predictor = null;
      predictorKey = '';
      tracker = null;
      trackerModel = null;
      lastT = -Infinity;
      lastFrame = undefined;
      shape = null;
      status = { ...IDLE_AIR_GUITAR_STATUS };
    };

    return {
      process(inputs, ctx: NodeContext) {
        const c = resolveConfig(inputs.config);
        if (!c.enabled) {
          if (predictor) reset();
          return { notes: [], shape: null, status, enabled: false };
        }
        if (!predictor || predictorKey !== strokeKey(c)) {
          predictor = createImpactPredictor({ minLead: c.minLead, minAmplitude: c.minStroke, minApproachSpeed: c.minSpeed });
          predictorKey = strokeKey(c);
          lastT = -Infinity;
          status = { ...IDLE_AIR_GUITAR_STATUS, enabled: true, known: status.known };
        }
        const model = (inputs.model as TrainedModel | null | undefined) ?? null;
        if (model !== trackerModel || c.enterFrames !== trackerFrames) {
          // A new model (an enrolment just changed) or tuning: start the chord tracking over.
          tracker = model && model.categories.length > 0 ? createCategoryTracker(model, { enterFrames: c.enterFrames }) : null;
          trackerModel = model;
          trackerFrames = c.enterFrames;
          status = { ...status, known: model?.categories.length ?? 0, chord: null, playable: true };
        }
        const shift = typeof inputs.octaveShift === 'number' && Number.isFinite(inputs.octaveShift) ? Math.round(inputs.octaveShift) : 0;
        const notes: NoteEvent[] = [];
        const frame = inputs.hands as HandsFrame | undefined;
        const sameStamp = !!frame && !!lastFrame && frame.t !== undefined && frame.t === lastFrame.t;
        const fresh = frame !== lastFrame && !sameStamp;
        lastFrame = frame;
        if (frame && fresh && frame.height > 0) {
          const t = frameTime(frame, ctx);
          const fretHand: PlayerHand = c.strumHand === 'right' ? 'left' : 'right';
          const fret = frame.hands.find((h) => h.handedness === labelFor(fretHand, c.mirrorHandedness));
          const strum = frame.hands.find((h) => h.handedness === labelFor(c.strumHand, c.mirrorHandedness));
          shape = fret ? chordShapeVector(fret, frame) : null;
          let chord = status.chord;
          if (shape && tracker) chord = labelOf(model, tracker.push(shape).categoryId);
          status = { ...status, fretting: !!fret, chord, playable: chord === null || parseChordName(chord) !== null };
          if (strum && t >= lastT + MIN_SAMPLE_SPACING) {
            lastT = t;
            predictor.setMinLead(c.minLead + Math.max(0, ctx.time - t));
            const kp = strum.keypoints[c.strumPoint === 'wrist' ? LM.wrist : LM.index_tip];
            for (const e of predictor.push({ t, x: kp.x / frame.height, y: kp.y / frame.height })) {
              if (chord === null) continue; // no chord held: a strum of nothing
              let strummed: NoteEvent[] = [];
              if (e.kind === 'predict') {
                const lead = e.t - ctx.time;
                strummed = strumNotes(chord, Math.max(e.t, ctx.time), clamp01(e.strength) * c.volume, c.strumSpread, { predicted: lead >= 0, lead }, shift);
              } else if (e.predicted === null) {
                strummed = strumNotes(chord, ctx.time, clamp01(e.strength) * c.volume * LATE_VELOCITY, c.strumSpread, { predicted: false, lead: e.t - ctx.time }, shift);
              }
              if (strummed.length) {
                notes.push(...strummed);
                status = {
                  ...status,
                  strums: status.strums + 1,
                  predicted: status.predicted + (strummed[0].predicted ? 1 : 0),
                  lastChord: chord,
                  lastLead: strummed[0].lead,
                };
              }
            }
            if (!status.ready && Number.isFinite(predictor.level())) status = { ...status, ready: true };
          }
        }
        return { notes, shape, status, enabled: true };
      },
      dispose() {
        reset();
      },
    };
  },
});
