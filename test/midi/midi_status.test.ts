/**
 * The MIDI reporter (#392; the MIDI slice's since #600 S13, moved from `test/live_reporters.test.ts`
 * with its assertions): the per-frame sink that reads the `midi-out` node's status and writes the
 * status store only when the panel has something new to show. Driven with a stub engine and a stub
 * store; times are in MILLISECONDS.
 */
import { describe, expect, it, vi } from 'vitest';
import type { MidiStatus } from '@/slices/midi/nodes/midi_out';
import { ABSENT_MIDI_STATUS, makeMidiReporter, type MidiStatusState } from '@/slices/midi/app/midiStatus';
import { MIDI } from '../helpers/extensions';
import { MIDI_UI } from '@/slices/midi/ui';
import { useMidiStatus } from '@/slices/midi/app/midiStatus';

/** A stub engine whose outputs the test sets by `node.port`. */
function stubEngine() {
  const outputs: Record<string, unknown> = {};
  return { outputs, getOutput: (node: string, port: string) => outputs[`${node}.${port}`] };
}

describe.runIf(MIDI)('makeMidiReporter', () => {
  it('reports a port or phase change at once, and paces the active-note counter to 250 ms', () => {
    const engine = stubEngine();
    const state: Pick<MidiStatusState, 'status' | 'report'> = { status: ABSENT_MIDI_STATUS, report: vi.fn((s: MidiStatus) => (state.status = s)) };
    const sink = makeMidiReporter(engine, { getState: () => state });
    const on: MidiStatus = { ...ABSENT_MIDI_STATUS, phase: 'ready', supported: true, ports: ['IAC'], portName: 'IAC' };
    engine.outputs['midiOut.status'] = on;
    sink(0);
    expect(state.report).toHaveBeenCalledTimes(1);
    engine.outputs['midiOut.status'] = { ...on, activeNotes: 2 };
    sink(100);
    expect(state.report).toHaveBeenCalledTimes(1);
    sink(250);
    expect(state.report).toHaveBeenCalledTimes(2);
    engine.outputs['midiOut.status'] = { ...on, activeNotes: 2, ports: ['IAC', 'USB'] };
    sink(260);
    expect(state.report).toHaveBeenCalledTimes(3);
  });
});


describe.runIf(MIDI)('the slice\'s status hook (#600 S13: it was a hand-wired reporter in useEngine)', () => {
  it('mirrors the midi-out node into the status store, shows it absent when the node leaves, and resets', () => {
    const [hook] = MIDI_UI.statusHooks;
    expect(hook.nodeId).toBe('midiOut');
    const engine = stubEngine();
    const on: MidiStatus = { ...ABSENT_MIDI_STATUS, phase: 'ready', supported: true, ports: ['IAC'], portName: 'IAC' };
    engine.outputs['midiOut.status'] = on;
    hook.make(engine, () => ({}))(0);
    expect(useMidiStatus.getState().status).toEqual(on);
    hook.onRemoved();
    expect(useMidiStatus.getState().status).toEqual(ABSENT_MIDI_STATUS);
    useMidiStatus.getState().report(on);
    hook.reset();
    expect(useMidiStatus.getState().status).toEqual(ABSENT_MIDI_STATUS);
  });
});
