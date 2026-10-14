/**
 * "Dance the orchestra" (#380, body-movement A8): the real dancer leads the score, through
 * the composed graph.
 *
 * The graph is the instrument graph the derivation composes for `conductor.source` =
 * `dancer` (the body source, its `body-pulse`, the conductor branch), cut to the nodes the
 * loop runs through: the store bridge, the body source (a replay of the Que Calor dancer,
 * 129.2 bpm, whose stride repeats once a bar), the dancer's pulse, the conductor and the
 * score. The score is a 4/4 demo marked at 128 bpm, so the dancer (about 121 bpm on
 * average, cycles of 1.75 s at first and 1.95 s once settled) is 4 to 6 % slow of it:
 * inside the default 10 % clamp, a relation of four beats (a bar) per cycle, and far
 * enough off that a score held at its marked tempo drifts through the bar (the control).
 *
 * The acceptance figures: the score's tempo never leaves the clamp; its bars stay on the
 * dancer's cycles, measured as the circular R of the score's position in its bar at each
 * of the dancer's fitted cycle starts (1 = every cycle starts at one place in the bar),
 * against the same figure for the score played at its marked tempo (the control); the
 * score is silent until the piece starts, and never stops after it.
 */
import { describe, it, expect } from 'vitest';
import { Engine, type GraphSpec } from '@thoremin/dag';
import type { MusicalTime, PulseState } from '@thoremin/ictus';
import { createAppRegistry } from '@/nodes/browser';
import { composeInstrumentGraph, branchIdsFor } from '@/app/graph';
import { useControls } from '@/app/store';
import { DEFAULT_CONDUCTOR_DIAL, type BodyFrame } from '@/nodes';
import { loadStream } from './helpers/fixtures';

const HZ = 30;
const REGISTRY = createAppRegistry();
const LOOP = ['ui', 'camBody', 'bodyPulse', 'conductor', 'score'];
const MARKED = 128;
const DEMO_44 = { v: 1, title: 'demo 4/4', source: 'builtin', parts: [], tempoMap: [{ beat: 0, bpm: MARKED }], timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }], dynamics: [], fermatas: [], lengthBeats: 1024 };
const DANCER = { ...DEFAULT_CONDUCTOR_DIAL, enabled: true, source: 'dancer' as const };

function loopSpec(frames: BodyFrame[], conductor: typeof DANCER): GraphSpec {
  const ids = branchIdsFor({ handMap: { maxGain: 0 }, conductor });
  expect(ids).toEqual(expect.arrayContaining(['conductor', 'body-source']));
  const { spec } = composeInstrumentGraph(ids, { body: 'replay-body', source: 'synthetic-hands' }, REGISTRY);
  // The pulse reaches the conductor on the branch table's own edge.
  expect(spec.edges.some((e) => e.from.node === 'bodyPulse' && e.from.port === 'pulse' && e.to.node === 'conductor' && e.to.port === 'pulse')).toBe(true);
  return {
    nodes: spec.nodes.filter((n) => LOOP.includes(n.id)).map((n) => (n.id === 'camBody' ? { ...n, params: { frames } } : n)),
    edges: spec.edges.filter((e) => LOOP.includes(e.from.node) && LOOP.includes(e.to.node)),
  };
}

interface Run {
  time: MusicalTime[];
  bpm: number[];
  leads: boolean[];
  level: number[];
  pulse: PulseState[];
}

async function dance(frames: BodyFrame[], conductor = DANCER): Promise<Run> {
  const controls = { ...useControls.getState(), conductor, scoreDoc: DEMO_44 };
  const engine = new Engine(loopSpec(frames, conductor), REGISTRY, { nominalDt: 1 / HZ, resources: { controls: () => controls, audioContext: {}, masterGain: {} } });
  await engine.init();
  const out: Run = { time: [], bpm: [], leads: [], level: [], pulse: [] };
  for (let i = 0; i < frames.length; i++) {
    engine.tick(i / HZ);
    out.time.push(engine.getOutput('conductor', 'time') as MusicalTime);
    out.bpm.push(engine.getOutput('conductor', 'bpm') as number);
    out.leads.push(engine.getOutput('conductor', 'leadsScore') as boolean);
    out.level.push(engine.getOutput('conductor', 'level') as number);
    out.pulse.push(engine.getOutput('bodyPulse', 'pulse') as PulseState);
  }
  return out;
}

/** The dancer's fitted cycle starts (the pulse's anchors) from `fromS`. */
function cycleStarts(run: Run, fromS: number): number[] {
  const out: number[] = [];
  for (const p of run.pulse) if (p.lastAnchorAt !== undefined && out.at(-1) !== p.lastAnchorAt) out.push(p.lastAnchorAt);
  return out.filter((t) => t >= fromS);
}

/** R of the phases `beatAt(t)` takes in a 4-beat bar over `ts`. */
function barR(ts: number[], beatAt: (t: number) => number): number {
  const ph = ts.map((t) => (2 * Math.PI * beatAt(t)) / 4);
  return Math.hypot(ph.reduce((a, x) => a + Math.cos(x), 0), ph.reduce((a, x) => a + Math.sin(x), 0)) / ph.length;
}

describe('the real dancer leads the score (video_body_que_calor, a 4/4 demo at 120 bpm)', () => {
  // The clip is 20 s, played four times through; each seam is a jump in the dance, which
  // the follower answers by dropping its pulse: the piece holds its tempo.
  const clip = loadStream('video_body_que_calor', 'camBody.body') as BodyFrame[];
  const frames = [...clip, ...clip, ...clip, ...clip];
  const PASS = clip.length / HZ;

  it('starts on a cycle, stays in the clamp, never stops, and keeps its bars on the dancer', async () => {
    const run = await dance(frames);
    const start = run.leads.findIndex(Boolean);
    // Silent until the relation has persisted and the next cycle came (the pulse is
    // trusted after about 6 s, the relation 3 s later).
    expect(start / HZ).toBeGreaterThan(6);
    expect(start / HZ).toBeLessThan(14);
    expect(run.bpm.slice(0, start).every((b) => b === 0)).toBe(true);
    expect(run.time[start].beat).toBeLessThan(0.5);
    // Never stops after the start, and never leaves the clamp.
    const after = run.bpm.slice(start);
    expect(after.every((b) => b >= MARKED * 0.9 - 1e-9 && b <= MARKED * 1.1 + 1e-9)).toBe(true);
    expect(run.leads.slice(start).every(Boolean)).toBe(true);
    for (let i = start + 1; i < run.time.length; i++) expect(run.time[i].beat).toBeGreaterThan(run.time[i - 1].beat);
    // One cycle is a bar.
    expect(new Set(run.level.slice(start))).toEqual(new Set([4]));
    // The dancer's tempo, not the marked one: the cycles settle near 1.94 s (four beats
    // at about 121 to 124 bpm).
    const late = run.bpm.slice(15 * HZ);
    const mean = late.reduce((a, b) => a + b, 0) / late.length;
    expect(mean).toBeGreaterThan(117);
    expect(mean).toBeLessThan(126);

    // The bars on the dancer's cycles: R of the score's place in its bar at each fitted
    // cycle start, against the control (the score at its marked tempo from the same start,
    // which this dancer, 4 to 6 % slower, drifts through). Each seam is a jump in the dance:
    // the follower drops the pulse, the piece holds its tempo, the next pass re-locks with
    // the dancer's bar elsewhere and the phase law walks the score back onto it, so a pass
    // reads high only once that has happened. Measured:
    //                 from 25 s (n 23)   passes 2 to 4, from 9 s in (n 6 each)
    //   following     0.75               0.96, 0.95, 0.96
    //   marked tempo  0.04               0.92, 0.92, 0.92
    // Six cycles cannot tell a follower from a metronome within one pass (the control
    // drifts less than a beat in eleven seconds); the whole run can. That the PHASE law,
    // not only the tempo, does the walking is the seam test in `test/ictus_dance.test.ts`.
    const beatAt = (t: number) => {
      const m = run.time[Math.min(run.time.length - 1, Math.max(0, Math.floor(t * HZ)))];
      return m.beat + (t - m.t) * (m.tempo / 60);
    };
    const t0 = start / HZ;
    const fixed = (t: number) => ((t - t0) * MARKED) / 60;
    const r = (from: number, to: number) => {
      const ts = cycleStarts(run, from).filter((t) => t < to);
      return { n: ts.length, on: barR(ts, beatAt), off: barR(ts, fixed) };
    };
    const whole = r(25, PASS * 4);
    const passes = [2, 3, 4].map((k) => r(PASS * (k - 1) + 9, PASS * k));
    console.info(
      `[#380] Que Calor x4 vs a 4/4 demo at ${MARKED} bpm, bar R following / at the marked tempo: from 25 s ${whole.on.toFixed(2)} / ${whole.off.toFixed(2)} (n ${whole.n}); passes 2-4 ${passes.map((p) => `${p.on.toFixed(2)} / ${p.off.toFixed(2)} (n ${p.n})`).join(', ')}; mean ${mean.toFixed(1)} bpm`,
    );
    expect(whole.n).toBeGreaterThanOrEqual(20);
    expect(whole.on).toBeGreaterThan(0.7);
    expect(whole.on).toBeGreaterThan(whole.off + 0.4);
    expect(passes[2].on).toBeGreaterThan(0.9);
  });

  it('a narrower clamp holds the score inside it', async () => {
    const run = await dance(frames, { ...DANCER, dancer: { ...DANCER.dancer, range: 0.04 } });
    const start = run.leads.findIndex(Boolean);
    expect(start).toBeGreaterThan(0);
    expect(run.bpm.slice(start).every((b) => b >= MARKED * 0.96 - 1e-9 && b <= MARKED * 1.04 + 1e-9)).toBe(true);
  });
});

describe('the dancer as a leader (the derivation, #380)', () => {
  it('a dancer leading the score composes the body source with the conductor', () => {
    expect(branchIdsFor({ conductor: { enabled: true, source: 'dancer' } })).toEqual(expect.arrayContaining(['conductor', 'body-source']));
    expect(branchIdsFor({ conductor: { enabled: true, source: 'dancer' } })).not.toContain('song-pace');
  });

  it('a dancer leading the recording is the song following the dancer: the pace branch, never the beat servo', () => {
    const ids = branchIdsFor({ conductor: { enabled: true, source: 'dancer', conducts: 'recording' }, songHandle: {} });
    expect(ids).toEqual(expect.arrayContaining(['conductor', 'body-source', 'song-pace']));
    // Without a song there is nothing to pace.
    expect(branchIdsFor({ conductor: { enabled: true, source: 'dancer', conducts: 'recording' }, songHandle: null })).not.toContain('song-pace');
  });

  it("the conductor's recordingTime stays empty while a dancer leads (the pace node then follows the pulse)", async () => {
    const clip = loadStream('video_body_que_calor', 'camBody.body') as BodyFrame[];
    const run = { recording: [] as unknown[], leads: [] as boolean[] };
    const conductor = { ...DANCER, conducts: 'recording' as const };
    const controls = { ...useControls.getState(), conductor, scoreDoc: DEMO_44 };
    const engine = new Engine(loopSpec(clip.slice(0, 15 * HZ), conductor), REGISTRY, { nominalDt: 1 / HZ, resources: { controls: () => controls, audioContext: {}, masterGain: {} } });
    await engine.init();
    for (let i = 0; i < 15 * HZ; i++) {
      engine.tick(i / HZ);
      run.recording.push(engine.getOutput('conductor', 'recordingTime'));
      run.leads.push(engine.getOutput('conductor', 'leadsScore') as boolean);
    }
    expect(run.recording.every((x) => x === undefined)).toBe(true);
    expect(run.leads.every((x) => !x)).toBe(true);
  });
});
