/**
 * MIDI output as a slice (#600 S13, the first of Phase E): the feature left core, and nothing a
 * player saved or bound noticed. Its dial is FLAT, so its keys stay `midi.enabled`, `midi.port` and
 * `midi.muteFollowsMaster` in the dials, in a saved instrument and in the per-dial commands (the ids,
 * titles and descriptions below are main's before the move, verbatim); its node reads the same
 * live ports, now derived by the slice; it heals field by field as core's `healMidi` did; and the
 * shell's muted badge still says "MIDI still on" when the notes keep flowing. The S2 goldens
 * (`persisted_golden.test.ts`) pin the stored shape: unchanged by the move.
 */
import { describe, expect, it } from 'vitest';
import { registry } from '@/app/commands/registry';
import '@/app/host/contributions';
import { layerToSettings, settingsToLayer } from '@/settings/dials';
import { mergeControls, useControls, type ControlState } from '@/app/store';
import { makeStoreControlsNode } from '@/host/storeControls';
import { EXTENSIONS } from '@/extensions';
import { foldContributions } from '@/host/contributions';
import { stillSoundingNote } from '@/app/stillSounding';
import { MIDI_EXTENSION } from '@/slices/midi';
import type { DialSlice, Extension } from '@thoremin/sdk/instruments/extension';
import { MIDI } from '../helpers/extensions';
import { z } from 'zod';
import { checkFlatSlice, flatDialKey, flatDialKeys } from '@/host/slices';

describe.runIf(MIDI)('the MIDI slice keeps everything a player saved or bound (#600 S13)', () => {
  it('the per-dial commands are main\'s, id, title and description', () => {
    const midi = registry
      .list()
      .filter((c) => c.id.startsWith('dial.midi.'))
      .map((c) => ({ id: c.id, title: c.title, description: c.description }))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(midi).toEqual([
      { id: 'dial.midi.enabled.set', title: 'Set MIDI output', description: 'Send the played voices to a Web MIDI output (external synth or DAW)' },
      { id: 'dial.midi.muteFollowsMaster.set', title: 'Set Mute silences MIDI too', description: 'When on, the master mute (M) also stops the MIDI notes; when off, only the local sound is muted and notes keep flowing to your DAW' },
      { id: 'dial.midi.port.set', title: 'Set MIDI port', description: 'MIDI output port name (empty = first available)' },
    ]);
  });

  it('a saved instrument keeps the flat keys, and its settings the `midi` object', () => {
    const settings = layerToSettings(settingsToLayer({ ...useControls.getState(), midi: { enabled: true, port: 'IAC', muteFollowsMaster: false } } as never));
    expect((settings as unknown as { midi: unknown }).midi).toEqual({ enabled: true, port: 'IAC', muteFollowsMaster: false });
    const layer = settingsToLayer(settings) as Record<string, unknown>;
    expect([layer['midi.enabled'], layer['midi.port'], layer['midi.muteFollowsMaster']]).toEqual([true, 'IAC', false]);
    expect('midi' in layer).toBe(false);
  });

  it('heals field by field: one corrupt field takes its default alone, as core\'s healMidi did', () => {
    const current = useControls.getInitialState();
    const healed = mergeControls({ midi: { enabled: true, port: 'IAC', muteFollowsMaster: 'yes' } }, current) as ControlState & { midi: unknown };
    expect(healed.midi).toEqual({ enabled: true, port: 'IAC', muteFollowsMaster: true });
    const absent = mergeControls({}, current) as ControlState & { midi: unknown };
    expect(absent.midi).toEqual({ enabled: false, port: '', muteFollowsMaster: true });
  });

  it('the bridge derives the node\'s live ports from the dial (absent: its defaults)', () => {
    const node = makeStoreControlsNode(EXTENSIONS);
    expect(node.outputs.map((p) => p.name)).toEqual(expect.arrayContaining(['midiEnabled', 'midiPort', 'midiMuteFollowsMaster']));
    const run = (controls: unknown) => node.make(node.params.parse({})).process({}, { tick: 0, time: 0, dt: 1 / 60, resources: { controls: () => controls } } as never) as Record<string, unknown>;
    const base = useControls.getState();
    const on = run({ ...base, midi: { enabled: true, port: 'IAC', muteFollowsMaster: false } });
    expect([on.midiEnabled, on.midiPort, on.midiMuteFollowsMaster]).toEqual([true, 'IAC', false]);
    const { midi: _omit, ...withoutMidi } = base as unknown as Record<string, unknown>;
    const off = run(withoutMidi);
    expect([off.midiEnabled, off.midiPort, off.midiMuteFollowsMaster]).toEqual([false, '', true]);
  });

  it('the muted badge names MIDI only while its notes keep flowing', () => {
    expect(stillSoundingNote({ midi: { enabled: true, muteFollowsMaster: false } })).toBe(' · MIDI still on');
    expect(stillSoundingNote({ midi: { enabled: true, muteFollowsMaster: true } })).toBe('');
    expect(stillSoundingNote({ midi: { enabled: false, muteFollowsMaster: false } })).toBe('');
  });
});

describe('a flat dial slice is for a built-in feature that already had flat keys (#600 S13)', () => {
  const ext = (key: string): Extension => ({ ...(MIDI_EXTENSION as unknown as Extension), id: 'other', dials: [{ ...(MIDI_EXTENSION.dials[0] as unknown as DialSlice), key }], branches: [], nodes: [] });

  it('a new extension may not declare one', () => {
    expect(() => foldContributions([ext('myDial')])).toThrow(/declares the dial "myDial" flat; only a built-in feature/);
  });

  it('nor claim a built-in feature\'s flat dial: it belongs to that feature\'s slice', () => {
    expect(() => foldContributions([ext('midi')])).toThrow(/declares the flat dial "midi", which belongs to "midi-output"/);
  });

  it('a flat slice may carry no migrations', () => {
    const migrating: Extension = { ...ext('midi'), id: 'midi-output', dials: [{ ...(MIDI_EXTENSION.dials[0] as unknown as DialSlice), version: 2, migrations: { 1: (v: unknown) => v } }] };
    expect(() => foldContributions([migrating])).toThrow(/cannot carry migrations/);
  });
});

describe('the flat dial mechanism, for the slices after MIDI (#600 S13)', () => {
  const base = MIDI_EXTENSION.dials[0] as unknown as DialSlice;

  it('a field may keep a key other than `key.field` (S14\'s `steerConfig`)', () => {
    const renamed: DialSlice = { ...base, flatKeys: { port: 'midiPortName' } };
    expect(flatDialKeys(renamed)).toEqual(['midi.enabled', 'midiPortName', 'midi.muteFollowsMaster']);
    expect(flatDialKey(renamed, 'enabled')).toBe('midi.enabled');
    expect(() => checkFlatSlice('midi-output', renamed)).not.toThrow();
    expect(() => checkFlatSlice('midi-output', { ...base, flatKeys: { nope: 'x' } })).toThrow(/renames "nope", which is not one of its fields/);
    expect(() => checkFlatSlice('x', { ...base, layout: undefined, key: 'other', flatKeys: { port: 'p' } })).toThrow(/names flat keys but is not flat/);
  });

  it('every field needs a real default, and the object\'s default must be the fields\'', () => {
    const optional: DialSlice = { ...base, schema: z.object({ enabled: z.boolean().optional() }).default({}) };
    expect(() => checkFlatSlice('midi-output', optional)).toThrow(/"midi.enabled" has no default/);
    const diverging: DialSlice = { ...base, schema: z.object({ enabled: z.boolean().default(false) }).default({ enabled: true }) };
    expect(() => checkFlatSlice('midi-output', diverging)).toThrow(/default is not its fields' defaults/);
  });

  it('an extension\'s store-controls port may not shadow one core writes', () => {
    const shadowing: Extension = { id: 'shadow', branches: [], nodes: [], derive: () => [], dials: [{ key: 'shadowDial', kind: 'x', schema: z.object({}).default({}), meta: { facets: [], title: 't', description: 'd' }, ports: [{ name: 'mute', kind: 'boolean', read: () => true }] }] };
    expect(() => makeStoreControlsNode([shadowing])).toThrow(/store-controls port "mute", which core already writes/);
  });
});
