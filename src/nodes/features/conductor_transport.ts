/**
 * The conductor's body transport and start state (split from `conductor.ts`, #557): the
 * ictus `Transport` state machine and the arm-motion meter that feeds it (#377), the facts a
 * start leaves behind (the downbeat, the tempo of a release, a cut-off's resting beat, the
 * last accepted stroke, the tempo the beat last advanced at) and the placement of a start
 * on the stroke grid. The node keeps the beat; `place` returns where the start puts it.
 */
import { createTransport, type Anchor, type Ictus, type IctusState, type Transport, type TransportPhase, type TransportPose } from '@thoremin/ictus';
import type { BodyFrame } from '@thoremin/sdk/nodes/domain';
import { createBodyMotionMeter, type BodyMotionMeter, type BodySide } from './conductor_body';

/** What the node's `transport` output reads: the transport's phase, `stopped` on a cut-off's
 *  frame, or `off` (reading the hands, or the rules off). */
export type ConductorTransportReading = TransportPhase | 'stopped' | 'off';

/** The body's start (#377): the tempo before the second stroke when the score marks none
 *  (the priors' initial tempo), and how far short of a whole beat the start waits. */
export const START_BPM = 100;
export const START_EPS = 1e-3;

/** The body points the transport rules read (#377): those an ARM beats. A player who
 *  bounces (the trunk, the hips, the head) may hang the arms still, which is the cut-off
 *  pose, so those points keep the hand's transport (the first stroke starts). */
const TRANSPORT_POINTS: ReadonlySet<string> = new Set(['impact', 'wrist']);

/** The transport phases in which the score sounds (#377). */
const TRANSPORT_SOUNDING: ReadonlySet<TransportPhase> = new Set(['running', 'holding']);

export type TransportConfig = NonNullable<Parameters<typeof createTransport>[0]>;

/** The beat a stroke lands on at or near `b`, given a rounding. */
export type Grid = (b: number, snap: (x: number) => number) => number;

/** What feeding the follower one tick said of the start: a cut-off, a start, a release. */
export interface StartFlags {
  stopped: boolean;
  started: boolean;
  released: boolean;
}

/** The fermata hold fields a start may release. */
export interface FermataMark {
  at: number | null;
  released: number | null;
}

function readTransportPose(raw: unknown): TransportPose | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const pose: TransportPose = {};
  for (const k of ['ready', 'hold', 'cutoff'] as const) if (typeof r[k] === 'boolean') pose[k] = r[k];
  return Object.keys(pose).length ? pose : undefined;
}

export interface BodyTransport {
  /** The transport reading for the `transport` output. */
  reading: ConductorTransportReading;
  /** The transport says the next stroke is overdue with the body still. */
  waiting: boolean;
  /** The beat the body's transport started on (its downbeat), until the prior has a period:
   *  meanwhile the beat moves at the marked tempo and waits just short of the next stroke's
   *  beat for the second stroke. */
  startBeat: number | null;
  /** The tempo of that interval when it is a release (the tempo before the hold); null at a
   *  start (the marked tempo then). */
  startBpm: number | null;
  /** A cut-off left the beat where it stopped (not at the top): the next start moves on. */
  afterStop: boolean;
  /** The beat at the last stroke the transport accepted. */
  strokeBeat: number | null;
  /** The tempo the beat last advanced at: the hold runs up to its stop at it, and the
   *  release moves at it until the next stroke. */
  holdBpm: number;
  /** Whether the transport rules are in force (the body is read with them on). */
  active(): boolean;
  phase(): TransportPhase | undefined;
  /** True when the rules are in force and the score must be silent: before the start, after
   *  a cut-off, or with no stroke accepted yet. */
  silences(anchors: number): boolean;
  /** Make, reconfigure or drop the transport for this tick. A live change (from the hands to
   *  the body, or the rules turned on) while the music runs keeps it running (the next stroke
   *  is taken as the next one); otherwise it starts idle and waits for the ready pose. */
  prepare(on: boolean, cfg: TransportConfig, t: number, running: () => boolean): void;
  /** The arm cues (height, motion in noise units) for a body frame; none without the meter. */
  cues(body: BodyFrame, t: number, hand: BodySide): object;
  /** One body-frame step: whether the anchor reaches the prior, and the start / cut-off /
   *  release it called. A release restarts the prior; the caller resets the fermata count. */
  step(inputs: Record<string, unknown>, ic: Ictus, t: number, anchor: Anchor | null, cues: object): StartFlags & { accept: boolean };
  /** The conductor leaves the body: the transport is dropped, the meter kept. */
  drop(): void;
  /** The conductor is off. */
  idle(): void;
  /** Where a start puts the beat (the downbeat, a cut-off's restart, a hold's release), and
   *  the bookkeeping of the start and the last stroke. Returns the new beat. */
  place(fed: StartFlags, s: IctusState, grid: Grid, beat: number, fermata: FermataMark): number;
}

export function rulesOn(source: string, rules: boolean, bodyPoint: string): boolean {
  return source === 'body' && rules && TRANSPORT_POINTS.has(bodyPoint);
}

export function createBodyTransport(): BodyTransport {
  let transport: Transport | null = null;
  let transportCfg: unknown = null;
  /** Measures the arms' height and motion from the pose stream; lives as long as the stream
   *  (a rebuild of the follower does not reset it: its jitter estimate is the camera's). */
  let meter: BodyMotionMeter | null = null;
  const tp: BodyTransport = {
    reading: 'off',
    waiting: false,
    startBeat: null,
    startBpm: null,
    afterStop: false,
    strokeBeat: null,
    holdBpm: 0,
    active: () => transport !== null,
    phase: () => transport?.phase(),
    silences: (anchors) => transport !== null && (!TRANSPORT_SOUNDING.has(transport.phase()) || anchors === 0),
    prepare(on, cfg, t, running) {
      if (!on) {
        transport = null;
        tp.reading = 'off';
        return;
      }
      if (!transport) {
        transport = createTransport(cfg);
        transportCfg = cfg;
        tp.reading = 'idle';
        // The music is running (on the hands, or on the body with the rules off): the
        // prior is following strokes now, not holding after the last one.
        if (running()) {
          transport.run(t);
          tp.reading = 'running';
        }
      } else if (cfg !== transportCfg) {
        transport.configure(cfg);
        transportCfg = cfg;
      }
      meter ??= createBodyMotionMeter();
    },
    cues: (body, t, hand) => (meter ? meter.push(body, t, hand) : {}),
    step(inputs, ic, t, a, cues) {
      const tr0 = transport!;
      const wasHolding = tr0.phase() === 'holding';
      const now = ic.state();
      const tr = tr0.step({
        t,
        ...cues,
        anchor: a?.t,
        period: (now.state === 'running' || now.state === 'hold') && Number.isFinite(now.period) ? now.period : Infinity,
        pose: readTransportPose(inputs.transportPose),
      });
      tp.reading = tr.stopped ? 'stopped' : tr.phase;
      tp.waiting = tr.waiting;
      let released = false;
      // The stroke that releases the body's hold restarts the prior, like a start:
      // the release and the stroke after it set the tempo again (a conductor's
      // tempo after a fermata is a new one), and the beat moves at the old tempo
      // in between. Feeding it to a prior whose confidence decayed through the hold
      // would hand the beat to the speed fallback for a few strokes.
      if (wasHolding && tr.accept) {
        ic.prior.reset();
        released = true;
      }
      return { accept: tr.accept, stopped: tr.stopped, started: tr.started, released };
    },
    drop() {
      transport = null;
      tp.reading = 'off';
    },
    idle() {
      transport = null;
      meter = null;
      tp.reading = 'off';
      tp.afterStop = false;
      tp.startBeat = null;
    },
    place({ started, released, stopped }, s, grid, beat, fermata) {
      let b = beat;
      if (started && tp.afterStop) {
        // After a cut-off the note at the stop has sounded (a fermata's too): the restart
        // plays the next stroke's beat strictly after it.
        const from = b;
        b = grid(b + START_EPS / 2, Math.ceil);
        if (fermata.at !== null && fermata.at <= from) {
          fermata.released = fermata.at;
          fermata.at = null;
        }
        tp.afterStop = false;
      } else if (started) b = grid(b - START_EPS, Math.ceil);
      else if (released) {
        // A body hold waits just short of a stroke's beat: the release plays it. A fermata
        // is not on the stroke grid at every level (beat 3 marking half bars): the beat
        // goes on from it rather than jumping to the next stroke's beat.
        const g = grid(b - 2 * START_EPS, Math.ceil);
        if (g - b <= 2 * START_EPS) b = Math.max(b, g);
      }
      if (started || released) {
        tp.startBeat = b;
        tp.startBpm = released && tp.holdBpm > 0 ? tp.holdBpm : null;
      }
      if (tp.startBeat !== null && (!transport || s.state !== 'ready' || s.anchors === 0)) tp.startBeat = null;
      if (!transport || stopped) {
        tp.strokeBeat = null;
        tp.waiting = false;
      } else if (s.anchor) tp.strokeBeat = grid(b, Math.round);
      return b;
    },
  };
  return tp;
}
