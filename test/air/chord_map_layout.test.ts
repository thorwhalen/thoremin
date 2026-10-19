/**
 * The chord map's layouts (`@thoremin/ext-air/lib/chord_map`): a key's chords, spelled in the
 * key; the harmonic map's three axes (a fourth across, a third and a second on the diagonals)
 * and its neighbourhoods (every other chord of the key exactly once around each cell); the one-
 * row layouts' orders; the geometry in display fractions; choosing a cell with hysteresis, a
 * dwell and a release; the melody ladder.
 */
import { describe, it, expect } from 'vitest';
import {
  DEGREES,
  LAYOUTS,
  cellAt,
  chordMapGrid,
  createCellTracker,
  degreeAt,
  diatonicChords,
  keyedCells,
  letterChordNames,
  scaleChords,
  ladderBand,
  layoutCells,
  melodyLadder,
  moveText,
  neighbourCaptions,
  sharedTones,
  type MapCell,
  type Region,
} from '@thoremin/ext-air/lib/chord_map';
import { midiToName, type ScaleSpec } from '@thoremin/sdk/music/theory';

const key = (root: number, type: ScaleSpec['type']): ScaleSpec => ({ root, type, octaves: 2, baseOctave: 3 });
const names = (spec: ScaleSpec) => diatonicChords(spec).map((c) => c.name);
const LEFT: Region = { x0: 0, x1: 0.65, y0: 0.1, y1: 0.9 };
const ASPECT = 16 / 9;

describe('the chords of a key', () => {
  it('names and numbers the seven triads, spelled in the key', () => {
    expect(names(key(0, 'major'))).toEqual(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'B°']);
    expect(diatonicChords(key(0, 'major')).map((c) => c.numeral)).toEqual(['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
    expect(names(key(5, 'major'))).toEqual(['F', 'Gm', 'Am', 'Bb', 'C', 'Dm', 'E°']);
    expect(names(key(7, 'major'))).toEqual(['G', 'Am', 'Bm', 'C', 'D', 'Em', 'F#°']);
    expect(names(key(9, 'minor'))).toEqual(['Am', 'B°', 'C', 'Dm', 'Em', 'F', 'G']);
    // The guitar voicing parses the symbol, not the shown name.
    expect(diatonicChords(key(0, 'major'))[6].symbol).toBe('Bdim');
  });

  it('reads a pentatonic key through its seven-note parent', () => {
    expect(names(key(0, 'pentatonic'))).toEqual(names(key(0, 'major')));
  });

  it('counts the notes two chords share: a third keeps two, a fourth one, a second none', () => {
    const c = diatonicChords(key(0, 'major'));
    expect(sharedTones(c[0].triad, c[2].triad)).toBe(2); // C -> Em
    expect(sharedTones(c[0].triad, c[3].triad)).toBe(1); // C -> F
    expect(sharedTones(c[0].triad, c[1].triad)).toBe(0); // C -> Dm
  });
});

describe('the harmonic map', () => {
  const layout = LAYOUTS.harmonic;

  it('steps a fourth across, a third down-right and a second down-left, as in the video', () => {
    expect(degreeAt(layout, 1, 0)).toBe(3); // C -> F
    expect(degreeAt(layout, 0, 1)).toBe(2); // C -> Em
    expect(degreeAt(layout, -1, 1)).toBe(6); // C -> B°
    // The video's top row, left to right: G C F B° Em Am Dm.
    const row = [-1, 0, 1, 2, 3, 4, 5].map((q) => names(key(0, 'major'))[degreeAt(layout, q, 0)]);
    expect(row).toEqual(['G', 'C', 'F', 'B°', 'Em', 'Am', 'Dm']);
  });

  it('puts every other chord of the key exactly once around each cell', () => {
    for (let q = -3; q <= 3; q++) {
      for (let r = -3; r <= 3; r++) {
        const d = degreeAt(layout, q, r);
        const around = [[1, 0], [-1, 0], [0, 1], [-1, 1], [1, -1], [0, -1]].map(([dq, dr]) => degreeAt(layout, q + dq, r + dr));
        expect(new Set(around).size).toBe(6);
        expect(around).not.toContain(d);
      }
    }
  });

  it('fills the region with whole hexagons of the asked size, the tonic in the middle', () => {
    const cells = layoutCells('harmonic', LEFT, { aspect: ASPECT, cellSize: 0.2 });
    expect(cells.length).toBeGreaterThan(12);
    for (const c of cells) {
      expect(c.w * ASPECT).toBeCloseTo(0.2, 9); // a hexagon's width, in frame heights
      expect(c.x - c.w / 2).toBeGreaterThanOrEqual(LEFT.x0 - 1e-9);
      expect(c.x + c.w / 2).toBeLessThanOrEqual(LEFT.x1 + 1e-9);
      expect(c.y - c.h / 2).toBeGreaterThanOrEqual(LEFT.y0 - 1e-9);
      expect(c.y + c.h / 2).toBeLessThanOrEqual(LEFT.y1 + 1e-9);
    }
    const centre = cells.find((c) => c.q === 0 && c.r === 0)!;
    expect(centre.degree).toBe(0);
    expect(Math.abs(centre.x - (LEFT.x0 + LEFT.x1) / 2)).toBeLessThan(centre.w);
    // Neighbours touch: the right-hand neighbour is one width away.
    const east = cells.find((c) => c.q === 1 && c.r === 0)!;
    expect(east.x - centre.x).toBeCloseTo(centre.w, 9);
    expect(east.degree).toBe(3);
  });

  it('captions each edge of a cell with the move across it', () => {
    const cells = layoutCells('harmonic', LEFT, { aspect: ASPECT, cellSize: 0.2 });
    const centre = cells.find((c) => c.q === 0 && c.r === 0)!;
    const captions = neighbourCaptions('harmonic', centre);
    expect(captions.map((c) => c.text).sort()).toEqual(['2nd down', '2nd up', '3rd down', '3rd up', '4th down', '4th up']);
    const right = captions.find((c) => c.text === '4th up')!;
    expect(right.x).toBeCloseTo(centre.x + centre.w / 2, 9);
    expect(moveText(0, 0)).toBe('');
  });
});

describe('the letters map (H13 of #613)', () => {
  const cells = layoutCells('harmonic', LEFT, { aspect: ASPECT, cellSize: 0.2 });
  const at00 = (placed: MapCell[]) => placed[cells.findIndex((c) => c.q === 0 && c.r === 0)];

  it('keeps every cell on its letter: A minor is home on the A cells, vi\'s place in C', () => {
    const am = keyedCells(cells, 'letters', key(9, 'minor'));
    expect(at00(am).degree).toBe(2); // the middle cell is still C: III in A minor
    const homes = cells.filter((_, i) => am[i].degree === 0);
    expect(homes.length).toBeGreaterThan(0);
    expect(homes.every((c) => c.degree === 5)).toBe(true); // every home cell is an A cell
    expect(keyedCells(cells, 'home', key(9, 'minor'))).toEqual(cells); // the home map: as laid out
  });

  it('relights only the chords a modulation changes: C to G changes ii, IV and vii°', () => {
    const shown = (spec: ScaleSpec) => letterChordNames(diatonicChords(spec), spec);
    const before = shown(key(0, 'major'));
    const after = shown(key(7, 'major'));
    expect(before).toEqual(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'B°']);
    expect(after).toEqual(['C', 'D', 'Em', 'F#°', 'G', 'Am', 'Bm']);
    expect(before.flatMap((n, i) => (n !== after[i] ? [i] : []))).toEqual([1, 3, 6]); // D, F, B
  });

  it('reads the move captions where the cells are laid out, whatever the key', () => {
    const am = keyedCells(cells, 'letters', key(9, 'minor'));
    const a = cells.findIndex((c) => c.degree === 5 && Math.abs(c.q) + Math.abs(c.r) <= 2);
    const grid = (laidOut?: MapCell[]) =>
      chordMapGrid({ layout: 'harmonic', cells: am, laidOut, chords: diatonicChords(key(9, 'minor')), choice: { active: a, candidate: null }, captions: true, ladder: null, pointers: [] });
    const fromLaidOut = grid(cells).captions.map((c) => c.text);
    expect(fromLaidOut).toEqual(neighbourCaptions('harmonic', cells[a]).map((c) => c.text)); // as in C: a move is a move
    expect(fromLaidOut).toContain('4th up');
  });
});

describe('scale-generic maps (#671)', () => {
  it('lays out a pentatonic\'s own five chords, stacks of its own thirds', () => {
    const pent = key(0, 'pentatonic');
    expect(scaleChords(pent, true).map((c) => c.name)).toEqual(['Am', 'Gsus4', 'Asus4', 'C', 'Dsus4']);
    expect(scaleChords(pent, false).map((c) => c.name)).toEqual(names(key(0, 'major'))); // the key's seven, as before
  });

  it('visits every chord along a step k exactly when gcd(k, n) = 1, and names moves in the scale\'s steps', () => {
    const cells = layoutCells('harmonic', LEFT, { aspect: ASPECT, cellSize: 0.2, degrees: 5 });
    expect(new Set(cells.map((c) => c.degree))).toEqual(new Set([0, 1, 2, 3, 4]));
    const row = layoutCells('scale', LEFT, { aspect: ASPECT, cellSize: 0.2, degrees: 5 });
    expect(row.map((c) => c.degree)).toEqual([0, 1, 2, 3, 4]);
    expect(moveText(0, 2, 5)).toBe('2 steps up');
    expect(moveText(0, 4, 5)).toBe('1 step down');
    expect(moveText(1, 4)).toBe(moveText(1, 4, 7)); // a seven-note key keeps its interval names
  });

  it('a harmonic minor\'s own chords are its key\'s, on the same map', () => {
    const hm = key(9, 'minorHarmonic');
    expect(scaleChords(hm, true).map((c) => c.name)).toEqual(['Am', 'B°', 'C+', 'Dm', 'E', 'F', 'G#°']);
    expect(scaleChords(hm, true).map((c) => c.numeral)).toEqual(['i', 'ii°', 'III+', 'iv', 'V', 'VI', 'vii°']);
    const am = keyedCells(layoutCells('harmonic', LEFT, { aspect: ASPECT, cellSize: 0.2 }), 'letters', hm);
    expect(am.filter((c) => c.degree === 0).length).toBeGreaterThan(0); // home on the A cells, as in natural minor
  });
});

describe('the one-row layouts', () => {
  it('orders the chords by fifths or by scale', () => {
    const fifths = layoutCells('fifths', LEFT, { aspect: ASPECT, cellSize: 0.2 }).map((c) => names(key(0, 'major'))[c.degree]);
    expect(fifths).toEqual(['F', 'C', 'G', 'Dm', 'Am', 'Em', 'B°']);
    const scale = layoutCells('scale', LEFT, { aspect: ASPECT, cellSize: 0.2 }).map((c) => c.degree);
    expect(scale).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('makes seven full-height strips across the region: only the hand\'s width matters', () => {
    const cells = layoutCells('scale', LEFT, { aspect: ASPECT, cellSize: 0.2 });
    expect(cells).toHaveLength(DEGREES);
    for (const c of cells) expect(c.h).toBeCloseTo(LEFT.y1 - LEFT.y0, 9);
    expect(cellAt(cells, { x: cells[3].x, y: 0.15 }, ASPECT, 'rect')?.index).toBe(3);
    expect(cellAt(cells, { x: cells[3].x, y: 0.85 }, ASPECT, 'rect')?.index).toBe(3);
    expect(cellAt(cells, { x: cells[3].x, y: 0.97 }, ASPECT, 'rect')).toBeNull();
  });
});

describe('choosing a cell', () => {
  const cells = layoutCells('harmonic', LEFT, { aspect: ASPECT, cellSize: 0.2 });
  const at = (c: MapCell, dx = 0) => ({ x: c.x + dx * c.w, y: c.y });
  const centre = cells.findIndex((c) => c.q === 0 && c.r === 0);
  const east = cells.findIndex((c) => c.q === 1 && c.r === 0);

  it('finds the cell under a point, and nothing well off the grid', () => {
    expect(cellAt(cells, at(cells[centre]), ASPECT, 'hex')?.index).toBe(centre);
    expect(cellAt(cells, at(cells[centre], 0.4), ASPECT, 'hex')?.index).toBe(centre);
    expect(cellAt(cells, { x: 0.98, y: 0.5 }, ASPECT, 'hex')).toBeNull();
  });

  it('takes a cell after the dwell, holds through a border wobble, and moves once clearly over', () => {
    const tracker = createCellTracker({ enterFrames: 2, hysteresis: 0.12, releaseS: 0.3 });
    const push = (p: { x: number; y: number } | null, t: number) => tracker.push(cells, p, t, ASPECT, 'hex');
    expect(push(at(cells[centre]), 0).active).toBeNull(); // one frame is not enough
    expect(push(at(cells[centre]), 0.033).active).toBe(centre);
    // Just past the shared edge (0.5 widths): nearer the neighbour, but within the margin.
    expect(push(at(cells[centre], 0.55), 0.066).active).toBe(centre);
    expect(push(at(cells[centre], 0.45), 0.1).active).toBe(centre);
    expect(push(at(cells[centre], 0.55), 0.133).active).toBe(centre);
    // Clearly over the neighbour: a candidate, then in force.
    const moving = push(at(cells[east], -0.2), 0.166);
    expect(moving).toEqual({ active: centre, candidate: east });
    expect(push(at(cells[east], -0.2), 0.2).active).toBe(east);
  });

  it('keeps the chord a moment after the hand is lost, then lets it go', () => {
    const tracker = createCellTracker({ enterFrames: 1, hysteresis: 0.12, releaseS: 0.3 });
    tracker.push(cells, at(cells[centre]), 0, ASPECT, 'hex');
    expect(tracker.push(cells, null, 0.1, ASPECT, 'hex').active).toBe(centre);
    expect(tracker.push(cells, null, 0.3, ASPECT, 'hex').active).toBe(centre);
    expect(tracker.push(cells, null, 0.41, ASPECT, 'hex').active).toBeNull();
    // Back on the grid before the release: the gone time starts over.
    tracker.push(cells, at(cells[centre]), 1, ASPECT, 'hex');
    tracker.push(cells, null, 1.2, ASPECT, 'hex');
    tracker.push(cells, at(cells[centre]), 1.25, ASPECT, 'hex');
    expect(tracker.push(cells, null, 1.5, ASPECT, 'hex').active).toBe(centre);
  });
});

describe('the melody ladder', () => {
  it('stacks the chord\'s tones from the first root at or above the base, root on top', () => {
    const em = diatonicChords(key(0, 'major'))[2].triad;
    expect(melodyLadder(em, 60, 2).map(midiToName)).toEqual(['E4', 'G4', 'B4', 'E5', 'G5', 'B5', 'E6']);
    expect(melodyLadder([], 60, 2)).toEqual([]);
  });

  it('picks a band by height, the top band the highest note, nothing outside the strip', () => {
    const strip: Region = { x0: 0.65, x1: 1, y0: 0.1, y1: 0.9 };
    expect(ladderBand(strip, 7, { x: 0.8, y: 0.89 })).toBe(0);
    expect(ladderBand(strip, 7, { x: 0.8, y: 0.11 })).toBe(6);
    expect(ladderBand(strip, 7, { x: 0.8, y: 0.0 })).toBe(6);
    expect(ladderBand(strip, 7, { x: 0.5, y: 0.5 })).toBeNull();
    expect(ladderBand(strip, 7, null)).toBeNull();
  });
});

describe('the picture', () => {
  it('draws every cell with its chord and numeral, lights the one in force, adds the ladder', () => {
    const cells = layoutCells('harmonic', LEFT, { aspect: ASPECT, cellSize: 0.2 });
    const centre = cells.findIndex((c) => c.q === 0 && c.r === 0);
    const chords = diatonicChords(key(0, 'major'));
    const strip: Region = { x0: 0.65, x1: 1, y0: 0.1, y1: 0.9 };
    const grid = chordMapGrid({
      layout: 'harmonic',
      cells,
      chords,
      choice: { active: centre, candidate: null },
      captions: true,
      ladder: { region: strip, notes: melodyLadder(chords[0].triad, 60, 2), band: 2 },
      pointers: [{ x: 0.3, y: 0.5 }],
    });
    expect(grid.cells).toHaveLength(cells.length + 7);
    expect(grid.cells[centre]).toMatchObject({ label: 'C', sub: 'I', state: 'active', shape: 'hex' });
    expect(grid.cells.filter((c) => c.state === 'active')).toHaveLength(2); // the chord and the melody band
    expect(grid.cells[cells.length + 2]).toMatchObject({ label: 'G4', state: 'active', shape: 'rect' });
    expect(grid.captions).toHaveLength(6);
    expect(grid.pointers).toEqual([{ x: 0.3, y: 0.5 }]);
  });
});
