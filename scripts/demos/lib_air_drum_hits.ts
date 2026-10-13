/**
 * The shipped `air-drum` node (#233) played over one `an.impacts` clip, with a beat
 * follower on its `time` input: the engine behind `air_drum_hits.ts` (one run, the
 * demo page's JSON) and `magnet_sweep.ts` (the #239 acceptance table).
 *
 * The clip's impact keypoint stands in for the player's right hand (all 21 keypoints on
 * it, so the node tracks `point: 'wrist'`: a single point has no grip for a stick tip to
 * lever), one hands frame per camera frame, and the node is ticked by hand so three
 * things a live session has can be simulated: the pipeline delay from capture to tick
 * (`latency`), the audio output stage the node is told through its `timing` resource
 * (`outputStage`), and the follower that supplies the grid the magnet pulls toward.
 *
 * The followers, so the causes can be told apart (#239, the 2026-10-05 comment):
 * - `none`: no grid; the magnet has nothing to pull toward.
 * - `trend`: the trend prior hearing each stroke's IMPACT (`impactT`, unpulled) once it is
 *   past: rule (c), no prior is ever fed what was sounded.
 * - `trend-sounded`: the same prior hearing the drum's SOUNDED hits, the feedback loop
 *   the rule forbids; kept to show what it costs.
 * - `conductor`: the shipped conductor node over the same frames (the drumming hand as
 *   the conducting hand), what the app wires; `prior` picks its rhythm prior.
 * - `ictus`: the conductor's core alone (`createIctus`, the same prior, no phase servo
 *   and no speed fallback), to split the conductor's lag between the prior and the servo.
 * - `oracle`: the clip's true intended beats as the grid, the bound.
 *
 * Errors are measured on the time the sound reaches the ear: a hit scheduled before its
 * decision plus the output stage comes out at that bound, not at `t`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NodeContext } from '@thoremin/dag';
import { createIctus, createTrendPrior, type Anchor, type MusicalTime, type RhythmPriorKind } from '@thoremin/ictus';
import { type HandsFrame } from '@/nodes';
import { conductorNode } from '@/nodes/features/conductor';
import { airDrumNode, type AirDrumStatus, type DrumHit } from '@thoremin/ext-air/nodes/air_drum';
import { TIMING_RESOURCE_KEY } from '@thoremin/sdk/timing/tracker';

export const FOLLOWERS = ['none', 'trend', 'trend-sounded', 'conductor', 'ictus', 'oracle'] as const;
export type Follower = (typeof FOLLOWERS)[number];

export interface Truth {
  spec: { fps: number; kind: string; object: string };
  objects: { name: string; impact_keypoint: string }[];
  events: { index: number; t_impact: number; t_grid: number }[];
}

export interface Clip {
  dir: string;
  truth: Truth;
  frames: HandsFrame[];
}

export interface RunOptions {
  latency?: number;
  outputStage?: number;
  magnetism?: number;
  minLead?: number;
  follower?: Follower;
  /** The conductor's / ictus follower's rhythm prior (default: the conductor's default). */
  prior?: RhythmPriorKind;
}

export type PlayedHit = DrumHit & { at: number; ear: number };

export interface RunResult {
  hits: PlayedHit[];
  status: AirDrumStatus;
  /** Every status the node reported, one per tick (for "did the status line ever show"). */
  magnetStandings: Set<AirDrumStatus['magnet']>;
  /** Mean `impact - grid` the node measured at the end, seconds. */
  lag: number;
}

export function loadClip(dir: string): Clip {
  const truth = JSON.parse(readFileSync(join(dir, 'truth.json'), 'utf8')) as Truth;
  const obj = truth.objects[0];
  const frames: HandsFrame[] = [];
  for (const line of readFileSync(join(dir, 'keypoints.ndjson'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line) as { t: number; value: { width: number; height: number; keypoints: { object: string; name: string; x: number; y: number }[] } };
    const p = rec.value.keypoints.find((k) => k.object === obj.name && k.name === obj.impact_keypoint)!;
    const keypoints = Array.from({ length: 21 }, () => ({ x: p.x, y: p.y }));
    frames.push({
      width: rec.value.width,
      height: rec.value.height,
      // The mirrored webcam labels the player's RIGHT hand 'Left'.
      hands: [{ handedness: 'Left', keypoints }],
      t: rec.t,
      tSource: 'capture',
      tOrigin: performance.timeOrigin,
    } as HandsFrame);
  }
  return { dir, truth, frames };
}

/** The true grid as a `MusicalTime` at `now`: anchored on the intended beat nearest `now`,
 *  its period the mean of the intervals either side (the clip's tempo ramps). */
function oracleTime(grid: number[], now: number): MusicalTime {
  let k = 0;
  for (let i = 1; i < grid.length; i++) if (Math.abs(grid[i] - now) < Math.abs(grid[k] - now)) k = i;
  const before = k > 0 ? grid[k] - grid[k - 1] : grid[k + 1] - grid[k];
  const after = k < grid.length - 1 ? grid[k + 1] - grid[k] : before;
  const period = (before + after) / 2;
  return { t: grid[k], beat: k, phase: 0, tempo: 60 / period, period, confidence: 1, nextBeatAt: grid[k] + period, beatsPerBar: 4, beatInBar: k % 4, state: 'running', anchors: k + 1 };
}

export function runClip(clip: Clip, o: RunOptions = {}): RunResult {
  const latency = o.latency ?? 0;
  const outputStage = o.outputStage ?? 0;
  const followerKind = o.follower ?? 'trend';
  const fps = clip.truth.spec.fps;
  const drum = airDrumNode.make(airDrumNode.params.parse({ point: 'wrist', enabled: true, minLead: o.minLead ?? 0.05, magnetism: o.magnetism ?? 0 }));
  const resources = { timeScale: 1, [TIMING_RESOURCE_KEY]: () => ({ outputStage: { value: outputStage, source: 'measured' as const }, audioEpoch: 0, leadBudget: outputStage }) };
  const trend = createTrendPrior({ memory: 12, quadraticAfter: 5 });
  const conductor = conductorNode.make(conductorNode.params.parse({ enabled: true, ...(o.prior ? { prior: o.prior } : {}) }));
  const ictus = createIctus({ detector: { mirrorX: true }, ...(o.prior ? { prior: o.prior } : {}) });
  const grid = clip.truth.events.map((e) => e.t_grid);
  const hits: PlayedHit[] = [];
  const magnetStandings = new Set<AirDrumStatus['magnet']>();
  let status: AirDrumStatus | undefined;
  // The trend follower hears a time once it is past (never the future).
  const pending: number[] = [];
  let ictusTime: MusicalTime | undefined;
  for (let i = 0; i < clip.frames.length; i++) {
    const frame = clip.frames[i];
    const now = frame.t! + latency;
    const ctx: NodeContext = { tick: i, time: now, dt: i === 0 ? 0 : 1 / fps, resources, log: undefined as never };
    let time: MusicalTime | undefined;
    if (followerKind === 'trend' || followerKind === 'trend-sounded') {
      trend.advance(now);
      while (pending.length && pending[0] <= now) {
        const t = pending.shift()!;
        const anchor: Anchor = { t, confidence: 1, strength: 1, sharpness: NaN, lateral: 0 };
        trend.update(anchor);
      }
      time = trend.state();
    } else if (followerKind === 'conductor') {
      time = (conductor.process({ hands: frame }, ctx) ?? {}).time as MusicalTime | undefined;
    } else if (followerKind === 'ictus') {
      const p = frame.hands[0].keypoints[0];
      ictusTime = ictus.feed({ t: frame.t!, x: p.x / frame.height, y: p.y / frame.height });
      time = ictusTime;
    } else if (followerKind === 'oracle') {
      time = oracleTime(grid, now);
    }
    const outs = drum.process({ hands: frame, time }, ctx) ?? {};
    status = outs.status as AirDrumStatus;
    magnetStandings.add(status.magnet);
    for (const h of (outs.hits as DrumHit[] | undefined) ?? []) {
      hits.push({ ...h, at: now, ear: Math.max(h.t, now + outputStage) });
      if (followerKind === 'trend') pending.push(h.impactT);
      if (followerKind === 'trend-sounded') pending.push(h.t);
      pending.sort((a, b) => a - b);
    }
  }
  drum.dispose?.();
  conductor.dispose?.();
  return { hits, status: status!, magnetStandings, lag: status!.magnetLag };
}

export interface Score {
  hits: number;
  events: number;
  onTime: number;
  /** Mean |ear - true impact| (actuality) and |ear - intended beat| (intent), seconds. */
  actualityMae: number;
  intentMae: number;
  meanPull: number;
}

export function score(clip: Clip, r: RunResult): Score {
  const events = clip.truth.events;
  const nearest = (t: number) => events.reduce((b, e) => (Math.abs(e.t_impact - t) < Math.abs(b.t_impact - t) ? e : b));
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  return {
    hits: r.hits.length,
    events: events.length,
    onTime: r.hits.filter((h) => h.predicted).length,
    actualityMae: mean(r.hits.map((h) => Math.abs(h.ear - nearest(h.impactT).t_impact))),
    intentMae: mean(r.hits.map((h) => Math.abs(h.ear - nearest(h.impactT).t_grid))),
    meanPull: mean(r.hits.map((h) => Math.abs(h.pull))),
  };
}
