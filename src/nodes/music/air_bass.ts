/**
 * `air-bass` node (#249) — play a bass that is not there.
 *
 * What `docs/research/air-instruments.md` §7.1 found decides the design. Bass pitch is
 * not a hand SHAPE: on real footage the fretting hand looks the same at every fret (10%
 * across players, 32% within one), because a sounding note is a fret and a string. An
 * air bass has no frets either, so the note is the player's intent expressed as a
 * **displacement along an imaginary neck**: how far the fretting hand is from the
 * plucking hand (horizontally, see {@link neckNote}), in the fretting hand's own palm spans (camera-distance invariant, the
 * offset the footage featurizer used). Far out toward the headstock is low, close to the
 * body is high, exactly as on the instrument; the displacement is quantised to the
 * instrument's scale (the `scale` input, the same notes the theremin plays), so this is
 * the theremin's own pitch mapping laid along a neck.
 *
 * The plucking hand is the rhythm half, and it is the drum problem (§7.3): a pluck is a
 * short stroke whose moment of contact the camera never sees, so it is predicted before
 * the frame that shows it by the same impact predictor the air drum uses
 * (`src/ictus/impact.ts`). The note is latched when the pluck is predicted, so sliding
 * the fretting hand after a pluck does not bend a note that has already sounded.
 *
 * Output: note events on the engine clock (`notes`), sounded by `pluck-out` on the
 * audio clock, plus a `status` for the Instruments view's readout. Off by default. Pure
 * and Node-safe (no DOM, no clock), so synthetic hands drive it headlessly.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';
import { createImpactPredictor, type ImpactPredictor } from '@/ictus';
import { LM, frameTime, type Hand, type HandsFrame, type Keypoint } from '../domain';
import { NoteEventsSchema, type NoteEvent } from './note_events';

export const PLAYER_HANDS = ['right', 'left'] as const;
export type PlayerHand = (typeof PLAYER_HANDS)[number];
export const PLUCK_POINTS = ['indexTip', 'wrist'] as const;
export type PluckPoint = (typeof PLUCK_POINTS)[number];

const Params = z.object({
  /** Off by default: a player who never chooses an air bass hears nothing new. */
  enabled: z.boolean().default(false),
  /** The hand that plucks; the other one frets. */
  pluckHand: z.enum(PLAYER_HANDS).default('right'),
  /** The plucking hand's tracked point: the index fingertip (a finger pluck) or the wrist. */
  pluckPoint: z.enum(PLUCK_POINTS).default('indexTip'),
  /** The fretting hand's distance from the plucking hand, in its own palm spans, at the
   *  HIGHEST note (close to the body) and at the LOWEST (out toward the headstock). */
  neckNear: z.number().min(0).max(20).default(2),
  neckFar: z.number().min(0).max(20).default(7),
  /** How much the palm span and the neck's reference point are smoothed, per camera
   *  frame (0..1, the weight of a new frame). Both are near-constants of the player's
   *  body; measured raw, a pixel of tracker jitter moves the note a quarter step. */
  smoothing: z.number().min(0.01).max(1).default(0.1),
  /** How far past the edge of a note, in scale steps, the neck hand must move before
   *  the note changes: a hand held still on a note stays on it. */
  hysteresis: z.number().min(0).max(0.5).default(0.3),
  /** How far ahead of the pluck a note is committed, seconds (the air drum's lead). */
  minLead: z.number().min(0).max(0.2).default(0.05),
  /** The smallest pluck that counts, as a fraction of the frame height. */
  minStroke: z.number().min(0.005).max(0.2).default(0.02),
  /** The slowest approach that is a pluck, frame heights per second. */
  minSpeed: z.number().min(0).max(5).default(0.4),
  /** Note loudness, 0..1 (the pluck's own strength scales it). */
  volume: z.number().min(0).max(1).default(0.8),
  /** The mirrored webcam reports the opposite hand label. Off for a third-person video. */
  mirrorHandedness: z.boolean().default(true),
});
type Params = z.infer<typeof Params>;

/** The node's params, re-exported as the SSOT for the `airBass` dial. */
export const AirBassDialSchema = Params;
export type AirBassDialParams = Params;
export const DEFAULT_AIR_BASS_DIAL: AirBassDialParams = AirBassDialSchema.parse({});

export { NoteEventSchema, NoteEventsSchema, type NoteEvent } from './note_events';

/** What the Instruments view shows. */
export interface AirBassStatus {
  enabled: boolean;
  /** Whether both hands are in view (the fretting hand sets the note). */
  fretting: boolean;
  /** The note under the fretting hand right now, or null with it out of view. */
  fretMidi: number | null;
  /** Notes sounded since enabling, and how many were predicted ahead of the pluck. */
  notes: number;
  predicted: number;
  lastMidi: number | null;
  /** The last note's lead in seconds (negative = late). */
  lastLead: number;
  /** Whether the plucking hand's stroke floor has been learned (a first pluck seen). */
  ready: boolean;
}

export const IDLE_AIR_BASS_STATUS: AirBassStatus = { enabled: false, fretting: false, fretMidi: null, notes: 0, predicted: 0, lastMidi: null, lastLead: 0, ready: false };

/** Velocity of a pluck sounded on confirmation instead of prediction. */
const LATE_VELOCITY = 0.6;
/** Two samples closer than this are not two camera frames (the air drum's rule). */
const MIN_SAMPLE_SPACING = 0.004;

/** MediaPipe's label for the player's hand, given the mirror convention. */
export function labelFor(hand: PlayerHand, mirrorHandedness: boolean): Hand['handedness'] {
  const raw = hand === 'right' ? 'Right' : 'Left';
  if (!mirrorHandedness) return raw;
  return raw === 'Right' ? 'Left' : 'Right';
}

const dist = (a: Keypoint, b: Keypoint) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Where the fretting hand is along the neck, 0 (the lowest note, `far`) to 1 (the
 * highest, `near`): its wrist's HORIZONTAL distance from the reference point (the
 * plucking wrist), in palm spans. `near` and `far` may be given in either order. Null
 * for a degenerate neck or span.
 *
 * Horizontal, because a pluck is a vertical stroke: measured as a straight-line distance,
 * the plucking hand's own stroke moves the note by a scale step between two plucks at the
 * same place on the neck. A tilted neck shortens the horizontal run a little, which the
 * `neckNear` / `neckFar` dials absorb.
 */
export function neckPosition(fretX: number, refX: number, span: number, near: number, far: number): number | null {
  const lo = Math.min(near, far);
  const hi = Math.max(near, far);
  if (!(span > 0) || hi - lo <= 0) return null;
  const d = Math.abs(fretX - refX) / span;
  return clamp01((hi - d) / (hi - lo));
}

/** The palm span: wrist to middle knuckle, in pixels. */
export const palmSpan = (h: Hand): number => dist(h.keypoints[LM.wrist], h.keypoints[LM.middle_mcp]);

/**
 * The note along the neck for ONE frame, unsmoothed: {@link neckPosition} quantised to
 * `scale` (low to high). The live node smooths the span and the reference and adds
 * hysteresis on top ({@link createNeckReader}); this is the stateless mapping.
 */
export function neckNote(fret: Hand, pluck: Hand, scale: readonly number[], near: number, far: number): number | null {
  if (scale.length === 0) return null;
  const pos = neckPosition(fret.keypoints[LM.wrist].x, pluck.keypoints[LM.wrist].x, palmSpan(fret), near, far);
  return pos === null ? null : scale[Math.round(pos * (scale.length - 1))];
}

/** The live neck: the span and the reference point smoothed, the note held with hysteresis. */
export interface NeckReader {
  /** Update from one frame with both hands in view; returns the scale INDEX, or null. */
  read(fret: Hand, pluck: Hand, steps: number, near: number, far: number): number | null;
  reset(): void;
}

export function createNeckReader({ smoothing, hysteresis }: { smoothing: number; hysteresis: number }): NeckReader {
  let span = NaN;
  let refX = NaN;
  let index: number | null = null;
  // Frames read since the reset: the smoothed span and reference are still settling
  // for about 1/smoothing frames, and hysteresis would lock in an unsettled first
  // reading, so it only applies once they have settled.
  let seen = 0;
  const settle = Math.ceil(1 / smoothing);
  const ema = (prev: number, next: number) => (Number.isFinite(prev) ? prev + smoothing * (next - prev) : next);
  return {
    read(fret, pluck, steps, near, far) {
      span = ema(span, palmSpan(fret));
      refX = ema(refX, pluck.keypoints[LM.wrist].x);
      seen += 1;
      if (steps <= 0) return (index = null);
      const pos = neckPosition(fret.keypoints[LM.wrist].x, refX, span, near, far);
      if (pos === null) return (index = null);
      const at = pos * (steps - 1);
      if (index === null || index >= steps || seen <= settle || Math.abs(at - index) > 0.5 + hysteresis) index = Math.round(at);
      return index;
    },
    reset() {
      span = NaN;
      refX = NaN;
      index = null;
      seen = 0;
    },
  };
}

export const airBassNode = defineNode<Params>({
  type: 'air-bass',
  roles: ['feature', 'mapping'],
  title: 'Air bass',
  description:
    'Play a bass in the air: the fretting hand\'s distance along an imaginary neck picks the note (quantised to the scale), and a pluck of the other hand sounds it, predicted before the frame that shows it (src/ictus/impact.ts). Off by default.',
  inputs: [
    { name: 'hands', kind: 'hands-frame' },
    { name: 'config', kind: 'air-bass-config' },
    // The notes the neck spans, low to high (the instrument's scale).
    { name: 'scale', kind: 'number[]' },
    // The global octave shift (the arrow keys / palette), in octaves.
    { name: 'octaveShift', kind: 'number' },
  ],
  outputs: [
    { name: 'notes', kind: 'note-events', schema: NoteEventsSchema },
    { name: 'status', kind: 'air-bass-status' },
    { name: 'enabled', kind: 'boolean' },
  ],
  params: Params,
  make(p) {
    let cfg: Params = p;
    let lastConfigRef: unknown = undefined;
    let predictor: ImpactPredictor | null = null;
    let predictorKey = '';
    let lastT = -Infinity;
    let lastFrame: HandsFrame | undefined;
    let fretMidi: number | null = null;
    let neck: NeckReader | null = null;
    let neckKey = '';
    let status: AirBassStatus = { ...IDLE_AIR_BASS_STATUS };

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

    /** The config fields that shape the stroke detector: a change rebuilds it (a switched
     *  hand or point must not read as a pluck, and the floor belongs to the old point). */
    const strokeKey = (c: Params) => `${c.pluckHand}|${c.pluckPoint}|${c.mirrorHandedness}|${c.minStroke}|${c.minSpeed}`;

    const reset = () => {
      predictor = null;
      predictorKey = '';
      lastT = -Infinity;
      lastFrame = undefined;
      fretMidi = null;
      neck = null;
      neckKey = '';
      status = { ...IDLE_AIR_BASS_STATUS };
    };

    return {
      process(inputs, ctx: NodeContext) {
        const c = resolveConfig(inputs.config);
        if (!c.enabled) {
          if (predictor) reset();
          return { notes: [], status, enabled: false };
        }
        if (!predictor || predictorKey !== strokeKey(c)) {
          predictor = createImpactPredictor({ minLead: c.minLead, minAmplitude: c.minStroke, minApproachSpeed: c.minSpeed });
          predictorKey = strokeKey(c);
          lastT = -Infinity;
          status = { ...IDLE_AIR_BASS_STATUS, enabled: true };
        }
        if (!neck || neckKey !== `${c.smoothing}|${c.hysteresis}`) {
          neck = createNeckReader(c);
          neckKey = `${c.smoothing}|${c.hysteresis}`;
        }
        const shift = typeof inputs.octaveShift === 'number' && Number.isFinite(inputs.octaveShift) ? Math.round(inputs.octaveShift) : 0;
        const scale = (Array.isArray(inputs.scale) ? (inputs.scale as number[]) : []).map((m) => m + 12 * shift);
        const notes: NoteEvent[] = [];
        const frame = inputs.hands as HandsFrame | undefined;
        const sameStamp = !!frame && !!lastFrame && frame.t !== undefined && frame.t === lastFrame.t;
        const fresh = frame !== lastFrame && !sameStamp;
        lastFrame = frame;
        if (frame && fresh && frame.height > 0) {
          const t = frameTime(frame, ctx);
          const fretHand: PlayerHand = c.pluckHand === 'right' ? 'left' : 'right';
          const pluck = frame.hands.find((h) => h.handedness === labelFor(c.pluckHand, c.mirrorHandedness));
          const fret = frame.hands.find((h) => h.handedness === labelFor(fretHand, c.mirrorHandedness));
          // The note follows the fretting hand while both are in view, and holds its last
          // value when the fretting hand drops out (a pluck still sounds the last note).
          if (pluck && fret) {
            const i = neck.read(fret, pluck, scale.length, c.neckNear, c.neckFar);
            // A degenerate neck (the two ends at the same place) plays nothing, and says so.
            fretMidi = i === null ? null : scale[i];
          }
          status = { ...status, fretting: !!(pluck && fret), fretMidi };
          if (pluck && t >= lastT + MIN_SAMPLE_SPACING) {
            lastT = t;
            // The frame's age is added to the lead, as the air drum does, so the lead is real.
            predictor.setMinLead(c.minLead + Math.max(0, ctx.time - t));
            const kp = pluck.keypoints[c.pluckPoint === 'wrist' ? LM.wrist : LM.index_tip];
            for (const e of predictor.push({ t, x: kp.x / frame.height, y: kp.y / frame.height })) {
              if (fretMidi === null) continue; // no neck yet: nothing to sound
              if (e.kind === 'predict') {
                const lead = e.t - ctx.time;
                notes.push({ t: Math.max(e.t, ctx.time), midi: fretMidi, velocity: clamp01(e.strength) * c.volume, predicted: lead >= 0, lead });
              } else if (e.predicted === null) {
                notes.push({ t: ctx.time, midi: fretMidi, velocity: clamp01(e.strength) * c.volume * LATE_VELOCITY, predicted: false, lead: e.t - ctx.time });
              }
            }
            if (!status.ready && Number.isFinite(predictor.level())) status = { ...status, ready: true };
          }
        }
        if (notes.length) {
          const last = notes[notes.length - 1];
          status = {
            ...status,
            notes: status.notes + notes.length,
            predicted: status.predicted + notes.filter((n) => n.predicted).length,
            lastMidi: last.midi,
            lastLead: last.lead,
          };
        }
        return { notes, status, enabled: true };
      },
      dispose() {
        reset();
      },
    };
  },
});
