/**
 * The WEBMIDI.js adapter behind the `midi-out` node (`openWebMidiSink`, #120, #137): never
 * reached by the node's own tests, which inject a sink. Driven here with `webmidi` mocked: no
 * Web MIDI is `unsupported` (and the library is never enabled), a refused permission is
 * `denied` rather than an error, no ports and a missing port say so with the ports there are,
 * and the sink sends on 1-indexed channels with the raw velocity, silences the port on
 * all-notes-off and on close, and survives a device that refuses those.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIDI } from '../helpers/extensions';

const webmidi = vi.hoisted(() => ({
  WebMidi: { enable: vi.fn(async () => undefined), outputs: [] as unknown[] },
}));
vi.mock('webmidi', () => webmidi);

function port(name: string) {
  const channel = () => ({ playNote: vi.fn(), stopNote: vi.fn(), sendControlChange: vi.fn() });
  return {
    name,
    channels: [undefined, ...Array.from({ length: 16 }, channel)],
    sendAllNotesOff: vi.fn(),
    sendAllSoundOff: vi.fn(),
  };
}

beforeEach(() => {
  vi.stubGlobal('navigator', { requestMIDIAccess: () => Promise.resolve({}) });
  webmidi.WebMidi.enable.mockReset().mockResolvedValue(undefined);
  webmidi.WebMidi.outputs = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const open = async (portName = '') => (await import('@/slices/midi/app/midi_engine')).openWebMidiSink({ portName });

describe.runIf(MIDI)('openWebMidiSink', () => {
  it('is unsupported without Web MIDI, and never enables the library', async () => {
    vi.stubGlobal('navigator', {});
    expect(await open()).toEqual({ sink: null, ports: [], reason: 'unsupported' });
    expect(webmidi.WebMidi.enable).not.toHaveBeenCalled();
  });

  it.each(['NotAllowedError', 'SecurityError'])('a refusal (%s) is denied, not an error', async (name) => {
    webmidi.WebMidi.enable.mockRejectedValueOnce(Object.assign(new Error('no'), { name }));
    expect(await open()).toEqual({ sink: null, ports: [], reason: 'denied' });
  });

  it('any other failure to enable is an error', async () => {
    webmidi.WebMidi.enable.mockRejectedValueOnce(new Error('driver'));
    expect(await open()).toEqual({ sink: null, ports: [], reason: 'error' });
    webmidi.WebMidi.enable.mockRejectedValueOnce(null);
    expect((await open()).reason).toBe('error');
  });

  it('says there are no ports', async () => {
    expect(await open()).toEqual({ sink: null, ports: [], reason: 'no-ports' });
  });

  it('a named port that is missing is not found, with the ports there are', async () => {
    webmidi.WebMidi.outputs = [port('IAC Bus 1'), port('Synth')];
    expect(await open('Gone')).toEqual({ sink: null, ports: ['IAC Bus 1', 'Synth'], reason: 'port-not-found' });
  });

  it('binds the named port, or the first one', async () => {
    const [a, b] = [port('IAC Bus 1'), port('Synth')];
    webmidi.WebMidi.outputs = [a, b];
    expect((await open('Synth')).sink!.portName).toBe('Synth');
    const first = await open();
    expect(first.sink!.portName).toBe('IAC Bus 1');
    expect(first.ports).toEqual(['IAC Bus 1', 'Synth']);
    expect(first.reason).toBeUndefined();
  });

  it('sends notes and controllers on the 1-indexed channel with the raw velocity; an unknown channel is ignored', async () => {
    const p = port('Synth');
    webmidi.WebMidi.outputs = [p];
    const { sink } = await open();
    sink!.noteOn(10, 36, 100);
    sink!.noteOff(10, 36);
    sink!.controlChange(1, 11, 64);
    expect(p.channels[10]!.playNote).toHaveBeenCalledWith(36, { rawAttack: 100 });
    expect(p.channels[10]!.stopNote).toHaveBeenCalledWith(36);
    expect(p.channels[1]!.sendControlChange).toHaveBeenCalledWith(11, 64);
    expect(() => sink!.noteOn(0, 60, 1)).not.toThrow();
    expect(() => sink!.noteOn(17, 60, 1)).not.toThrow();
  });

  it('silences the port on all-notes-off and on close, even when the device refuses', async () => {
    const p = port('Synth');
    webmidi.WebMidi.outputs = [p];
    const { sink } = await open();
    sink!.allNotesOff();
    expect(p.sendAllNotesOff).toHaveBeenCalledOnce();
    expect(p.sendAllSoundOff).toHaveBeenCalledOnce();
    sink!.close();
    expect(p.sendAllNotesOff).toHaveBeenCalledTimes(2);
    p.sendAllNotesOff.mockImplementation(() => {
      throw new Error('port closed');
    });
    expect(() => sink!.allNotesOff()).not.toThrow();
    expect(() => sink!.close()).not.toThrow();
  });
});
