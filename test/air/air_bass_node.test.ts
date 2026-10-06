/**
 * The `air-bass` node (#249) on synthetic performances: the fretting hand's distance
 * along the neck picks the note from the scale (far = low, near = high), each pluck of
 * the other hand sounds it, most of them predicted ahead of the pluck, and nothing
 * sounds with the dial off or before a fretting hand has been seen.
 */
import { describe, it, expect } from 'vitest';
import { airBassNode, neckNote, type NoteEvent, type AirBassStatus } from '@thoremin/ext-air/nodes/air_bass';
import { makeHandKeypoints, type Hand, type HandsFrame } from '@thoremin/sdk/nodes/domain';
import { bassTake } from './synthetic_bass';

const SCALE = [28, 31, 33, 35, 38, 40, 43, 45, 47, 50]; // E minor pentatonic, E1 up
const hand = (cx: number, handedness: Hand['handedness'] = 'Left'): Hand => ({
  handedness,
  keypoints: makeHandKeypoints({ cx, cy: 200, scale: 40, spread: 0.5, pinch: 0, handedness }),
});

describe('neckNote', () => {
  it('maps far to the lowest note, near to the highest, quantised to the scale', () => {
    const pluck = hand(500, 'Right');
    const spanPx = Math.hypot(hand(0).keypoints[0].x - hand(0).keypoints[9].x, hand(0).keypoints[0].y - hand(0).keypoints[9].y);
    const at = (d: number) => neckNote(hand(500 - d * spanPx), pluck, SCALE, 2, 7);
    expect(at(7)).toBe(28);
    expect(at(10)).toBe(28); // beyond the neck's end: clamped
    expect(at(2)).toBe(50);
    expect(at(0.5)).toBe(50);
    expect(at(4.5)).toBe(SCALE[Math.round(0.5 * (SCALE.length - 1))]);
  });

  it('is null for an empty scale or a degenerate neck', () => {
    expect(neckNote(hand(100), hand(500, 'Right'), [], 2, 7)).toBeNull();
    expect(neckNote(hand(100), hand(500, 'Right'), SCALE, 3, 3)).toBeNull();
  });
});

/** Run the node over a take, one tick per frame at the frame's own time. */
function play(frames: HandsFrame[], config: Record<string, unknown>, octaveShift = 0) {
  const h = airBassNode.make(airBassNode.params.parse({}));
  const notes: NoteEvent[] = [];
  let status: AirBassStatus | undefined;
  for (const f of frames) {
    const out = h.process({ hands: f, config, scale: SCALE, octaveShift }, { time: f.t!, dt: 1 / 30, tick: 0, resources: {} } as never) as {
      notes: NoteEvent[];
      status: AirBassStatus;
    };
    notes.push(...out.notes);
    status = out.status;
  }
  return { notes, status: status! };
}

const ON = { enabled: true, mirrorHandedness: false };

describe('the air-bass node', () => {
  it('sounds one note per pluck, at the note under the fretting hand, mostly predicted', () => {
    // Two seconds far out on the neck (low), two seconds close in (high).
    const frames = bassTake({ duration: 4, neck: (t) => (t < 2 ? 6.5 : 2.2) });
    const { notes, status } = play(frames, ON);
    // Eight plucks in four seconds; the first teaches the floor, so at least six sound.
    expect(notes.length).toBeGreaterThanOrEqual(6);
    expect(notes.length).toBeLessThanOrEqual(8);
    const low = notes.filter((n) => n.t < 2);
    const high = notes.filter((n) => n.t > 2.1);
    expect(low.length).toBeGreaterThan(0);
    expect(high.length).toBeGreaterThan(0);
    for (const n of low) expect(n.midi).toBeLessThanOrEqual(31);
    for (const n of high) expect(n.midi).toBeGreaterThanOrEqual(47);
    expect(notes.filter((n) => n.predicted).length / notes.length).toBeGreaterThanOrEqual(0.5);
    expect(status.ready).toBe(true);
    expect(status.notes).toBe(notes.length);
    expect(status.fretMidi).toBe(high[high.length - 1].midi);
  });

  it('works left-handed (the left hand plucks, the neck runs the other way)', () => {
    const frames = bassTake({ duration: 3, neck: () => 6.5, pluckHand: 'left' });
    const { notes } = play(frames, { ...ON, pluckHand: 'left' });
    expect(notes.length).toBeGreaterThan(2);
    for (const n of notes) expect(n.midi).toBeLessThanOrEqual(31);
  });

  it('sounds nothing with the dial off', () => {
    const { notes, status } = play(bassTake({ duration: 3, neck: () => 4 }), { enabled: false });
    expect(notes).toEqual([]);
    expect(status.enabled).toBe(false);
  });

  it('sounds nothing until a fretting hand has been seen, then holds its last note', () => {
    const frames = bassTake({ duration: 4, neck: () => 6.5 }).map((f) =>
      // The fretting hand is out of view for the first two seconds and the last one.
      f.t! < 2 || f.t! > 3 ? { ...f, hands: f.hands.filter((h) => h.handedness === 'Right') } : f,
    );
    const { notes, status } = play(frames, ON);
    expect(notes.every((n) => n.t >= 2)).toBe(true);
    expect(notes.some((n) => n.t > 3.05)).toBe(true); // plucked with the neck hand gone
    for (const n of notes) expect(n.midi).toBeLessThanOrEqual(31);
    expect(status.fretting).toBe(false);
    expect(status.fretMidi).not.toBeNull();
  });

  it('holds the note under a still neck hand through tracker jitter', () => {
    // The neck hand held at the CENTRE of a note (4.5 palms: the middle of the ten-note
    // neck lies between two notes, so aim at one), with 3 px of jitter on every point (MediaPipe at 480p jitters 1.5 to 2.5).
    const centre = 7 - (5 / 9) * 4; // index 4 of 10 on a 2..7 neck
    for (const seed of [1, 2, 3, 4, 5]) {
      const { notes } = play(bassTake({ duration: 8, neck: () => centre, jitterPx: 3, seed }), ON);
      expect(notes.length).toBeGreaterThan(10);
      // Once the smoothing has settled (a third of a second, 1/smoothing frames), every
      // pluck lands on the held note. A pluck inside that first third can still read the
      // neighbour: there is no settled reading to hold yet.
      const settled = notes.filter((n) => n.t > 0.4);
      expect(new Set(settled.map((n) => n.midi))).toEqual(new Set([SCALE[4]]));
    }
  });

  it('shifts the neck by the global octave shift', () => {
    const { notes } = play(bassTake({ duration: 3, neck: () => 7 }), ON, 1);
    expect(notes.length).toBeGreaterThan(2);
    for (const n of notes) expect(n.midi).toBe(SCALE[0] + 12);
  });

  it('plays nothing on a degenerate neck, and says so', () => {
    const { notes, status } = play(bassTake({ duration: 3, neck: () => 4 }), { ...ON, neckNear: 4, neckFar: 4 });
    expect(notes).toEqual([]);
    expect(status.fretting).toBe(true);
    expect(status.fretMidi).toBeNull();
  });

  it('reads the neck the same with its two ends given in either order', () => {
    const a = play(bassTake({ duration: 3, neck: () => 6.5 }), { ...ON, neckNear: 2, neckFar: 7 });
    const b = play(bassTake({ duration: 3, neck: () => 6.5 }), { ...ON, neckNear: 7, neckFar: 2 });
    expect(b.notes.map((n) => n.midi)).toEqual(a.notes.map((n) => n.midi));
  });
});
