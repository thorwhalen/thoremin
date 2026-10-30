/**
 * The staff (`@thoremin/games/staff`) and the pitch spelling under it (`@thoremin/games/spelling`):
 * a MIDI note written in a key (C major by default: sharps; a flat key: flats; the key's own notes
 * by its signature), accidentals carried to the bar's end per letter and octave, a natural printed
 * where a note returns; the clef chosen by range; heads where the time axis says, on the right
 * line, with the value their length in beats asks; the stage drawing it in every mode.
 */
import { describe, it, expect } from 'vitest';
import { barAccidentals, signature, spell } from '@thoremin/games/spelling';
import { clefFor, noteValue, staffLayout } from '@thoremin/games/staff';
import { drawStage, stageBoxes } from '@thoremin/games/stage';
import { NOTE_VIEWS } from '@thoremin/games/note_view';
import { createSingSession } from '@thoremin/games/sing';
import { createPlayAlongSession } from '@thoremin/games/play_along';
import { LESSONS } from '@thoremin/games/lessons';
import type { Lesson } from '@thoremin/games/lesson';
import { makeRecordingCanvas } from '../helpers/canvas';

describe('pitch spelling', () => {
  it('writes a pitch in its key: sharps in C major, flats in a flat key, the signature for the key\'s own notes', () => {
    expect(spell(60)).toEqual({ letter: 'C', alter: 0, octave: 4 });
    expect(spell(61)).toEqual({ letter: 'C', alter: 1, octave: 4 });
    expect(spell(61, -1)).toEqual({ letter: 'D', alter: -1, octave: 4 });
    expect(spell(70, -1)).toEqual({ letter: 'B', alter: -1, octave: 4 });
    expect(spell(66, 1)).toEqual({ letter: 'F', alter: 1, octave: 4 });
    expect(spell(65, 1)).toEqual({ letter: 'F', alter: 0, octave: 4 });
    // B sharp and C flat keep their octave by their letter.
    expect(spell(60, 7)).toEqual({ letter: 'B', alter: 1, octave: 3 });
    expect(spell(59, -7)).toEqual({ letter: 'C', alter: -1, octave: 4 });
    expect(signature(2)).toMatchObject({ F: 1, C: 1, G: 0 });
  });

  it('carries an accidental to the bar\'s end for its letter and octave, and prints the natural that cancels it', () => {
    const at = (midi: number, bar: number, key = 0) => ({ spelled: spell(midi, key), bar });
    expect(barAccidentals([at(66, 0), at(66, 0), at(65, 0), at(78, 0), at(66, 1)])).toEqual(['sharp', null, 'natural', 'sharp', 'sharp']);
    // In G major the F sharp is the signature's; an F natural needs its sign, then F sharp again needs one.
    expect(barAccidentals([at(66, 0, 1), at(65, 0, 1), at(66, 0, 1)], 1)).toEqual([null, 'natural', 'sharp']);
  });
});

describe('the staff', () => {
  const grid = { t0: 0, beatS: 0.5, beatsPerBar: 4 };
  const box = { left: 0, top: 0, right: 1000, bottom: 200 };
  const xOf = (t: number) => 100 + t * 100;

  it('chooses the clef by range, and a rhythm goes on one line', () => {
    expect(clefFor(60, 72)).toBe('treble');
    expect(clefFor(40, 60)).toBe('bass');
    expect(clefFor(40, 76)).toBe('grand');
    expect(staffLayout([{ start: 0, end: 0.5 }], box, xOf, grid).clef).toBe('percussion');
    expect(staffLayout([{ start: 0, end: 0.5 }], box, xOf, grid).staves[0].lines).toHaveLength(1);
  });

  it('puts each head at its onset on its line, with the value its beats ask for', () => {
    const notes = [
      { start: 0, end: 0.5, midi: 64 },
      { start: 0.5, end: 1.5, midi: 60 },
      { start: 1.5, end: 2.25, midi: 67 },
      { start: 2.25, end: 4.25, midi: 61 },
    ];
    const L = staffLayout(notes, box, xOf, grid, { range: { low: 60, high: 72 } });
    const bottomLine = L.staves[0].lines[4];
    expect(L.heads.map((h) => h.x)).toEqual(notes.map((n) => xOf(n.start)));
    // E4 on the bottom line; C4 a space under it on one ledger line; G4 on the second line.
    expect(L.heads[0].y).toBeCloseTo(bottomLine);
    expect(L.heads[1].y).toBeCloseTo(bottomLine + L.space);
    expect(L.heads[1].ledgers).toEqual([bottomLine + L.space]);
    expect(L.heads[2].y).toBeCloseTo(bottomLine - L.space);
    expect(L.heads.map((h) => h.value.beats)).toEqual([1, 2, 1.5, 4]);
    expect(L.heads[2].value.dot).toBe(true);
    expect(L.heads[3].accidental).toBe('sharp');
    // Bars of four half-second beats: barlines at 2 s and 4 s (the last note runs past it).
    expect(L.bars).toEqual([xOf(2), xOf(4)]);
  });

  it('writes the note values', () => {
    expect(noteValue(4)).toMatchObject({ hollow: true, stem: false });
    expect(noteValue(2)).toMatchObject({ hollow: true, stem: true });
    expect(noteValue(1)).toMatchObject({ hollow: false, flags: 0 });
    expect(noteValue(0.5)).toMatchObject({ flags: 1 });
    expect(noteValue(0.25)).toMatchObject({ flags: 2 });
  });
});

describe('what a view keeps for the staff', () => {
  // One 4/4 bar at 60 bpm: F sharp for a beat, then F natural held for three.
  const lesson: Lesson = { id: 'f', title: 'F and F sharp', game: 'play-along', bpm: 60, countIn: 0, hint: '', notes: [{ beat: 0, beats: 1, midi: 66 }, { beat: 1, beats: 3, midi: 65 }] };

  it('keeps a long note until it ends, and the bar\'s first note while the bar is on screen, so the natural keeps its sign', () => {
    const s = createPlayAlongSession(lesson, { start: 0 });
    // 3.5 s in: the F sharp ended 2.5 s ago, far behind the 0.6 s the stage shows, but it is the bar's first note.
    const v = s.tick(3.5, { pitch: [], onsets: [] }).view;
    expect(v.notes.map((n) => n.midi)).toEqual([66, 65]);
    const L = staffLayout(v.notes, { left: 0, top: 0, right: 1000, bottom: 200 }, (t) => 100 + t * 100, v.grid!, { range: { low: 60, high: 72 } });
    expect(L.heads.map((h) => h.accidental)).toEqual(['sharp', 'natural']);
    // Once the past window has left their bar, they go.
    expect(s.tick(9, { pitch: [], onsets: [] }).view.notes).toHaveLength(0);
  });
});

describe('the stage with a staff', () => {
  it('stacks the staff above a roll across, lays it over the far end of a falling one, or shows it alone', () => {
    const across = stageBoxes(960, 540, 'roll-h', 'over');
    expect(across.staff!.bottom).toBeLessThanOrEqual(across.roll!.top);
    const falling = stageBoxes(960, 540, 'highway', 'over');
    expect(falling.staff!.top).toBe(falling.roll!.top);
    expect(stageBoxes(960, 540, 'roll-v', 'only').roll).toBeNull();
    expect(stageBoxes(960, 540, 'roll-v', 'off').staff).toBeNull();
  });

  it.each(NOTE_VIEWS)('%s: draws Sing and Play along with the staff over and alone', (kind) => {
    const sessions = [
      createSingSession(LESSONS.find((l) => l.game === 'sing')!, { start: 0 }),
      createPlayAlongSession(LESSONS.find((l) => l.id === 'play-mary')!, { start: 0 }),
      createPlayAlongSession(LESSONS.find((l) => l.id === 'rhythm-quarters')!, { start: 0 }),
    ];
    for (const s of sessions) {
      const v = s.tick(4.5, { pitch: [], onsets: [] }).view;
      expect(v.grid).toBeDefined();
      for (const staff of ['over', 'only'] as const) {
        const c = makeRecordingCanvas(960, 540);
        drawStage(c.canvas.getContext('2d') as CanvasRenderingContext2D, { W: 960, H: 540, notes: kind, staff }, v);
        expect(c.texts()).toContain(v.title);
        // Note heads are ellipses.
        expect(c.calls.filter((x) => x.m === 'ellipse').length).toBeGreaterThan(0);
      }
    }
  });
});
