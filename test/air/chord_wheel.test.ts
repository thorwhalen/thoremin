/**
 * The chord wheel (H5 of #613): the direction stepper (one move per push, re-armed at the
 * centre), and the `chord-wheel` node on a scripted hand: from the tonic, a push up makes the
 * fourth-up move (C to F), the hand back in the middle re-arms, a second push up goes on (F to
 * B°), a push down comes back; the Tonnetz wheel's P turns C into C minor and back; the chord
 * sounds only while the hand is seen; its grid draws the centre and a wedge per move with the
 * target chord's name. (A move that cannot apply is the state reducer's, tested there.)
 */
import { describe, it, expect } from 'vitest';
import { createBeatWalk, createDirectionStepper } from '@thoremin/sdk/harmony/navigate';
import { radial } from '@thoremin/sdk/harmony/layout';
import { chordWheelNode, wheelRegion, CHORD_WHEEL_VOICE_ID_BASE, type ChordWheelStatus } from '@thoremin/ext-air/nodes/chord_wheel';
import { freqToMidi, type ScaleSpec } from '@thoremin/sdk/music/theory';
import type { HandsFrame, SynthParams } from '@thoremin/sdk/nodes/domain';
import type { CellGrid } from '@thoremin/sdk/nodes/cell_grid';
import { palmAt, W, H } from './synthetic_chord_map';

const C: ScaleSpec = { root: 0, type: 'major', octaves: 2, baseOctave: 3 };
const ASPECT = W / H;

describe('the direction stepper', () => {
  it('commits one move per push, after the dwell, and re-arms only back in the centre', () => {
    const s = createDirectionStepper({ wedges: 6, dead: 0.07, reach: 0.14, enterFrames: 3 });
    const up = { dx: 0, dy: -0.2 };
    expect(s.push({ dx: 0, dy: 0 }).armed).toBe(true);
    expect(s.push(up).committed).toBeNull();
    expect(s.push(up).committed).toBeNull();
    expect(s.push(up)).toEqual({ pointing: 0, committed: 0, armed: false });
    for (let i = 0; i < 10; i++) expect(s.push(up).committed).toBeNull(); // held out: no walking on
    expect(s.push({ dx: 0, dy: 0.1 }).committed).toBeNull(); // past the dead zone, not back in it
    expect(s.push({ dx: 0, dy: 0 }).armed).toBe(true);
    const down = { dx: 0, dy: 0.3 };
    s.push(down);
    s.push(down);
    expect(s.push(down).committed).toBe(3);
  });

  it('chooses nothing short of the reach, and forgets a half-made choice when the point is lost', () => {
    const s = createDirectionStepper({ wedges: 6, dead: 0.07, reach: 0.14, enterFrames: 2 });
    for (let i = 0; i < 5; i++) expect(s.push({ dx: 0.1, dy: 0 }).committed).toBeNull();
    s.push({ dx: 0.3, dy: 0 });
    s.push(null);
    expect(s.push({ dx: 0.3, dy: 0 }).committed).toBeNull();
    expect(s.push({ dx: 0.3, dy: 0 }).committed).not.toBeNull();
  });
});

interface Out {
  params: SynthParams;
  grid: CellGrid;
  status: ChordWheelStatus;
  triad: number[];
}

/** The wheel's centre and the point `r` frame heights out at wedge angle `k` of 6. */
const centre = radial(wheelRegion('left'), 6, { aspect: ASPECT, radius: 0.3 })[0];
const at = (k: number | null, r = 0.2) => (k === null ? { x: centre.x, y: centre.y } : { x: centre.x + (r * Math.sin((2 * Math.PI * k) / 6)) / ASPECT, y: centre.y - r * Math.cos((2 * Math.PI * k) / 6) });

/** Play a script of hand positions (null = no hand), five frames each. */
function play(script: ({ x: number; y: number } | null)[], config: Record<string, unknown> = {}) {
  const h = chordWheelNode.make(chordWheelNode.params.parse({}));
  const outs: Out[] = [];
  let i = 0;
  for (const p of script) {
    for (let f = 0; f < 5; f++, i++) {
      const t = i / 30;
      const frame: HandsFrame = { t, width: W, height: H, hands: p ? [palmAt(p, 'Left')] : [] };
      outs.push(h.process({ hands: frame, config: { enabled: true, mirrorHandedness: false, ...config }, spec: C, octaveShift: 0 }, { time: t, dt: 1 / 30, tick: i, resources: {} } as never) as unknown as Out);
    }
  }
  return outs;
}
const pcs = (p: SynthParams) => [...new Set(p.voices.filter((v) => v.id >= CHORD_WHEEL_VOICE_ID_BASE && v.present && v.gain > 0).map((v) => Math.round(freqToMidi(v.freq)) % 12))].sort((a, b) => a - b);

describe('the beat walk (H11 of #613)', () => {
  const step = (w: ReturnType<typeof createBeatWalk>, beat: number, o: { committed?: number | null; pointing?: number | null; seen?: boolean; now?: number; beats?: number } = {}) =>
    w.step({ committed: o.committed ?? null, pointing: o.pointing === undefined ? 0 : o.pointing, seen: o.seen ?? true, now: o.now ?? beat / 2, beat, beats: o.beats ?? 1 });

  it('repeats a held move on the beats, the first at least half a step after the push', () => {
    const w = createBeatWalk();
    expect(step(w, 2.7, { committed: 0 })).toBeNull(); // the push itself is the stepper's
    expect(w.walking()).toBe(true);
    expect(step(w, 3.05)).toBeNull(); // beat 3 is too close to the push
    expect(step(w, 3.99)).toBeNull();
    expect(step(w, 4.0)).toBe(0);
    expect(step(w, 4.06)).toBeNull();
    expect(step(w, 5.01)).toBe(0);
  });

  it('skips a missed beat rather than making it up, keeping the grid', () => {
    const w = createBeatWalk();
    step(w, 0, { committed: 0 });
    expect(step(w, 1.0)).toBe(0);
    expect(step(w, 2.96)).toBe(0); // a stall past beat 2: one move now
    expect(step(w, 3.02)).toBe(0); // and beat 3 is still on the grid, not two moves for one
    expect(step(w, 3.5)).toBeNull();
  });

  it('holds through a hand lost for a moment, ends on another wedge, the dead zone or a long loss', () => {
    const w = createBeatWalk();
    step(w, 0, { committed: 0, now: 0 });
    expect(step(w, 1.0, { seen: false, pointing: null, now: 0.5 })).toBeNull(); // lost 0.5 s: over the grace
    expect(w.walking()).toBe(false);
    step(w, 0, { committed: 0, now: 0 });
    expect(step(w, 1.0, { seen: false, pointing: null, now: 0.1 })).toBe(0); // a dropped frame
    expect(step(w, 1.5, { pointing: null, now: 0.2 })).toBeNull(); // back in the dead zone
    expect(w.walking()).toBe(false);
  });

  it('re-aims at the next beat when the beat jumps back (a song restarted)', () => {
    const w = createBeatWalk();
    step(w, 50, { committed: 0 });
    expect(step(w, 51)).toBe(0);
    expect(step(w, 0.4)).toBeNull(); // back near the start: the next step is beat 1
    expect(step(w, 1.0)).toBe(0);
  });

  it('never walks with the walk off', () => {
    const w = createBeatWalk();
    step(w, 0, { committed: 0, beats: 0 });
    expect(w.walking()).toBe(false);
    expect(step(w, 1, { beats: 0 })).toBeNull();
  });
});

describe('the chord-wheel node', () => {
  it('walks the cycle of fourths on the beat while a push is held (walk on), one move per push with it off', () => {
    const hold = [at(null), ...Array.from({ length: 22 }, () => at(0))];
    const chordsOf = (outs: Out[]) => outs.map((o) => o.status.chord).filter((c, i, a) => c !== a[i - 1]);
    const walked = play(hold, { walk: true, bpm: 120, rendering: 'arpUp' });
    expect(chordsOf(walked)).toEqual(['C', 'F', 'B°', 'Em', 'Am', 'Dm', 'G', 'C']);
    expect(walked[walked.length - 1].status.walking).toBe(true);
    // Each walked change lands on the tick where the realizer's beat (120 bpm, 1/15 beat a tick)
    // reaches a whole beat: the arpeggio's beat, not the camera's.
    const changes = walked.map((o, i) => (i > 0 && o.status.chord !== walked[i - 1].status.chord ? i : -1)).filter((i) => i >= 0);
    expect(changes.slice(1).every((i) => (i + 1) % 15 === 0)).toBe(true);
    expect(chordsOf(play(hold, { bpm: 120 }))).toEqual(['C', 'F']);
    // Two beats a step: half as many moves.
    expect(chordsOf(play(hold, { walk: true, bpm: 120, walkBeats: 2 }))).toEqual(['C', 'F', 'B°', 'Em', 'Am']);
  });

  it('walks the key\'s moves: up is a fourth up (C to F), back to the middle, up again (to B°), down back', () => {
    const outs = play([at(null), at(0), at(null), at(0), at(null), at(3)]);
    const chords = outs.map((o) => o.status.chord).filter((c, i, a) => c !== a[i - 1]);
    expect(chords).toEqual(['C', 'F', 'B°', 'F']);
    const last = outs[outs.length - 1];
    expect(last.status).toMatchObject({ moveCount: 3, lastMove: '4th down', numeral: 'IV' });
    expect(pcs(last.params)).toEqual([0, 5, 9]); // F A C
  });

  it('the Tonnetz wheel leaves the key: P turns C into C minor, L into E minor', () => {
    expect(play([at(null), at(0)], { moves: 'tonnetz' }).at(-1)!.status.chord).toBe('Cm');
    expect(play([at(null), at(1)], { moves: 'tonnetz' }).at(-1)!.status.chord).toBe('Em');
    // N from C is F minor, outside C major: named, no numeral but its borrowed function.
    const n = play([at(null), at(3)], { moves: 'tonnetz' }).at(-1)!;
    expect(n.status.chord).toBe('Fm');
  });

  it('moves around the key and back: a second down from C is B°, then a fourth up is Em; P toggles C and Cm', () => {
    const outs = play([at(null), at(5), at(null), at(0)]);
    expect(outs.map((o) => o.status.chord).filter((c, i, a) => c !== a[i - 1])).toEqual(['C', 'B°', 'Em']);
    const t = play([at(null), at(0), at(null), at(0), at(null), at(0)], { moves: 'tonnetz' });
    expect(t.map((o) => o.status.chord).filter((c, i, a) => c !== a[i - 1])).toEqual(['C', 'Cm', 'C', 'Cm']);
  });

  it('sounds only while the hand is seen, and draws the centre and a wedge per move', () => {
    const outs = play([null, at(null), null, null, null]);
    expect(pcs(outs[2].params)).toEqual([]); // before the hand: silent
    expect(pcs(outs[7].params)).toEqual([0, 4, 7]); // C while seen
    expect(pcs(outs.at(-1)!.params)).toEqual([]); // lost for long enough: silent
    const g = outs[7].grid;
    expect(g.cells).toHaveLength(7);
    expect(g.cells[0]).toMatchObject({ label: 'C', sub: 'I', state: 'active' });
    expect(g.cells.slice(1).map((c) => c.label)).toEqual(['F', 'Em', 'Dm', 'G', 'Am', 'B°']);
    expect(g.cells.slice(1).map((c) => c.sub)).toEqual(['4th up', '3rd up', '2nd up', '4th down', '3rd down', '2nd down']);
  });

  it('walks on the song\'s beat when it keeps time with the song (H9 of #613)', () => {
    const h = chordWheelNode.make(chordWheelNode.params.parse({}));
    const song = (t: number) => ({ t, beat: ((t - 0.1) * 100) / 60, tempo: 100, state: 'running', phase: 0, period: 0.6, confidence: 1, nextBeatAt: 0, beatsPerBar: 4, beatInBar: 0, anchors: 0 });
    const script = [at(null), ...Array.from({ length: 22 }, () => at(0))];
    const outs: Out[] = [];
    let i = 0;
    for (const p of script)
      for (let f = 0; f < 5; f++, i++) {
        const t = i / 30;
        const frame: HandsFrame = { t, width: W, height: H, hands: p ? [palmAt(p, 'Left')] : [] };
        outs.push(h.process({ hands: frame, config: { enabled: true, mirrorHandedness: false, walk: true, clock: 'song' }, spec: C, octaveShift: 0, time: song(t) }, { time: t, dt: 1 / 30, tick: i, resources: {} } as never) as unknown as Out);
      }
    const changes = outs.map((o, k) => (k > 0 && o.status.chord !== outs[k - 1].status.chord ? k / 30 : -1)).filter((t) => t >= 0);
    expect(changes.length).toBeGreaterThan(3);
    for (const t of changes.slice(1)) {
      const beat = ((t - 0.1) * 100) / 60;
      expect(Math.abs(beat - Math.round(beat))).toBeLessThan(0.06);
    }
  });

  it('shows each chord\'s tension with the model named over the wheel (H10 of #613), and nothing with it off', () => {
    const shown = play([at(null)], { tension: 'tps' });
    const grid = shown[shown.length - 1].grid;
    expect(grid.cells[0].sub).toBe('I · 0');
    expect(grid.cells.slice(1).some((cell) => /· \d+$/.test(cell.sub))).toBe(true);
    expect(grid.captions.map((c) => c.text)).toEqual(["Tension: Lerdahl's tonal pitch space (distance from the tonic chord)"]);
    const plain = play([at(null)]);
    expect(plain[plain.length - 1].grid.cells[0].sub).toBe('I');
    expect(plain[plain.length - 1].grid.captions).toEqual([]);
  });

  it('puts the likeliest next chord on top (Piston), so pushing up three times plays I, IV, V, I', () => {
    const outs = play([at(null), at(0), at(null), at(0), at(null), at(0), at(null)], { order: 'likely' });
    expect(outs.map((o) => o.status.chord).filter((c, i, a) => c !== a[i - 1])).toEqual(['C', 'F', 'G', 'C']);
    const first = play([at(null)], { order: 'likely' });
    const grid = first[first.length - 1].grid;
    expect(grid.cells.slice(1).map((c) => c.label)).toEqual(['F', 'G', 'Am', 'Em', 'Dm', 'B°']);
    expect(grid.captions.map((c) => c.text)).toEqual(["Most likely on top: Piston's usual root progressions"]);
    // A held walk keeps the order it started from: the top wedge from C walks the cycle of fourths.
    const hold = [at(null), ...Array.from({ length: 22 }, () => at(0))];
    const walked = play(hold, { order: 'likely', walk: true, bpm: 120 });
    expect(walked.map((o) => o.status.chord).filter((c, i, a) => c !== a[i - 1])).toEqual(['C', 'F', 'B°', 'Em', 'Am', 'Dm', 'G', 'C']);
    // The Tonnetz's moves leave the key: always in their places.
    const tonnetz = play([at(null)], { order: 'likely', moves: 'tonnetz' });
    expect(tonnetz[tonnetz.length - 1].grid.captions).toEqual([]);
  });

  it('is silent and draws nothing with the dial off', () => {
    const h = chordWheelNode.make(chordWheelNode.params.parse({}));
    const out = h.process({ hands: { t: 0, width: W, height: H, hands: [palmAt(at(null), 'Left')] }, config: { enabled: false }, spec: C }, { time: 0, dt: 1 / 30, tick: 0, resources: {} } as never) as unknown as Out;
    expect(out.grid.cells).toEqual([]);
    expect(pcs(out.params)).toEqual([]);
  });
});
