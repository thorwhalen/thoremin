/**
 * The `chord-map` node on synthetic performances: the chord hand's palm over a chord holds that
 * chord (its tones on the chord voices), moving to another chord follows it, a lost hand keeps
 * the chord for the release and then lets it go; the other hand's height plays the chord's tones;
 * in strum mode the other hand's strums sound the chord under the chord hand as a guitar voicing,
 * most of them predicted ahead; nothing sounds with the dial off. The grid it emits is what the
 * overlay draws.
 */
import { describe, it, expect } from 'vitest';
import { chordMapNode, chordMapRegions, CHORD_MAP_MELODY_VOICE_ID, CHORD_MAP_VOICE_ID_BASE, type ChordMapStatus } from '@thoremin/ext-air/nodes/chord_map';
import type { NoteEvent } from '@thoremin/ext-air/nodes/note_events';
import { diatonicChords, layoutCells, melodyLadder, type ChordMapLayoutId } from '@thoremin/ext-air/lib/chord_map';
import { guitarVoicing, parseChordName } from '@thoremin/ext-air/lib/guitar';
import { freqToMidi, type ScaleSpec } from '@thoremin/sdk/music/theory';
import { ABSENT_FACE, type FaceFeatures, type HandsFrame, type SynthParams } from '@thoremin/sdk/nodes/domain';
import type { CellGrid } from '@thoremin/sdk/nodes/cell_grid';
import { chordMapTake, W, H } from './synthetic_chord_map';

const C_MAJOR: ScaleSpec = { root: 0, type: 'major', octaves: 2, baseOctave: 3 };
const ON = { enabled: true, mirrorHandedness: false };

interface Out {
  params: SynthParams;
  notes: NoteEvent[];
  grid: CellGrid;
  status: ChordMapStatus;
  triad: number[];
}

function play(frames: HandsFrame[], config: Record<string, unknown>, spec: ScaleSpec = C_MAJOR, faceAt?: (t: number) => FaceFeatures) {
  const h = chordMapNode.make(chordMapNode.params.parse({}));
  const outs: { t: number; out: Out }[] = [];
  for (const f of frames) {
    const out = h.process({ hands: f, config, spec, octaveShift: 0, face: faceAt?.(f.t!) }, { time: f.t!, dt: 1 / 30, tick: 0, resources: {} } as never) as unknown as Out;
    outs.push({ t: f.t!, out });
  }
  return outs;
}

/** The cells the node lays out for these settings (the left hand points, the default sizes). */
function cellsFor(layout: ChordMapLayoutId = 'harmonic', chordHand: 'left' | 'right' = 'left') {
  return layoutCells(layout, chordMapRegions(chordHand, 0.65).chords, { aspect: W / H, cellSize: 0.2 });
}
const cellOf = (degree: number, layout: ChordMapLayoutId = 'harmonic') => {
  const cells = cellsFor(layout);
  // The cell of this degree nearest the region's middle.
  return cells.filter((c) => c.degree === degree).sort((a, b) => Math.abs(a.q) + Math.abs(a.r) - (Math.abs(b.q) + Math.abs(b.r)))[0];
};
const chordVoices = (p: SynthParams) => p.voices.filter((v) => v.id >= CHORD_MAP_VOICE_ID_BASE && v.id < CHORD_MAP_MELODY_VOICE_ID);
const soundingPcs = (p: SynthParams) => [...new Set(chordVoices(p).filter((v) => v.present && v.gain > 0).map((v) => ((Math.round(freqToMidi(v.freq)) % 12) + 12) % 12))].sort((a, b) => a - b);
const pcsOf = (degree: number) => [...new Set(diatonicChords(C_MAJOR)[degree].triad.map((n) => n % 12))].sort((a, b) => a - b);
const melody = (p: SynthParams) => p.voices.find((v) => v.id === CHORD_MAP_MELODY_VOICE_ID)!;

describe('the chord-map node, holding', () => {
  it('holds the chord under the palm, then follows a move to another', () => {
    const c = cellOf(0);
    const am = cellOf(5);
    const outs = play(chordMapTake({ duration: 2, chordAt: (t) => (t < 1 ? c : am) }), ON);
    const at = (t: number) => outs.find((o) => o.t >= t)!.out;
    expect(soundingPcs(at(0.5).params)).toEqual(pcsOf(0));
    expect(at(0.5).status).toMatchObject({ enabled: true, key: 'C', chord: 'C', numeral: 'I', pointing: true });
    expect(soundingPcs(at(1.5).params)).toEqual(pcsOf(5));
    expect(at(1.5).status.chord).toBe('Am');
    expect(at(1.5).triad).toEqual(diatonicChords(C_MAJOR)[5].triad);
    // The grid lights the chord in force.
    const active = at(1.5).grid.cells.filter((x) => x.state === 'active' && x.shape === 'hex');
    expect(active.map((x) => x.label)).toEqual(['Am']);
    expect(at(1.5).grid.captions).toHaveLength(7); // six moves, and the ladder's note set
    expect(at(1.5).grid.captions.map((c) => c.text)).toContain('chord tones');
    // Changed within a couple of camera frames of arriving (the dwell is two frames).
    const changed = outs.find((o) => o.t >= 1 && o.out.status.chord === 'Am')!;
    expect(changed.t - 1).toBeLessThanOrEqual(2 / 30 + 1e-9);
  });

  it('keeps the chord a moment after the hand is lost, then lets it go', () => {
    const outs = play(chordMapTake({ duration: 1.5, chordAt: (t) => (t < 0.5 ? cellOf(3) : null) }), ON);
    const at = (t: number) => outs.find((o) => o.t >= t)!.out;
    expect(soundingPcs(at(0.4).params)).toEqual(pcsOf(3));
    expect(soundingPcs(at(0.7).params)).toEqual(pcsOf(3)); // within the 0.3 s release
    expect(soundingPcs(at(1.0).params)).toEqual([]);
    expect(at(1.0).status).toMatchObject({ chord: null, pointing: false });
  });

  it("plays a melody on the chord's tones with the other hand's height", () => {
    const strip = chordMapRegions('left', 0.65).other;
    const bandY = (i: number, n: number) => strip.y1 - ((strip.y1 - strip.y0) / n) * (i + 0.5);
    const ladder = melodyLadder(diatonicChords(C_MAJOR)[2].triad, 60, 2); // Em, an octave above the chords (base octave 3)
    const outs = play(
      chordMapTake({ duration: 1, chordAt: () => cellOf(2), otherAt: (t) => (t < 0.5 ? { x: 0.8, y: bandY(1, ladder.length) } : { x: 0.8, y: bandY(4, ladder.length) }) }),
      ON,
    );
    const low = outs.find((o) => o.t >= 0.4)!.out;
    const high = outs.find((o) => o.t >= 0.9)!.out;
    expect(melody(low.params).present).toBe(true);
    expect(Math.round(freqToMidi(melody(low.params).freq))).toBe(ladder[1]);
    expect(Math.round(freqToMidi(melody(high.params).freq))).toBe(ladder[4]);
    expect(high.status.melody).toBe('G5');
    expect(high.grid.cells.filter((x) => x.shape === 'rect')).toHaveLength(ladder.length);
  });

  it('is silent with the melody off, and with the other hand outside its strip', () => {
    const outs = play(chordMapTake({ duration: 0.5, chordAt: () => cellOf(0), otherAt: () => ({ x: 0.8, y: 0.5 }) }), { ...ON, melody: false });
    expect(melody(outs[outs.length - 1].out.params).present).toBe(false);
    const inside = play(chordMapTake({ duration: 0.5, chordAt: () => cellOf(0), otherAt: () => ({ x: 0.3, y: 0.5 }) }), ON);
    expect(melody(inside[inside.length - 1].out.params).present).toBe(false);
  });

  it('plays the one-row layouts by the hand\'s width alone', () => {
    const cells = cellsFor('fifths');
    const outs = play(chordMapTake({ duration: 0.5, chordAt: () => ({ x: cells[2].x, y: 0.2 }) }), { ...ON, layout: 'fifths' });
    expect(outs[outs.length - 1].out.status.chord).toBe('G'); // IV I V: the third strip
  });
});

describe('the chord-map node, strumming', () => {
  const voiced = (name: string) => guitarVoicing(parseChordName(name)!).filter((n): n is number => n !== null);
  function strums(notes: NoteEvent[]): NoteEvent[][] {
    const out: NoteEvent[][] = [];
    for (const n of notes) {
      const cur = out[out.length - 1];
      if (!cur || n.t - cur[cur.length - 1].t > 0.05) out.push([n]);
      else cur.push(n);
    }
    return out;
  }

  it('strums the chord under the chord hand as a guitar voicing, most strums predicted ahead', () => {
    const outs = play(chordMapTake({ duration: 4, chordAt: (t) => (t < 2 ? cellOf(4) : cellOf(1)), strumPeriod: 0.5 }), { ...ON, play: 'strum' });
    const notes = outs.flatMap((o) => o.out.notes).filter((n) => n.velocity > 0);
    const s = strums(notes);
    const first = s.filter((x) => x[0].t < 1.9);
    const second = s.filter((x) => x[0].t > 2.2);
    expect(first.length).toBeGreaterThan(1);
    expect(second.length).toBeGreaterThan(1);
    for (const x of first) expect(x.map((n) => n.midi)).toEqual(voiced('G'));
    for (const x of second) expect(x.map((n) => n.midi)).toEqual(voiced('Dm'));
    const status = outs[outs.length - 1].out.status;
    expect(status.strums).toBe(s.length);
    expect(status.predicted / status.strums).toBeGreaterThanOrEqual(0.5);
    expect(status.ready).toBe(true);
    // Strumming holds no chord voices and draws no melody ladder.
    expect(soundingPcs(outs[outs.length - 1].out.params)).toEqual([]);
    expect(outs[outs.length - 1].out.grid.cells.every((x) => x.shape === 'hex')).toBe(true);
  });

  it('strums nothing while no chord is pointed at', () => {
    const outs = play(chordMapTake({ duration: 3, chordAt: () => null, strumPeriod: 0.5 }), { ...ON, play: 'strum' });
    expect(outs.flatMap((o) => o.out.notes)).toEqual([]);
  });
});

describe('the chord-map node, coloured by the face (H7 of #613)', () => {
  const A_MINOR: ScaleSpec = { root: 9, type: 'minor', octaves: 2, baseOctave: 3 };
  // A resting face, a smile from 0.5 s, the mouth open and the brows up from 2.2 s.
  const faceAt = (t: number): FaceFeatures => ({
    ...ABSENT_FACE,
    present: true,
    smile: t >= 0.5 ? 0.9 : 0,
    mouthOpen: t >= 2.2 ? 0.6 : 0.1,
    browRaise: t >= 2.2 ? 0.7 : 0.3,
  });
  const take = () => chordMapTake({ duration: 3.2, chordAt: () => cellOf(0) });

  it('turns the key major a second into a smile, then adds the seventh and the ninth to an open mouth', () => {
    const outs = play(take(), { ...ON, face: true }, A_MINOR, faceAt);
    const at = (t: number) => outs.find((o) => o.t >= t)!.out;
    expect(soundingPcs(at(1.2).params)).toEqual([0, 4, 9]); // A minor: the smile is not yet a second old
    expect(at(1.2).status.mode).toBe('key');
    expect(soundingPcs(at(1.8).params)).toEqual([1, 4, 9]); // A major
    expect(at(1.8).status).toMatchObject({ mode: 'brighter', key: 'A', tension: 0 });
    expect(soundingPcs(at(3.0).params)).toEqual([1, 4, 8, 9, 11]); // Amaj9: G# and B added
    expect(at(3.0).status.tension).toBe(2);
  });

  it('plays the same with the seed\'s voice-led voicing', () => {
    const outs = play(take(), { ...ON, face: true, voicing: 'voiceLed' }, A_MINOR, faceAt);
    const at = (t: number) => outs.find((o) => o.t >= t)!.out;
    expect(soundingPcs(at(1.8).params)).toEqual([1, 4, 9]);
    expect(soundingPcs(at(3.0).params)).toEqual([1, 8, 9, 11]); // Amaj9 in four voices: A in the bass, the fifth shed
  });

  it('turns any key: a blues key smiles into its parallel major', () => {
    const outs = play(take(), { ...ON, face: true }, { ...A_MINOR, type: 'blues' }, faceAt);
    expect(soundingPcs(outs.find((o) => o.t >= 1.8)!.out.params)).toEqual([1, 4, 9]);
  });

  it('says only what changed: a frown on a minor key changes nothing', () => {
    const frown = (t: number): FaceFeatures => ({ ...ABSENT_FACE, present: true, browFurrow: t >= 0.5 ? 0.8 : 0 });
    const outs = play(take(), { ...ON, face: true }, A_MINOR, frown);
    const late = outs.find((o) => o.t >= 2.5)!.out;
    expect(late.status.mode).toBe('key');
    expect(soundingPcs(late.params)).toEqual([0, 4, 9]);
  });

  it('keeps the key in force while the dwell slider is dragged', () => {
    const h = chordMapNode.make(chordMapNode.params.parse({}));
    const frames = take();
    const modes = frames.map((f, i) => {
      const dwell = f.t! < 2 ? 1 : 1 + 0.1 * (i % 5); // dragged from 2 s on, a write per frame
      return (h.process({ hands: f, config: { ...ON, face: true, modeDwellS: dwell }, spec: A_MINOR, octaveShift: 0, face: faceAt(f.t!) }, { time: f.t!, dt: 1 / 30, tick: 0, resources: {} } as never) as unknown as Out).status.mode;
    });
    expect(modes.slice(Math.round(2 * 30))).toEqual(modes.slice(Math.round(2 * 30)).map(() => 'brighter'));
  });

  it('adds no tension to a strum, and says none', () => {
    const outs = play(chordMapTake({ duration: 3.2, chordAt: () => cellOf(0), strumPeriod: 0.5 }), { ...ON, face: true, play: 'strum' }, A_MINOR, faceAt);
    expect(outs.find((o) => o.t >= 3.0)!.out.status).toMatchObject({ mode: 'brighter', tension: 0 });
  });

  it('leaves the key and the chord alone with the face off, or with no face in view', () => {
    const off = play(take(), { ...ON, face: false }, A_MINOR, faceAt);
    expect(soundingPcs(off.find((o) => o.t >= 3.0)!.out.params)).toEqual([0, 4, 9]);
    const unseen = play(take(), { ...ON, face: true }, A_MINOR, () => ABSENT_FACE);
    expect(unseen.find((o) => o.t >= 3.0)!.out.status).toMatchObject({ mode: 'key', tension: 0 });
  });
});

describe('the chord-map node, the letters map (H13 of #613)', () => {
  it('keeps the chord under the hand on its letter across a key change, relights the changed cells, moves the home', () => {
    const f = cellOf(3); // F in C major
    const frames = chordMapTake({ duration: 4, chordAt: () => f });
    const h = chordMapNode.make(chordMapNode.params.parse({}));
    const outs = frames.map((fr) => ({ t: fr.t!, out: h.process({ hands: fr, config: { ...ON, anchor: 'letters' }, spec: fr.t! < 1.5 ? C_MAJOR : { ...C_MAJOR, root: 7 }, octaveShift: 0 }, { time: fr.t!, dt: 1 / 30, tick: 0, resources: {} } as never) as unknown as Out }));
    const at = (t: number) => outs.find((o) => o.t >= t)!.out;
    expect(at(1).status.chord).toBe('F');
    expect(at(2).status.chord).toBe('F#°'); // the same cell, its chord in G
    const marked = (o: Out, mark: string) => new Set(o.grid.cells.filter((c) => c.mark === mark).map((c) => c.label));
    expect(marked(at(1), 'home')).toEqual(new Set(['C']));
    expect(marked(at(1), 'changed').size).toBe(0);
    expect(marked(at(2), 'changed')).toEqual(new Set(['D', 'F#°', 'Bm']));
    expect(marked(at(2), 'home')).toEqual(new Set(['G']));
    expect(marked(at(3.8), 'changed').size).toBe(0); // the relight fades after two seconds
  });

  it('keeps the letters through the face\'s parallel in a key the two modes spell apart (C# minor and Db major)', () => {
    const csm: ScaleSpec = { root: 1, type: 'minor', octaves: 2, baseOctave: 3 };
    const c = cellOf(0); // a C cell: in C# minor the letter C is the tonic's
    const smile = (t: number): FaceFeatures => ({ ...ABSENT_FACE, present: true, smile: t >= 0.3 ? 0.9 : 0 });
    const outs = play(chordMapTake({ duration: 2.5, chordAt: () => c }), { ...ON, anchor: 'letters', face: true }, csm, smile);
    const home = (o: Out) => new Set(o.grid.cells.filter((x) => x.mark === 'home').map((x) => x.label));
    const before = outs.find((o) => o.t >= 0.2)!.out;
    const after = outs.find((o) => o.t >= 2.2)!.out;
    expect(home(before)).toEqual(new Set(['C#m']));
    // The same cells, now the parallel major's tonic (spelled as the theory spells that key): home did not move.
    expect(home(after)).toEqual(new Set([diatonicChords({ ...csm, type: 'major' })[0].name]));
    expect(after.grid.cells.filter((x) => x.mark === 'home').length).toBe(before.grid.cells.filter((x) => x.mark === 'home').length);
    expect(after.grid.cells.filter((x) => x.mark === 'changed').length).toBeGreaterThan(0);
  });

  it('plays the melody over the held cell\'s chord in the new key', () => {
    const f = cellOf(3);
    const frames = chordMapTake({ duration: 3, chordAt: (t) => (t < 1 ? f : null) });
    const h = chordMapNode.make(chordMapNode.params.parse({}));
    const outs = frames.map((fr) => h.process({ hands: fr, config: { ...ON, anchor: 'letters' }, spec: fr.t! < 1.5 ? C_MAJOR : { ...C_MAJOR, root: 7 }, octaveShift: 0 }, { time: fr.t!, dt: 1 / 30, tick: 0, resources: {} } as never) as unknown as Out);
    const ladder = outs[outs.length - 1].grid.cells.filter((x) => x.shape === 'rect').map((x) => x.label.replace(/\d+$/, ''));
    expect(ladder.slice(0, 3)).toEqual(['F#', 'A', 'C']); // over F#°, the F cell in G, not over C
  });

  it('marks nothing on the home map', () => {
    const outs = play(chordMapTake({ duration: 1, chordAt: () => cellOf(0) }), ON);
    expect(outs[outs.length - 1].out.grid.cells.some((c) => c.mark)).toBe(false);
  });
});

describe('the chord-map node, chords from MIDI (H8 of #613)', () => {
  function playMidi(heldAt: (t: number) => number[], config: Record<string, unknown>, duration = 2, strumPeriod?: number) {
    const h = chordMapNode.make(chordMapNode.params.parse({}));
    return chordMapTake({ duration, chordAt: () => null, strumPeriod }).map((fr) => ({
      t: fr.t!,
      out: h.process({ hands: fr, config: { ...ON, follow: 'midi', ...config }, spec: C_MAJOR, octaveShift: 0, midi: { available: true, inputs: 1, held: heldAt(fr.t!) } }, { time: fr.t!, dt: 1 / 30, tick: 0, resources: {} } as never) as unknown as Out,
    }));
  }

  it('lights and sounds the chord the keys hold, any inversion, with no hand on the map', () => {
    const outs = playMidi((t) => (t < 1 ? [64, 67, 72] : [62, 65, 69]), {});
    const at = (t: number) => outs.find((o) => o.t >= t)!.out;
    expect(at(0.5).status).toMatchObject({ chord: 'C', midi: 'listening', midiChord: 'C' });
    expect(soundingPcs(at(0.5).params)).toEqual(pcsOf(0));
    expect(at(1.5).status.chord).toBe('Dm');
    expect(at(1.5).grid.cells.filter((c) => c.state === 'active').map((c) => c.label)).toEqual(['Dm']);
  });

  it('names a chord outside the key and strums it by its name', () => {
    const outs = playMidi(() => [58, 62, 65], { play: 'strum' }, 3, 0.5); // Bb
    const last = outs[outs.length - 1].out;
    expect(last.status).toMatchObject({ chord: null, midiChord: 'Bb (outside the key)' });
    const strummed = outs.flatMap((o) => o.out.notes);
    expect(strummed.length).toBeGreaterThan(0);
    const pcs = new Set(strummed.filter((n) => n.velocity > 0).map((n) => n.midi % 12));
    expect([...pcs].sort((a, b) => a - b)).toEqual([2, 5, 10]); // Bb D F
  });

  it('strums a chord outside the key the guitar has no shape for by its triad (C#dim7 as C#dim)', () => {
    const outs = playMidi(() => [61, 64, 67, 70], { play: 'strum' }, 3, 0.5);
    const notes = outs.flatMap((o) => o.out.notes).filter((n) => n.velocity > 0);
    expect(notes.length).toBeGreaterThan(0);
    expect([...new Set(notes.map((n) => n.midi % 12))].sort((a, b) => a - b)).toEqual([1, 4, 7]);
  });

  it('holding a chord outside the key plays the melody over its own notes', () => {
    const outs = playMidi(() => [58, 62, 65], {}); // Bb
    const ladder = outs[outs.length - 1].out.grid.cells.filter((x) => x.shape === 'rect').map((x) => x.label.replace(/\d+$/, ''));
    expect(ladder.slice(0, 3)).toEqual(['A#', 'D', 'F']);
  });

  it('says when no keyboard can be heard', () => {
    const h = chordMapNode.make(chordMapNode.params.parse({}));
    const fr = chordMapTake({ duration: 0.1, chordAt: () => null })[0];
    const out = h.process({ hands: fr, config: { ...ON, follow: 'midi' }, spec: C_MAJOR, octaveShift: 0, midi: { available: false, inputs: 0, held: [] } }, { time: 0, dt: 1 / 30, tick: 0, resources: {} } as never) as unknown as Out;
    expect(out.status.midi).toBe('unavailable');
  });
});

describe('the chord-map node, on musical time (H9 of #613)', () => {
  const changeAt = (outs: { t: number; out: Out }[]) => outs.find((o, i) => i > 0 && o.out.status.chord !== outs[i - 1].out.status.chord && o.out.status.chord === 'Am')!.t;

  it('commits a held change on the next beat of the tempo, not when the frame arrived', () => {
    const c = cellOf(0);
    const am = cellOf(5);
    const take = chordMapTake({ duration: 2.5, chordAt: (t) => (t < 1.05 ? c : am) });
    const now = changeAt(play(take, { ...ON, bpm: 120 }));
    const onBeat = changeAt(play(take, { ...ON, bpm: 120, commit: 'beat' }));
    expect(now).toBeLessThan(1.2); // as soon as the dwell allows
    expect(onBeat).toBeCloseTo(1.5, 1); // beat 3 at 120 bpm
  });

  it('keeps time with the song: a held change lands on the song\'s beat', () => {
    const c = cellOf(0);
    const am = cellOf(5);
    const take = chordMapTake({ duration: 2.5, chordAt: (t) => (t < 1.05 ? c : am) });
    const h = chordMapNode.make(chordMapNode.params.parse({}));
    // A song at 90 bpm whose beat 0 fell at t = 0.2.
    const song = (t: number) => ({ t, beat: ((t - 0.2) * 90) / 60, tempo: 90, state: 'running', phase: 0, period: 60 / 90, confidence: 1, nextBeatAt: 0, beatsPerBar: 4, beatInBar: 0, anchors: 0 });
    const outs = take.map((fr) => ({ t: fr.t!, out: h.process({ hands: fr, config: { ...ON, clock: 'song', commit: 'beat' }, spec: C_MAJOR, octaveShift: 0, time: song(fr.t!) }, { time: fr.t!, dt: 1 / 30, tick: 0, resources: {} } as never) as unknown as Out }));
    const t = changeAt(outs);
    const beat = ((t - 0.2) * 90) / 60;
    expect(Math.abs(beat - Math.round(beat))).toBeLessThan(0.06); // on a song beat (within a tick)
    expect(t).toBeGreaterThan(1.1);
  });
});

describe('the chord-map node, off', () => {
  it('sounds and draws nothing with the dial off or no key', () => {
    for (const [config, spec] of [[{ ...ON, enabled: false }, C_MAJOR], [ON, undefined]] as const) {
      const h = chordMapNode.make(chordMapNode.params.parse({}));
      const frames = chordMapTake({ duration: 0.5, chordAt: () => cellOf(0), strumPeriod: 0.3 });
      for (const f of frames) {
        const out = h.process({ hands: f, config, spec }, { time: f.t!, dt: 1 / 30, tick: 0, resources: {} } as never) as unknown as Out;
        expect(out.params.voices.every((v) => !v.present)).toBe(true);
        expect(out.notes).toEqual([]);
        expect(out.grid.cells).toEqual([]);
      }
    }
  });

  it('puts the chords on the right with the right hand pointing', () => {
    const cells = layoutCells('harmonic', chordMapRegions('right', 0.65).chords, { aspect: W / H, cellSize: 0.2 });
    const c = cells.find((x) => x.q === 0 && x.r === 0)!;
    expect(c.x).toBeGreaterThan(0.5);
    // The left hand is now the melody hand; pointing with the right.
    const frames = chordMapTake({ duration: 0.5, chordAt: () => null }).map((f) => ({ ...f, hands: [{ ...chordMapTake({ duration: 0.04, chordAt: () => c }).at(0)!.hands[0], handedness: 'Right' as const }] }));
    const outs = play(frames, { ...ON, chordHand: 'right' });
    expect(outs[outs.length - 1].out.status.chord).toBe('C');
  });
});
