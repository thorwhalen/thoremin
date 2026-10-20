/**
 * The chord chart's word to a player who has conducting on and has not beaten yet. The conductor
 * leads the score only from its first stroke (nothing is held on beat 0 before the downbeat), so
 * the chart's `leads` is false then; its status reads the conductor's own dial for "conducting is
 * on", and says "conduct", not "turn conducting on".
 */
import { describe, expect, it } from 'vitest';
import { chordChartNode, type ChordChartStatus } from '@thoremin/ext-harmony/nodes/chord_chart';
import { describeChordChartLive } from '@thoremin/ext-harmony/app/chordChartStatus';
import type { ScoreDoc } from '@thoremin/sdk/score/schema';
import { HARMONY } from '../helpers/extensions';

const note = (midi: number, start: number) => ({ midi, start, duration: 2, velocity: 0.8 });
const DOC = {
  v: 1,
  title: 'chart',
  source: 'builtin',
  parts: [{ name: 'keys', program: 0, percussion: false, notes: [48, 52, 55].map((m) => note(m, 0)).concat([53, 57, 60].map((m) => note(m, 2))) }],
  tempoMap: [],
  timeSignatures: [],
  dynamics: [],
  fermatas: [],
  lengthBeats: 4,
} as unknown as ScoreDoc;

const WAITING = { t: 0, beat: 0, tempo: 0, state: 'ready' };

function statusOf(inputs: Record<string, unknown>): ChordChartStatus {
  const h = chordChartNode.make(chordChartNode.params.parse({ enabled: true }));
  return (h.process({ doc: DOC, time: WAITING, ...inputs }, { tick: 0, time: 0, dt: 1 / 30, resources: {} } as never) as { status: ChordChartStatus }).status;
}

describe.runIf(HARMONY)('the chord chart before the first stroke', () => {
  it('conducting on, no stroke yet: says to conduct, and plays nothing', () => {
    const s = statusOf({ leads: false, conductor: { enabled: true, conducts: 'score' } });
    expect(s.conducting).toBe(true);
    expect(s.running).toBe(false);
    expect(describeChordChartLive(s)).toMatch(/starts on your downbeat/);
  });

  it('conducting off, or leading a recording: says to turn it on', () => {
    for (const conductor of [{ enabled: false }, { enabled: true, conducts: 'recording' }, undefined]) {
      const s = statusOf({ leads: false, conductor });
      expect(s.conducting, JSON.stringify(conductor)).toBe(false);
      expect(describeChordChartLive(s)).toMatch(/Turn conducting on/);
    }
  });
});
