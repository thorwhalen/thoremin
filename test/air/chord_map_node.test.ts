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
import type { HandsFrame, SynthParams } from '@thoremin/sdk/nodes/domain';
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

function play(frames: HandsFrame[], config: Record<string, unknown>, spec: ScaleSpec = C_MAJOR) {
  const h = chordMapNode.make(chordMapNode.params.parse({}));
  const outs: { t: number; out: Out }[] = [];
  for (const f of frames) {
    const out = h.process({ hands: f, config, spec, octaveShift: 0 }, { time: f.t!, dt: 1 / 30, tick: 0, resources: {} } as never) as unknown as Out;
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
