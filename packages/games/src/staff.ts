/**
 * A song on a staff, drawn on the stage's canvas and kept in time with it: a note's head stands
 * where its onset is on the time axis the caller gives (`xOf`), so the staff scrolls with a piano
 * roll beside it (proportional notation: space is time, not a page's even spacing). That is why
 * the staff is drawn here rather than engraved by a notation library: an engraver lays a page out
 * once and cannot move it in step with the game's clock.
 *
 * What is written: the clef by range (treble, bass, or both as a grand staff), a one-line
 * percussion staff for a rhythm, the key's signature, heads hollow or filled by their length in
 * beats with stems, flags and dots, ledger lines, accidentals carried through the bar
 * (`spelling`), and the barlines of the song's meter. Rests are the gaps between notes.
 *
 * `staffLayout` is pure (positions only); `drawStaff` paints it.
 */
import { BG, TEXT } from './paint';
import { barAccidentals, diatonicStep, signature, spell, type Accidental, type KeyFifths, type Letter, type Spelled } from './spelling';

export const STAFF_MODES = ['off', 'over', 'only'] as const;
export type StaffMode = (typeof STAFF_MODES)[number];

/** Each mode's name for a player. */
export const STAFF_MODE_LABELS: Record<StaffMode, string> = { off: 'Staff: off', over: 'Staff: with the notes', only: 'Staff only' };

export type Clef = 'treble' | 'bass' | 'grand' | 'percussion';

/** The song's beat grid on the engine clock: beat 0's time, a beat's length, beats in a bar. */
export interface BeatGrid {
  t0: number;
  beatS: number;
  beatsPerBar: number;
}

export interface StaffNote {
  start: number;
  end: number;
  midi?: number;
  state?: 'pending' | 'active' | 'hit' | 'miss';
}

export interface StaffBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface StaffOptions {
  /** The key signature in fifths (sharps positive). Default 0, C major. */
  key?: KeyFifths;
  /** The pitch range the whole song spans (MIDI), which chooses the clef once for the song. */
  range?: { low: number; high: number };
}

/** The bottom line's diatonic step and the line count of each staff (E4 and G2; C4 = 28). */
const TREBLE_BOTTOM = 30;
const BASS_BOTTOM = 18;
/** Below this, a grand staff's note goes on the bass staff. */
const MIDDLE_C = 60;
/** Spaces between a grand staff's two staves. */
const GRAND_GAP = 4;

/** The clef a range reads best on: treble down to F3, bass up to G4, else both. */
export function clefFor(low: number, high: number): Exclude<Clef, 'percussion'> {
  if (low >= 53) return 'treble';
  if (high <= 67) return 'bass';
  return 'grand';
}

/** A written length: the largest standard value (dotted or not) that fits in the note's beats. */
export interface NoteValue {
  beats: number;
  hollow: boolean;
  stem: boolean;
  flags: number;
  dot: boolean;
}

const VALUES: readonly NoteValue[] = [
  { beats: 4, hollow: true, stem: false, flags: 0, dot: false },
  { beats: 3, hollow: true, stem: true, flags: 0, dot: true },
  { beats: 2, hollow: true, stem: true, flags: 0, dot: false },
  { beats: 1.5, hollow: false, stem: true, flags: 0, dot: true },
  { beats: 1, hollow: false, stem: true, flags: 0, dot: false },
  { beats: 0.75, hollow: false, stem: true, flags: 1, dot: true },
  { beats: 0.5, hollow: false, stem: true, flags: 1, dot: false },
  { beats: 0.25, hollow: false, stem: true, flags: 2, dot: false },
];

export const noteValue = (beats: number): NoteValue => VALUES.find((v) => beats >= v.beats - 1e-6) ?? VALUES[VALUES.length - 1];

/** One written note: its head's centre, its value, its sign, its ledger lines, its stem's direction. */
export interface Head {
  x: number;
  y: number;
  value: NoteValue;
  accidental: Accidental;
  ledgers: number[];
  stemUp: boolean;
  /** The head sits on a line (its dot goes in the space above). */
  onLine: boolean;
  state: NonNullable<StaffNote['state']>;
  spelled?: Spelled;
}

export interface StaffLayout {
  clef: Clef;
  /** A line gap, pixels. */
  space: number;
  /** Each staff's five lines (one for percussion), top to bottom, with its clef. */
  staves: { clef: Exclude<Clef, 'grand'>; lines: number[] }[];
  heads: Head[];
  /** Barline x positions, and their top and bottom. */
  bars: number[];
  top: number;
  bottom: number;
}

/** Where a song's notes go on a staff in a box, onsets at `xOf(start)`. */
export function staffLayout(notes: readonly StaffNote[], box: StaffBox, xOf: (t: number) => number, grid: BeatGrid, opts: StaffOptions = {}): StaffLayout {
  const key = opts.key ?? 0;
  const pitched = notes.length > 0 && notes.every((n) => n.midi !== undefined);
  const midis = notes.flatMap((n) => (n.midi === undefined ? [] : [n.midi]));
  const range = opts.range ?? { low: Math.min(...midis, 60), high: Math.max(...midis, 60) };
  const clef: Clef = pitched || midis.length ? clefFor(range.low, range.high) : 'percussion';
  const h = box.bottom - box.top;
  // Spaces the staff needs with room for a few ledger lines either side.
  const spaces = clef === 'grand' ? 8 + GRAND_GAP + 6 : clef === 'percussion' ? 6 : 10;
  const space = Math.max(5, Math.min(16, h / spaces));
  const mid = (box.top + box.bottom) / 2;
  const staves: StaffLayout['staves'] = [];
  /** The y of a diatonic step on a staff whose bottom line is at `bottomY`. */
  const yOn = (bottomY: number, bottomStep: number) => (step: number) => bottomY - ((step - bottomStep) * space) / 2;
  let trebleY: ((s: number) => number) | null = null;
  let bassY: ((s: number) => number) | null = null;
  const fiveLines = (bottomY: number) => [4, 3, 2, 1, 0].map((k) => bottomY - k * space);
  if (clef === 'percussion') staves.push({ clef: 'percussion', lines: [mid] });
  else if (clef === 'grand') {
    const trebleBottom = mid - (GRAND_GAP / 2) * space;
    const bassBottom = mid + (GRAND_GAP / 2 + 4) * space;
    trebleY = yOn(trebleBottom, TREBLE_BOTTOM);
    bassY = yOn(bassBottom, BASS_BOTTOM);
    staves.push({ clef: 'treble', lines: fiveLines(trebleBottom) }, { clef: 'bass', lines: fiveLines(bassBottom) });
  } else {
    const bottom = mid + 2 * space;
    if (clef === 'treble') trebleY = yOn(bottom, TREBLE_BOTTOM);
    else bassY = yOn(bottom, BASS_BOTTOM);
    staves.push({ clef, lines: fiveLines(bottom) });
  }

  const barS = grid.beatS * grid.beatsPerBar;
  const barOf = (t: number) => Math.floor((t - grid.t0) / barS + 1e-6);
  const ordered = [...notes].sort((a, b) => a.start - b.start);
  const spelled = ordered.map((n) => (n.midi === undefined ? null : spell(n.midi, key)));
  const signs = barAccidentals(
    ordered.flatMap((n, i) => (spelled[i] ? [{ spelled: spelled[i]!, bar: barOf(n.start) }] : [])),
    key,
  );
  let s = 0;
  const heads: Head[] = ordered.map((n, i) => {
    const value = noteValue((n.end - n.start) / grid.beatS);
    const x = xOf(n.start);
    const state = n.state ?? 'pending';
    const w = spelled[i];
    if (!w) return { x, y: mid, value, accidental: null, ledgers: [], stemUp: true, onLine: true, state };
    const accidental = signs[s++];
    const onTreble = clef === 'treble' || (clef === 'grand' && n.midi! >= MIDDLE_C);
    const [yOf, bottomStep] = onTreble ? [trebleY!, TREBLE_BOTTOM] : [bassY!, BASS_BOTTOM];
    const step = diatonicStep(w);
    const topStep = bottomStep + 8;
    const ledgers: number[] = [];
    for (let l = bottomStep - 2; l >= step; l -= 2) ledgers.push(yOf(l));
    for (let l = topStep + 2; l <= step; l += 2) ledgers.push(yOf(l));
    return { x, y: yOf(step), value, accidental, ledgers, stemUp: step < bottomStep + 4, onLine: (step - bottomStep) % 2 === 0, state, spelled: w };
  });

  const bars: number[] = [];
  const t0 = Math.min(...ordered.map((n) => n.start), grid.t0);
  const t1 = Math.max(...ordered.map((n) => n.end), grid.t0);
  for (let b = Math.ceil((t0 - grid.t0) / barS - 1e-6); grid.t0 + b * barS <= t1 + 1e-6; b++) {
    if (b > 0) bars.push(xOf(grid.t0 + b * barS));
  }
  const allLines = staves.flatMap((st) => st.lines);
  return { clef, space, staves, heads, bars, top: Math.min(...allLines), bottom: Math.max(...allLines) };
}

const HEAD_COLOR: Record<Head['state'], string> = { pending: '#cbd5e1', active: '#ffffff', hit: '#f5d142', miss: '#ef4444' };
const LINE = 'rgba(229,231,235,0.55)';
const SIGN: Record<Exclude<Accidental, null>, string> = { sharp: '♯', flat: '♭', natural: '♮' };
/** Music fonts first; a system symbol font has the clefs on most devices, and a serif is the last resort. */
const MUSIC_FONT = "'Bravura', 'Noto Music', 'Apple Symbols', 'Segoe UI Symbol', serif";
const CLEF_GLYPH = { treble: '\u{1D11E}', bass: '\u{1D122}' } as const;
/** A code point no font draws: a clef as wide as it is the missing-glyph box, so no music font is there. */
const NO_GLYPH = '\u{10FFFE}';

let clefsDrawable: boolean | undefined;
/** Whether this device draws the clef glyphs (asked once; a canvas that cannot measure says no). */
function canDrawClefs(g: CanvasRenderingContext2D): boolean {
  if (clefsDrawable !== undefined) return clefsDrawable;
  try {
    g.font = `40px ${MUSIC_FONT}`;
    clefsDrawable = Math.abs(g.measureText(CLEF_GLYPH.treble).width - g.measureText(NO_GLYPH).width) > 0.5;
  } catch {
    clefsDrawable = false;
  }
  return clefsDrawable;
}

/** A clef: its glyph where a font has it, else its letter (G on the second line, F on the fourth), as clefs began. */
function drawClef(g: CanvasRenderingContext2D, clef: 'treble' | 'bass', x: number, top: number, bottom: number, s: number) {
  if (canDrawClefs(g)) {
    if (clef === 'treble') glyph(g, CLEF_GLYPH.treble, x, (top + bottom) / 2 + 0.35 * s, 6.4 * s, TEXT);
    else glyph(g, CLEF_GLYPH.bass, x, top + 1.6 * s, 3.6 * s, TEXT);
    return;
  }
  g.fillStyle = TEXT;
  g.font = `italic 700 ${Math.round(3.4 * s)}px Georgia, 'Times New Roman', serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(clef === 'treble' ? 'G' : 'F', x, clef === 'treble' ? bottom - s : top + s);
}

function glyph(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string) {
  g.fillStyle = color;
  g.font = `${Math.round(size)}px ${MUSIC_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(s, x, y);
}

function stroke(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string, width: number) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
}

/**
 * Paint a staff layout in its box: the lines, the barlines, the notes, then the clef and the key
 * over a panel at the left edge (notes pass under it), and the now line at `nowX` when given.
 */
export function drawStaff(g: CanvasRenderingContext2D, L: StaffLayout, box: StaffBox, opts: { nowX?: number; key?: KeyFifths; panel?: boolean } = {}): void {
  const s = L.space;
  if (opts.panel) {
    g.globalAlpha = 0.8;
    g.fillStyle = BG;
    g.fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
    g.globalAlpha = 1;
  }
  for (const st of L.staves) for (const y of st.lines) stroke(g, box.left, y, box.right, y, LINE, 1);
  // A barline just before its downbeat's head, so the two do not overlap.
  for (const bar of L.bars) {
    const x = bar - 1.4 * s;
    if (x > box.left && x < box.right) stroke(g, x, L.top, x, L.bottom, LINE, 1.2);
  }
  const headW = 1.3 * s;
  for (const h of L.heads) {
    if (h.x < box.left - headW || h.x > box.right + headW) continue;
    const color = HEAD_COLOR[h.state];
    for (const y of h.ledgers) stroke(g, h.x - headW * 0.85, y, h.x + headW * 0.85, y, LINE, 1);
    g.fillStyle = color;
    g.strokeStyle = color;
    g.lineWidth = Math.max(1.2, s * 0.16);
    g.beginPath();
    g.ellipse(h.x, h.y, headW / 2, s / 2 - 0.5, -0.35, 0, Math.PI * 2);
    if (h.value.hollow) g.stroke();
    else g.fill();
    if (h.value.dot) {
      // A dot sits in a space: a head on a line has its dot in the space above.
      g.beginPath();
      g.arc(h.x + headW * 0.85, h.onLine ? h.y - s / 2 : h.y, s * 0.15, 0, Math.PI * 2);
      g.fill();
    }
    if (h.accidental) glyph(g, SIGN[h.accidental], h.x - headW * 1.05, h.y, 1.9 * s, color);
    if (h.value.stem) {
      const x = h.stemUp ? h.x + headW / 2 - 0.6 : h.x - headW / 2 + 0.6;
      const tip = h.stemUp ? h.y - 3.5 * s : h.y + 3.5 * s;
      stroke(g, x, h.y, x, tip, color, Math.max(1, s * 0.12));
      for (let f = 0; f < h.value.flags; f++) {
        const y = tip + (h.stemUp ? 1 : -1) * f * 0.8 * s;
        stroke(g, x, y, x + 0.9 * s, y + (h.stemUp ? 1.4 : -1.4) * s, color, Math.max(1.2, s * 0.2));
      }
    }
  }
  if (opts.nowX !== undefined) stroke(g, opts.nowX, L.top - 2 * s, opts.nowX, L.bottom + 2 * s, 'rgba(255,255,255,0.7)', 2);
  // The clef and the key signature on a panel, so the notes pass under them.
  const sig = signature(opts.key ?? 0);
  const sigLetters = Object.entries(sig).filter(([, a]) => a !== 0);
  const panelW = 3.2 * s + sigLetters.length * 0.9 * s;
  g.fillStyle = BG;
  const panelTop = Math.max(box.top, L.top - 4.5 * s);
  g.fillRect(box.left, panelTop, panelW, Math.min(box.bottom, L.bottom + 4.5 * s) - panelTop);
  for (const st of L.staves) {
    const top = st.lines[0];
    const bottom = st.lines[st.lines.length - 1];
    for (const y of st.lines) stroke(g, box.left, y, box.left + panelW, y, LINE, 1);
    if (st.clef !== 'percussion') drawClef(g, st.clef, box.left + 1.4 * s, top, bottom, s);
    else {
      // The percussion clef: two short bars.
      stroke(g, box.left + 1.2 * s, top - s, box.left + 1.2 * s, top + s, TEXT, 2);
      stroke(g, box.left + 1.7 * s, top - s, box.left + 1.7 * s, top + s, TEXT, 2);
      continue;
    }
    // The signature's signs on their lines and spaces in signature order (steps above the treble's
    // bottom line; the bass staff's sit two steps lower).
    const sharps = (opts.key ?? 0) > 0;
    const order = sharps ? SHARP_STEPS : FLAT_STEPS;
    order
      .filter(([l]) => sig[l] !== 0)
      .forEach(([, step], k) => {
        const y = bottom - ((step - (st.clef === 'bass' ? 2 : 0)) * s) / 2;
        glyph(g, sharps ? SIGN.sharp : SIGN.flat, box.left + 3 * s + k * 0.9 * s, y, 1.8 * s, TEXT);
      });
  }
}

/** Where a signature's sharps and flats go, in order: steps above the treble staff's bottom line. */
const SHARP_STEPS: readonly [Letter, number][] = [['F', 8], ['C', 5], ['G', 9], ['D', 6], ['A', 3], ['E', 7], ['B', 4]];
const FLAT_STEPS: readonly [Letter, number][] = [['B', 4], ['E', 7], ['A', 3], ['D', 6], ['G', 2], ['C', 5], ['F', 1]];
