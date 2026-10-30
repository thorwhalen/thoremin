/**
 * The note views (`@thoremin/games/note_view`): one (time, row) projection per way of showing a
 * song. Across, later is further right and higher is higher; falling, later is higher up and
 * higher pitches further right; on the highway, later is nearer the horizon and smaller, and the
 * near line is full size. A note is a box as long as it lasts in all three; the stage draws Sing
 * and Play along through each without a canvas of its own.
 */
import { describe, it, expect } from 'vitest';
import { NOTE_VIEWS, noteProjection, noteQuad } from '@thoremin/games/note_view';
import { roadScale } from '@thoremin/games/perspective';
import { drawStage, laneRows, stageProjection } from '@thoremin/games/stage';
import { createSingSession } from '@thoremin/games/sing';
import { createPlayAlongSession } from '@thoremin/games/play_along';
import { LESSONS } from '@thoremin/games/lessons';
import { makeRecordingCanvas } from '../helpers/canvas';

const box = { left: 0, top: 100, right: 1000, bottom: 500 };
const span = { now: 10, from: 8, to: 14, low: 60, high: 72 };

describe('the note projections', () => {
  it('across: now on the now line, the future to the right, higher pitches higher', () => {
    const P = noteProjection('roll-h', box, span, { nowAt: 0.3 });
    expect(P.at(10, 66).x).toBeCloseTo(300);
    expect(P.at(14, 66).x).toBeCloseTo(1000);
    expect(P.at(12, 72).y).toBeLessThan(P.at(12, 60).y);
    expect(P.rowsAcross).toBe(false);
  });

  it('falling: the future higher up, the hit line near the bottom, higher pitches to the right', () => {
    const P = noteProjection('roll-v', box, span);
    expect(P.at(11, 66).y).toBeLessThan(P.at(10, 66).y);
    expect(P.at(10, 66).y).toBeCloseTo(500 - 0.14 * 400);
    expect(P.at(14, 66).y).toBeCloseTo(100);
    expect(P.at(12, 72).x).toBeGreaterThan(P.at(12, 60).x);
  });

  it('highway: the future shrinks toward the horizon, full size at the hit line', () => {
    const P = noteProjection('highway', box, span);
    expect(P.rowSize(13)).toBeLessThan(P.rowSize(11));
    expect(P.rowSize(10) / P.rowSize(14)).toBeCloseTo(roadScale(0) / roadScale(5));
    // The rows converge: a low and a high row are closer far away than near.
    const gap = (t: number) => P.at(t, 72).x - P.at(t, 60).x;
    expect(gap(14)).toBeLessThan(gap(10));
    expect(P.at(14, 66).y).toBeGreaterThan(100);
    expect(P.at(14, 66).y).toBeLessThan(P.at(10, 66).y);
  });

  it.each(NOTE_VIEWS)('%s: a note is a box from its start to its end, a row wide', (kind) => {
    const P = noteProjection(kind, box, span);
    const [a, b, c, d] = noteQuad(P, { start: 11, end: 12, row: 64 }, 0.4);
    // The start edge and the end edge are each one row-width apart, and the end lies further along.
    expect(a).toEqual(P.at(11, 63.6));
    expect(c).toEqual(P.at(12, 64.4));
    const along = (p: { x: number; y: number }) => (P.rowsAcross ? -p.y : p.x);
    expect(along(d)).toBeGreaterThan(along(a));
    expect(along(c)).toBeGreaterThan(along(b));
    expect(P.shown[0]).toBeLessThan(10);
    expect(P.shown[1]).toBe(14);
  });
});

describe('the stage through each view', () => {
  const sing = createSingSession(LESSONS.find((l) => l.game === 'sing')!, { start: 0 });
  const play = createPlayAlongSession(LESSONS.find((l) => l.id === 'play-mary')!, { start: 0 });
  const clap = createPlayAlongSession(LESSONS.find((l) => l.id === 'rhythm-quarters')!, { start: 0 });

  it.each(NOTE_VIEWS)('%s: draws Sing, a melody and a rhythm, title and note boxes', (kind) => {
    for (const s of [sing, play, clap]) {
      const v = s.tick(4.5, { pitch: [], onsets: [] }).view;
      const c = makeRecordingCanvas(960, 540);
      drawStage(c.canvas.getContext('2d') as CanvasRenderingContext2D, { W: 960, H: 540, notes: kind }, v);
      expect(c.texts()).toContain(v.title);
      // Notes are filled paths (quads), not arcs.
      expect(c.calls.filter((x) => x.m === 'arc')).toHaveLength(0);
      expect(c.calls.filter((x) => x.m === 'fill').length).toBeGreaterThan(0);
    }
  });

  it('a melody gets a lane per semitone, a rhythm one lane, and its notes are short blocks', () => {
    const v = clap.tick(4.5, { pitch: [], onsets: [] }).view;
    expect(laneRows(v)).toEqual({ pitched: false, low: 0, high: 0 });
    const m = play.tick(4.5, { pitch: [], onsets: [] }).view;
    expect(laneRows(m)).toMatchObject({ pitched: true, low: m.low, high: m.high });
    const P = stageProjection(m, 960, 540, 'roll-h', laneRows(m));
    const n = m.notes[1];
    // A melody note's box is as long as the note.
    expect(P.at(n.end, n.midi!).x - P.at(n.start, n.midi!).x).toBeCloseTo((n.end - n.start) * ((P.at(m.to, 0).x - P.at(m.now, 0).x) / (m.to - m.now)));
  });
});
