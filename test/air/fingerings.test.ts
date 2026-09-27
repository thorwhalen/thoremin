/**
 * The fingering charts (#263): the notation parses, every chart is a contiguous
 * chromatic (or, for the whistle, diatonic) run with no duplicate rows, and the facts a
 * flautist would check hold: the second octave repeats the first from E, D and D# lift
 * the left index, the clarinet's clarion is the chalumeau's twelfth with the register key.
 */
import { describe, expect, it } from 'vitest';
import {
  ALTO_SAX_CHART,
  CLARINET_CHART,
  FINGERING_CHARTS,
  FLUTE_CHART,
  OBOE_CHART,
  RECORDER_BAROQUE_CHART,
  RECORDER_GERMAN_CHART,
  WHISTLE_D_CHART,
  chartNotes,
  distinctFingerings,
  fingerStates,
  fingeringFor,
  fingeringKey,
  parseFingers,
} from '@/music/fingerings';
import { parseNoteName } from '@/music/notes';

describe('the notation', () => {
  it('reads both hands, in any order, ignoring fillers', () => {
    expect(parseFingers('T123|12-4')).toEqual(['LT', 'L1', 'L2', 'L3', 'R1', 'R2', 'R4']);
    expect(parseFingers('-3-1|4')).toEqual(['L3', 'L1', 'R4']);
    expect(parseFingers('|')).toEqual([]);
    expect(parseFingers('T T|1 1')).toEqual(['LT', 'R1']);
    expect(() => parseFingers('T123')).toThrow(/two hands/);
    expect(() => parseFingers('T5|')).toThrow(/unknown finger/);
  });

  it('states every finger, and keys a shape by its sorted down set', () => {
    const states = fingerStates({ down: ['R4', 'LT'] });
    expect(states.LT).toBe('down');
    expect(states.R4).toBe('down');
    expect(states.L1).toBe('up');
    expect(Object.keys(states)).toHaveLength(9);
    expect(fingeringKey({ down: ['R4', 'LT'] })).toBe(fingeringKey({ down: ['LT', 'R4'] }));
  });
});

describe('every chart', () => {
  for (const chart of Object.values(FINGERING_CHARTS)) {
    it(`${chart.id}: parses, has no duplicate notes, and is sorted by chartNotes`, () => {
      const midis = chart.fingerings.map((x) => x.midi);
      expect(new Set(midis).size).toBe(midis.length);
      for (const x of chart.fingerings) expect(parseNoteName(x.note)?.midi).toBe(x.midi);
      const sorted = chartNotes(chart);
      expect(sorted.map((x) => x.midi)).toEqual([...midis].sort((a, b) => a - b));
      expect(distinctFingerings(chart).length).toBeGreaterThan(0);
    });
  }

  it('the chromatic charts have no gaps (the recorders skip C6 and C#6, which charts disagree on)', () => {
    for (const chart of [FLUTE_CHART, CLARINET_CHART, ALTO_SAX_CHART]) {
      const midis = chartNotes(chart).map((x) => x.midi);
      for (let i = 1; i < midis.length; i++) expect(midis[i] - midis[i - 1]).toBe(1);
    }
    for (const chart of [RECORDER_BAROQUE_CHART, RECORDER_GERMAN_CHART]) {
      const notes = chartNotes(chart).map((x) => x.note);
      expect(notes.indexOf('D6') - notes.indexOf('B5')).toBe(1);
      expect(notes).not.toContain('C6');
    }
  });
});

describe('the flute chart', () => {
  it('runs C4 to C7, repeats the first octave from E, and lifts the left index for D5 and D#5', () => {
    expect(chartNotes(FLUTE_CHART)[0].note).toBe('C4');
    expect(chartNotes(FLUTE_CHART).at(-1)!.note).toBe('C7');
    for (const n of ['E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']) {
      expect(fingeringKey(fingeringFor(FLUTE_CHART, `${n}5`)!)).toBe(fingeringKey(fingeringFor(FLUTE_CHART, `${n}4`)!));
    }
    expect(fingeringKey(fingeringFor(FLUTE_CHART, 'C6')!)).toBe(fingeringKey(fingeringFor(FLUTE_CHART, 'C5')!));
    const d4 = fingeringFor(FLUTE_CHART, 'D4')!;
    const d5 = fingeringFor(FLUTE_CHART, 'D5')!;
    expect(d4.down).toContain('L1');
    expect(d5.down).not.toContain('L1');
    expect(d5.down.filter((f) => f !== 'L1')).toEqual(d4.down.filter((f) => f !== 'L1'));
    // Enharmonics find the same row.
    expect(fingeringFor(FLUTE_CHART, 'Eb5')).toBe(fingeringFor(FLUTE_CHART, 'D#5'));
    expect(fingeringFor(FLUTE_CHART, 'Gb4')?.down).toContain('R3');
    expect(fingeringFor(FLUTE_CHART, 'A#4')?.alternates.map((a) => a.name)).toContain('one and one');
    expect(fingeringFor(FLUTE_CHART, 'C8')).toBeNull();
  });

  it('shows the pinky Eb key down on every note but D, C and C#', () => {
    for (const x of chartNotes(FLUTE_CHART, ['C4', 'C#6'])) {
      const pc = x.midi % 12;
      const isD = pc === 2;
      const isLowCs = x.midi <= parseNoteName('C#4')!.midi;
      expect(x.keys.includes('Eb key')).toBe(!isD && !isLowCs);
    }
  });
});

describe('the other winds', () => {
  it('the clarinet clarion is the chalumeau a twelfth below plus the register key', () => {
    for (const x of chartNotes(CLARINET_CHART, ['B4', 'C6'])) {
      const below = fingeringFor(CLARINET_CHART, x.midi - 19)!;
      expect(x.keys).toContain('register key');
      expect(x.down.filter((f) => f !== 'LT')).toEqual(below.down.filter((f) => f !== 'LT'));
      expect(x.down).toContain('LT');
    }
    expect(CLARINET_CHART.transposition).toBe(-2);
  });

  it('the two recorder systems differ only at F and F#', () => {
    const b = chartNotes(RECORDER_BAROQUE_CHART);
    const g = chartNotes(RECORDER_GERMAN_CHART);
    expect(b.map((x) => x.note)).toEqual(g.map((x) => x.note));
    const differ = b.filter((x, i) => fingeringKey(x) !== fingeringKey(g[i])).map((x) => x.note);
    expect(differ).toEqual(['F5', 'F#5', 'F6', 'F#6']);
    // The German F is the plain one: right index only; the baroque F is the fork.
    expect(fingeringFor(RECORDER_GERMAN_CHART, 'F5')!.down).toEqual(['LT', 'L1', 'L2', 'L3', 'R1']);
    expect(fingeringFor(RECORDER_BAROQUE_CHART, 'F5')!.down).toEqual(['LT', 'L1', 'L2', 'L3', 'R1', 'R3', 'R4']);
    expect(fingeringFor(RECORDER_BAROQUE_CHART, 'F#5')!.down).toEqual(['LT', 'L1', 'L2', 'L3', 'R2', 'R3']);
    // The second octave pinches the thumb; Bb and B are their own forks up there.
    expect(fingeringFor(RECORDER_BAROQUE_CHART, 'G6')!.keys[0]).toMatch(/pinched/);
    expect(fingeringFor(RECORDER_BAROQUE_CHART, 'A#6')!.down).toEqual(['LT', 'L1', 'L3', 'R1', 'R2', 'R3']);
  });

  it('the sax reaches its low notes with the little fingers, and the oboe forks its F', () => {
    expect(fingeringFor(ALTO_SAX_CHART, 'Bb3')!.down).toEqual(['LT', 'L1', 'L2', 'L3', 'L4', 'R1', 'R2', 'R3', 'R4'].filter((f) => f !== 'LT'));
    expect(fingeringFor(ALTO_SAX_CHART, 'C4')!.down).toContain('R4');
    expect(fingeringFor(ALTO_SAX_CHART, 'D5')!.down).toContain('LT');
    expect(fingeringFor(OBOE_CHART, 'D4')!.down).toEqual(['L1', 'L2', 'L3', 'R1', 'R2', 'R3']);
    expect(fingeringFor(OBOE_CHART, 'F#4')!.down).toEqual(['L1', 'L2', 'L3', 'R1']);
    expect(fingeringFor(OBOE_CHART, 'F4')!.alternates[0].name).toBe('forked F');
    expect(fingeringFor(OBOE_CHART, 'C5')!.down).toEqual(['L1', 'R1']);
    // The second octave's fingers are the first's, plus the octave keys.
    for (const n of ['E', 'F#', 'G', 'A', 'B']) {
      const lo = fingeringFor(OBOE_CHART, `${n}4`)!.down.filter((f) => f !== 'LT');
      const hi = fingeringFor(OBOE_CHART, `${n}5`)!.down.filter((f) => f !== 'LT');
      expect(hi).toEqual(lo);
    }
  });

  it('the whistle and the sax main line share the six-finger scale from D', () => {
    const scale = ['D', 'E', 'F#', 'G', 'A', 'B', 'C#'];
    const whistle = scale.map((n) => fingeringKey(fingeringFor(WHISTLE_D_CHART, `${n}${n === 'C#' ? 6 : 5}`)!));
    const sax = scale.map((n) => fingeringKey(fingeringFor(ALTO_SAX_CHART, `${n}${n === 'C#' ? 5 : 4}`)!));
    // Every degree but F# (the sax forks it with R2, the whistle lifts to R1) and the
    // top C# match finger for finger.
    scale.forEach((n, i) => {
      if (n === 'F#') return;
      expect(sax[i]).toBe(whistle[i]);
    });
    expect(ALTO_SAX_CHART.transposition).toBe(-9);
  });
});
