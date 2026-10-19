/**
 * The chord map's layouts (the chord-map instrument): a key's seven diatonic triads laid out
 * as on-screen targets a hand points at, and the pure geometry behind it. The design and its
 * sources are `docs/research/chord-layouts.md`.
 *
 * The default layout is the one in Pur Pasteur's "Motion Capture Harmonic Map": a hexagonal
 * lattice whose three axes are the three ways a diatonic triad moves to another, so every
 * neighbour of a chord is one step on one of them. Across a row each step is a fourth up
 * (scale steps +3: I IV vii° iii vi ii V I, the diatonic cycle of fourths); the down-right
 * diagonal is a third up (+2: the move that keeps two of the three notes); the down-left
 * diagonal is a second down (-1). It is the Tonnetz restricted to one key: the lattice repeats
 * every seven steps, so it tiles the whole region, and the tonic sits at its centre.
 *
 * Two one-row layouts sit beside it, the chord-button strips of the Omnichord, the Orchid or
 * an accordion's Stradella row: the seven chords in scale order, or by fifths (IV I V ii vi
 * iii vii°, the functional neighbours side by side). A row's cells are full-height strips: a
 * hand only has to be at the right width, the largest target a row can give.
 *
 * Everything here is pure (no DOM, no audio) and in DISPLAY coordinates: fractions of the
 * mirrored frame the player sees, the overlay's convention. Lengths that must be the same
 * across and down (a hexagon) are computed in frame HEIGHTS and converted with the frame's
 * aspect ratio.
 */
import { classifyChord, diatonicTriad, letterChordSpec, midiToName, romanNumeral, type ChordQuality, type ScaleSpec } from '@thoremin/sdk/music/theory';
import { chordName, chordSymbol, diatonicChords as harmonyChords, keyOf, type Chord, type Key } from '@thoremin/sdk/harmony/chord';
import { HEX_NEIGHBOURS, HEX_ROW_STEP, cellAt as layoutCellAt, cellDistance as layoutCellDistance, hexLattice, latticeChord, strip, type Cell, type Region } from '@thoremin/sdk/harmony/layout';
import { createCellTracker as createNavTracker, type CellChoice, type CellTrackerOptions } from '@thoremin/sdk/harmony/navigate';
import { RELATIONS } from '@thoremin/sdk/harmony/space';
import type { CellGrid, GridCaption, GridCell } from '@thoremin/sdk/nodes/cell_grid';

/** The number of chords a key has, and so the period of every layout. */
export const DEGREES = 7;

export const CHORD_MAP_LAYOUTS = ['harmonic', 'fifths', 'scale'] as const;
export type ChordMapLayoutId = (typeof CHORD_MAP_LAYOUTS)[number];

export interface ChordMapLayout {
  shape: 'hex' | 'rect';
  /** What the settings say about it. */
  label: string;
  /** The move from a cell to its right-hand neighbour (a relation of `@thoremin/sdk/harmony/space`). */
  east: string;
  /** The move from a cell to its down-right neighbour (hex only). */
  southEast: string;
  /** The degree of the first cell of a row (rect only). */
  first: number;
}

export const LAYOUTS: Readonly<Record<ChordMapLayoutId, ChordMapLayout>> = {
  harmonic: { shape: 'hex', label: 'Harmonic map: fourths across, thirds and seconds on the diagonals', east: 'dia+3', southEast: 'dia+2', first: 0 },
  fifths: { shape: 'rect', label: 'One row by fifths: IV I V ii vi iii vii°', east: 'dia-3', southEast: 'dia-3', first: 3 },
  scale: { shape: 'rect', label: 'One row in scale order: I ii iii IV V vi vii°', east: 'dia+1', southEast: 'dia+1', first: 0 },
};

/** Each degree's colour (I red, ii orange, iii yellow, IV green, V blue, vi violet, vii°
 *  crimson): the same degree is the same colour in every key and every layout. */
export const DEGREE_COLORS = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#38bdf8', '#a78bfa', '#f43f5e'] as const;

const mod = (n: number, m: number) => ((n % m) + m) % m;

// ---- The chords of a key --------------------------------------------------------------

export interface DiatonicChord {
  degree: number;
  /** Root pitch class. */
  root: number;
  /** How the chord is shown: "Em", "B°", "Bb", "F#m". */
  name: string;
  /** A name the guitar voicing parses: "Em", "Bdim", "Bb". */
  symbol: string;
  numeral: string;
  quality: ChordQuality;
  /** The triad on the spec's register (three ascending MIDI notes). */
  triad: number[];
}

/**
 * The seven chords of a key, spelled in the key (the third chord of F major is "Am", its
 * fourth "Bb", not "A#"), with each one's triad on the spec's register. A key without seven
 * notes is read through its seven-note embedding (a pentatonic melody's chords are its parent
 * major's), keeping the register. Names, symbols and numerals are the harmony layer's chord
 * model (`@thoremin/sdk/harmony/chord`).
 */
export function diatonicChords(spec: ScaleSpec): DiatonicChord[] {
  const key = letterChordSpec(spec);
  const k = keyOf(key);
  return harmonyChords(k).map((chord, degree) => {
    const triad = diatonicTriad(key, degree);
    const quality = classifyChord(triad)?.quality ?? 'unknown';
    return { degree, root: chord.root, name: chordName(chord, k), symbol: chordSymbol(chord, k), numeral: romanNumeral(degree, quality), quality, triad };
  });
}

/** How many notes two triads share (pitch classes): 2 for a third, 1 for a fourth, 0 for a
 *  second, on a major scale. */
export function sharedTones(a: readonly number[], b: readonly number[]): number {
  const pcs = new Set(a.map((n) => mod(n, 12)));
  return new Set(b.map((n) => mod(n, 12)).filter((pc) => pcs.has(pc))).size;
}

// ---- Geometry ---------------------------------------------------------------------------

export type { Region } from '@thoremin/sdk/harmony/layout';
export type { CellTrackerOptions, CellChoice } from '@thoremin/sdk/harmony/navigate';

/** One target: its degree and where it is (a layout cell of `@thoremin/sdk/harmony/layout`). */
export interface MapCell extends Cell {
  degree: number;
}

export interface CellOptions {
  /** The frame's width over its height. */
  aspect: number;
  /** A hexagon's width across its flats, in frame heights. */
  cellSize: number;
}

/** Degrees are the same in every key: they are read in C major. */
const REFERENCE_KEY: Key = { tonic: 0, scale: 'major' };
const REFERENCE_CHORDS = harmonyChords(REFERENCE_KEY);
const degreeOf = (c: Chord | null): number => (c ? REFERENCE_CHORDS.findIndex((d) => d.root === c.root && d.quality === c.quality) : -1);

/** The degree of a cell of a layout: the tonic at axial (0, 0) of a lattice, the layout's first
 *  degree at the start of a row; each move a relation walked (`latticeChord`). */
export function degreeAt(layout: ChordMapLayout, q: number, r: number): number {
  const seed = REFERENCE_CHORDS[layout.shape === 'hex' ? 0 : layout.first];
  return degreeOf(latticeChord(RELATIONS, { east: layout.east, southEast: layout.southEast }, seed, REFERENCE_KEY, q, layout.shape === 'hex' ? r : 0));
}

/**
 * The cells of a layout filling a region (`@thoremin/sdk/harmony/layout`): a hex lattice of as
 * many whole hexagons of `cellSize` as fit, centred, with the tonic on the middle cell; a row is
 * seven full-height strips across the region.
 */
export function layoutCells(layoutId: ChordMapLayoutId, region: Region, { aspect, cellSize }: CellOptions): MapCell[] {
  const layout = LAYOUTS[layoutId];
  const cells = layout.shape === 'hex' ? hexLattice(region, { aspect, cellSize }) : strip(region, DEGREES, aspect);
  return cells.map((cell) => ({ ...cell, degree: degreeAt(layout, cell.q, cell.r) }));
}

/** A point's distance from a cell's centre in that cell's widths (the layout's `cellDistance`). */
export function cellDistance(cell: MapCell, p: { x: number; y: number }, aspect: number, _shape?: 'hex' | 'rect'): number {
  return layoutCellDistance(cell, p, aspect);
}

/** The cell a point is over, or null off the grid (the layout's `cellAt`). */
export function cellAt(cells: readonly MapCell[], p: { x: number; y: number }, aspect: number, _shape?: 'hex' | 'rect'): { index: number; distance: number } | null {
  return layoutCellAt(cells, p, aspect);
}

export interface CellTracker {
  /** One camera frame: the point (null when the hand is not seen) at engine time `t`. */
  push(cells: readonly MapCell[], p: { x: number; y: number } | null, t: number, aspect: number, _shape?: 'hex' | 'rect'): CellChoice;
  reset(): void;
}

/** The dwell commit policy (`@thoremin/sdk/harmony/navigate`'s cell tracker). */
export function createCellTracker(opts: CellTrackerOptions): CellTracker {
  const t = createNavTracker(opts);
  return { push: (cells, p, now, aspect) => t.push(cells, p, now, aspect), reset: () => t.reset() };
}

// ---- What a move does ----------------------------------------------------------------

/** The diatonic step a move from degree `from` to degree `to` is (shortest way round). */
const STEP_OF: readonly (string | null)[] = [null, 'dia+1', 'dia+2', 'dia+3', 'dia-3', 'dia-2', 'dia-1'];

/** What moving from `from` to `to` is, in scale steps ("3rd up"): the relation's own label. */
export function moveText(from: number, to: number): string {
  const id = STEP_OF[mod(to - from, DEGREES)];
  return id ? (RELATIONS.get(id)?.label ?? '') : '';
}

/** The captions around a hex cell: on each of its six edges, what moving across it does. */
export function neighbourCaptions(layoutId: ChordMapLayoutId, cell: MapCell): GridCaption[] {
  const layout = LAYOUTS[layoutId];
  if (layout.shape !== 'hex') return [];
  const step = cell.h * HEX_ROW_STEP;
  return HEX_NEIGHBOURS.map((n) => ({
    x: cell.x + (n.dx * cell.w) / 2,
    y: cell.y + (n.dy * step) / 2,
    text: moveText(cell.degree, degreeAt(layout, cell.q + n.dq, cell.r + n.dr)),
  }));
}

// ---- The melody ladder -------------------------------------------------------------------

/**
 * The melody hand's notes over a chord: its tones from the first root at or above `baseMidi`,
 * for `octaves` octaves, and the root on top (E4 G4 B4 E5 G5 B5 E6 for Em from C4).
 */
export function melodyLadder(triad: readonly number[], baseMidi: number, octaves: number): number[] {
  if (triad.length === 0) return [];
  const root = mod(triad[0], 12);
  const start = baseMidi + mod(root - baseMidi, 12);
  const offsets = [...new Set(triad.map((n) => mod(n - triad[0], 12)))].sort((a, b) => a - b);
  const notes: number[] = [];
  for (let o = 0; o < octaves; o++) for (const off of offsets) notes.push(start + 12 * o + off);
  notes.push(start + 12 * octaves);
  return notes;
}

/** The band a height picks on a ladder of `n` notes over a region (the top band the highest
 *  note), or null outside the region's width. */
export function ladderBand(region: Region, n: number, p: { x: number; y: number } | null): number | null {
  if (!p || n <= 0 || p.x < region.x0 || p.x > region.x1) return null;
  const f = (region.y1 - p.y) / (region.y1 - region.y0);
  return Math.min(n - 1, Math.max(0, Math.floor(f * n)));
}

// ---- The picture -----------------------------------------------------------------------

/** The colour of a melody band no chord is sounding over. */
const IDLE_BAND_COLOR = '#cbd5e1';

export interface ChordMapView {
  layout: ChordMapLayoutId;
  cells: readonly MapCell[];
  chords: readonly DiatonicChord[];
  choice: CellChoice;
  /** The moves around the active cell are shown (hex only). */
  captions: boolean;
  /** The melody ladder: its region, notes and the band played, or null with no ladder. */
  ladder: { region: Region; notes: readonly number[]; band: number | null } | null;
  /** The points that choose (display fractions). */
  pointers: readonly { x: number; y: number }[];
}

/** The chord map as the overlay's cell grid. */
export function chordMapGrid(view: ChordMapView): CellGrid {
  const shape = LAYOUTS[view.layout].shape;
  const active = view.choice.active !== null ? view.cells[view.choice.active] : undefined;
  const cells: GridCell[] = view.cells.map((cell, i) => {
    const chord = view.chords[cell.degree];
    const state = i === view.choice.active ? 'active' : i === view.choice.candidate ? 'candidate' : 'idle';
    return { x: cell.x, y: cell.y, w: cell.w, h: cell.h, shape, label: chord?.name ?? '', sub: chord?.numeral ?? '', color: DEGREE_COLORS[cell.degree], state };
  });
  if (view.ladder) {
    const { region, notes, band } = view.ladder;
    const bandH = (region.y1 - region.y0) / Math.max(1, notes.length);
    const color = active ? DEGREE_COLORS[active.degree] : IDLE_BAND_COLOR;
    notes.forEach((midi, i) => {
      cells.push({
        x: (region.x0 + region.x1) / 2,
        y: region.y1 - bandH * (i + 0.5),
        w: region.x1 - region.x0,
        h: bandH,
        shape: 'rect',
        label: midiToName(midi),
        sub: '',
        color,
        state: i === band ? 'active' : 'idle',
      });
    });
  }
  const captions = view.captions && active ? neighbourCaptions(view.layout, active) : [];
  return { cells, captions, pointers: [...view.pointers] };
}
