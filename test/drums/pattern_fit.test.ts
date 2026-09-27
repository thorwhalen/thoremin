/**
 * Drum patterns as data and the pattern fit (#269), on a synthetic player: a pattern
 * played four times with a tempo drift, a per-event feel, per-drum positions and hit
 * jitter (self-made, safe to commit). The fit recovers the tempo, the feel where it is a
 * habit, the pads; an extra hit and a missed event are counted; a take of nothing is
 * null. Then the starters compile to what a drummer would read off them.
 */
import { describe, expect, it } from 'vitest';
import { DRUM_PATTERNS, compilePattern, eventTime, patternById, type DrumPattern } from '@/music/drum_patterns';
import { DRUM_SOUND, drumNameForGmNote, soundForGmNote } from '@/music/gm_drums';
import { assignHits, fitPattern, patternDrums, playbackOffset, playbackPad, type HitSample } from '@/drums/pattern_fit';
import type { PadId } from '@/nodes/music/drum_pads';

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r: () => number, sd: number) => (r() + r() + r() - 1.5) * sd * 1.41;

interface Player {
  /** Tempo at the start, and its change per pass (bpm per pass, negative = slowing). */
  bpm: number;
  driftPerPass: number;
  /** Feel per event index, beats (positive = late). */
  feel: Record<number, number>;
  /** Timing jitter, beats. */
  jitter: number;
  /** The pad and centre the player uses per drum. */
  pads: Record<string, { pad: PadId; x: number; y: number }>;
  /** Position jitter, frame fractions. */
  wobble: number;
}

const ROCK = patternById('rock')!;
const PLAYER: Player = {
  bpm: 96,
  driftPerPass: -1.5,
  // The snare late by a twentieth of a beat (events 3 and 9 in the rock beat: snare@1
  // and snare@3), the first two off-beat hi-hats (events 2 and 5) pushed early.
  feel: { 3: 0.05, 9: 0.05, 2: -0.03, 5: -0.03 },
  jitter: 0.012,
  pads: { kick: { pad: 'p6', x: 0.5, y: 0.82 }, snare: { pad: 'p1', x: 0.52, y: 0.7 }, hihat: { pad: 'p2', x: 0.27, y: 0.58 } },
  wobble: 0.01,
};

/** A take: the pattern played `passes` times from `start`, by `p`. Returns the hits and
 *  the mean tempo actually played. */
function take(pattern: DrumPattern, p: Player, passes: number, start: number, seed: number, mutate?: (hits: HitSample[]) => void): { hits: HitSample[]; meanBpm: number } {
  const r = rng(seed);
  const hits: HitSample[] = [];
  let t0 = start;
  const bpms: number[] = [];
  for (let pass = 0; pass < passes; pass++) {
    const bpm = p.bpm + p.driftPerPass * pass;
    bpms.push(bpm);
    const period = 60 / bpm;
    for (const e of pattern.events) {
      const pos = p.pads[e.drum];
      hits.push({
        t: t0 + (e.beat + (p.feel[e.index] ?? 0) + gauss(r, p.jitter)) * period,
        sound: e.sound,
        pad: pos.pad,
        x: pos.x + gauss(r, p.wobble),
        y: pos.y + gauss(r, p.wobble),
      });
    }
    t0 += pattern.lengthBeats * period;
  }
  hits.sort((a, b) => a.t - b.t);
  mutate?.(hits);
  return { hits, meanBpm: bpms.reduce((a, b) => a + b, 0) / bpms.length };
}

describe('the pattern fit', () => {
  it("recovers the player's tempo, feel and pads from four passes with a drift", () => {
    const { hits, meanBpm } = take(ROCK, PLAYER, 4, 2.3, 7);
    const model = fitPattern(hits, ROCK, { statedBpm: 96, takenAt: 1 })!;
    expect(model).not.toBeNull();
    expect(Math.abs(model.bpm - meanBpm)).toBeLessThan(1);
    expect(model.passes).toBe(4);
    expect(model.recall).toBe(1);
    expect(model.precision).toBe(1);
    // The snare's lateness is a habit: mean clears the spread, and playback keeps it.
    expect(model.feel['3'].n).toBe(4);
    expect(model.feel['3'].offset).toBeGreaterThan(0.02);
    expect(Math.abs(model.feel['3'].offset - 0.05)).toBeLessThan(0.03);
    expect(playbackOffset(model, 3)).not.toBe(0);
    expect(model.feel['2'].offset).toBeLessThan(-0.01);
    // The kick on one has no habit (offset within the jitter): plays on the grid.
    expect(Math.abs(model.feel['0'].offset)).toBeLessThan(0.03);
    expect(Math.abs(playbackOffset(model, 0))).toBeLessThan(0.03);
    // The pads the player used, and where on them.
    expect(model.positions.kick.pad).toBe('p6');
    expect(model.positions.snare.pad).toBe('p1');
    expect(model.positions.hihat.pad).toBe('p2');
    expect(model.positions.snare.centre!.x).toBeCloseTo(0.52, 1);
    expect(playbackPad(model, 'snare')).toBe('p1');
    expect(playbackPad(model, 'crash')).toBeNull();
    expect(model.patternId).toBe('rock');
    expect(model.statedBpm).toBe(96);
  });

  it('finds the pattern phase whatever beat the take starts on, and a tempo well off the stated one', () => {
    // Started late, and played at 88 against a stated 96.
    const slow = { ...PLAYER, bpm: 88, driftPerPass: 0 };
    const { hits } = take(ROCK, slow, 3, 5.7, 3);
    const model = fitPattern(hits, ROCK, { statedBpm: 96 })!;
    expect(model).not.toBeNull();
    expect(Math.abs(model.bpm - 88)).toBeLessThan(1);
    expect(model.recall).toBe(1);
  });

  it('counts an extra hit and a missed event, and refuses a take of nothing', () => {
    const { hits } = take(ROCK, { ...PLAYER, driftPerPass: 0 }, 4, 1, 11, (h) => {
      // Drop one snare (event 3, snare@1, of pass 1) and add a stray hit between beats.
      const period = 60 / 96;
      const t = 1 + (1 * ROCK.lengthBeats + ROCK.events[3].beat) * period;
      const i = h.findIndex((x) => x.sound === 'snare' && Math.abs(x.t - t) < 0.1);
      expect(i).toBeGreaterThanOrEqual(0);
      h.splice(i, 1);
      h.push({ t: 1 + 2.62 * period, sound: 'tom', pad: 'p3' });
      h.sort((a, b) => a.t - b.t);
    });
    const model = fitPattern(hits, ROCK, { statedBpm: 96 })!;
    const total = ROCK.events.length * 4;
    expect(model.recall).toBeCloseTo((total - 1) / total, 6);
    expect(model.precision).toBeCloseTo((total - 1) / total, 6);
    expect(model.feel['3'].n).toBe(3);
    expect(fitPattern([], ROCK)).toBeNull();
    expect(fitPattern([{ t: 1 }, { t: 2 }], ROCK)).toBeNull();
  });

  it('assigns each hit to one event, same sound first, one hit per event per pass', () => {
    const period = 60 / 96;
    const kickAt = (pass: number) => eventTime(ROCK, ROCK.events[0], pass, 96, 0);
    const hits: HitSample[] = [
      { t: kickAt(0) + 0.01, sound: 'kick' },
      { t: kickAt(0) + 0.02, sound: 'hihat' }, // the hi-hat on one, same instant
      { t: kickAt(1) - 0.02, sound: 'kick' },
      { t: kickAt(1) - 0.01, sound: 'kick' }, // a flam: the second kick has no event
    ];
    const a = assignHits(hits, ROCK, period, 0);
    expect(a.map((x) => [x.hit, ROCK.events[x.event].drum, x.pass])).toEqual([
      [0, 'kick', 0],
      [1, 'hihat', 0],
      [3, 'kick', 1],
    ]);
  });
});

describe('the starters', () => {
  it('compile to events a drummer would read off the grid, and to a percussion score', () => {
    expect(DRUM_PATTERNS.length).toBeGreaterThanOrEqual(5);
    expect(ROCK.steps).toBe(16);
    expect(ROCK.lengthBeats).toBe(4);
    expect(ROCK.events.map((e) => `${e.drum}@${e.beat}`)).toEqual([
      'kick@0',
      'hihat@0',
      'hihat@0.5',
      'snare@1',
      'hihat@1',
      'hihat@1.5',
      'kick@2',
      'hihat@2',
      'hihat@2.5',
      'snare@3',
      'hihat@3',
      'hihat@3.5',
    ]);
    expect(patternDrums(ROCK)).toEqual(['kick', 'snare', 'hihat']);
    expect(ROCK.score.parts[0].percussion).toBe(true);
    expect(ROCK.score.parts[0].notes[0]).toMatchObject({ midi: 36, start: 0 });
    expect(ROCK.score.tempoMap[0].bpm).toBe(96);
    const fill = patternById('fill')!;
    expect(fill.steps).toBe(32);
    expect(fill.lengthBeats).toBe(8);
    expect(fill.events.at(-1)).toMatchObject({ drum: 'crash', beat: 7.75 });
    expect(fill.events.find((e) => e.accent)).toMatchObject({ drum: 'snare', beat: 7.5 });
    expect(new Set(DRUM_PATTERNS.map((p) => p.id)).size).toBe(DRUM_PATTERNS.length);
  });

  it('rejects a ragged or misspelt grid', () => {
    expect(() => compilePattern({ id: 'x', name: 'x', bpm: 90, rows: { kick: 'x...', snare: 'x.....' } })).toThrow(/steps/);
    expect(() => compilePattern({ id: 'x', name: 'x', bpm: 90, rows: { kick: 'x..o' } })).toThrow(/unknown step/);
    expect(() => compilePattern({ id: 'x', name: 'x', bpm: 90, rows: { bongo: 'x...' } as never })).toThrow(/unknown drum/);
    expect(() => compilePattern({ id: 'x', name: 'x', bpm: 90, rows: {} })).toThrow(/no steps/);
  });

  it('maps General MIDI drums onto the kit', () => {
    expect(soundForGmNote(36)).toBe('kick');
    expect(soundForGmNote(46)).toBe('hihat');
    expect(soundForGmNote(75)).toBeNull();
    expect(drumNameForGmNote(38)).toBe('snare');
    expect(drumNameForGmNote(40)).toBe('snare');
    expect(drumNameForGmNote(45)).toBe('tom');
    expect(DRUM_SOUND.openHihat).toBe('hihat');
  });
});
