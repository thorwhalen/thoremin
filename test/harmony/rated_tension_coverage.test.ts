/**
 * #920's follow-ups of the player's own tension (#809): coverage, the captions' model, a label's fit.
 *
 * - The practice covers the moves from the tonic first (what the player's tension reads), and
 *   "Another move" still moves on among them; a move into a degree from elsewhere is never pooled.
 * - The computed captions' "darker / brighter" reads the model the chord map's `captionTension`
 *   names, the player's own included, through the SDK's one chooser (the wheel's too).
 * - A cell's label and sub-line are narrowed to the cell (`fillText`'s max width).
 */
import { describe, it, expect } from 'vitest';
import { diatonicChords, keyOf } from '@thoremin/sdk/harmony/chord';
import { moveKey, movesOf, nextMoveToRate, type RatingsTable } from '@thoremin/sdk/harmony/ratings';
import { computedCaptions } from '@thoremin/sdk/harmony/captions';
import { createTensionChooser, ratedTensionModel, TENSION_MODELS, TENSION_SETTING, tensionSettingName } from '@thoremin/sdk/harmony/tension';
import { drawCellGrid } from '@thoremin/sdk/nodes/cell_grid_draw';
import { createPathFollower } from '@thoremin/ext-harmony/lib/map_paths';
import { diatonicChords as mapChords } from '@thoremin/ext-harmony/lib/chord_map';
import { makeRecordingCanvas } from '../helpers/canvas';

const C = keyOf({ root: 0, type: 'major' });
const rating = (tension: number, n = 1) => ({ valence: 0, tension, n });

describe('the practice covers the moves the wheel reads first (#920)', () => {
  it('asks for the six moves from the tonic first, then any least-rated move', () => {
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

  it('"Another move" moves on, also when the move shown is the last tonic move unrated', () => {
    // Five tonic moves rated; 0>5 is the one left and is the move being skipped.
    const t: RatingsTable = Object.fromEntries([1, 2, 3, 4, 6].map((d) => [moveKey('major', 0, d), rating(0)]));
    for (const r of [0, 0.5, 0.99]) expect(nextMoveToRate(t, 'major', { random: () => r, avoid: { from: 0, to: 5 } })).not.toEqual({ mode: 'major', from: 0, to: 5 });
    // Two left: the skipped one is never offered again while the other is there.
    const two: RatingsTable = Object.fromEntries([1, 2, 3, 4].map((d) => [moveKey('major', 0, d), rating(0)]));
    for (const r of [0, 0.99]) expect(nextMoveToRate(two, 'major', { random: () => r, avoid: { from: 0, to: 5 } })).toEqual({ mode: 'major', from: 0, to: 6 });
  });

  it('a number marked the player\'s is one they gave: a move into V from elsewhere is not pooled in', () => {
    const [, , , , V] = diatonicChords(C);
    const model = ratedTensionModel({ [moveKey('major', 1, 4)]: rating(0.8) }, TENSION_MODELS.tps);
    expect(model.isRated(V, C)).toBe(false);
    expect(model.tension(V, C)).toBe(TENSION_MODELS.tps.tension(V, C));
  });
});

describe('the captions read the chosen tension model (#920)', () => {
  it('one chooser for every display: none for off, a named model, the player\'s rebuilt only on new ratings', () => {
    const choose = createTensionChooser();
    const table: RatingsTable = { [moveKey('major', 0, 4)]: rating(1) };
    expect(choose('off', table)).toBeNull();
    expect(choose('tps', table)).toBe(TENSION_MODELS.tps);
    const mine = choose('rated', table)!;
    expect(mine.id).toBe('rated');
    expect(choose('rated', table)).toBe(mine);
    expect(choose('rated', { ...table })).not.toBe(mine);
    expect(TENSION_SETTING.map((c) => tensionSettingName(c))).toEqual(['none', ...TENSION_SETTING.slice(1, -1).map((c) => TENSION_MODELS[c as 'tps'].name), mine.name]);
  });

  it('the chord map says resolving or opening by the player\'s ratings: the move to V turns with the rating', () => {
    const spec = { root: 0, type: 'major' as const, octaves: 2, baseOctave: 3 };
    const frame = { idiom: 'none', captionSet: 'computed' as const, trailSteps: 0, spec, chords: mapChords(spec), shown: 0 };
    const move = (from: number, to: number, tension: number, captionTension: 'off' | 'rated') =>
      createPathFollower().push({ ...frame, captionTension, ratings: { [moveKey('major', 0, 4)]: rating(tension) } }).moveText?.(from, to) ?? '';
    expect(move(0, 4, 1, 'off')).not.toMatch(/resolving|opening/);
    // V rated most tense: it opens from home and resolves back.
    expect(move(0, 4, 1, 'rated')).toMatch(/opening/);
    expect(move(4, 0, 1, 'rated')).toMatch(/resolving/);
    // Rated as settled as home: the player's model hears no direction either way.
    expect(move(0, 4, -1, 'rated')).not.toMatch(/resolving|opening/);
    const mine = createTensionChooser()('rated', {})!;
    expect(computedCaptions({ tension: mine, parts: ['direction'] }).models).toEqual([tensionSettingName('rated')]);
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
