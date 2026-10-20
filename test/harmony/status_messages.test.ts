/**
 * What the chord instruments tell the player (the chord map, the wheel, the chart): the
 * `describe*Live` line for each state their nodes report, and the reporters that copy a node's
 * status into the view only when what the view shows changed. Each state must say something of
 * its own (two states sharing a line would hide one of them from the player); the assertions
 * name the fragment that matters rather than the whole sentence, so rewording stays cheap.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  ABSENT_CHORD_MAP_LIVE,
  describeChordMapLive,
  makeChordMapReporter,
  useChordMapStatus,
  type ChordMapLive,
} from '@thoremin/ext-harmony/app/chordMapStatus';
import { describeChordWheelLive, makeChordWheelReporter, useChordWheelStatus } from '@thoremin/ext-harmony/app/chordWheelStatus';
import { describeChordChartLive, makeChordChartReporter, useChordChartStatus } from '@thoremin/ext-harmony/app/chordChartStatus';
import { IDLE_CHORD_WHEEL_STATUS, type ChordWheelStatus } from '@thoremin/ext-harmony/nodes/chord_wheel';
import { IDLE_CHORD_CHART_STATUS, type ChordChartStatus } from '@thoremin/ext-harmony/nodes/chord_chart';

const map = (s: Partial<ChordMapLive>): ChordMapLive => ({ ...ABSENT_CHORD_MAP_LIVE, enabled: true, key: 'C major', ...s });
const wheel = (s: Partial<ChordWheelStatus>): ChordWheelStatus => ({ ...IDLE_CHORD_WHEEL_STATUS, enabled: true, key: 'C major', ...s });
const chart = (s: Partial<ChordChartStatus>): ChordChartStatus => ({ ...IDLE_CHORD_CHART_STATUS, enabled: true, ...s });

/** Every line is distinct: no two states read the same to the player. */
const expectDistinct = (lines: string[]) => expect(new Set(lines).size).toBe(lines.length);

describe('the chord map tells the player', () => {
  const cases: [Partial<ChordMapLive>, RegExp][] = [
    [{ enabled: false }, /^Off\./],
    [{ midi: 'waiting' }, /allow MIDI access/],
    [{ midi: 'denied' }, /MIDI access was refused/],
    [{ midi: 'unavailable' }, /Safari has no Web MIDI/],
    [{ midi: 'no-input' }, /No MIDI keyboard found/],
    [{ audio: 'waiting' }, /allow the microphone/],
    [{ audio: 'denied' }, /microphone was refused/],
    [{ audio: 'unavailable' }, /offers no microphone/],
    [{ audio: 'quiet' }, /Play a chord near the microphone/],
    [{ audio: 'listening' }, /Listening for a chord/],
    [{ midi: 'listening' }, /Play a chord on your MIDI keyboard/],
    [{ midi: 'listening', inputChord: 'Am', play: 'strum' }, /^Am\. Strum it/],
    [{ audio: 'listening', inputChord: 'Am' }, /^Am\. Raise or lower/],
    [{ pointing: false }, /Show your chord hand/],
    [{ pointing: true }, /Move your chord hand over a chord/],
    [{ pointing: true, chord: 'C', numeral: 'I', melody: 'E4' }, /^C \(I\), melody E4 \(chord tones\)/],
    [{ pointing: true, chord: 'C', numeral: 'I', melody: 'E4', melodySet: 'scale' }, /melody E4 \(scale\)/],
    [{ pointing: true, chord: 'C', numeral: 'I' }, /^C \(I\)\. Raise or lower/],
    [{ pointing: true, chord: 'Cm', numeral: 'i', mode: 'darker', tension: 1 }, /the frown made it minor, with a seventh/],
    [{ pointing: true, chord: 'C', numeral: 'I', mode: 'brighter', tension: 2 }, /the smile made it major, with a ninth/],
    [{ pointing: true, chord: 'C', numeral: 'I', play: 'strum' }, /Strum down once/],
    [{ pointing: true, chord: 'C', numeral: 'I', play: 'strum', ready: true }, /^C \(I\)\. Strum with your other hand/],
    [{ pointing: true, chord: 'C', numeral: 'I', play: 'strum', ready: true, strums: 2, lastLead: 0.0304 }, /strummed 30 ms before/],
    [{ pointing: true, chord: 'C', numeral: 'I', play: 'strum', ready: true, strums: 2, lastLead: -0.012 }, /strummed 12 ms after/],
  ];
  it.each(cases)('%o', (state, line) => {
    expect(describeChordMapLive(map(state))).toMatch(line);
  });
  it('says something different in every state', () => {
    expectDistinct(cases.map(([s]) => describeChordMapLive(map(s))));
  });
});

describe('the chord wheel tells the player', () => {
  const cases: [Partial<ChordWheelStatus>, RegExp][] = [
    [{ enabled: false }, /^Off\./],
    [{ steer: 'face', chord: 'C', numeral: 'I' }, /^C \(I\)\. Show your face/],
    [{ steer: 'face', chord: 'G', numeral: 'V', face: 'smile', lastMove: 'up a fifth' }, /^G \(V\), after up a fifth\. Reading: smile/],
    [{ steer: 'face', chord: 'G', numeral: '', face: 'neutral' }, /^G\. Reading: neutral/],
    [{ steering: false }, /Show your steering hand/],
    [{ steering: true, chord: 'C', numeral: 'I', rejected: 'tritone' }, /does not apply to this chord/],
    [{ steering: true, chord: 'C', numeral: 'I', walking: true }, /walking the move on the beat/],
    [{ steering: true, chord: 'C', numeral: 'I', walking: true, lastMove: 'up a step' }, /walking up a step/],
    [{ steering: true, chord: 'C', numeral: 'I', armed: false, lastMove: 'up a step' }, /after up a step\. Back to the middle/],
    [{ steering: true, chord: 'C', numeral: 'I', armed: false }, /^C \(I\)\. Back to the middle/],
    [{ steering: true, chord: 'C', numeral: 'I' }, /Push toward a move/],
  ];
  it.each(cases)('%o', (state, line) => {
    expect(describeChordWheelLive(wheel(state))).toMatch(line);
  });
  it('says something different in every state', () => {
    expectDistinct(cases.map(([s]) => describeChordWheelLive(wheel(s))));
  });
});

describe('the chord chart tells the player', () => {
  const cases: [Partial<ChordChartStatus>, RegExp][] = [
    [{ enabled: false }, /^Off\./],
    [{}, /Turn conducting on .* and choose a piece/],
    [{ conducting: true }, /No chords in this piece/],
    [{ hasChart: true, changes: 12 }, /^12 chord changes\. Turn conducting on/],
    [{ hasChart: true, changes: 12, conducting: true }, /starts on your downbeat/],
    [{ hasChart: true, changes: 12, conducting: true, running: true, chord: 'G', next: 'C' }, /^G, then C\.$/],
    [{ hasChart: true, changes: 12, conducting: true, running: true, chord: 'G' }, /^G\.$/],
  ];
  it.each(cases)('%o', (state, line) => {
    expect(describeChordChartLive(chart(state))).toMatch(line);
  });
  it('says something different in every state', () => {
    expectDistinct(cases.map(([s]) => describeChordChartLive(chart(s))));
  });
});

describe('the chord instruments report to the view only on a change', () => {
  const engineOf = (out: () => unknown) => ({ getOutput: vi.fn((_id: string, _port: string) => out()) });

  it.each([
    ['map', makeChordMapReporter, map({ chord: 'C' }), map({ chord: 'G' }), 'chordMap'],
    ['wheel', makeChordWheelReporter, wheel({ chord: 'C' }), wheel({ chord: 'G' }), 'chordWheel'],
    ['chart', makeChordChartReporter, chart({ chord: 'C' }), chart({ chord: 'G' }), 'chordChart'],
  ] as const)('the %s reads its node status, skips the unchanged and the absent', (_name, make, a, b, nodeId) => {
    let out: unknown = undefined;
    const engine = engineOf(() => out);
    const report = vi.fn();
    const tick = (make as (e: typeof engine, s: { report: typeof report }) => () => void)(engine, { report });
    tick();
    expect(report).not.toHaveBeenCalled();
    out = a;
    tick();
    tick();
    out = { ...a };
    tick();
    expect(report).toHaveBeenCalledTimes(1);
    out = b;
    tick();
    expect(report).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenLastCalledWith(b);
    expect(engine.getOutput).toHaveBeenCalledWith(nodeId, 'status');
  });

  it('the status stores report and reset', () => {
    for (const [store, live] of [
      [useChordMapStatus, map({ chord: 'C' })],
      [useChordWheelStatus, wheel({ chord: 'C' })],
      [useChordChartStatus, chart({ chord: 'C' })],
    ] as const) {
      const s = store as unknown as { getState(): { live: unknown; report(l: unknown): void; reset(): void } };
      const idle = s.getState().live;
      s.getState().report(live);
      expect(s.getState().live).toBe(live);
      s.getState().reset();
      expect(s.getState().live).toBe(idle);
    }
  });
});
