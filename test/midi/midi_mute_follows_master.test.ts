/**
 * The `midi.muteFollowsMaster` dial (#168 Q3, #146 B1.1), replayed over a recorded hand
 * sweep (`test/fixtures/sweep_right`) through the real nodes: replay-hands → hand-features
 * → voice-mapping → synth-merge → midi-out, with `store-controls` carrying the player's
 * mute and the MIDI dials, and a mock sink logging every MIDI event per tick.
 *
 * Two facts are pinned:
 *
 *  1. With the dial at its default (ON: the master mute silences MIDI too, which is what
 *     the instrument did before the dial existed) the MIDI event stream is BYTE-EQUAL to
 *     the one main `42d94db` produced with the wiring of that day
 *     (`test/fixtures/midi_mute/legacy_main.ndjson`, dumped by this file's writer from
 *     that code before the dial, the `unmuted` merge output and the midi-out `mute` port
 *     existed). A mute mid-sweep releases every note and nothing sounds until unmute.
 *  2. With the dial OFF the mute never reaches the port: the stream is byte-equal to a
 *     run with no mute at all, so a DAW driven by thoremin keeps playing while the local
 *     monitor is silent.
 *
 * Regenerating the baseline (only to re-baseline deliberately, never to make a red test
 * pass): `THOREMIN_WRITE_MIDI_BASELINE=1 npx vitest run test/midi_mute_follows_master`.
 * The writer runs the LEGACY wiring (the mute reaching midi-out only through the merge's
 * muted `params`), which the graph still supports, so the dump is reproducible.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { Engine, type GraphSpec } from '@thoremin/dag';
import { createAppRegistry } from '@/nodes/browser';
import type { MidiSink, MidiSinkFactory } from '@/slices/midi/nodes/midi_out';
import type { HandsFrame } from '@/nodes';
import { useControls } from '@/app/store';
import { DEFAULT_MIDI } from '@/slices/midi/schema';
import { MIDI } from '../helpers/extensions';
import { FIXTURES, loadStream } from '../helpers/fixtures';

const BASELINE = join(FIXTURES, 'midi_mute', 'legacy_main.ndjson');
const TICKS = 90; // the sweep_right fixture's length
const MUTE_AT = 30;
const UNMUTE_AT = 60;

type Ev = [kind: string, ...args: number[]];

class LogSink implements MidiSink {
  readonly portName = 'Log Port';
  events: Ev[] = [];
  noteOn(channel: number, note: number, velocity: number) { this.events.push(['on', channel, note, velocity]); }
  noteOff(channel: number, note: number) { this.events.push(['off', channel, note]); }
  controlChange(channel: number, controller: number, value: number) { this.events.push(['cc', channel, controller, value]); }
  allNotesOff() { this.events.push(['allNotesOff']); }
  close() { this.events.push(['close']); }
}

/** How the mute reached midi-out before the dial (main 42d94db), and how it does now. */
type Wiring = 'legacy' | 'dial';

function spec(wiring: Wiring): GraphSpec {
  const frames = loadStream('sweep_right', 'src.hands') as HandsFrame[];
  const e = (fn: string, fp: string, tn: string, tp: string) => ({ from: { node: fn, port: fp }, to: { node: tn, port: tp } });
  return {
    nodes: [
      { id: 'src', type: 'replay-hands', params: { frames } },
      { id: 'feat', type: 'hand-features', params: { mirrorX: false, mirrorHandedness: false } },
      { id: 'ui', type: 'store-controls', params: {} },
      { id: 'map', type: 'voice-mapping', params: { magnetism: 0.8, maxGain: 0.5 } },
      { id: 'merge', type: 'synth-merge', params: {} },
      { id: 'midiOut', type: 'midi-out', params: {} },
    ],
    edges: [
      e('src', 'hands', 'feat', 'hands'),
      e('feat', 'features', 'map', 'features'),
      e('map', 'params', 'merge', 'voice1'),
      e('ui', 'muteAll', 'merge', 'mute'),
      e('ui', 'hushVoices', 'merge', 'hush'),
      e('ui', 'midiEnabled', 'midiOut', 'enabled'),
      e('ui', 'midiPort', 'midiOut', 'port'),
      ...(wiring === 'legacy'
        ? [e('ui', 'mute', 'map', 'mute'), e('merge', 'params', 'midiOut', 'params')]
        : [
            e('merge', 'unmuted', 'midiOut', 'params'),
            e('ui', 'mute', 'midiOut', 'mute'),
            e('ui', 'claimed', 'midiOut', 'claimed'),
            e('ui', 'midiMuteFollowsMaster', 'midiOut', 'muteFollowsMaster'),
          ]),
    ],
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Run the sweep with a mute window (or none) and return the per-tick MIDI event log as
 *  NDJSON — one line per tick, so a diff reads as "what changed at tick N". */
async function run(wiring: Wiring, opts: { mute: boolean; muteFollowsMaster?: boolean; claim?: boolean }): Promise<string> {
  const sink = new LogSink();
  const factory: MidiSinkFactory = async () => ({ sink, ports: [sink.portName] });
  useControls.setState({
    muted: false,
    hushedBy: [],
    midi: { ...DEFAULT_MIDI, enabled: true, ...(opts.muteFollowsMaster === undefined ? {} : { muteFollowsMaster: opts.muteFollowsMaster }) },
  } as never);
  const eng = new Engine(spec(wiring), createAppRegistry(), {
    resources: { controls: () => useControls.getState(), createMidiSink: factory },
    nominalDt: 1 / 30,
    validatePorts: true,
  });
  const lines: string[] = [];
  for (let tick = 0; tick < TICKS; tick++) {
    // The mute window is the player's M, or (a claim) the Trainer holding the room.
    if (opts.mute && tick === MUTE_AT) (opts.claim ? useControls.getState().setHush('trainer', true) : useControls.getState().setMuted(true));
    if (opts.mute && tick === UNMUTE_AT) (opts.claim ? useControls.getState().setHush('trainer', false) : useControls.getState().setMuted(false));
    eng.tick();
    if (tick === 0) await flush(); // the port opens asynchronously; from tick 1 on it is attached
    lines.push(JSON.stringify({ tick, events: sink.events }));
    sink.events = [];
  }
  eng.dispose();
  return lines.join('\n') + '\n';
}

const parse = (ndjson: string) => ndjson.trim().split('\n').map((l) => JSON.parse(l) as { tick: number; events: Ev[] });

afterEach(() => {
  useControls.setState({ muted: false, hushedBy: [], midi: { ...DEFAULT_MIDI } } as never);
});

describe.runIf(MIDI && process.env.THOREMIN_WRITE_MIDI_BASELINE)('baseline writer (legacy wiring)', () => {
  it('dumps the legacy stream', async () => {
    writeFileSync(BASELINE, await run('legacy', { mute: true }));
  });
});

describe.runIf(MIDI && !process.env.THOREMIN_WRITE_MIDI_BASELINE)('midi.muteFollowsMaster over the sweep_right fixture', () => {
  it('the fixture sounds: notes play, and the mute window has something to silence', async () => {
    const log = parse(await run('dial', { mute: false }));
    const ons = log.flatMap((l) => l.events.filter((ev) => ev[0] === 'on'));
    expect(ons.length).toBeGreaterThan(3);
    // Something is sounding INSIDE the mute window, else the dial would be untested.
    expect(log.slice(MUTE_AT, UNMUTE_AT).some((l) => l.events.some((ev) => ev[0] === 'on'))).toBe(true);
  });

  it('dial ON (the default): the stream is byte-equal to main 42d94db\'s (the mute silences MIDI, as before)', async () => {
    const baseline = readFileSync(BASELINE, 'utf8');
    expect(await run('dial', { mute: true })).toBe(baseline);
    // The default IS on: not naming the dial gives the same bytes.
    expect(await run('dial', { mute: true, muteFollowsMaster: true })).toBe(baseline);
  });

  it('dial ON: the mute releases every held note and nothing sounds until unmute', async () => {
    const log = parse(await run('dial', { mute: true, muteFollowsMaster: true }));
    const at = (tick: number) => log[tick].events;
    expect(at(MUTE_AT).some((ev) => ev[0] === 'off')).toBe(true);
    expect(at(MUTE_AT).some((ev) => ev[0] === 'on')).toBe(false);
    for (let t = MUTE_AT; t < UNMUTE_AT; t++) expect(at(t).filter((ev) => ev[0] === 'on'), `tick ${t}`).toEqual([]);
    expect(at(UNMUTE_AT).some((ev) => ev[0] === 'on')).toBe(true);
  });

  it('dial OFF: the mute never reaches the port; byte-equal to a run with no mute at all', async () => {
    const unmuted = await run('dial', { mute: false });
    expect(await run('dial', { mute: true, muteFollowsMaster: false })).toBe(unmuted);
    expect(unmuted).not.toBe(readFileSync(BASELINE, 'utf8'));
  });

  it('dial OFF: the player\'s M alone — note-ons continue through the mute window', async () => {
    const log = parse(await run('dial', { mute: true, muteFollowsMaster: false }));
    expect(log.slice(MUTE_AT, UNMUTE_AT).some((l) => l.events.some((ev) => ev[0] === 'on'))).toBe(true);
  });

  it('dial OFF: a tool claim (the Trainer) still silences MIDI — the dial governs only the player\'s M', async () => {
    const log = parse(await run('dial', { mute: true, muteFollowsMaster: false, claim: true }));
    const at = (tick: number) => log[tick].events;
    expect(at(MUTE_AT).some((ev) => ev[0] === 'off')).toBe(true);
    for (let t = MUTE_AT; t < UNMUTE_AT; t++) expect(at(t).filter((ev) => ev[0] === 'on'), `tick ${t}`).toEqual([]);
    expect(at(UNMUTE_AT).some((ev) => ev[0] === 'on')).toBe(true);
    // And with the dial on, a claim is exactly the player's mute: the baseline bytes.
    expect(await run('dial', { mute: true, muteFollowsMaster: true, claim: true })).toBe(readFileSync(BASELINE, 'utf8'));
  });

  it('the legacy wiring still produces the baseline (the dump is reproducible)', async () => {
    expect(await run('legacy', { mute: true })).toBe(readFileSync(BASELINE, 'utf8'));
  });
});
