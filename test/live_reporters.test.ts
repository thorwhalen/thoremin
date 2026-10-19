/**
 * The face and gesture reporters (#392: out of `useEngine`, the `makeGenerativeReporter`
 * shape): per-frame sinks that read a node output and write a status store only when the panel
 * has something new to show, so a readout never re-renders at frame rate. Driven with a stub
 * engine and stub stores; times are in MILLISECONDS, as the host's converter hands them over.
 * The MIDI reporter moved with its slice (#600 S13): `test/midi/midi_status.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import { ABSENT_FACE_STATUS, type FaceStatus } from '@/nodes';
import { makeFaceReporter } from '@/app/faceStatus';
import { makeGestureReporter, type HandPoses } from '@/app/gestureStatus';

/** A stub engine whose outputs the test sets by `node.port`. */
function stubEngine() {
  const outputs: Record<string, unknown> = {};
  return { outputs, getOutput: (node: string, port: string) => outputs[`${node}.${port}`] };
}

describe('makeFaceReporter', () => {
  const ready = (faceDetected: boolean): FaceStatus => ({ ...ABSENT_FACE_STATUS, phase: 'ready', faceDetected });

  it('reports transitions at once, and a face being read at most every 100 ms', () => {
    const engine = stubEngine();
    const report = vi.fn();
    const sink = makeFaceReporter(engine, { report }, () => undefined);
    sink(0); // no status yet
    expect(report).not.toHaveBeenCalled();
    engine.outputs['camFace.status'] = ready(true);
    engine.outputs['faceExpr.expression'] = { present: true, label: 'happy', scores: [1] };
    sink(1000);
    expect(report).toHaveBeenLastCalledWith(ready(true), 'happy', [1]);
    sink(1050);
    expect(report).toHaveBeenCalledTimes(1);
    sink(1100);
    expect(report).toHaveBeenCalledTimes(2);
    // Idle (no face): only the transition is reported.
    engine.outputs['camFace.status'] = ready(false);
    sink(1120);
    sink(1500);
    expect(report).toHaveBeenCalledTimes(3);
    expect(report).toHaveBeenLastCalledWith(ready(false), null, null);
  });

  it('toasts once on a transition INTO error, never for an error already there at the first frame', () => {
    const engine = stubEngine();
    const toast = vi.fn();
    const sink = makeFaceReporter(engine, { report: () => undefined }, toast);
    engine.outputs['camFace.status'] = { ...ABSENT_FACE_STATUS, phase: 'error' };
    sink(0);
    expect(toast).not.toHaveBeenCalled();
    engine.outputs['camFace.status'] = { ...ABSENT_FACE_STATUS, phase: 'loading' };
    sink(10);
    engine.outputs['camFace.status'] = { ...ABSENT_FACE_STATUS, phase: 'error' };
    sink(20);
    sink(500);
    expect(toast).toHaveBeenCalledOnce();
  });
});

describe('makeGestureReporter', () => {
  it('ticks the dispatcher EVERY frame, in ms, and writes the store only when a pose changes', () => {
    const engine = stubEngine();
    const tick = vi.fn();
    const report = vi.fn();
    const sink = makeGestureReporter(engine, { tick }, { report });
    const open: HandPoses = { left: 'absent', right: 'open' };
    engine.outputs['gesture.poses'] = open;
    sink(16);
    sink(33);
    expect(tick.mock.calls).toEqual([
      [open, 16],
      [open, 33],
    ]);
    expect(report).toHaveBeenCalledOnce();
    engine.outputs['gesture.poses'] = { left: 'absent', right: 'fist' };
    sink(50);
    expect(report).toHaveBeenCalledTimes(2);
  });
});
