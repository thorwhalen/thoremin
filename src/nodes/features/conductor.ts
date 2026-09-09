/**
 * `conductor` node — the conductor's beating hand becomes musical time (#187).
 *
 * Wraps `src/ictus` (the pure core: ictus detector → adaptive oscillator →
 * `MusicalTime`) as a DAG node over the hands frame the rest of the graph already
 * reads, and emits what the score player needs: a continuous `beat`, the `bpm` it is
 * advancing at, and a `velocityScale` from the size of the strokes — the two ports
 * `score` consumes — plus the whole `MusicalTime` on `time` for the overlay, the
 * scheduler (PR 4) and the pacer (#186).
 *
 * Why the beat is integrated HERE and not by `transport`. The research map (§6.3, §7.2)
 * settled two things: the score must read ONE beat from ONE node (the engine rejects
 * fan-in), and a follower needs a beat-agnostic fallback because non-experts' beats
 * are often not synchronous with anything (You're the Conductor's finding). So this
 * node owns a running `beatOut` and advances it every tick at a tempo blended, by the
 * oscillator's confidence, between the inferred tempo and a speed-based fallback (hand
 * speed relative to the player's own recent speed → bpm, what `performance` computes
 * from height), and — while confident — converges its phase onto the inferred beat
 * through a servo with an explicit horizon (`servoBeats`, Personal Orchestra's Δt): the
 * score does not jump to the ictus, it catches up over about a beat, which is what
 * filters a novice's jitter without making the orchestra feel deaf. In `hold` (the
 * conductor stopped, a fermata, a lost hand) the beat freezes: `bpm` reads 0 and the
 * score sustains whatever is sounding.
 *
 * The dial. {@link ConductorDialSchema} IS this node's params (the `faceControls`
 * pattern): the `conductor` dial re-exports it, the `config` input overrides the
 * build-time params live per tick, and `commands/paths.ts` derives a `dial.setIn`
 * leaf for every field here, so the panel, the palette, a keybinding and the AI
 * assistant can all turn the conductor on or retune it with no graph rebuild. Two
 * fields are build-time only because they shape the oscillator itself
 * (`phaseGain`, `periodGain`); a live change to them takes effect at the next
 * enable (the node re-creates its core when it is switched off and on).
 *
 * Pure and Node-safe: no DOM, no clock (it reads `ctx.time` / `ctx.dt`), and the
 * recorded conducting fixtures drive it headlessly.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';
import { beatAt, createIctus, wrapPhase, type Ictus, type IctusState, type MusicalTime } from '@/ictus';
import { LM, type Hand, type HandsFrame } from '../domain';

export const CONDUCTOR_HANDS = ['auto', 'right', 'left'] as const;
export type ConductorHand = (typeof CONDUCTOR_HANDS)[number];
export const CONDUCTOR_POINTS = ['wrist', 'indexTip'] as const;
export type ConductorPoint = (typeof CONDUCTOR_POINTS)[number];

const Params = z.object({
  /** Off by default: conducting replaces the score's fixed tempo, and a player who
   *  never opens the Conductor panel should never have the score play. */
  enabled: z.boolean().default(false),
  /** Which of the player's hands beats time. `auto` takes whichever is in frame,
   *  preferring the right. */
  hand: z.enum(CONDUCTOR_HANDS).default('auto'),
  /** The tracked point: the wrist (steady) or the index fingertip (livelier, like a
   *  baton tip). */
  point: z.enum(CONDUCTOR_POINTS).default('wrist'),
  /** Selfie mirror: the webcam view is mirrored, so lateral direction is flipped to the
   *  player's frame. Off for a recorded third-person video. */
  mirrorX: z.boolean().default(true),
  /** The mirrored webcam reports the opposite hand label (the same knob `hand-features`
   *  carries). Off for a recorded third-person video. */
  mirrorHandedness: z.boolean().default(true),
  /** Beats per bar, for `beatInBar` (the meter recogniser is a later PR). */
  beatsPerBar: z.number().int().min(1).max(12).default(4),
  /** The phase servo's convergence horizon in beats: how long the score takes to catch
   *  up with an ictus that arrived early or late. Small = tight (for a conductor),
   *  large = forgiving (for a novice; filters jitter). */
  servoBeats: z.number().min(0.25).max(4).default(1),
  /** Below this oscillator confidence the tempo blends toward the speed-based
   *  fallback (0 = never fall back, 1 = always). */
  fallbackBelowConfidence: z.number().min(0).max(1).default(0.3),
  /** The speed-based fallback's tempo range (hand nearly still → min, at the player's
   *  own peak speed → max). */
  fallbackBpmMin: z.number().min(20).max(300).default(50),
  fallbackBpmMax: z.number().min(20).max(300).default(160),
  /** Stroke size → `velocityScale` range: the smallest strokes play at `dynMin`, the
   *  biggest at `dynMax`. */
  dynMin: z.number().min(0).max(1).default(0.35),
  dynMax: z.number().min(0).max(1).default(1),
  /** Oscillator gains (build-time; see the header). */
  phaseGain: z.number().min(0).max(1).default(0.5),
  periodGain: z.number().min(0).max(1).default(0.4),
});
type Params = z.infer<typeof Params>;

/** The node's params, re-exported as the SSOT for the `conductor` dial. */
export const ConductorDialSchema = Params;
export type ConductorDialParams = Params;
/** The shipped defaults, as a plain value — the dial/store/schema default. */
export const DEFAULT_CONDUCTOR_DIAL: ConductorDialParams = ConductorDialSchema.parse({});

/** Runtime shape of the `time` port (`PortSpec.schema`): a follower that emits nothing
 *  would otherwise be a silent score rather than an error. Mirrors `MusicalTime`. */
/** A number that may be `Infinity` (`z.number()` is finite-only): the period while
 *  idle and the next-beat time while holding are genuinely infinite. */
const numberOrInfinity = z.custom<number>((v) => typeof v === 'number' && !Number.isNaN(v), 'expected a number or Infinity');

export const MusicalTimeSchema = z.object({
  t: z.number(),
  beat: z.number(),
  phase: z.number(),
  tempo: z.number(),
  period: numberOrInfinity,
  confidence: z.number(),
  nextBeatAt: numberOrInfinity,
  beatsPerBar: z.number(),
  beatInBar: z.number(),
  state: z.enum(['ready', 'running', 'hold']),
  anchors: z.number(),
});

/** The live `config` port: a partial override of the params (the dial's value). */
const ConfigOverride = Params.partial();

/** MediaPipe's label for the player's hand, given the mirror convention. */
function labelFor(hand: Exclude<ConductorHand, 'auto'>, mirrorHandedness: boolean): Hand['handedness'] {
  const raw = hand === 'right' ? 'Right' : 'Left';
  if (!mirrorHandedness) return raw;
  return raw === 'Right' ? 'Left' : 'Right';
}

function pickHand(frame: HandsFrame, cfg: Params): Hand | undefined {
  if (!frame.hands.length) return undefined;
  if (cfg.hand === 'auto') {
    const preferred = labelFor('right', cfg.mirrorHandedness);
    return frame.hands.find((h) => h.handedness === preferred) ?? frame.hands[0];
  }
  const label = labelFor(cfg.hand, cfg.mirrorHandedness);
  return frame.hands.find((h) => h.handedness === label);
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const conductorNode = defineNode<Params>({
  type: 'conductor',
  roles: ['feature', 'mapping'],
  title: 'Conductor',
  description:
    'The beating hand becomes musical time: ictus detection + an adaptive oscillator (src/ictus) → beat, bpm, dynamics for the score. Off by default.',
  inputs: [
    { name: 'hands', kind: 'hands-frame' },
    { name: 'config', kind: 'conductor-config' },
  ],
  outputs: [
    { name: 'time', kind: 'musical-time', schema: MusicalTimeSchema },
    { name: 'beat', kind: 'number', schema: z.number() },
    { name: 'bpm', kind: 'number', schema: z.number() },
    { name: 'velocityScale', kind: 'number', schema: z.number() },
    { name: 'phase', kind: 'number' },
    { name: 'dynamics', kind: 'number' },
    { name: 'articulation', kind: 'number' },
    { name: 'confidence', kind: 'number' },
    { name: 'enabled', kind: 'boolean' },
  ],
  params: Params,
  make(p) {
    let ictus: Ictus | null = null;
    let lastConfigRef: unknown = undefined;
    let cfg: Params = p;
    /** The beat the score reads: integrated here, phase-servoed onto the ictus. */
    let beatOut = 0;
    let wasEnabled = false;
    // Speed-based fallback: EW speed of the tracked point and a decaying envelope of it.
    let lastPt: { t: number; x: number; y: number } | null = null;
    let speedEw = 0;
    let speedEnv = 0;

    const resolveConfig = (raw: unknown): Params => {
      if (raw === lastConfigRef) return cfg;
      lastConfigRef = raw;
      if (raw && typeof raw === 'object') {
        const parsed = ConfigOverride.safeParse(raw);
        if (parsed.success) {
          const overrides = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
          cfg = { ...p, ...overrides } as Params;
          return cfg;
        }
      }
      cfg = p;
      return cfg;
    };

    const idleTime = (t: number, beatsPerBar: number): MusicalTime => ({
      t,
      beat: beatOut,
      phase: 0,
      tempo: 0,
      period: Infinity,
      confidence: 0,
      nextBeatAt: Infinity,
      beatsPerBar,
      beatInBar: 0,
      state: 'ready',
      anchors: 0,
    });

    const emit = (time: MusicalTime, bpm: number, dyn: number, art: number, enabled: boolean, c: Params) => ({
      time,
      beat: beatOut,
      bpm,
      velocityScale: enabled ? c.dynMin + (c.dynMax - c.dynMin) * clamp01(dyn) : 0,
      phase: time.phase,
      dynamics: dyn,
      articulation: art,
      confidence: time.confidence,
      enabled,
    });

    return {
      process(inputs, ctx: NodeContext) {
        const c = resolveConfig(inputs.config);
        if (!c.enabled) {
          if (wasEnabled) {
            ictus = null;
            lastPt = null;
            speedEw = 0;
            speedEnv = 0;
            wasEnabled = false;
          }
          return emit(idleTime(ctx.time, c.beatsPerBar), 0, 0, 0.5, false, c);
        }
        if (!wasEnabled || !ictus) {
          ictus = createIctus({
            detector: { mirrorX: c.mirrorX },
            oscillator: { beatsPerBar: c.beatsPerBar, phaseGain: c.phaseGain, periodGain: c.periodGain },
          });
          wasEnabled = true;
        }

        // 1. Feed the tracked point (or free-run when no hand is in frame).
        const frame = inputs.hands as HandsFrame | undefined;
        const hand = frame ? pickHand(frame, c) : undefined;
        let s: IctusState;
        if (hand && frame && frame.height > 0) {
          const kp = hand.keypoints[c.point === 'wrist' ? LM.wrist : LM.index_tip];
          const pt = { t: ctx.time, x: kp.x / frame.height, y: kp.y / frame.height };
          if (lastPt && pt.t > lastPt.t) {
            const speed = Math.hypot(pt.x - lastPt.x, pt.y - lastPt.y) / (pt.t - lastPt.t);
            speedEw += 0.3 * (speed - speedEw);
            speedEnv = Math.max(speedEnv * Math.pow(0.85, pt.t - lastPt.t), speedEw);
          }
          lastPt = pt;
          s = ictus.feed(pt);
        } else {
          s = ictus.advance(ctx.time);
        }

        // 2. Blend the inferred tempo with the speed fallback by confidence; integrate.
        const fallbackBpm = c.fallbackBpmMin + (c.fallbackBpmMax - c.fallbackBpmMin) * (speedEnv > 0 ? clamp01(speedEw / speedEnv) : 0);
        let bpm: number;
        if (s.state === 'hold') {
          bpm = 0;
        } else {
          const w = s.state === 'running' && c.fallbackBelowConfidence > 0 ? clamp01(s.confidence / c.fallbackBelowConfidence) : s.state === 'running' ? 1 : 0;
          bpm = w * s.tempo + (1 - w) * fallbackBpm;
          beatOut += (bpm / 60) * ctx.dt;
          // 3. Phase servo: converge onto the inferred beat over `servoBeats`.
          if (w > 0 && Number.isFinite(s.period) && s.period > 0) {
            const err = wrapPhase(beatOut - beatAt(s, ctx.time));
            beatOut -= w * err * Math.min(1, ctx.dt / (c.servoBeats * s.period));
          }
        }

        const wholeBeat = Math.floor(beatOut);
        const time: MusicalTime = {
          t: ctx.time,
          beat: beatOut,
          phase: beatOut - wholeBeat,
          tempo: bpm,
          period: bpm > 0 ? 60 / bpm : Infinity,
          confidence: s.confidence,
          nextBeatAt: bpm > 0 ? ctx.time + ((1 - (beatOut - wholeBeat)) * 60) / bpm : Infinity,
          beatsPerBar: c.beatsPerBar,
          beatInBar: ((wholeBeat % c.beatsPerBar) + c.beatsPerBar) % c.beatsPerBar,
          state: s.state,
          anchors: s.anchors,
        };
        return emit(time, bpm, s.dynamics, s.articulation, true, c);
      },
      dispose() {
        ictus = null;
      },
    };
  },
});
