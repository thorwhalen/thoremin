/**
 * The chord map's caption sets and ghost trails (#714, #713 PR B, library half): the computed
 * captions on the moves around the active cell (the letters map reading the key's chords), and an
 * idiom's way ahead drawn as a trail on the cells of its degrees.
 */
import { describe, it, expect } from 'vitest';
import { captionTextFor, chordMapGrid, diatonicChords, keyedCells, layoutCells, neighbourCaptions, trailPoints, type MapCell, type Region } from '@thoremin/ext-harmony/lib/chord_map';
import { INTERVAL_CAPTIONS, computedCaptions } from '@thoremin/sdk/harmony/captions';
import { ahead, idiomById, startFollow } from '@thoremin/sdk/harmony/idioms';
import { keyOf } from '@thoremin/sdk/harmony/chord';
import { drawCellGrid } from '@thoremin/sdk/nodes/cell_grid_draw';
import { CellGridSchema } from '@thoremin/sdk/nodes/cell_grid';
import { makeRecordingCanvas } from '../helpers/canvas';
import type { ScaleSpec } from '@thoremin/sdk/music/theory';

const key = (root: number, type: ScaleSpec['type']): ScaleSpec => ({ root, type, octaves: 2, baseOctave: 3 });
const LEFT: Region = { x0: 0, x1: 0.65, y0: 0.1, y1: 0.9 };
const cells = layoutCells('harmonic', LEFT, { aspect: 16 / 9, cellSize: 0.2 });
const centre = (d: number) => cells.findIndex((c) => c.degree === d && Math.abs(c.q) + Math.abs(c.r) <= 2);

describe('caption sets on the map', () => {
  const C = key(0, 'major');
  const chords = diatonicChords(C);

  it('keeps the interval captions by default and with the interval set', () => {
    const tonic = centre(0);
    const plain = neighbourCaptions('harmonic', cells[tonic]).map((c) => c.text);
    const viaSet = neighbourCaptions('harmonic', cells[tonic], 7, captionTextFor(INTERVAL_CAPTIONS, chords, keyOf(C))).map((c) => c.text);
    expect(viaSet).toEqual(plain);
  });

  it('shows the computed captions around the tonic', () => {
    const text = captionTextFor(computedCaptions(), chords, keyOf(C));
    expect(text(0, 3)).toBe('one held, expected'); // C to F
    expect(text(0, 2)).toBe('smooth, darker, surprising'); // C to Em
    expect(text(0, 0)).toBe(''); // no move
  });

  it('reads the key\'s chords on a letters map (A minor on the A cells)', () => {
    const am = key(9, 'minor');
    const amChords = diatonicChords(am);
    const keyed = keyedCells(cells, 'letters', am);
    const a = centre(5); // the A cell of the C layout is A minor's tonic
    expect(keyed[a].degree).toBe(0);
    const grid = chordMapGrid({ layout: 'harmonic', cells: keyed, laidOut: cells, chords: amChords, choice: { active: a, candidate: null }, captions: true, ladder: null, pointers: [], moveText: captionTextFor(computedCaptions(), amChords, keyOf(am)) });
    // The layout's degree 5 (C's vi) is A minor's 0: every layout degree is the key's minus 2.
    const text = captionTextFor(computedCaptions(), amChords, keyOf(am));
    const inKey = neighbourCaptions('harmonic', cells[a], 7, (f, t) => text((f + 2) % 7, (t + 2) % 7)).map((c) => c.text);
    const unshifted = neighbourCaptions('harmonic', cells[a], 7, text).map((c) => c.text);
    expect(grid.captions.map((c) => c.text)).toEqual(inKey);
    expect(inKey).not.toEqual(unshifted);
  });
});

describe('ghost trails', () => {
  const C = key(0, 'major');
  const fifties = idiomById('fifties')!;

  it('puts each degree ahead on its cell nearest the one before', () => {
    const start = cells[centre(0)];
    const pts = trailPoints(cells, [5, 3, 4], start);
    expect(pts).toHaveLength(3);
    const at = (p: { x: number; y: number }) => cells.find((c) => c.x === p.x && c.y === p.y) as MapCell;
    expect(pts.map((p) => at(p).degree)).toEqual([5, 3, 4]);
    // Each is the nearest of its degree to the one before.
    let prev = { x: start.x, y: start.y };
    for (const p of pts) {
      const d = at(p).degree;
      const best = Math.min(...cells.filter((c) => c.degree === d).map((c) => (c.x - prev.x) ** 2 + (c.y - prev.y) ** 2));
      expect((p.x - prev.x) ** 2 + (p.y - prev.y) ** 2).toBeCloseTo(best, 12);
      prev = p;
    }
  });

  it('ends a trail at a step off the map', () => {
    expect(trailPoints(cells, [5, null, 3], null)).toHaveLength(1);
  });

  it('draws an idiom ahead of the active chord as a valid grid, and nothing without one', () => {
    const chords = diatonicChords(C);
    const steps = ahead(fifties, keyOf(C), { position: 0, onPath: true, skips: 0 }, 3).map((s) => s.cell);
    const view = { layout: 'harmonic' as const, cells, chords, choice: { active: centre(0), candidate: null }, captions: false, ladder: null, pointers: [] };
    const grid = chordMapGrid({ ...view, trail: { degrees: steps, label: fifties.name } });
    expect(grid.trails).toHaveLength(1);
    expect(grid.trails![0].points).toHaveLength(3);
    expect(grid.trails![0].from).toEqual({ x: cells[centre(0)].x, y: cells[centre(0)].y });
    expect(CellGridSchema.safeParse(grid).success).toBe(true);
    expect(chordMapGrid(view).trails).toBeUndefined();
    expect(ahead(fifties, keyOf(C), startFollow(), 1)[0].cell).toBe(0);

    const rec = makeRecordingCanvas(640, 360);
    drawCellGrid(rec.canvas.getContext('2d')!, 640, 360, CellGridSchema.parse(grid));
    expect(rec.texts()).toEqual(expect.arrayContaining(['1', '2', '3', fifties.name]));
    expect(rec.count('setLineDash')).toBe(2);
  });
});
