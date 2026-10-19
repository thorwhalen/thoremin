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
import { classifyChord, diatonicChord, diatonicTriad, letterChordSpec, letterDegree, midiToName, NOTE_LETTERS, romanNumeral, SCALE_TYPES, type ChordQuality, type ScaleSpec } from '@thoremin/sdk/music/theory';
import { chordName, chordSymbol, diatonicChords as harmonyChords, functionOf, keyOf, type Chord, type Key } from '@thoremin/sdk/harmony/chord';
import { parseChordName } from './guitar';
import { HEX_NEIGHBOURS, HEX_ROW_STEP, cellAt as layoutCellAt, cellDistance as layoutCellDistance, hexLattice, latticeChord, strip, type Cell, type Region } from '@thoremin/sdk/harmony/layout';
import { createCellTracker as createNavTracker, type CellChoice, type CellTrackerOptions } from '@thoremin/sdk/harmony/navigate';
import { RELATIONS } from '@thoremin/sdk/harmony/space';
import type { CellGrid, GridCaption, GridCell } from '@thoremin/sdk/nodes/cell_grid';

/** The number of chords a key has, and so the period of every layout. */
export const DEGREES = 7;

export const CHORD_MAP_LAYOUTS = ['harmonic', 'fifths', 'scale'] as const;
export type ChordMapLayoutId = (typeof CHORD_MAP_LAYOUTS)[number];
/** Where the map keeps its place (H13 of #613): `home`, the key's tonic in the middle, the map
 *  laid out again for each key; `letters`, the seven letters stay where they are (C in the
 *  middle), so a key's home is where its tonic's letter sits (A minor's on the A cells, vi's
 *  place in C) and a modulation relights only the chords it changes (C to G: ii, IV and vii°). */
export const CHORD_MAP_ANCHORS = ['home', 'letters'] as const;
export type ChordMapAnchor = (typeof CHORD_MAP_ANCHORS)[number];

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
  /** The chord's tones on the spec's register: the triad, or the seventh chord (four notes). */
  tones: number[];
}

/**
 * The seven chords of a key, spelled in the key (the third chord of F major is "Am", its
 * fourth "Bb", not "A#"), with each one's triad on the spec's register; `size` 4 names and
 * voices the key's seventh chords (Cmaj7, Dm7, G7, Bø7), where neighbours a third apart share
 * three tones. A key without seven
 * notes is read through its seven-note embedding (a pentatonic melody's chords are its parent
 * major's), keeping the register. Names, symbols and numerals are the harmony layer's chord
 * model (`@thoremin/sdk/harmony/chord`).
 */
export function diatonicChords(spec: ScaleSpec, size: 3 | 4 = 3): DiatonicChord[] {
  const key = letterChordSpec(spec);
  const k = keyOf(key);
  const triads = harmonyChords(k);
  return harmonyChords(k, size).map((chord, degree) => {
    const triad = diatonicTriad(key, degree);
    const quality = classifyChord(triad)?.quality ?? 'unknown';
    const tones = diatonicChord(key, degree, size);
    // A seventh the guitar cannot voice (a half-diminished one) strums as its triad.
    const symbol = chordSymbol(chord, k);
    return {
      degree,
      root: chord.root,
      name: chordName(chord, k),
      symbol: size === 3 || parseChordName(symbol) ? symbol : chordSymbol(triads[degree], k),
      numeral: size === 3 ? romanNumeral(degree, quality) : (functionOf(chord, k)?.numeral ?? romanNumeral(degree, quality)),
      quality,
      triad,
      tones,
    };
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

/** The cells with their degree IN THE KEY: as laid out with `home` (the layout's degrees are
 *  the key's), else each cell's letter (its degree read in C, the layout's reference) as the
 *  degree that letter is in this key (`letterDegree`: F in G major is F#, vii°). */
export function keyedCells(cells: readonly MapCell[], anchor: ChordMapAnchor, spec: ScaleSpec): MapCell[] {
  if (anchor === 'home') return [...cells];
  return cells.map((c) => ({ ...c, degree: letterDegree(spec, NOTE_LETTERS[c.degree]) }));
}

/** The chord each letter shows (by letter, C first): the key's chords as shown (triads or
 *  sevenths, the face's parallel), each on the letter the key's own spelling gives its degree.
 *  What a modulation compares. */
export function letterChordNames(chords: readonly DiatonicChord[], letterSpec: ScaleSpec): string[] {
  return NOTE_LETTERS.map((l) => chords[letterDegree(letterSpec, l)]?.name ?? '');
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

/** The melody hand's note sets, from the fewest to the most (the video's right hand, whose tilt
 *  morphs between the chord's tones, the chord's pentatonic and the full scale): they nest. */
export const MELODY_SETS = ['chord', 'pentatonic', 'scale'] as const;
export type MelodySet = (typeof MELODY_SETS)[number];

const MAJOR_PENTATONIC = SCALE_TYPES.pentatonic.intervals;

/** The key's major pentatonics: one on every note of the key whose five notes all lie in it
 *  (C, F and G in C major, and in A minor). */
export function keyPentatonics(spec: ScaleSpec): number[][] {
  const scale = new Set(scaleOf(spec));
  return [...scale].map((r) => MAJOR_PENTATONIC.map((i) => mod(r + i, 12))).filter((pent) => pent.every((p) => scale.has(p)));
}

/**
 * The CHORD's pentatonic (the deep research on the video, §5): the key's pentatonic that holds the
 * chord's tones, so chord tones lie inside it and it inside the scale, and tilting the melody hand
 * only ever adds notes (C and Am: C pentatonic; F and Dm: F's; G and Em: G's). A chord no
 * pentatonic holds (vii°: a pentatonic has no tritone) takes the one sharing most of its tones,
 * the key's dominant on a tie (B°: G pentatonic). With no chord, the tonic's.
 */
export function pentatonicOf(spec: ScaleSpec, chordTones: readonly number[] = []): number[] {
  const pents = keyPentatonics(spec);
  if (pents.length === 0) return [];
  const pcs = [...new Set(chordTones.slice(0, 3).map((n) => mod(n, 12)))];
  const key = letterChordSpec(spec);
  const tonic = mod(key.root, 12);
  if (pcs.length === 0) return pents.find((p) => p[0] === tonic) ?? pents[0];
  const dominant = mod(scaleOf(spec)[4], 12);
  const score = (pent: number[]) => pcs.filter((p) => pent.includes(p)).length;
  return [...pents].sort((a, b) => score(b) - score(a) || Number(b[0] === dominant) - Number(a[0] === dominant))[0];
}

/** The key's seven pitch classes. */
export function scaleOf(spec: ScaleSpec): number[] {
  const key = letterChordSpec(spec);
  return SCALE_TYPES[key.type].intervals.map((i) => mod(key.root + i, 12));
}

/** A ladder over any set of pitch classes: every note of the set from the first `first` (a pitch
 *  class) at or above `baseMidi`, for `octaves` octaves, and that note again on top. */
export function setLadder(pcs: readonly number[], first: number, baseMidi: number, octaves: number): number[] {
  if (pcs.length === 0) return [];
  const start = baseMidi + mod(first - baseMidi, 12);
  const offsets = [...new Set(pcs.map((p) => mod(p - first, 12)))].sort((a, b) => a - b);
  const notes: number[] = [];
  for (let o = 0; o < octaves; o++) for (const off of offsets) notes.push(start + 12 * o + off);
  notes.push(start + 12 * octaves);
  return notes;
}

/** The melody ladder for a set: the chord's tones, the chord's pentatonic or the scale, each from
 *  the chord's root, so the three ladders share their bottom note and nest. */
export function melodyNotesFor(set: MelodySet, chordTones: readonly number[], spec: ScaleSpec, baseMidi: number, octaves: number): number[] {
  if (set === 'chord') return melodyLadder(chordTones, baseMidi, octaves);
  const first = chordTones.length ? mod(chordTones[0], 12) : mod(letterChordSpec(spec).root, 12);
  return setLadder(set === 'pentatonic' ? pentatonicOf(spec, chordTones) : scaleOf(spec), first, baseMidi, octaves);
}

/** How far the melody hand tilts (degrees, either way) at each set's lower edge, and the margin
 *  a tilt must pass an edge by to change set (so a hand on an edge does not flicker). */
export const MELODY_TILT_EDGES: Readonly<Record<MelodySet, number>> = { chord: 0, pentatonic: 20, scale: 45 };
export const MELODY_TILT_HYSTERESIS = 5;

/** The set a tilt picks, held while within the hysteresis of the current set's edges: an
 *  upright hand plays the chord's tones, tilted the pentatonic, tilted further the whole scale. */
export function setForTilt(tiltDeg: number, current: MelodySet): MelodySet {
  const t = Math.abs(tiltDeg);
  const plain: MelodySet = t >= MELODY_TILT_EDGES.scale ? 'scale' : t >= MELODY_TILT_EDGES.pentatonic ? 'pentatonic' : 'chord';
  if (plain === current) return current;
  const i = MELODY_SETS.indexOf(current);
  const lo = MELODY_TILT_EDGES[current] - (i > 0 ? MELODY_TILT_HYSTERESIS : 0);
  const next = MELODY_SETS[i + 1];
  const hi = next ? MELODY_TILT_EDGES[next] + MELODY_TILT_HYSTERESIS : Infinity;
  return t >= lo && t < hi ? current : plain;
}

/** The band a height picks on a ladder of `n` notes over a region (the top band the highest
 *  note), or null outside the region's width. */
export function ladderBand(region: Region, n: number, p: { x: number; y: number } | null): number | null {
  if (!p || n <= 0 || p.x < region.x0 || p.x > region.x1) return null;
  const f = (region.y1 - p.y) / (region.y1 - region.y0);
  return Math.min(n - 1, Math.max(0, Math.floor(f * n)));
}

// ---- The picture -----------------------------------------------------------------------

/** What the ladder's caption calls each note set, and how far above the ladder it sits. */
const SET_CAPTION: Readonly<Record<MelodySet, string>> = { chord: 'chord tones', pentatonic: 'pentatonic', scale: 'scale' };
const LADDER_CAPTION_GAP = 0.03;

/** The colour of a melody band no chord is sounding over. */
const IDLE_BAND_COLOR = '#cbd5e1';

export interface ChordMapView {
  layout: ChordMapLayoutId;
  cells: readonly MapCell[];
  chords: readonly DiatonicChord[];
  choice: CellChoice;
  /** The moves around the active cell are shown (hex only). */
  captions: boolean;
  /** The melody ladder: its region, notes, the band played and its note set, or null with no ladder. */
  ladder: { region: Region; notes: readonly number[]; band: number | null; set?: MelodySet } | null;
  /** The points that choose (display fractions). */
  pointers: readonly { x: number; y: number }[];
  /** The cells as laid out, when `cells` carries degrees in the key (the letters map): the move
   *  captions are read from these, where a cell's neighbours are (both degrees in one frame). */
  laidOut?: readonly MapCell[];
  /** A mark per cell (aligned with `cells`): its home, or relit by a modulation. */
  marks?: readonly (GridCell['mark'] | undefined)[];
}

/** The chord map as the overlay's cell grid. */
export function chordMapGrid(view: ChordMapView): CellGrid {
  const shape = LAYOUTS[view.layout].shape;
  const active = view.choice.active !== null ? view.cells[view.choice.active] : undefined;
  const cells: GridCell[] = view.cells.map((cell, i) => {
    const chord = view.chords[cell.degree];
    const state = i === view.choice.active ? 'active' : i === view.choice.candidate ? 'candidate' : 'idle';
    const mark = view.marks?.[i];
    return { x: cell.x, y: cell.y, w: cell.w, h: cell.h, shape, label: chord?.name ?? '', sub: chord?.numeral ?? '', color: DEGREE_COLORS[cell.degree], state, ...(mark ? { mark } : {}) };
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
  const laidOutActive = view.choice.active !== null ? (view.laidOut ?? view.cells)[view.choice.active] : undefined;
  const captions = view.captions && laidOutActive ? neighbourCaptions(view.layout, laidOutActive) : [];
  if (view.ladder?.set) {
    const { region, set } = view.ladder;
    captions.push({ x: (region.x0 + region.x1) / 2, y: region.y0 - LADDER_CAPTION_GAP, text: SET_CAPTION[set] });
  }
  return { cells, captions, pointers: [...view.pointers] };
}
