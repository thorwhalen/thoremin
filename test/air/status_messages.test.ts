/**
 * What the air instruments tell the player (the bass, the flute, the guitar): the
 * `describe*Live` line for each state their nodes report, and the reporters that copy a node's
 * status into the view only when what the view shows changed. Each state must say something of
 * its own; the assertions name the fragment that matters rather than the whole sentence.
 */
import { describe, expect, it, vi } from 'vitest';
import { ABSENT_AIR_BASS_LIVE, describeBassLive, makeAirBassReporter, useAirBassStatus, type AirBassLive } from '@thoremin/ext-air/app/airBassStatus';
import { ABSENT_AIR_FLUTE_LIVE, describeFluteLive, makeAirFluteReporter, useAirFluteStatus, type AirFluteLive } from '@thoremin/ext-air/app/airFluteStatus';
import { ABSENT_AIR_GUITAR_LIVE, describeGuitarLive, makeAirGuitarReporter, useAirGuitarStatus, type AirGuitarLive } from '@thoremin/ext-air/app/airGuitarStatus';
import { ABSENT_AIR_DRUM_LIVE, makeAirDrumReporter, useAirDrumStatus, type AirDrumLive } from '@thoremin/ext-air/app/airDrumStatus';

const bass = (s: Partial<AirBassLive>): AirBassLive => ({ ...ABSENT_AIR_BASS_LIVE, enabled: true, ...s });
const flute = (s: Partial<AirFluteLive>): AirFluteLive => ({ ...ABSENT_AIR_FLUTE_LIVE, enabled: true, ...s });
const guitar = (s: Partial<AirGuitarLive>): AirGuitarLive => ({ ...ABSENT_AIR_GUITAR_LIVE, enabled: true, ...s });

const expectDistinct = (lines: string[]) => expect(new Set(lines).size).toBe(lines.length);

describe('the air bass tells the player', () => {
  const on = { fretting: true, fretMidi: 40 };
  const cases: [Partial<AirBassLive>, RegExp][] = [
    [{ enabled: false }, /^Off\./],
    [{ fretting: false }, /Show both hands/],
    [{ fretting: true, fretMidi: null }, /No note on the neck/],
    [on, /Pluck down once/],
    [{ ...on, ready: true }, /^Ready\. Slide along the neck/],
    [{ ...on, ready: true, notes: 3, lastMidi: 40, lastLead: 0.021 }, /^E2: predicted 21 ms before the pluck/],
    [{ ...on, ready: true, notes: 3, lastMidi: 40, lastLead: -0.008 }, /^E2: sounded 8 ms after the pluck/],
  ];
  it.each(cases)('%o', (state, line) => expect(describeBassLive(bass(state))).toMatch(line));
  it('says something different in every state', () => expectDistinct(cases.map(([s]) => describeBassLive(bass(s)))));
});

describe('the air flute tells the player', () => {
  const on = { knownFingers: 4, mouthReady: true, hands: true };
  const cases: [Partial<AirFluteLive>, RegExp][] = [
    [{ enabled: false }, /^Off\./],
    [{ knownFingers: 0 }, /Teach it your fingerings first/],
    [{ knownFingers: 4, breath: 'mouth', mouthReady: false }, /Teach it your blowing and resting mouth/],
    [{ knownFingers: 4, breath: 'always', hands: false }, /Show both hands/],
    [{ ...on, breath: 'always' }, /Make one of your fingerings/],
    [{ ...on, breath: 'always', note: 'low', playable: false }, /"low" is not a note name/],
    [{ ...on, breath: 'mouth', note: 'D5', playable: true, face: false }, /^D5\. Face the camera/],
    [{ ...on, breath: 'mouth', note: 'D5', playable: true, face: true }, /^D5\. Blow to play it\.$/],
    [{ ...on, breath: 'always', note: 'D5', playable: true }, /^D5\.$/],
    [{ ...on, breath: 'mouth', note: 'D5', playable: true, face: true, sounding: true }, /^D5, sounding\.$/],
  ];
  it.each(cases)('%o', (state, line) => expect(describeFluteLive(flute(state))).toMatch(line));
  it('says something different in every state', () => expectDistinct(cases.map(([s]) => describeFluteLive(flute(s)))));
});

describe('the air guitar tells the player', () => {
  const on = { known: 3, fretting: true, chord: 'G', playable: true };
  const cases: [Partial<AirGuitarLive>, RegExp][] = [
    [{ enabled: false }, /^Off\./],
    [{ known: 0 }, /Teach it your chords first/],
    [{ known: 3, fretting: true, chord: null }, /Make one of your chord shapes/],
    [{ known: 3, fretting: false, chord: null }, /Show your chord hand/],
    [{ ...on, fretting: false }, /Holding G \(chord hand out of view\)/],
    [{ ...on, chord: 'Gx', playable: false }, /"Gx" is not a chord name/],
    [on, /^G\. Strum down once/],
    [{ ...on, ready: true }, /^G\. Strum\.$/],
    [{ ...on, ready: true, strums: 1, lastChord: 'G', lastLead: 0.015 }, /Last strum \(G\) predicted 15 ms ahead/],
    [{ ...on, ready: true, strums: 1, lastChord: 'G', lastLead: -0.03 }, /Last strum \(G\) sounded 30 ms late/],
  ];
  it.each(cases)('%o', (state, line) => expect(describeGuitarLive(guitar(state))).toMatch(line));
  it('says something different in every state', () => expectDistinct(cases.map(([s]) => describeGuitarLive(guitar(s)))));
});

describe('the air instruments report to the view only on a change', () => {
  it.each([
    ['bass', makeAirBassReporter, bass({ notes: 1 }), bass({ notes: 2 }), 'airBass'],
    ['flute', makeAirFluteReporter, flute({ note: 'D5' }), flute({ note: 'E5' }), 'airFlute'],
    ['guitar', makeAirGuitarReporter, guitar({ chord: 'G' }), guitar({ chord: 'C' }), 'airGuitar'],
    ['drum', makeAirDrumReporter, { ...ABSENT_AIR_DRUM_LIVE, enabled: true, hits: 1 }, { ...ABSENT_AIR_DRUM_LIVE, enabled: true, hits: 2 }, 'airDrum'],
  ] as const)('the %s reads its node status, skips the unchanged and the absent', (_name, make, a, b, nodeId) => {
    let out: unknown = undefined;
    const engine = { getOutput: vi.fn((_id: string, _port: string) => out) };
    const report = vi.fn();
    const tick = (make as (e: typeof engine, s: { report: typeof report }) => () => void)(engine, { report });
    tick();
    out = a;
    tick();
    out = structuredClone(a);
    tick();
    expect(report).toHaveBeenCalledTimes(1);
    out = b;
    tick();
    expect(report).toHaveBeenLastCalledWith(b);
    expect(report).toHaveBeenCalledTimes(2);
    expect(engine.getOutput).toHaveBeenCalledWith(nodeId, 'status');
  });

  it('the status stores report and reset', () => {
    for (const [store, live] of [
      [useAirBassStatus, bass({ notes: 1 })],
      [useAirFluteStatus, flute({ note: 'D5' })],
      [useAirGuitarStatus, guitar({ chord: 'G' })],
      [useAirDrumStatus, { ...ABSENT_AIR_DRUM_LIVE, hits: 1 } as AirDrumLive],
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
