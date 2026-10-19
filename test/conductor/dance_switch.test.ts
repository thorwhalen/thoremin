/**
 * "Dance the orchestra": the leader switched away from the dancer and back (#506).
 *
 * The real dancer (the Que Calor replay, a 4/4 demo marked at 128 bpm, as in
 * `dance_orchestra.test.ts`) leads the score; mid-piece the leader is switched to the
 * hands or to the body and back. Two cases, because the live graph differs:
 *
 * - to the **hands**: the derivation drops the body branch (`conductorReadsBody`), so the
 *   pose camera and `body-pulse` are removed and, back to the dancer, start over (the
 *   reconcile re-creates them): the cold case.
 * - to the **body**: the body branch and its pulse follower stay composed; only the
 *   conductor's dance lead is re-created: the warm case.
 *
 * Measured: the time from the switch back until the score leads again (`leadsScore`).
 * Before #506 the new dance lead re-persisted the relation (3 s) and started a cycle after:
 * 8.93 s via the hands, 3.23 s via the body. Now the conductor keeps the relation its last
 * dance lead followed, and the new lead follows it at once when the dancer relates the same
 * way (ictus `DanceLead.reset(beat, { ratio })`): 7.03 s via the hands (the pulse follower
 * starting over is the rest, and live the pose model loading too), 1.17 s via the body
 * (the dancer's next cycle). Keeping the body branch composed after the dancer stops
 * leading would make the hands case warm too, at the cost of the pose model running for a
 * hand conductor: not done (see the PR).
 */
import { describe, it, expect } from 'vitest';
import { Engine, type GraphSpec } from '@thoremin/dag';
import { createDanceLead, UNKNOWN_PULSE, type PulseState } from '@thoremin/ictus';
import { createAppRegistry } from '@/nodes/browser';
import { composeInstrumentGraph, branchIdsFor } from '@/app/graph';
import { useControls } from '@/app/store';
import { type BodyFrame } from '@/nodes';
import { DEFAULT_CONDUCTOR_DIAL } from '@/slices/conductor/nodes/conductor';
import { loadStream } from '../helpers/fixtures';
import { BODY, CONDUCTOR } from '../helpers/extensions';

const HZ = 30;
const REGISTRY = createAppRegistry();
const LOOP = ['ui', 'camBody', 'bodyPulse', 'conductor', 'score'];
const MARKED = 128;
const DEMO_44 = { v: 1, title: 'demo 4/4', source: 'builtin', parts: [], tempoMap: [{ beat: 0, bpm: MARKED }], timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }], dynamics: [], fermatas: [], lengthBeats: 1024 };
type Conductor = typeof DEFAULT_CONDUCTOR_DIAL;
const AS = (source: Conductor['source']): Conductor => ({ ...DEFAULT_CONDUCTOR_DIAL, enabled: true, source });

/** The loop the derivation composes for `conductor`, cut to the nodes the score's lead runs
 *  through; the body replay is `frames` from its first frame. */
function loopSpec(frames: BodyFrame[], conductor: Conductor): GraphSpec {
  const ids = branchIdsFor({ handMap: { maxGain: 0 }, conductor });
  const { spec } = composeInstrumentGraph(ids, { body: 'replay-body', source: 'synthetic-hands' }, REGISTRY);
  return {
    nodes: spec.nodes.filter((n) => LOOP.includes(n.id)).map((n) => (n.id === 'camBody' ? { ...n, params: { frames } } : n)),
    edges: spec.edges.filter((e) => LOOP.includes(e.from.node) && LOOP.includes(e.to.node)),
  };
}

/** The dancer leads; at `away` the leader becomes `other`, at `back` the dancer again.
 *  Returns when the score first leads, and when it leads again after `back` (seconds). */
async function switchBack(clip: BodyFrame[], other: 'hands' | 'body', away: number, back: number): Promise<{ first: number; again: number }> {
  let conductor = AS('dancer');
  const controls = () => ({ ...useControls.getState(), conductor, scoreDoc: DEMO_44 });
  const engine = new Engine(loopSpec(clip, conductor), REGISTRY, { nominalDt: 1 / HZ, resources: { controls, audioContext: {}, masterGain: {} } });
  await engine.init();
  let first = NaN;
  let again = NaN;
  for (let i = 0; i < clip.length; i++) {
    const t = i / HZ;
    if (i === Math.round(away * HZ) || i === Math.round(back * HZ)) {
      conductor = i === Math.round(away * HZ) ? AS(other) : AS('dancer');
      // The live host re-composes on a dial change; the body replay re-created starts
      // where the dance is now (its frames from this tick).
      await engine.applyGraph(loopSpec(clip.slice(i), conductor));
    }
    engine.tick(t);
    const leads = engine.getOutput('conductor', 'leadsScore') === true;
    if (leads && Number.isNaN(first)) first = t;
    if (leads && t >= back && Number.isNaN(again)) again = t;
  }
  return { first, again: again - back };
}

describe.runIf(CONDUCTOR)('the leader switched back to the dancer (#506)', () => {
  const clip = loadStream('video_body_que_calor', 'camBody.body') as BodyFrame[];

  it.runIf(BODY)('measures the wait: cold (via the hands, the pulse starts over) and warm (via the body)', async () => {
    // The clip is 20 s (its end is a seam in the dance): the switches sit after the first
    // lead (9.4 s) and leave the cold case room to re-lock.
    const away = 9.6;
    const back = 10;
    const cold = await switchBack(clip, 'hands', away, back);
    const warm = await switchBack(clip, 'body', away, back);
    console.info(`[#506] first lead at ${cold.first.toFixed(2)} s; back to the dancer at ${back} s: again after ${cold.again.toFixed(2)} s via the hands, ${warm.again.toFixed(2)} s via the body`);
    expect(cold.first).toBeLessThan(away);
    // Warm: the dancer's next cycle (about 1.95 s here), no new persistence.
    expect(warm.again).toBeLessThan(2.2);
    // Cold: the pulse's own re-acquisition, without the lead's 3 s on top.
    expect(cold.again).toBeLessThan(8.93 - 1.5);
  });
});

/** A steady pulse of `period` with cycles at `t0 + k * period` (as `ictus_dance.test.ts`). */
function pulseAt(t: number, period: number, t0 = 0, confidence = 0.8): PulseState {
  const beat = (t - t0) / period;
  const whole = Math.floor(beat);
  return { ...UNKNOWN_PULSE, t, beat, phase: beat - whole, tempo: 60 / period, period, confidence, nextBeatAt: t + (whole + 1 - beat) * period, state: 'running', anchors: whole, lastAnchorAt: t0 + whole * period, level: period, strength: 0.7, candidates: [{ period, r: 0.7 }] };
}

describe.runIf(CONDUCTOR)('ictus DanceLead.reset(beat, { ratio }): the relation resumed (#506)', () => {
  /** When a fresh lead first leads on a steady dancer of a bar per 1.875 s (4 beats at 128). */
  const firstLead = (resume?: { ratio: number }, period = 1.875): number => {
    const lead = createDanceLead();
    lead.reset(0, resume);
    for (let t = 0; t < 20; t += 1 / 30) if (lead.step({ t, pulse: pulseAt(t, period, 0.1), marked: 128 }).started) return t;
    return NaN;
  };

  it('the same relation is followed at once: the start is the next cycle, not after 3 s', () => {
    const fresh = firstLead();
    const resumed = firstLead({ ratio: 4 });
    expect(fresh).toBeGreaterThan(3);
    expect(resumed).toBeLessThan(2.1);
  });

  it.runIf(BODY)('a candidate never followed is not resumed: a flick away while locking persists again', async () => {
    // Away at 6.4 s (the relation of a bar per cycle is then persisting, not yet followed),
    // back at 6.5 s: the conductor has nothing to resume, so the score waits for the
    // persistence as a first start does (it led at 7.63 s when the candidate was resumed).
    const clip = loadStream('video_body_que_calor', 'camBody.body') as BodyFrame[];
    const flick = await switchBack(clip, 'body', 6.4, 6.5);
    expect(flick.again + 6.5).toBeGreaterThan(9);
  });

  it('a different relation persists as a first one does', () => {
    expect(firstLead({ ratio: 2 })).toBeCloseTo(firstLead(), 6);
  });
});
