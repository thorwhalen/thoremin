/**
 * The field games' pieces and sessions: the 1-euro filter across a wrap, the dwell, the loudness
 * scale, the pitch cursor and Pop the Notes on real singing (vocadito track 2: C4, E4, F4 and G4
 * held for half a second or more), and the Pitch Maze on a scripted voice with known offsets (in
 * tune, a quarter tone sharp, the wrong note), where the opening's width decides what passes.
 */
import { describe, it, expect } from 'vitest';
import { createPitchTracker } from '@thoremin/sdk/audio/pitch';
import { createOneEuro } from '@thoremin/stats/smooth';
import { hzOf } from '@thoremin/judge';
import { createDwell } from '@thoremin/games/dwell';
import { createLoudnessScale, dbOf, LOUDNESS_RANGES } from '@thoremin/games/loudness';
import { createPitchCursor, pitchX, semitoneOfX } from '@thoremin/games/cursor';
import { distanceOn } from '@thoremin/games/field';
import { createPopSession, pitchLoudnessCourse } from '@thoremin/games/pop';
import { bandsOf, createMazeSession, createTrackSession, MAZE_LEVELS, ROAD_SPEED, trackFor, TRACK_LEVELS, type Segment } from '@thoremin/games/maze';
import { midiOf } from '@thoremin/judge';
import type { FieldView } from '@thoremin/games/field';
import type { Heard, HeardPitch } from '@thoremin/games/listen';
import { loadAudioFixture, inBlocks } from '../helpers/audio_fixtures';

const TICK = 1 / 60;

/** Tick a session from t0 to t1, handing each tick the pitch frames inside it. */
function run(tick: (now: number, heard: Heard) => { view: FieldView; cues: unknown[] }, pitch: (t0: number, t1: number) => HeardPitch[], t0: number, t1: number) {
  let last!: FieldView;
  let cues = 0;
  let prev = t0 - TICK;
  for (let now = t0; now <= t1 + 1e-9; now += TICK) {
    const r = tick(now, { pitch: pitch(prev, now), onsets: [] });
    last = r.view;
    cues += r.cues.length;
    prev = now;
  }
  return { last, cues };
}

const realSinging = () => {
  const fx = loadAudioFixture('audio_games_vocadito_2');
  const tr = createPitchTracker({ sampleRate: fx.wav.sampleRate });
  const frames = inBlocks(fx.wav.pcm, fx.wav.sampleRate, 128, (b, t0) => tr.push(b, t0)).map((f) => ({ t: f.t, f0: f.f0, clarity: f.clarity, rms: f.rms }));
  return { frames, between: (a: number, b: number) => frames.filter((f) => f.t > a && f.t <= b), duration: fx.wav.pcm.length / fx.wav.sampleRate };
};

/** A voice holding `midi` from t to t + dur, 100 frames a second. */
function voice(notes: { t: number; dur: number; midi: number | null }[]): (a: number, b: number) => HeardPitch[] {
  const frames: HeardPitch[] = [];
  for (const n of notes) for (let t = n.t; t < n.t + n.dur; t += 0.01) frames.push(n.midi === null ? { t, f0: null, clarity: 0.1, rms: 0.001 } : { t, f0: hzOf(n.midi), clarity: 0.9, rms: 0.05 });
  return (a, b) => frames.filter((f) => f.t > a && f.t <= b);
}

describe('the 1-euro filter', () => {
  it('takes the short way round a wrap', () => {
    const f = createOneEuro({ period: 12 });
    f.push(0, 11.8);
    const y = f.push(0.01, 0.2); // B to C: a step of 0.4, not of -11.6
    expect(y).toBeGreaterThan(11.8);
    expect(y).toBeLessThan(12.2);
  });
  it('holds a steady value still and follows a step', () => {
    const f = createOneEuro({ minCutoff: 1, beta: 0.05 });
    let y = 0;
    for (let i = 0; i < 100; i++) y = f.push(i / 100, 5);
    expect(y).toBe(5);
    for (let i = 100; i < 200; i++) y = f.push(i / 100, 7);
    expect(y).toBeCloseTo(7, 1);
  });
});

describe('dwell', () => {
  it('fills while inside, drains at its decay while outside, and stays done', () => {
    const d = createDwell({ needS: 1, decay: 0.5 });
    for (let i = 0; i < 6; i++) d.step(true, 0.1);
    expect(d.progress).toBeCloseTo(0.6);
    d.step(false, 0.4);
    expect(d.progress).toBeCloseTo(0.4);
    for (let i = 0; i < 6; i++) d.step(true, 0.1);
    expect(d.done).toBe(true);
    d.step(false, 1);
    expect(d.done).toBe(true);
  });
  it('without decay, waits where it was', () => {
    const d = createDwell({ needS: 1 });
    d.step(true, 0.3);
    d.step(false, 5);
    expect(d.progress).toBeCloseTo(0.3);
  });
});

describe('the loudness scale', () => {
  it('starts on the normal range, then learns the player’s own', () => {
    const s = createLoudnessScale();
    expect(s.range()).toEqual(LOUDNESS_RANGES.normal);
    // A quiet singer: between -60 and -35 dB, for five seconds.
    for (let i = 0; i < 500; i++) s.push(i / 100, 10 ** ((-60 + 25 * ((i % 50) / 49)) / 20));
    const { lowDb, highDb } = s.range();
    expect(lowDb).toBeGreaterThan(-61);
    expect(lowDb).toBeLessThan(-55);
    expect(highDb).toBeGreaterThan(-40);
    expect(highDb).toBeLessThan(-34);
    // Both ends are reachable at the player's own extremes: -35 dB is the top, -60 the bottom.
    expect(s.position(10 ** (-35 / 20))).toBe(1);
    expect(s.position(10 ** (-60 / 20))).toBe(0);
  });
  it('is never narrower than its minimum span', () => {
    const s = createLoudnessScale({ minSpanDb: 18 });
    for (let i = 0; i < 400; i++) s.push(i / 100, 10 ** (-30 / 20));
    const { lowDb, highDb } = s.range();
    expect(highDb - lowDb).toBeCloseTo(18);
    expect((lowDb + highDb) / 2).toBeCloseTo(-30, 0);
  });
  it('keeps a fixed range when asked', () => {
    const s = createLoudnessScale({ mode: 'loud' });
    for (let i = 0; i < 400; i++) s.push(i / 100, 0.001);
    expect(s.range()).toEqual(LOUDNESS_RANGES.loud);
    expect(s.position(10 ** (-27 / 20))).toBeCloseTo(0.5);
  });
  it('on real singing, spans at least its minimum and reaches both ends', () => {
    const { frames } = realSinging();
    const s = createLoudnessScale();
    const voiced = frames.filter((f) => f.f0 !== null && f.clarity >= 0.5);
    const pos = voiced.map((f) => s.push(f.t, f.rms));
    const { lowDb, highDb } = s.range();
    expect(highDb - lowDb).toBeGreaterThanOrEqual(18 - 1e-9);
    expect(lowDb).toBeGreaterThan(dbOf(1e-4));
    const late = pos.slice(Math.floor(pos.length / 2));
    expect(Math.min(...late)).toBeLessThan(0.15);
    expect(Math.max(...late)).toBeGreaterThan(0.85);
  });
});

describe('the pitch cursor', () => {
  it('puts a note at the centre of its column, any octave, and wraps', () => {
    expect(pitchX(60)).toBeCloseTo(0.5 / 12);
    expect(pitchX(72 + 7)).toBeCloseTo(7.5 / 12);
    expect(pitchX(48 + 11)).toBeCloseTo(11.5 / 12);
    expect(semitoneOfX(pitchX(64.3))).toBeCloseTo(4.3);
  });
  it('follows real singing to the sung notes’ columns', () => {
    const { between } = realSinging();
    const c = createPitchCursor();
    const at = (t: number) => {
      let s = null;
      for (let now = 0; now <= t; now += TICK) s = c.push({ pitch: between(now - TICK, now), onsets: [] }, now);
      return s!;
    };
    // vocadito 2: G4 held from 2.09 s to 3.63 s.
    const g = at(3.2);
    expect(g.live).toBe(true);
    expect(Math.abs(semitoneOfX(g.x) - 7)).toBeLessThan(0.5);
  });
});

describe('Pop the Notes', () => {
  const backdrop = { columns: [] };
  const balloons = (semis: number[]) => semis.map((s) => ({ x: pitchX(60 + s), y: 0.5, r: 0.04 }));

  it('on real singing, pops the balloons of the sung notes and none of the others', () => {
    const { between, duration } = realSinging();
    const sung = createPopSession({ title: 't', start: 0, targets: balloons([0, 4, 5, 7]), cursor: createPitchCursor(), backdrop, wrapX: true, aspect: 1, atOnce: 4, holdS: 0.35 });
    const r = run(sung.tick, between, 0, duration);
    expect(r.last.score.done).toBe(4);
    expect(r.last.phase).toBe('results');
    expect(r.cues).toBe(4);
    const unsung = createPopSession({ title: 't', start: 0, targets: balloons([1, 3, 6, 9, 10]), cursor: createPitchCursor(), backdrop, wrapX: true, aspect: 1, atOnce: 5, holdS: 0.35 });
    expect(run(unsung.tick, between, 0, duration).last.score.done).toBe(0);
  });

  it('loses a balloon’s hold slowly while the voice is off it', () => {
    const s = createPopSession({ title: 't', start: 0, targets: balloons([0]), cursor: createPitchCursor(), backdrop, wrapX: true, aspect: 1, holdS: 1, decay: 0.5 });
    const v = voice([{ t: 0, dur: 0.6, midi: 60 }, { t: 0.6, dur: 0.4, midi: 66 }]);
    const r = run(s.tick, v, 0, 1);
    expect(r.last.score.done).toBe(0);
    // About 0.55 held (the filter and the frames' lag take a little), less 0.2 lost.
    expect(r.last.targets[0].progress).toBeGreaterThan(0.2);
    expect(r.last.targets[0].progress).toBeLessThan(0.5);
  });

  it('a course sits on the columns, inside the reachable heights, never twice on one column', () => {
    const c = pitchLoudnessCourse({ count: 40, rMin: 0.05, rMax: 0.1, seed: 7 });
    for (const [i, b] of c.entries()) {
      expect((b.x * 12 - 0.5) % 1).toBeCloseTo(0);
      expect(b.y).toBeGreaterThanOrEqual(0.15);
      expect(b.y).toBeLessThanOrEqual(0.85);
      if (i > 0) expect(distanceOn(b, c[i - 1], { wrapX: true, aspect: 1 })).toBeGreaterThan(0);
      if (i > 0) expect(b.x).not.toBeCloseTo(c[i - 1].x);
    }
  });
});

describe('the Pitch Maze', () => {
  const notes = [60, 64, 67];
  const opts = { title: 't', start: 0, notes, backdrop: { columns: [] }, speed: 0.25, holdS: 0.8, spacing: 0.5 };
  // Wall k spans [0.5(k+1), 0.5(k+1) + 0.2]; the ball reaches it at 2(k+1) s when nothing stops it.
  const singing = (cents: number) =>
    voice([
      { t: 0, dur: 2.9, midi: 60 + cents / 100 },
      { t: 2.9, dur: 2, midi: 64 + cents / 100 },
      { t: 4.9, dur: 3.1, midi: 67 + cents / 100 },
    ]);

  it('in tune, climbs through every wall without waiting, singing the tune', () => {
    const s = createMazeSession({ ...opts, cursor: createPitchCursor() });
    const r = run(s.tick, singing(0), 0, 9);
    expect(r.last.phase).toBe('results');
    expect(r.last.score.done).toBe(3);
    expect(r.last.results!.counts['seconds waiting']).toBe(0);
    expect(r.cues).toBe(3); // each wall's note, once
  });

  it('a quarter tone sharp gets through a normal opening and waits at a hard one', () => {
    const normal = createMazeSession({ ...opts, gapSemitones: MAZE_LEVELS.normal.gapSemitones, cursor: createPitchCursor() });
    expect(run(normal.tick, singing(50), 0, 8).last.score.done).toBe(3);
    const hard = createMazeSession({ ...opts, gapSemitones: MAZE_LEVELS.hard.gapSemitones, cursor: createPitchCursor() });
    const r = run(hard.tick, singing(50), 0, 8);
    expect(r.last.score.done).toBe(0);
    expect(r.last.maze!.stuck).toBe(true);
  });

  it('the wrong note stops the ball under the wall; the right one, held, takes it through', () => {
    const s = createMazeSession({ ...opts, notes: [62], cursor: createPitchCursor() });
    const v = voice([{ t: 0, dur: 4, midi: 69 }, { t: 4, dur: 2, midi: 62 }]);
    const stopped = run(s.tick, v, 0, 3.9).last;
    expect(stopped.maze!.stuck).toBe(true);
    expect(stopped.maze!.segments[0].state).toBe('ahead');
    const after = run(s.tick, v, 3.9 + TICK, 6).last;
    expect(after.score.done).toBe(1);
  });

  it('a silence inside a wall waits rather than falls', () => {
    const s = createMazeSession({ ...opts, notes: [60], holdS: 1, cursor: createPitchCursor() });
    const v = voice([{ t: 0, dur: 2.4, midi: 60 }, { t: 2.4, dur: 1, midi: null }, { t: 3.4, dur: 2, midi: 60 }]);
    const mid = run(s.tick, v, 0, 3).last;
    expect(mid.maze!.segments[0].state).toBe('inside');
    expect(mid.score.done).toBe(0);
    expect(run(s.tick, v, 3 + TICK, 5).last.score.done).toBe(1);
  });
});

describe('the Pitch Maze road (bands)', () => {
  const road = (segments: Segment[], extra = {}) => createTrackSession({ title: 't', start: 0, segments, cursor: createPitchCursor(), backdrop: { columns: [] }, speed: ROAD_SPEED, view: 'road', ...extra });
  // Three notes of a second each at 60 bpm, after a 3 s run-up: bands at 3-4, 4-5, 5-6 s.
  const melody = [{ midi: 60, beats: 1 }, { midi: 64, beats: 1 }, { midi: 67, beats: 1 }];
  const sing = (cents: number) => voice([{ t: 2.5, dur: 1.5, midi: 60 + cents / 100 }, { t: 4, dur: 1, midi: 64 + cents / 100 }, { t: 5, dur: 1.5, midi: 67 + cents / 100 }]);

  it('lays the notes along the road as long as they last', () => {
    const b = bandsOf(melody, { bpm: 60, speed: ROAD_SPEED, gapS: 0 });
    expect(b.map((x) => x.at / ROAD_SPEED)).toEqual([3, 4, 5]);
    expect(b.every((x) => Math.abs(x.length / ROAD_SPEED - 1) < 1e-9)).toBe(true);
  });

  it('in tune: on the note nearly all the time, points up, not lost', () => {
    const r = run(road(bandsOf(melody, { bpm: 60, speed: ROAD_SPEED, widthSemitones: 0.5 })).tick, sing(0), 0, 7);
    expect(r.last.phase).toBe('results');
    expect(r.last.maze!.lost).toBeUndefined();
    expect(r.last.results!.accuracy).toBeGreaterThan(0.9);
    expect(r.last.maze!.points!).toBeGreaterThan(5);
  });

  it('the lane\u2019s width is the precision: 20 cents sharp is on a 25-cent lane, 40 cents is off and loses', () => {
    const lane = bandsOf(melody, { bpm: 60, speed: ROAD_SPEED, widthSemitones: 0.5 });
    expect(run(road(lane).tick, sing(20), 0, 7).last.results!.accuracy).toBeGreaterThan(0.9);
    const off = run(road(lane).tick, sing(40), 0, 7).last;
    expect(off.maze!.lost).toBe(true);
    expect(off.results!.summary).toMatch(/Out of points/);
  });

  it('silence on a band costs points', () => {
    const r = run(road(bandsOf(melody, { bpm: 60, speed: ROAD_SPEED })).tick, voice([]), 0, 7).last;
    expect(r.maze!.lost).toBe(true);
  });

  it('on real singing, its own notes keep it going and a transposition loses', () => {
    const fx = loadAudioFixture('audio_games_vocadito_2');
    const { between, duration } = realSinging();
    const notes = (shift: number): Segment[] =>
      fx.notes.filter((n) => n.duration >= 0.1).map((n) => ({ kind: 'band', at: n.start * ROAD_SPEED, length: n.duration * ROAD_SPEED, midi: midiOf(n.hz) + shift, widthSemitones: 1 }));
    const own = run(road(notes(0)).tick, between, 0, duration + 1).last;
    expect(own.maze!.lost).toBeUndefined();
    expect(own.results!.accuracy).toBeGreaterThan(0.6);
    const moved = run(road(notes(3)).tick, between, 0, duration + 1).last;
    expect(moved.maze!.lost).toBe(true);
  });

  it('the levels go from walls seen from above to roads with narrower lanes', () => {
    const tune = [{ midi: 60, beats: 1 }, { midi: 62, beats: 2 }];
    const kinds = TRACK_LEVELS.map((l) => trackFor(tune, 90, l));
    expect(kinds.slice(0, 3).every((k) => k.view === 'top' && k.segments.every((x) => x.kind === 'wall'))).toBe(true);
    expect(kinds.slice(3).every((k) => k.view === 'road' && k.segments.every((x) => x.kind === 'band'))).toBe(true);
    const widths = TRACK_LEVELS.map((l) => l.widthSemitones);
    expect([...widths.slice(0, 3)].sort((a, b) => b - a)).toEqual(widths.slice(0, 3));
    expect([...widths.slice(3)].sort((a, b) => b - a)).toEqual(widths.slice(3));
  });
});
