/**
 * The chord map's melody hand and seventh chords, after the video's notes (its right hand's
 * tilt morphs the melody between the chord's tones, the pentatonic and the whole scale; with
 * sevenths, neighbours a third apart share three tones): the note sets in several keys, the
 * tilt-to-set rule with hysteresis, the node switching its ladder as a synthetic hand tilts, and
 * seventh chords held, named and strummed.
 */
import { describe, it, expect } from 'vitest';
import { diatonicChords, melodyNotesFor, pentatonicOf, scaleOf, setForTilt, setLadder, layoutCells } from '@thoremin/ext-harmony/lib/chord_map';
import { chordMapNode, chordMapRegions, handTilt, CHORD_MAP_MELODY_VOICE_ID, CHORD_MAP_VOICE_ID_BASE, type ChordMapStatus } from '@thoremin/ext-harmony/nodes/chord_map';
import { guitarVoicing, parseChordName } from '@thoremin/sdk/music/guitar';
import { freqToMidi, midiToName, type ScaleSpec } from '@thoremin/sdk/music/theory';
import { makeHandKeypoints, type Hand, type HandsFrame, type SynthParams } from '@thoremin/sdk/nodes/domain';
import type { NoteEvent } from '@thoremin/sdk/nodes/note_events';
import { chordMapTake, palmAt, W, H } from './synthetic_chord_map';

const C: ScaleSpec = { root: 0, type: 'major', octaves: 2, baseOctave: 3 };
const A_MINOR: ScaleSpec = { root: 9, type: 'minor', octaves: 2, baseOctave: 3 };
const names = (ns: number[]) => ns.map(midiToName);

describe('the melody note sets', () => {
  it('are the chord\'s tones, the chord\'s pentatonic or the whole scale, from the chord\'s root', () => {
    const chords = diatonicChords(C);
    const pent = (d: number) => pentatonicOf(C, chords[d].triad)[0];
    expect([0, 1, 2, 3, 4, 5, 6].map(pent)).toEqual([0, 5, 7, 5, 7, 0, 7]); // C F G F G C, and B° G's
    expect(scaleOf(C)).toEqual([0, 2, 4, 5, 7, 9, 11]);
    const em = chords[2].tones;
    expect(names(melodyNotesFor('chord', em, C, 60, 1))).toEqual(['E4', 'G4', 'B4', 'E5']);
    expect(names(melodyNotesFor('pentatonic', em, C, 60, 1))).toEqual(['E4', 'G4', 'A4', 'B4', 'D5', 'E5']);
    expect(names(melodyNotesFor('scale', em, C, 60, 1))).toEqual(['E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5']);
    expect(pentatonicOf(A_MINOR, []).sort((a, b) => a - b)).toEqual([0, 2, 4, 7, 9]); // the tonic's: A C D E G
    expect(setLadder([], 0, 60, 2)).toEqual([]);
  });

  it('nest for six of the seven chords, in every key: chord tones in the chord\'s pentatonic in the scale', () => {
    for (const spec of [C, A_MINOR, { ...C, root: 5 }, { ...A_MINOR, root: 2 }]) {
      const scale = new Set(scaleOf(spec));
      diatonicChords(spec).forEach((chord, d) => {
        const pent = new Set(pentatonicOf(spec, chord.triad));
        for (const p of pent) expect(scale.has(p), `${d}`).toBe(true);
        const inside = chord.triad.every((n) => pent.has(((n % 12) + 12) % 12));
        expect(inside, `degree ${d}`).toBe(chord.quality !== 'dim'); // the diminished chord alone has a tritone
      });
    }
  });

  it('picks a set by tilt, upright to chord tones, holding a set within 5 degrees of its edges', () => {
    expect([0, 10, 25, 50, -30, -60].map((t) => setForTilt(t, 'chord'))).toEqual(['chord', 'chord', 'pentatonic', 'scale', 'pentatonic', 'scale']);
    expect(setForTilt(17, 'pentatonic')).toBe('pentatonic'); // within the margin below its edge (20)
    expect(setForTilt(14, 'pentatonic')).toBe('chord');
    expect(setForTilt(48, 'pentatonic')).toBe('pentatonic'); // within the margin above the next edge (45)
    expect(setForTilt(51, 'pentatonic')).toBe('scale');
    expect(setForTilt(42, 'scale')).toBe('scale');
    expect(setForTilt(38, 'scale')).toBe('pentatonic');
  });
});

/** A hand like `palmAt`'s, rotated in the picture by `deg` around its wrist. */
function tilted(p: { x: number; y: number }, deg: number, handedness: 'Left' | 'Right'): Hand {
  const h = palmAt(p, handedness);
  const w = h.keypoints[0];
  const a = (deg * Math.PI) / 180;
  return { ...h, keypoints: h.keypoints.map((k) => ({ ...k, x: w.x + (k.x - w.x) * Math.cos(a) - (k.y - w.y) * Math.sin(a), y: w.y + (k.x - w.x) * Math.sin(a) + (k.y - w.y) * Math.cos(a) })) };
}

describe('the melody hand in the node', () => {
  const tonic = layoutCells('harmonic', chordMapRegions('left', 0.65).chords, { aspect: W / H, cellSize: 0.2 }).find((c) => c.q === 0 && c.r === 0)!;

  it('reads a hand\'s tilt from its knuckle line, either hand alike', () => {
    expect(handTilt({ handedness: 'Right', keypoints: makeHandKeypoints({ cx: 300, cy: 300, scale: 60, spread: 0.8, pinch: 0, handedness: 'Right' }) })).toBeCloseTo(0, 6);
    expect(Math.abs(handTilt(tilted({ x: 0.8, y: 0.5 }, 30, 'Right')))).toBeCloseTo(30, 6);
    expect(Math.abs(handTilt(tilted({ x: 0.8, y: 0.5 }, -50, 'Left')))).toBeCloseTo(50, 6);
  });

  it('switches the ladder as the melody hand tilts, with tilt mode on', () => {
    const h = chordMapNode.make(chordMapNode.params.parse({}));
    const sets: string[] = [];
    let ladderLen = 0;
    for (let i = 0; i < 90; i++) {
      const t = i / 30;
      const deg = t < 1 ? 0 : t < 2 ? 30 : 60;
      const frame: HandsFrame = { t, width: W, height: H, hands: [palmAt(tonic, 'Left'), tilted({ x: 0.82, y: 0.5 }, deg, 'Right')] };
      const out = h.process({ hands: frame, config: { enabled: true, mirrorHandedness: false, melodyNotes: 'tilt' }, spec: C, octaveShift: 0 }, { time: t, dt: 1 / 30, tick: i, resources: {} } as never) as unknown as { status: ChordMapStatus; grid: { cells: { shape: string }[] } };
      if (sets.at(-1) !== out.status.melodySet) sets.push(out.status.melodySet);
      ladderLen = out.grid.cells.filter((c) => c.shape === 'rect').length;
    }
    expect(sets).toEqual(['chord', 'pentatonic', 'scale']);
    expect(ladderLen).toBe(15); // two octaves of the scale, and the top note
  });
});

describe('seventh chords', () => {
  const tonic = () => layoutCells('harmonic', chordMapRegions('left', 0.65).chords, { aspect: W / H, cellSize: 0.2 }).find((c) => c.q === 0 && c.r === 0)!;

  it('names the key\'s sevenths, strums what a guitar can voice and the half-diminished as its triad', () => {
    const s = diatonicChords(C, 4);
    expect(s.map((c) => c.name)).toEqual(['Cmaj7', 'Dm7', 'Em7', 'Fmaj7', 'G7', 'Am7', 'Bø7']);
    expect(s.map((c) => c.numeral)).toEqual(['Imaj7', 'ii7', 'iii7', 'IVmaj7', 'V7', 'vi7', 'viiø']);
    expect(s.map((c) => c.symbol)).toEqual(['Cmaj7', 'Dm7', 'Em7', 'Fmaj7', 'G7', 'Am7', 'Bdim']);
    expect(s[0].tones).toHaveLength(4);
  });

  it('holds Cmaj7 on the chord voices and shows its four tones', () => {
    const h = chordMapNode.make(chordMapNode.params.parse({}));
    let last: { params: SynthParams; triad: number[] } | undefined;
    for (const f of chordMapTake({ duration: 0.5, chordAt: () => tonic() })) {
      last = h.process({ hands: f, config: { enabled: true, mirrorHandedness: false, sevenths: true }, spec: C, octaveShift: 0 }, { time: f.t!, dt: 1 / 30, tick: 0, resources: {} } as never) as unknown as typeof last;
    }
    const pcs = new Set(last!.params.voices.filter((v) => v.id >= CHORD_MAP_VOICE_ID_BASE && v.id < CHORD_MAP_MELODY_VOICE_ID && v.present).map((v) => Math.round(freqToMidi(v.freq)) % 12));
    expect(pcs).toEqual(new Set([0, 4, 7, 11]));
    expect(last!.triad.map((n) => n % 12)).toEqual([0, 4, 7, 11]);
  });

  it('strums the seventh\'s guitar voicing', () => {
    const h = chordMapNode.make(chordMapNode.params.parse({}));
    const notes: NoteEvent[] = [];
    for (const f of chordMapTake({ duration: 3, chordAt: () => tonic(), strumPeriod: 0.5 })) {
      const out = h.process({ hands: f, config: { enabled: true, mirrorHandedness: false, sevenths: true, play: 'strum' }, spec: C, octaveShift: 0 }, { time: f.t!, dt: 1 / 30, tick: 0, resources: {} } as never) as unknown as { notes: NoteEvent[] };
      notes.push(...out.notes.filter((n) => n.velocity > 0));
    }
    const voiced = guitarVoicing(parseChordName('Cmaj7')!).filter((n): n is number => n !== null);
    expect(notes.slice(0, voiced.length).map((n) => n.midi)).toEqual(voiced);
  });
});
