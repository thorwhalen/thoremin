/**
 * `air-drum` node (#233) — strike the air, hear a drum AT the strike.
 *
 * The consumer of the sub-frame impact predictor (`src/ictus/impact.ts`,
 * `docs/research/subframe-impact-prediction.md`): the first instrument that sounds
 * an onset *before* the frame that shows it. Each of the player's hands is a stick:
 * the tracked point (the wrist, or the index fingertip) is fed to its own predictor
 * as a normalised (frame-height) trajectory, and each stroke yields one hit —
 * committed while the hand is still tens of milliseconds above the (learned) floor,
 * with the hand's dynamic read off the stroke's amplitude relative to the player's
 * recent strokes (Dahl: the preparatory height predicts the accent). A stroke too
 * fast or too early to predict is sounded on confirmation, one frame late, as a
 * ghost note. There is no surface to calibrate: the floor is the player's own
 * turning depth, learned from the first stroke on.
 *
 * What comes out is a list of {@link DrumHit}s on the `hits` port — each with the
 * time it should SOUND, in engine seconds, possibly in the future — which the
 * `drum-out` node schedules on the audio clock (the two-clock discipline: this node
 * never touches audio). The `time` input is the conductor's `MusicalTime`; with a
 * running follower and a non-zero `magnetism` a predicted hit is pulled toward the
 * nearest expected beat (`src/ictus/magnet.ts`): the actuality ↔ intent dial of the
 * research map, in the player's hands.
 *
 * The dial. {@link AirDrumDialSchema} IS this node's params (the conductor pattern):
 * the `airDrum` dial re-exports it, the `config` input overrides the build-time
 * params live per tick, so the panel, the palette, a keybinding and the assistant can
 * start drumming or change a sound with no graph rebuild. Only a NEW camera frame is
 * an observation (#225), sampled at its capture stamp in real time (#226).
 *
 * Pure and Node-safe: no DOM, no clock (`ctx.time`), so the synthetic impact fixtures
 * (`test/fixtures/subframe_*`) drive it headlessly.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';
import { createImpactPredictor, magnetise, type ImpactPredictor, type MusicalTime } from '@/ictus';
import { LM, frameTime, type Hand, type HandsFrame } from '../domain';

export const DRUM_SOUNDS = ['kick', 'snare', 'hihat', 'tom'] as const;
export type DrumSound = (typeof DRUM_SOUNDS)[number];
export const AIR_DRUM_HANDS = ['both', 'right', 'left'] as const;
export type AirDrumHand = (typeof AIR_DRUM_HANDS)[number];
export const AIR_DRUM_POINTS = ['wrist', 'indexTip'] as const;
export type AirDrumPoint = (typeof AIR_DRUM_POINTS)[number];
export type PlayerHand = 'right' | 'left';

const Params = z.object({
  /** Off by default: a player who never opens the Air drum panel hears nothing new. */
  enabled: z.boolean().default(false),
  /** Which of the player's hands drum. */
  hand: z.enum(AIR_DRUM_HANDS).default('both'),
  /** The tracked point: the wrist (steady) or the index fingertip (a stick tip). */
  point: z.enum(AIR_DRUM_POINTS).default('wrist'),
  /** The drum each hand plays. */
  rightSound: z.enum(DRUM_SOUNDS).default('kick'),
  leftSound: z.enum(DRUM_SOUNDS).default('snare'),
  /** How far ahead of the strike a hit should be committed, seconds, counted from the
   *  moment this node decides (the frame's age — capture to inference to tick — is
   *  added on top, so the lead is real): the audio output latency plus a margin. A
   *  TARGET: a camera pipeline slower than the stroke's fall can defeat it, in which
   *  case the hit sounds as soon as it can and is reported as late, not predicted. */
  minLead: z.number().min(0).max(0.2).default(0.05),
  /** Timing magnetism, 0..1: how far a predicted hit is pulled toward the conductor's
   *  expected beat (nothing when the conductor is off). */
  magnetism: z.number().min(0).max(1).default(0),
  /** The mirrored webcam reports the opposite hand label (the same knob the conductor
   *  carries). Off for a recorded third-person video. */
  mirrorHandedness: z.boolean().default(true),
  /** Hit loudness, 0..1 (a stroke's own dynamic scales it). */
  volume: z.number().min(0).max(1).default(0.8),
  /** The smallest stroke that counts, as a fraction of the frame height: a still hand's
   *  jitter and the small bounce of hands coming into frame do not drum. */
  minStroke: z.number().min(0.005).max(0.2).default(0.03),
  /** The slowest approach that is a stroke, in frame heights per second: a slow
   *  drift down and up (a melodic hand sweeping) spans a stroke's depth but never at a
   *  stroke's speed (a real stroke peaks well above 1). */
  minSpeed: z.number().min(0).max(5).default(0.5),
});
type Params = z.infer<typeof Params>;

/** The node's params, re-exported as the SSOT for the `airDrum` dial. */
export const AirDrumDialSchema = Params;
export type AirDrumDialParams = Params;
export const DEFAULT_AIR_DRUM_DIAL: AirDrumDialParams = AirDrumDialSchema.parse({});

/** One hit to sound. */
export interface DrumHit {
  /** When it should SOUND, engine seconds (in the future for a predicted hit; the
   *  confirming sample's time for a ghost note). */
  t: number;
  /** 0..1, the stroke's dynamic times the volume dial. */
  velocity: number;
  hand: PlayerHand;
  sound: DrumSound;
  /** Predicted ahead of the impact (true) or sounded late on confirmation (false). */
  predicted: boolean;
  /** `t` minus the engine time at which it was decided, seconds: the lead a scheduler
   *  really gets (negative = a late ghost note: how far behind the strike it sounds). */
  lead: number;
  /** The magnet's pull, seconds (0 without a running conductor or with magnetism 0). */
  pull: number;
}

export const DrumHitSchema = z.object({
  t: z.number(),
  velocity: z.number(),
  hand: z.enum(['right', 'left']),
  sound: z.enum(DRUM_SOUNDS),
  predicted: z.boolean(),
  lead: z.number(),
  pull: z.number(),
});
export const DrumHitsSchema = z.array(DrumHitSchema);

/** What the panel shows: the last hit and the running counts. */
export interface AirDrumStatus {
  enabled: boolean;
  /** Hits sounded since enabling. */
  hits: number;
  /** Of them, predicted ahead of the impact. */
  predicted: number;
  lastHand: PlayerHand | null;
  /** The last hit's lead in seconds (negative = a late ghost note). */
  lastLead: number;
  lastPull: number;
  /** Whether each hand's floor has been learned (a first stroke has been seen). */
  ready: { right: boolean; left: boolean };
}

export const IDLE_STATUS: AirDrumStatus = { enabled: false, hits: 0, predicted: 0, lastHand: null, lastLead: 0, lastPull: 0, ready: { right: false, left: false } };

/** Ghost-note velocity for a stroke sounded on confirmation instead of prediction. */
const GHOST_VELOCITY = 0.6;
/** Two samples closer than this are not two camera frames (the conductor's rule). */
const MIN_SAMPLE_SPACING = 0.004;

/** MediaPipe's label for the player's hand, given the mirror convention. */
function labelFor(hand: PlayerHand, mirrorHandedness: boolean): Hand['handedness'] {
  const raw = hand === 'right' ? 'Right' : 'Left';
  if (!mirrorHandedness) return raw;
  return raw === 'Right' ? 'Left' : 'Right';
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

interface Stick {
  predictor: ImpactPredictor;
  lastT: number;
}

export const airDrumNode = defineNode<Params>({
  type: 'air-drum',
  roles: ['feature', 'mapping'],
  title: 'Air drum',
  description:
    'Strike the air with a hand and hear a drum at the strike: each hand is a stick whose hit is predicted before the frame that shows it (src/ictus/impact.ts). Off by default.',
  inputs: [
    { name: 'hands', kind: 'hands-frame' },
    { name: 'config', kind: 'air-drum-config' },
    // The conductor's musical time, for the timing magnet. Optional.
    { name: 'time', kind: 'musical-time' },
  ],
  outputs: [
    { name: 'hits', kind: 'drum-hits', schema: DrumHitsSchema },
    { name: 'status', kind: 'air-drum-status' },
    { name: 'enabled', kind: 'boolean' },
  ],
  params: Params,
  make(p) {
    let cfg: Params = p;
    let lastConfigRef: unknown = undefined;
    let sticks: Record<PlayerHand, Stick> | null = null;
    let lastFrame: HandsFrame | undefined;
    let status: AirDrumStatus = { ...IDLE_STATUS, ready: { right: false, left: false } };

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

    const makeStick = (c: Params): Stick => ({
      predictor: createImpactPredictor({ minLead: c.minLead, minAmplitude: c.minStroke, minApproachSpeed: c.minSpeed }),
      lastT: -Infinity,
    });
    /** The config fields that shape a stick: a change rebuilds both sticks (a switched
     *  tracked point or hand must not read as a stroke, and the floor belongs to the
     *  old point), so every dial leaf takes effect live. */
    const stickKey = (c: Params) => `${c.point}|${c.hand}|${c.mirrorHandedness}|${c.minStroke}|${c.minSpeed}`;
    let sticksKey = '';

    const reset = () => {
      sticks = null;
      lastFrame = undefined;
      status = { ...IDLE_STATUS, ready: { right: false, left: false } };
    };

    return {
      process(inputs, ctx: NodeContext) {
        const c = resolveConfig(inputs.config);
        if (!c.enabled) {
          if (sticks) reset();
          return { hits: [], status, enabled: false };
        }
        if (!sticks || sticksKey !== stickKey(c)) {
          sticks = { right: makeStick(c), left: makeStick(c) };
          sticksKey = stickKey(c);
          status = { ...IDLE_STATUS, enabled: true, ready: { right: false, left: false } };
        }
        const hits: DrumHit[] = [];
        const frame = inputs.hands as HandsFrame | undefined;
        const sameStamp = !!frame && !!lastFrame && frame.t !== undefined && frame.t === lastFrame.t;
        const fresh = frame !== lastFrame && !sameStamp;
        lastFrame = frame;
        const time = inputs.time as MusicalTime | undefined;
        if (frame && fresh && frame.height > 0) {
          const t = frameTime(frame, ctx);
          // The frame's age: the sample was captured `age` seconds before this decision
          // (the camera, inference and the tick), so the lead the predictor must leave
          // from the sample's time is the dial's lead plus that age.
          const age = Math.max(0, ctx.time - t);
          const hands: PlayerHand[] = c.hand === 'both' ? ['right', 'left'] : [c.hand];
          for (const which of hands) {
            const stick = sticks[which];
            const hand = frame.hands.find((h) => h.handedness === labelFor(which, c.mirrorHandedness));
            if (!hand || t < stick.lastT + MIN_SAMPLE_SPACING) continue;
            stick.lastT = t;
            stick.predictor.setMinLead(c.minLead + age);
            const kp = hand.keypoints[c.point === 'wrist' ? LM.wrist : LM.index_tip];
            const sound = which === 'right' ? c.rightSound : c.leftSound;
            for (const e of stick.predictor.push({ t, x: kp.x / frame.height, y: kp.y / frame.height })) {
              if (e.kind === 'predict') {
                let at = e.t;
                let pull = 0;
                if (time && c.magnetism > 0) {
                  const m = magnetise(e.t, time, c.magnetism);
                  // Never behind the decision: a pull toward a beat already past is
                  // truncated to "now", and reported as what it really moved.
                  at = Math.max(ctx.time, m.t);
                  pull = at - e.t;
                }
                // The lead a scheduler really gets: from NOW, not from the sample. A camera
                // pipeline older than the stroke's fall leaves none: that hit is honest
                // about being late (it is not "predicted"), and sounds as soon as it can.
                const lead = at - ctx.time;
                hits.push({ t: Math.max(at, ctx.time), velocity: clamp01(e.strength) * c.volume, hand: which, sound, predicted: lead >= 0, lead, pull });
              } else if (e.predicted === null) {
                // Unpredicted: a ghost note, now; its lead is how late that is.
                hits.push({ t: ctx.time, velocity: clamp01(e.strength) * c.volume * GHOST_VELOCITY, hand: which, sound, predicted: false, lead: e.t - ctx.time, pull: 0 });
              }
            }
            if (!status.ready[which] && Number.isFinite(stick.predictor.level())) status = { ...status, ready: { ...status.ready, [which]: true } };
          }
        }
        if (hits.length) {
          const last = hits[hits.length - 1];
          status = {
            ...status,
            hits: status.hits + hits.length,
            predicted: status.predicted + hits.filter((h) => h.predicted).length,
            lastHand: last.hand,
            lastLead: last.lead,
            lastPull: last.pull,
          };
        }
        return { hits, status, enabled: true };
      },
      dispose() {
        reset();
      },
    };
  },
});
