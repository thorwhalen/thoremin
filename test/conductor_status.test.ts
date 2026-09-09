/**
 * The conductor status reporter (#187 PR 4): the per-frame sink that bridges the
 * `conductor` node's outputs to the tool panel's store. It reads through a stub
 * engine, reports only when something a player can see changed (state, whole beat,
 * tempo to the bpm, confidence/dynamics to a twentieth), and ignores a missing node.
 */
import { describe, it, expect } from 'vitest';
import { makeConductorReporter, conductorLiveKey, type ConductorLive } from '@/app/conductorStatus';
import type { MusicalTime } from '@/ictus';

function time(over: Partial<MusicalTime>): MusicalTime {
  return { t: 0, beat: 0, phase: 0, tempo: 0, period: Infinity, confidence: 0, nextBeatAt: Infinity, beatsPerBar: 4, beatInBar: 0, state: 'ready', anchors: 0, ...over };
}

describe('makeConductorReporter', () => {
  it('reports the first read, then only visible changes', () => {
    const outputs: Record<string, unknown> = { time: time({ state: 'running', tempo: 70.2, beat: 3.1, beatInBar: 3, confidence: 0.51, anchors: 4 }), dynamics: 0.4, enabled: true };
    const engine = { getOutput: (_n: string, port: string) => outputs[port] };
    const reports: ConductorLive[] = [];
    const tick = makeConductorReporter(engine, { report: (l) => reports.push(l) });
    tick();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ enabled: true, state: 'running', beat: 3, beatInBar: 3, anchors: 4 });
    expect(reports[0].tempo).toBeCloseTo(70.2, 5);
    // A creep inside the same visible bucket: no report.
    outputs.time = time({ state: 'running', tempo: 70.4, beat: 3.6, beatInBar: 3, confidence: 0.52, anchors: 4 });
    outputs.dynamics = 0.415;
    tick();
    expect(reports).toHaveLength(1);
    // The next whole beat: a report.
    outputs.time = time({ state: 'running', tempo: 70.4, beat: 4.0, beatInBar: 0, confidence: 0.52, anchors: 5 });
    tick();
    expect(reports).toHaveLength(2);
    expect(reports[1].beat).toBe(4);
    // Hold: a report.
    outputs.time = time({ state: 'hold', tempo: 0, beat: 4.0, beatInBar: 0, confidence: 0.3, anchors: 5 });
    tick();
    expect(reports[2].state).toBe('hold');
    expect(reports[2].tempo).toBe(0);
  });

  it('ignores a missing node and never throws', () => {
    const engine = { getOutput: () => undefined };
    const reports: ConductorLive[] = [];
    const tick = makeConductorReporter(engine, { report: (l) => reports.push(l) });
    expect(() => tick()).not.toThrow();
    expect(reports).toHaveLength(0);
  });

  it('the change key quantises the way the panel displays', () => {
    const a: ConductorLive = { enabled: true, state: 'running', tempo: 70.2, beat: 3, beatInBar: 3, beatsPerBar: 4, confidence: 0.51, dynamics: 0.4, anchors: 4 };
    expect(conductorLiveKey(a)).toBe(conductorLiveKey({ ...a, tempo: 70.4, confidence: 0.52, dynamics: 0.415 }));
    expect(conductorLiveKey(a)).not.toBe(conductorLiveKey({ ...a, tempo: 71 }));
    expect(conductorLiveKey(a)).not.toBe(conductorLiveKey({ ...a, enabled: false }));
  });
});
