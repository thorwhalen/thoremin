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
import { chordName, chordSymbol, diatonicChords as harmonyChords, keyOf } from '@thoremin/sdk/harmony/chord';
import type { CellGrid, GridCaption, GridCell } from '@thoremin/sdk/nodes/cell_grid';

/** The number of chords a key has, and so the period of every layout. */
export const DEGREES = 7;

export const CHORD_MAP_LAYOUTS = ['harmonic', 'fifths', 'scale'] as const;
export type ChordMapLayoutId = (typeof CHORD_MAP_LAYOUTS)[number];

export interface ChordMapLayout {
  shape: 'hex' | 'rect';
  /** What the settings say about it. */
  label: string;
  /** Scale steps from a cell to its right-hand neighbour. */
  east: number;
  /** Scale steps from a cell to its down-right neighbour (hex only). */
  southEast: number;
  /** The degree of the first cell of a row (rect only). */
  first: number;
}

export const LAYOUTS: Readonly<Record<ChordMapLayoutId, ChordMapLayout>> = {
  harmonic: { shape: 'hex', label: 'Harmonic map: fourths across, thirds and seconds on the diagonals', east: 3, southEast: 2, first: 0 },
  fifths: { shape: 'rect', label: 'One row by fifths: IV I V ii vi iii vii°', east: 4, southEast: 0, first: 3 },
  scale: { shape: 'rect', label: 'One row in scale order: I ii iii IV V vi vii°', east: 1, southEast: 0, first: 0 },
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

/** A rectangle of the displayed frame, in fractions. */
export interface Region {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** One target: its degree and where it is (centre and size, display fractions). */
export interface MapCell {
  degree: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Axial coordinates on a hex lattice (rect: `q` is the column, `r` 0). */
  q: number;
  r: number;
}

export interface CellOptions {
  /** The frame's width over its height. */
  aspect: number;
  /** A hexagon's width across its flats, in frame heights. */
  cellSize: number;
}

const SQRT3 = Math.sqrt(3);
/** A hex's height point to point, over its width across the flats. */
const HEX_HEIGHT = 2 / SQRT3;
/** Rows of pointy-top hexagons are this fraction of a hex's height apart. */
const HEX_ROW_STEP = 0.75;

/** The six hex neighbours as axial offsets, with their position relative to the cell in
 *  cell widths (x) and row steps (y). */
const HEX_NEIGHBOURS = [
  { dq: 1, dr: 0, dx: 1, dy: 0 },
  { dq: -1, dr: 0, dx: -1, dy: 0 },
  { dq: 0, dr: 1, dx: 0.5, dy: 1 },
  { dq: -1, dr: 1, dx: -0.5, dy: 1 },
  { dq: 1, dr: -1, dx: 0.5, dy: -1 },
  { dq: 0, dr: -1, dx: -0.5, dy: -1 },
] as const;

/** The degree of a cell of a layout: the tonic at axial (0, 0). */
export function degreeAt(layout: ChordMapLayout, q: number, r: number): number {
  return layout.shape === 'hex' ? mod(layout.east * q + layout.southEast * r, DEGREES) : mod(layout.first + layout.east * q, DEGREES);
}

/**
 * The cells of a layout filling a region. A hex lattice packs as many whole hexagons of
 * `cellSize` as fit, centred, with the tonic on the middle cell; a row is seven full-height
 * strips across the region.
 */
export function layoutCells(layoutId: ChordMapLayoutId, region: Region, { aspect, cellSize }: CellOptions): MapCell[] {
  const layout = LAYOUTS[layoutId];
  const regionW = (region.x1 - region.x0) * aspect;
  const regionH = region.y1 - region.y0;
  if (!(regionW > 0 && regionH > 0 && aspect > 0)) return [];
  if (layout.shape === 'rect') {
    const w = regionW / DEGREES;
    return Array.from({ length: DEGREES }, (_, q) => ({
      degree: degreeAt(layout, q, 0),
      x: (region.x0 * aspect + w * (q + 0.5)) / aspect,
      y: (region.y0 + region.y1) / 2,
      w: w / aspect,
      h: regionH,
      q,
      r: 0,
    }));
  }
  const w = cellSize;
  const h = w * HEX_HEIGHT;
  const step = h * HEX_ROW_STEP;
  const rows = Math.max(1, Math.floor((regionH - h) / step) + 1);
  const cols = Math.max(1, Math.floor((regionW - (rows > 1 ? w / 2 : 0)) / w));
  const blockW = cols * w + (rows > 1 ? w / 2 : 0);
  const blockH = h + (rows - 1) * step;
  const ox = region.x0 * aspect + (regionW - blockW) / 2;
  const oy = region.y0 + (regionH - blockH) / 2;
  const axial = (c: number, row: number) => c - (row - (row & 1)) / 2;
  // The middle cell is the tonic.
  const r0 = Math.floor((rows - 1) / 2);
  const q0 = axial(Math.floor((cols - 1) / 2), r0);
  const cells: MapCell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let c = 0; c < cols; c++) {
      const q = axial(c, row) - q0;
      const r = row - r0;
      cells.push({
        degree: degreeAt(layout, q, r),
        x: (ox + w / 2 + c * w + (row & 1 ? w / 2 : 0)) / aspect,
        y: oy + h / 2 + row * step,
        w: w / aspect,
        h,
        q,
        r,
      });
    }
  }
  return cells;
}

/** How far outside its nearest cell a point may be and still count as on the grid, in cell
 *  widths from the centre: a hexagon's corners are 0.577 out, a strip's sides 0.5. */
const REACH = { hex: 0.6, rect: 0.55 } as const;

/** A point's distance from a cell's centre in that cell's widths (a strip: across only, and
 *  infinite above or below it). */
export function cellDistance(cell: MapCell, p: { x: number; y: number }, aspect: number, shape: 'hex' | 'rect'): number {
  const dx = ((p.x - cell.x) * aspect) / (cell.w * aspect);
  if (shape === 'rect') return Math.abs(p.y - cell.y) <= cell.h / 2 ? Math.abs(dx) : Infinity;
  const dy = (p.y - cell.y) / (cell.w * aspect);
  return Math.hypot(dx, dy);
}

/** The cell a point is over (the nearest centre, within reach), or null off the grid. */
export function cellAt(cells: readonly MapCell[], p: { x: number; y: number }, aspect: number, shape: 'hex' | 'rect'): { index: number; distance: number } | null {
  let best: { index: number; distance: number } | null = null;
  cells.forEach((cell, index) => {
    const distance = cellDistance(cell, p, aspect, shape);
    if (!best || distance < best.distance) best = { index, distance };
  });
  const found = best as { index: number; distance: number } | null;
  return found && found.distance <= REACH[shape] ? found : null;
}

// ---- Choosing a cell: hysteresis, a short dwell, a release --------------------------------

export interface CellTrackerOptions {
  /** Camera frames a new cell must be pointed at in a row before it takes over. */
  enterFrames: number;
  /** How much nearer a new cell's centre must be than the sounding one's, in cell widths,
   *  before it may take over: a hand resting on a border does not flicker between two. */
  hysteresis: number;
  /** Seconds the sounding cell is kept after the hand leaves the grid or is lost. */
  releaseS: number;
}

export interface CellChoice {
  /** The cell in force, or null. */
  active: number | null;
  /** The cell the hand is moving to, not yet in force, or null. */
  candidate: number | null;
}

export interface CellTracker {
  /** One camera frame: the point (null when the hand is not seen) at engine time `t`. */
  push(cells: readonly MapCell[], p: { x: number; y: number } | null, t: number, aspect: number, shape: 'hex' | 'rect'): CellChoice;
  reset(): void;
}

export function createCellTracker(opts: CellTrackerOptions): CellTracker {
  let active: number | null = null;
  let candidate: number | null = null;
  let count = 0;
  let goneSince: number | null = null;
  return {
    push(cells, p, t, aspect, shape) {
      const hit = p ? cellAt(cells, p, aspect, shape) : null;
      if (!hit || !p) {
        candidate = null;
        count = 0;
        if (active !== null) {
          goneSince ??= t;
          if (t - goneSince >= opts.releaseS) {
            active = null;
            goneSince = null;
          }
        }
        return { active, candidate };
      }
      goneSince = null;
      if (hit.index === active) {
        candidate = null;
        count = 0;
        return { active, candidate };
      }
      if (active !== null && active < cells.length) {
        const held = cellDistance(cells[active], p, aspect, shape);
        if (held - hit.distance < opts.hysteresis) {
          candidate = null;
          count = 0;
          return { active, candidate };
        }
      }
      count = hit.index === candidate ? count + 1 : 1;
      candidate = hit.index;
      if (count >= opts.enterFrames) {
        active = hit.index;
        candidate = null;
        count = 0;
      }
      return { active, candidate };
    },
    reset() {
      active = null;
      candidate = null;
      count = 0;
      goneSince = null;
    },
  };
}

// ---- What a move does ----------------------------------------------------------------

const MOVE_TEXT: Readonly<Record<number, string>> = {
  1: '2nd up',
  2: '3rd up',
  3: '4th up',
  4: '4th down',
  5: '3rd down',
  6: '2nd down',
};

/** What moving from `from` to `to` is, in scale steps ("3rd up"), or '' for no move. */
export function moveText(from: number, to: number): string {
  return MOVE_TEXT[mod(to - from, DEGREES)] ?? '';
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
