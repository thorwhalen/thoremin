/**
 * #920's follow-ups of the player's own tension (#809): coverage, the captions' model, a label's fit.
 *
 * - A degree whose move from the tonic is unrated is estimated from the player's rated moves INTO it
 *   (still the player's number, `isRated`), and the practice covers the moves from the tonic first.
 * - The computed captions' "darker / brighter" reads the model the chord map's `captionTension`
 *   names, the player's own included, through the SDK's one chooser (the wheel's too).
 * - A cell's label and sub-line are narrowed to the cell (`fillText`'s max width).
 */
import { describe, it, expect } from 'vitest';
import { diatonicChords, keyOf } from '@thoremin/sdk/harmony/chord';
import { moveKey, movesOf, nextMoveToRate, type RatingsTable } from '@thoremin/sdk/harmony/ratings';
import { computedCaptions } from '@thoremin/sdk/harmony/captions';
import { createTensionChooser, ratedTensionModel, tensionChoiceName, TENSION_CHOICES, TENSION_MODELS } from '@thoremin/sdk/harmony/tension';
import { drawCellGrid } from '@thoremin/sdk/nodes/cell_grid_draw';
import { createPathFollower } from '@thoremin/ext-harmony/lib/map_paths';
import { diatonicChords as mapChords } from '@thoremin/ext-harmony/lib/chord_map';
import { makeRecordingCanvas } from '../helpers/canvas';

const C = keyOf({ root: 0, type: 'major' });
const rating = (tension: number, n = 1) => ({ valence: 0, tension, n });

describe('the player\'s tension covers a degree from the moves into it (#920)', () => {
  const [, , , , V, vi] = diatonicChords(C);
  // Rated: ii -> V (tense, twice) and IV -> V (settled, once); nothing from the tonic to V.
  const table: RatingsTable = { [moveKey('major', 1, 4)]: rating(0.8, 2), [moveKey('major', 3, 4)]: rating(-0.4) };

  it('estimates V from the rated moves into it, weighted by how often each was rated, as the player\'s', () => {
    const model = ratedTensionModel(table, TENSION_MODELS.tps);
    const only = ratedTensionModel({ [moveKey('major', 0, 4)]: rating((0.8 * 2 - 0.4) / 3) }, TENSION_MODELS.tps);
    expect(model.isRated(V, C)).toBe(true);
    expect(model.tension(V, C)).toBe(only.tension(V, C));
    // A degree no rated move reaches is the fallback's.
    expect(model.isRated(vi, C)).toBe(false);
    expect(model.tension(vi, C)).toBe(TENSION_MODELS.tps.tension(vi, C));
  });

  it('the move from the tonic wins over the estimate, and intoDegree: false keeps only it', () => {
    const own = { ...table, [moveKey('major', 0, 4)]: rating(-1) };
    expect(ratedTensionModel(own, TENSION_MODELS.tps).tension(V, C)).toBe(ratedTensionModel({ [moveKey('major', 0, 4)]: rating(-1) }, TENSION_MODELS.tps).tension(V, C));
    expect(ratedTensionModel(table, TENSION_MODELS.tps, { intoDegree: false }).isRated(V, C)).toBe(false);
  });

  it('the practice asks for the six moves from the tonic first, then any least-rated move', () => {
    let t: RatingsTable = {};
    const asked: string[] = [];
    for (let i = 0; i < 6; i++) {
      const m = nextMoveToRate(t, 'major', { random: () => 0.5 });
      asked.push(`${m.from}>${m.to}`);
      t = { ...t, [moveKey('major', m.from, m.to)]: rating(0) };
    }
    expect(asked.every((a) => a.startsWith('0>'))).toBe(true);
    expect(new Set(asked).size).toBe(6);
    expect(nextMoveToRate(t, 'major', { random: () => 0 }).from).not.toBe(0);
    // Without a first set, uniform over every least-rated move from the start.
    const any = new Set(Array.from({ length: 42 }, (_, i) => nextMoveToRate({}, 'major', { random: () => i / 42, first: () => false })).map((m) => `${m.from}>${m.to}`));
    expect(any.size).toBe(movesOf('major').length);
  });
});

describe('the captions read the chosen tension model (#920)', () => {
  it('one chooser for every display: a named model, or the player\'s own rebuilt only when the ratings change', () => {
    const choose = createTensionChooser();
    const table: RatingsTable = { [moveKey('major', 0, 4)]: rating(1) };
    expect(choose('tps', table)).toBe(TENSION_MODELS.tps);
    const mine = choose('rated', table);
    expect(mine.id).toBe('rated');
    expect(choose('rated', table)).toBe(mine);
    expect(choose('rated', { ...table })).not.toBe(mine);
    expect(TENSION_CHOICES.map((c) => tensionChoiceName(c))).toEqual([...TENSION_CHOICES.slice(0, -1).map((c) => TENSION_MODELS[c as 'tps'].name), mine.name]);
  });

  it('the chord map\'s captions say resolving or opening by the chosen model, and nothing of it when off', () => {
    const table: RatingsTable = { [moveKey('major', 0, 4)]: rating(1) };
    const spec = { root: 0, type: 'major' as const, octaves: 2, baseOctave: 3 };
    const follower = createPathFollower();
    const frame = { idiom: 'none', captionSet: 'computed' as const, trailSteps: 0, spec, chords: mapChords(spec), shown: 0, ratings: table };
    const words = (m: ((a: number, b: number) => string | undefined) | undefined) => [1, 2, 3, 4, 5, 6].map((d) => m?.(0, d) ?? '').join(' | ');
    const off = words(follower.push(frame).moveText);
    const mine = words(follower.push({ ...frame, captionTension: 'rated' }).moveText);
    expect(off).not.toMatch(/resolving|opening/);
    expect(mine).toMatch(/resolving|opening/);
    expect(computedCaptions({ tension: createTensionChooser()('rated', table), parts: ['direction'] }).models).toEqual([tensionChoiceName('rated')]);
  });
});

describe('a cell\'s label fits its cell (#920)', () => {
  it('the label and the sub-line are drawn with the cell\'s width as their limit', () => {
    const W = 400;
    const H = 300;
    const rec = makeRecordingCanvas(W, H);
    const g = rec.canvas.getContext('2d') as CanvasRenderingContext2D;
    drawCellGrid(g, W, H, { cells: [{ x: 0.5, y: 0.5, w: 0.1, h: 0.2, label: 'V7/vi 6.4 (you)', sub: 'a long second line', color: '#fff', state: 'idle' }], captions: [], pointers: [] } as never);
    const texts = rec.calls.filter((c) => c.m === 'fillText');
    expect(texts.map((c) => c.args[3])).toEqual([0.1 * W * 0.9, 0.1 * W * 0.9]);
  });
});
