/**
 * The player's own tension model (#809): the tension rated for the move from the key's home chord
 * to a chord ("Rate this move", #715), placed on a named fallback's scale so a rated chord and an
 * unrated one rank together; every chord the ratings do not cover is the fallback's.
 *
 * Then on the chord wheel: `tension: rated` with the ratings on the node's `ratings` input shows
 * the player's number under a rated chord, the fallback's under the others, and names both.
 */
import { describe, it, expect } from 'vitest';
import { diatonicChords, keyOf, type Chord } from '@thoremin/sdk/harmony/chord';
import { moveKey, type RatingsTable } from '@thoremin/sdk/harmony/ratings';
import { ratedTensionModel, TENSION_MODELS } from '@thoremin/sdk/harmony/tension';
import { chordWheelNode, RATED_TENSION_FALLBACK } from '@thoremin/ext-harmony/nodes/chord_wheel';
import type { ScaleSpec } from '@thoremin/sdk/music/theory';
import type { HandsFrame } from '@thoremin/sdk/nodes/domain';
import type { CellGrid } from '@thoremin/sdk/nodes/cell_grid';
import { W, H } from './synthetic_chord_map';

const C_MAJOR = keyOf({ root: 0, type: 'major' });
const A_MINOR = keyOf({ root: 9, type: 'minor' });
const tps = TENSION_MODELS.tps;
const rated = (r: Record<string, number>): RatingsTable => Object.fromEntries(Object.entries(r).map(([k, tension]) => [k, { valence: 0, tension, n: 1 }]));
/** The fallback's range over a key's seven chords. */
const range = (key: typeof C_MAJOR) => {
  const ts = diatonicChords(key).map((c) => tps.tension(c, key)!);
  return { lo: Math.min(...ts), hi: Math.max(...ts) };
};

describe('ratedTensionModel', () => {
  it('with no ratings, every chord is the fallback', () => {
    const m = ratedTensionModel({}, tps);
    for (const c of diatonicChords(C_MAJOR)) expect(m.tension(c, C_MAJOR)).toBe(tps.tension(c, C_MAJOR));
    const borrowed: Chord = { root: 10, quality: 'maj' } as Chord;
    expect(m.tension(borrowed, C_MAJOR)).toBe(tps.tension(borrowed, C_MAJOR));
  });

  it("places a rated move on the fallback's diatonic range: most tense at 1, least at -1, the middle at 0", () => {
    const { lo, hi } = range(C_MAJOR);
    const [, ii, , IV, V] = diatonicChords(C_MAJOR);
    const m = ratedTensionModel(rated({ [moveKey('major', 0, 4)]: 1, [moveKey('major', 0, 1)]: -1, [moveKey('major', 0, 3)]: 0 }), tps);
    expect(m.tension(V, C_MAJOR)).toBe(hi);
    expect(m.tension(ii, C_MAJOR)).toBe(lo);
    expect(m.tension(IV, C_MAJOR)).toBeCloseTo((lo + hi) / 2, 2);
    // The player hears V as tenser than ii, which Lerdahl's distance does not.
    expect(tps.tension(V, C_MAJOR)!).toBeLessThan(tps.tension(ii, C_MAJOR)!);
    expect(m.tension(V, C_MAJOR)!).toBeGreaterThan(m.tension(ii, C_MAJOR)!);
  });

  it('reads the key by degree and mode: a major rating holds in G, not in A minor; the home chord is never rated', () => {
    const G = keyOf({ root: 7, type: 'major' });
    const table = rated({ [moveKey('major', 0, 4)]: 1, [moveKey('major', 0, 0)]: 1 });
    const m = ratedTensionModel(table, tps);
    expect(m.tension(diatonicChords(G)[4], G)).toBe(range(G).hi);
    expect(m.tension(diatonicChords(A_MINOR)[4], A_MINOR)).toBe(tps.tension(diatonicChords(A_MINOR)[4], A_MINOR));
    expect(m.tension(diatonicChords(C_MAJOR)[0], C_MAJOR)).toBe(tps.tension(diatonicChords(C_MAJOR)[0], C_MAJOR));
  });

  it('is named as the player\'s, with its fallback beside it (short: it sits over the wheel)', () => {
    const m = ratedTensionModel({}, tps);
    expect(m.id).toBe('rated');
    expect(m.name).toBe("Your ratings, else Lerdahl's tonal pitch space");
  });

  it("applies a rating only to the chord the player heard: harmonic minor's V is not the rated v", () => {
    const harmonic = keyOf({ root: 9, type: 'minorHarmonic' });
    const table = rated({ [moveKey('minor', 0, 4)]: -1, [moveKey('minor', 0, 3)]: 1 });
    const m = ratedTensionModel(table, tps);
    const [, , , iv, V] = diatonicChords(harmonic);
    // E major in A harmonic minor: the player rated Em (natural minor's v), so Lerdahl speaks.
    expect(m.tension(V, harmonic)).toBe(tps.tension(V, harmonic));
    // iv (Dm) is the same chord in both minors: the rating holds.
    expect(m.tension(iv, harmonic)).toBe(range(harmonic).hi);
    // In natural minor the rated v is the player's.
    expect(m.tension(diatonicChords(A_MINOR)[4], A_MINOR)).toBe(range(A_MINOR).lo);
  });
});

describe('the chord wheel shows the rated tension (#809)', () => {
  const C: ScaleSpec = { root: 0, type: 'major' } as ScaleSpec;
  function grid(ratings: RatingsTable | undefined): CellGrid {
    const h = chordWheelNode.make(chordWheelNode.params.parse({}));
    let out: { grid: CellGrid } | undefined;
    for (let i = 0; i < 3; i++) {
      const frame: HandsFrame = { t: i / 30, width: W, height: H, hands: [] };
      out = h.process({ hands: frame, config: { enabled: true, mirrorHandedness: false, tension: 'rated' }, spec: C, octaveShift: 0, ratings }, { time: i / 30, dt: 1 / 30, tick: i, resources: {} } as never) as unknown as { grid: CellGrid };
    }
    return out!.grid;
  }

  it("a rated move shows the player's number, an unrated one the fallback's, and the caption names both", () => {
    const g = grid(rated({ [moveKey('major', 0, 4)]: 1 }));
    const fallback = TENSION_MODELS[RATED_TENSION_FALLBACK];
    expect(g.captions.map((c) => c.text)).toEqual([`Tension: ${ratedTensionModel({}, fallback).name}`]);
    const subOf = (label: string) => g.cells.find((c) => c.label === label)!.sub;
    expect(subOf('G')).toMatch(new RegExp(`· ${range(C_MAJOR).hi}$`));
    expect(subOf('F')).toMatch(new RegExp(`· ${fallback.tension(diatonicChords(C_MAJOR)[3], C_MAJOR)}$`));
    // No ratings at all: every number is the fallback's.
    const none = grid(undefined);
    expect(none.cells.find((c) => c.label === 'G')!.sub).toMatch(new RegExp(`· ${fallback.tension(diatonicChords(C_MAJOR)[4], C_MAJOR)}$`));
  });
});
