/**
 * The three games' pure sessions, on real singing (the vocadito fixtures through the YIN tracker)
 * and on scripted input with known answers: a melody sung against its own notes scores high and
 * against a transposed melody low; onsets with known offsets land in the tiers they should; a held
 * note is found and timed.
 */
import { describe, it, expect } from 'vitest';
import { createPitchTracker } from '@thoremin/sdk/audio/pitch';
import { midiOf, hzOf } from '@thoremin/judge';
import { LessonSchema, notesFrom, placeLesson, midiFromName, nameOf, type Lesson } from '@/slices/games/lib/lesson';
import { LESSONS } from '@/slices/games/lib/lessons';
import { createSingSession } from '@/slices/games/lib/sing';
import { createPlayAlongSession } from '@/slices/games/lib/play_along';
import { createMatchSession } from '@/slices/games/lib/match';
import type { Heard, HeardPitch } from '@/slices/games/lib/listen';
import type { GameView } from '@/slices/games/lib/view';
import { loadAudioFixture, inBlocks, type AudioFixture } from '../helpers/audio_fixtures';

const TICK = 1 / 60;

/** Run a session from `t0` to `t1` at 60 ticks a second, handing each tick the input inside it. */
function run(
  tick: (now: number, heard: Heard) => { view: GameView; cues: unknown[] },
  input: { pitch: HeardPitch[]; onsets: { t: number; strength: number }[] },
  t0: number,
  t1: number,
): { last: GameView; cues: number } {
  let last!: GameView;
  let cues = 0;
  let prev = t0 - TICK;
  for (let now = t0; now <= t1; now += TICK) {
    const inTick = <T extends { t: number }>(xs: T[]) => xs.filter((x) => x.t > prev && x.t <= now);
    const r = tick(now, { pitch: inTick(input.pitch), onsets: inTick(input.onsets) });
    cues += r.cues.length;
    last = r.view;
    prev = now;
  }
  return { last, cues };
}

const pitchTrack = (fx: AudioFixture): HeardPitch[] => {
  const tr = createPitchTracker({ sampleRate: fx.wav.sampleRate });
  return inBlocks(fx.wav.pcm, fx.wav.sampleRate, 128, (b, t0) => tr.push(b, t0)).map((f) => ({ t: f.t, f0: f.f0, clarity: f.clarity }));
};

/** The fixture's annotated notes as a lesson in seconds (60 bpm: a beat is a second). */
const lessonOf = (fx: AudioFixture, game: Lesson['game']): Lesson =>
  LessonSchema.parse({
    id: 'fixture',
    title: 'fixture',
    game,
    bpm: 60,
    countIn: 0,
    notes: fx.notes.map((n) => ({ beat: n.start, beats: n.duration, midi: Math.round(midiOf(n.hz)) })),
  });

describe('lessons', () => {
  it('parses the note text and names notes', () => {
    expect(notesFrom('C4 D4:2 - x:0.5 61')).toEqual([
      { beat: 0, beats: 1, midi: 60 },
      { beat: 1, beats: 2, midi: 62 },
      { beat: 4, beats: 0.5 },
      { beat: 4.5, beats: 1, midi: 61 },
    ]);
    expect(midiFromName('Bb3')).toBe(58);
    expect(nameOf(69.4)).toBe('A4');
    expect(() => notesFrom('H4')).toThrow(/not a pitch/);
  });

  it('places a lesson after its count-in', () => {
    const l = LESSONS.find((x) => x.id === 'rhythm-quarters')!;
    const p = placeLesson(l, 10);
    expect(p.clicks).toHaveLength(4);
    expect(p.t0).toBeCloseTo(10 + (4 * 60) / 90);
    expect(p.notes[1].start - p.notes[0].start).toBeCloseTo(60 / 90);
  });

  it('ships lessons for every game, all valid', () => {
    for (const game of ['sing', 'play-along', 'match'] as const) expect(LESSONS.filter((l) => l.game === game).length).toBeGreaterThanOrEqual(2);
    for (const l of LESSONS) expect(() => LessonSchema.parse(l)).not.toThrow();
  });
});

describe('Sing on real singing', () => {
  for (const name of ['audio_games_vocadito_28', 'audio_games_vocadito_2']) {
    it(`${name}: its own melody scores high, a minor third off scores low, an octave off still scores (folded)`, () => {
      const fx = loadAudioFixture(name);
      const pitch = pitchTrack(fx);
      const lesson = lessonOf(fx, 'sing');
      const play = (transpose: number, octaveFold = true) =>
        run(createSingSession(lesson, { start: 0, transpose, octaveFold, reference: false }).tick, { pitch, onsets: [] }, 0, 7.5).last;
      const own = play(0);
      expect(own.phase).toBe('results');
      expect(own.results!.accuracy).toBeGreaterThan(0.6);
      const third = play(3);
      expect(third.results!.accuracy).toBeLessThan(0.2);
      expect(play(12).results!.accuracy).toBeCloseTo(own.results!.accuracy, 5);
      expect(play(12, false).results!.accuracy).toBeLessThan(0.1);
    });
  }

  it('shows the count-in, the trail folded to the note, and the reference cue', () => {
    const lesson = LESSONS.find((l) => l.id === 'sing-five')!;
    const s = createSingSession(lesson, { start: 1 });
    const first = s.tick(1, { pitch: [], onsets: [] });
    expect(first.view.phase).toBe('count-in');
    expect(first.view.countdown).toBe(4);
    // A C3 sung on the first note (C4) draws on the C4 bar.
    const t = s.notes[0].start + 0.1;
    const r = s.tick(t, { pitch: [{ t, f0: hzOf(48), clarity: 0.9 }], onsets: [] });
    expect(r.view.trail.at(-1)!.midi).toBeCloseTo(60);
    const all = run(createSingSession(lesson, { start: 1 }).tick, { pitch: [], onsets: [] }, 1, 3);
    expect(all.cues).toBe(5); // four clicks and the first note
  });
});

describe('Play along', () => {
  const clap = LESSONS.find((l) => l.id === 'rhythm-quarters')!;

  it('judges claps with known offsets into their tiers, counts extras, and reads the timing', () => {
    const s = createPlayAlongSession(clap, { start: 0 });
    const offsets = [0.005, -0.02, 0.045, -0.07, 0.09, 0.2, 0.01, -0.012];
    const onsets = s.notes.map((n, i) => ({ t: n.start + offsets[i], strength: 1 }));
    onsets.push({ t: s.notes[2].start + 0.33, strength: 1 }); // a stray between beats
    const { last } = run(s.tick, { pitch: [], onsets }, 0, s.end + 0.5);
    expect(last.phase).toBe('results');
    // 0.2 is outside every window: a miss for the target, and an extra.
    expect(last.results!.counts).toEqual({ perfect: 4, great: 1, good: 2, miss: 1, extra: 2 });
    expect(last.results!.timing!.verdict).toBe('steady');
  });

  it('a calibrated offset turns a late player on time', () => {
    const late = (offset: number) => {
      const s = createPlayAlongSession(clap, { start: 0, offset });
      return run(s.tick, { pitch: [], onsets: s.notes.map((n) => ({ t: n.start + 0.08, strength: 1 })) }, 0, s.end + 0.5).last.results!;
    };
    expect(late(0).counts.good).toBe(8);
    expect(late(0).timing!.verdict).toBe('dragging');
    expect(late(0.08).counts.perfect).toBe(8);
  });

  it('on real singing: the right notes at their onsets hit, the wrong ones are wrong notes', () => {
    const fx = loadAudioFixture('audio_games_vocadito_2');
    const pitch = pitchTrack(fx);
    const lesson = lessonOf(fx, 'play-along');
    const onsets = fx.notes.map((n) => ({ t: n.start, strength: 1 }));
    const own = run(createPlayAlongSession(lesson, { start: 0 }).tick, { pitch, onsets }, 0, 7.5).last.results!;
    expect(own.counts.perfect).toBeGreaterThanOrEqual(Math.floor(0.7 * fx.notes.length));
    const wrong = createPlayAlongSession(lesson, { start: 0, transpose: 4 });
    const w = run(wrong.tick, { pitch, onsets }, 0, 7.5).last;
    expect(w.results!.counts.miss).toBeGreaterThanOrEqual(Math.floor(0.7 * fx.notes.length));
  });
});

describe('Match the note', () => {
  const lesson = LessonSchema.parse({ id: 'm', title: 'm', game: 'match', bpm: 60, countIn: 0, notes: notesFrom('A4 C5') });
  /** A scripted singer: silent, then a glide from `from` to the target, then held with vibrato. */
  const sing = (t0: number, t1: number, target: number, from: number, rate = 100): HeardPitch[] =>
    Array.from({ length: Math.round((t1 - t0) * rate) }, (_, k) => {
      const t = t0 + k / rate;
      const glide = Math.min(1, (t - t0) / 0.4);
      const midi = from + (target - from) * glide + 0.2 * Math.sin(2 * Math.PI * 5.5 * t);
      return { t, f0: hzOf(midi), clarity: 0.9 };
    });

  it('times the find and the hold, then moves to the next note', () => {
    const s = createMatchSession(lesson, { start: 0 });
    // Note 1 (A4): listening from 1.2 s; sung from 1.5 s, gliding up from G4, in tune by about 1.8 s.
    const pitch = sing(1.5, 3.2, 69, 67);
    const first = run(s.tick, { pitch, onsets: [] }, 0, 3.2);
    expect(s.outcomes()).toHaveLength(1);
    expect(s.outcomes()[0].tier).toBe('perfect');
    expect(s.outcomes()[0].found!).toBeGreaterThan(0.3);
    expect(s.outcomes()[0].found!).toBeLessThan(0.9);
    expect(first.last.target!.midi).toBe(72);
  });

  it('ignores the reference while it rings, and misses after the timeout', () => {
    const s = createMatchSession(lesson, { start: 0, timeoutS: 2 });
    // The reference itself, heard by the microphone for its first second, must not count.
    const bleed = sing(0, 1.1, 69, 69);
    run(s.tick, { pitch: bleed, onsets: [] }, 0, 3.5);
    expect(s.outcomes()).toEqual([{ found: null, spreadCents: NaN, tier: 'miss' }]);
  });

  it('on real singing: finds the long G4 of vocadito 2', () => {
    const fx = loadAudioFixture('audio_games_vocadito_2');
    const pitch = pitchTrack(fx);
    const long = fx.notes.reduce((a, b) => (b.duration > a.duration ? b : a));
    const target = Math.round(midiOf(long.hz));
    const l = LessonSchema.parse({ id: 'g', title: 'g', game: 'match', bpm: 60, countIn: 0, notes: [{ beat: 0, beats: 1, midi: target }] });
    // Listening opens just before the note is sung.
    const s = createMatchSession(l, { start: long.start - 1.3, holdS: 0.8 });
    run(s.tick, { pitch, onsets: [] }, long.start - 1.3, long.start + long.duration);
    expect(s.outcomes()[0]?.tier).toMatch(/perfect|great/);
  });
});
