/**
 * A dancer leading a piece with written fermatas and an end (#463), through the conductor
 * node: the fermata reads as a hold (state `hold`, bpm 0; the panel's line is pinned in
 * `test/conduct_dance_shell.test.tsx`)
 * for one of the dancer's cycles, and past the piece's last note-off the beat returns to
 * the top on a cycle start, so the piece plays again with its bars on the dancer.
 */
import { describe, expect, it } from 'vitest';
import { replayNode } from '@thoremin/dag';
import { UNKNOWN_PULSE, type MusicalTime, type PulseState } from '@thoremin/ictus';
import { conductorNode, DEFAULT_CONDUCTOR_DIAL } from '@/nodes';

const HZ = 30;
const P = 2;
/** A steady dancer at one cycle (a 4/4 bar at 120 bpm) every 2 s. */
function pulseAt(t: number): PulseState {
  const beat = (t - 0.3) / P;
  const whole = Math.floor(beat);
  return { ...UNKNOWN_PULSE, t, beat, phase: beat - whole, tempo: 60 / P, period: P, confidence: 0.8, nextBeatAt: t + (whole + 1 - beat) * P, state: 'running', anchors: whole, lastAnchorAt: 0.3 + whole * P, level: P, strength: 0.7, candidates: [{ period: P, r: 0.7 }] };
}
const doc = (fermatas: number[], lengthBeats: number) => ({ v: 1, title: 'demo', source: 'builtin', parts: [{ id: 'p', name: 'p', percussion: false, notes: [{ midi: 60, start: 0, duration: 1, velocity: 0.8 }, { midi: 62, start: lengthBeats - 1, duration: 1, velocity: 0.8 }] }], tempoMap: [{ beat: 0, bpm: 120 }], timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }], dynamics: [], fermatas, lengthBeats });

async function run(seconds: number, d: ReturnType<typeof doc>) {
  const h = conductorNode.make(conductorNode.params.parse({ ...DEFAULT_CONDUCTOR_DIAL, enabled: true, source: 'dancer' }));
  const n = Math.round(seconds * HZ);
  const pulse = Array.from({ length: n }, (_, i) => pulseAt(i / HZ));
  return replayNode(h, { pulse, doc: pulse.map(() => d) }, { dt: 1 / HZ });
}

describe('a dancer and the written score (#463)', () => {
  it('a fermata is a hold for one cycle: state hold, bpm 0; then it goes on', async () => {
    const outs = await run(40, doc([14.5], 256));
    const holds = outs.filter((o) => (o.time as MusicalTime).state === 'hold');
    expect(holds.length / HZ).toBeGreaterThan(P - 0.1);
    expect(holds.length / HZ).toBeLessThan(P + 0.1);
    expect(holds.every((o) => o.bpm === 0 && (o.time as MusicalTime).beat === 14.5 && o.dance === 'fermata')).toBe(true);
    expect((outs.at(-1)!.time as MusicalTime).beat).toBeGreaterThan(20);
  });

  it('past the last note-off the piece starts again from the top, on a cycle start', async () => {
    // 30 beats long: loops at 32 (eight 4-beat cycles), every 16 s at 120 bpm.
    const outs = await run(50, doc([], 30));
    const beats = outs.map((o) => (o.time as MusicalTime).beat);
    const wraps = beats.map((b, i) => (i > 0 && b < beats[i - 1] ? i : -1)).filter((i) => i > 0);
    expect(wraps.length).toBeGreaterThanOrEqual(2);
    for (const i of wraps) {
      expect(beats[i]).toBeLessThan(0.2);
      // A dancer cycle start (0.3 + n * 2 s) within a frame of the wrap.
      const t = i / HZ;
      expect(Math.abs(((t - 0.3) / P) - Math.round((t - 0.3) / P)) * P).toBeLessThan(1.5 / HZ);
    }
    // It never stops: the score is led throughout, after the start.
    const start = outs.findIndex((o) => o.leadsScore === true);
    expect(outs.slice(start).every((o) => o.leadsScore === true && (o.bpm as number) > 0)).toBe(true);
  });
});
