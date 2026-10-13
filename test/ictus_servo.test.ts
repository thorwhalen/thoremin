/**
 * The beat servo (`@thoremin/ictus` `servo.ts`, #187 PR 7): a recording that follows a
 * conductor beat for beat. The loop is closed here by hand against an EXACT position
 * integral: the song's position advances by the rate the servo chose, held constant over
 * each tick (what an `AudioBufferSourceNode`'s k-rate `playbackRate` integrates to), read
 * back a tick late (the graph's delayed edges), and HEARD `latency` seconds after it is
 * read. The song's own tempo drifts beat to beat, so the servo has to read its local
 * tempo, not a constant.
 */
import { describe, it, expect } from 'vitest';
import {
  beatIndexAt,
  createBeatServo,
  servoRate,
  songTimeAt,
  songTimeOfBeat,
  EMPTY_SONG_GRID,
  SERVO_DEFAULTS,
  type MusicalTime,
  type ServoOptions,
  type ServoState,
  type SongGrid,
  wrapPhase,
} from '@thoremin/ictus';

const HZ = 60;
const DT = 1 / HZ;

/** A song whose own beat wanders +-4 % around 0.5 s, starting 0.7 s in. */
function driftingGrid(n = 400): SongGrid {
  const beats: number[] = [0.7];
  for (let i = 1; i < n; i++) beats.push(beats[i - 1] + 0.5 * (1 + 0.04 * Math.sin(i / 3)));
  return { ...EMPTY_SONG_GRID, periodS: 0.5, bpm: 120, phaseS: 0.2, beats, confidence: 0.9, meter: 4 };
}

/** A conductor: tempo `v(t)` beats per second from `start`, integrated exactly; holds
 *  inside `holds` (the beat freezes, as the conductor node's does). */
function conductor(v: (t: number) => number, start: number, holds: Array<[number, number]> = []) {
  let beat = 0;
  let lastT = start;
  return (t: number): MusicalTime => {
    const held = holds.some(([a, b]) => t >= a && t < b);
    if (t > start && !held) beat += v(t) * (t - lastT);
    lastT = t;
    const started = t > start;
    const tempo = started && !held ? v(t) : 0;
    return {
      t,
      beat,
      phase: beat - Math.floor(beat),
      tempo: tempo * 60,
      period: tempo > 0 ? 1 / tempo : Infinity,
      confidence: started ? 0.9 : 0,
      nextBeatAt: Infinity,
      beatsPerBar: 4,
      beatInBar: 0,
      state: !started ? 'ready' : held ? 'hold' : 'running',
      anchors: started ? 1 : 0,
    };
  };
}

interface Run {
  /** The conductor's beat minus the song's HEARD beat (less the offset), per tick. */
  errAt: (t: number) => number;
  states: ServoState[];
  positions: Array<{ t: number; a: number; playing: boolean }>;
}

function run(opts: {
  lead: (t: number) => MusicalTime;
  seconds: number;
  /** The true output latency. */
  latency: number;
  /** What the servo is told (defaults to the truth). */
  toldLatency?: number;
  offset?: number;
  servo?: ServoOptions;
  /** The song's tracked grid (default {@link driftingGrid}). */
  grid?: SongGrid;
  /** Song beats per conductor beat, for the error (#376; default 1). */
  k?: number;
}): Run {
  const grid = opts.grid ?? driftingGrid();
  const k = opts.k ?? 1;
  const servo = createBeatServo(opts.servo);
  const offset = opts.offset ?? 0;
  let a = 0;
  let playing = false;
  let rate = 1;
  let cueId = 0;
  let song = songTimeAt(grid, a, { t: 0, rate, playing });
  const positions: Run['positions'] = [];
  const leads: MusicalTime[] = [];
  const states: ServoState[] = [];
  for (let i = 0; i <= opts.seconds * HZ; i++) {
    const t = i * DT;
    const lead = opts.lead(t);
    leads.push(lead);
    const s = servo.step({ t, lead, song, rate, latency: opts.toldLatency ?? opts.latency, offset });
    states.push(s);
    if (s.cue && s.cue.id !== cueId) {
      cueId = s.cue.id;
      a = songTimeOfBeat(grid, s.cue.beat);
    }
    playing = s.playing;
    rate = s.rate;
    positions.push({ t, a, playing });
    // What the player publishes this tick, read by the servo on the next one.
    song = songTimeAt(grid, a, { t, rate, playing });
    // The exact integral of a rate held over the tick.
    if (playing) a += rate * DT;
  }
  const errAt = (t: number): number => {
    const i = Math.round(t * HZ);
    const j = Math.round((t - opts.latency) * HZ);
    const heard = positions[Math.max(0, j)];
    return leads[i].beat - (beatIndexAt(grid, heard.a) - offset) / k;
  };
  return { errAt, states, positions };
}

const maxAbsErr = (r: Run, from: number, to: number): number => {
  let m = 0;
  for (let t = from; t <= to; t += DT) m = Math.max(m, Math.abs(r.errAt(t)));
  return m;
};

describe('servoRate', () => {
  it('closes the error in exactly one horizon while both tempi hold', () => {
    // Conductor at 0.6 s a beat, the song's own beat 0.5 s, the song 0.2 beats behind.
    const leadPeriod = 0.6;
    const own = 0.5;
    const e = 0.2;
    const r = servoRate(leadPeriod, own, e);
    const dt = SERVO_DEFAULTS.horizonBeats * leadPeriod;
    // Song beats covered in dt at rate r, against the conductor's horizonBeats.
    expect((r * dt) / own).toBeCloseTo(SERVO_DEFAULTS.horizonBeats + e, 12);
  });

  it('clamps the correction and the rate', () => {
    expect(servoRate(0.5, 0.5, 10)).toBeCloseTo(1 + SERVO_DEFAULTS.maxCorrection, 12);
    expect(servoRate(0.5, 0.5, -10)).toBeCloseTo(1 - SERVO_DEFAULTS.maxCorrection, 12);
    expect(servoRate(0.1, 0.5, 0)).toBe(SERVO_DEFAULTS.maxRate);
    expect(servoRate(5, 0.5, 0)).toBe(SERVO_DEFAULTS.minRate);
  });
});

describe('createBeatServo against an exact position integral', () => {
  const L = 0.08;

  it('waits cued on the first beat, starts on the first stroke, and locks to within a hundredth of a beat', () => {
    const r = run({ lead: conductor(() => 1.8, 1), seconds: 12, latency: L });
    // Before the first stroke: paused, cued to beat 0 (the song's first tracked beat).
    const before = r.positions[Math.round(0.9 * HZ)];
    expect(before.playing).toBe(false);
    expect(before.a).toBeCloseTo(0.7, 6);
    expect(r.states[Math.round(0.9 * HZ)].mode).toBe('cueing');
    // After it: playing, and what is HEARD is on the conductor's beat.
    expect(r.positions[Math.round(1.5 * HZ)].playing).toBe(true);
    expect(maxAbsErr(r, 5, 12)).toBeLessThan(0.01);
  });

  it('follows a tempo change and an accelerando within a few horizons', () => {
    // 1.8 beats/s, a step to 1.4 at 6 s, then an accelerando to 2.2 from 12 s to 16 s.
    const v = (t: number) => (t < 6 ? 1.8 : t < 12 ? 1.4 : t < 16 ? 1.4 + (0.8 * (t - 12)) / 4 : 2.2);
    const r = run({ lead: conductor(v, 1), seconds: 22, latency: L });
    expect(maxAbsErr(r, 4, 6)).toBeLessThan(0.01);
    // Settled again three horizons after the step.
    expect(maxAbsErr(r, 9, 12)).toBeLessThan(0.01);
    // A steady accelerando is a ramp: a proportional servo trails it by a little.
    expect(maxAbsErr(r, 13, 16)).toBeLessThan(0.05);
    expect(maxAbsErr(r, 19, 22)).toBeLessThan(0.01);
  });

  it('compensates the output latency: told nothing, the song runs latency * tempo beats late', () => {
    const told = run({ lead: conductor(() => 2, 1), seconds: 10, latency: 0.1 });
    const blind = run({ lead: conductor(() => 2, 1), seconds: 10, latency: 0.1, toldLatency: 0 });
    expect(Math.abs(told.errAt(9))).toBeLessThan(0.01);
    // Positive: the conductor is ahead of what is heard, by 0.1 s at 2 beats a second.
    expect(blind.errAt(9)).toBeCloseTo(0.2, 2);
  });

  it('holds with the conductor and resumes on his beat', () => {
    const r = run({ lead: conductor(() => 1.8, 1, [[6, 8]]), seconds: 14, latency: L });
    const held = r.states[Math.round(7 * HZ)];
    expect(held.mode).toBe('holding');
    expect(held.playing).toBe(false);
    expect(r.positions[Math.round(7.5 * HZ)].playing).toBe(false);
    expect(maxAbsErr(r, 11, 14)).toBeLessThan(0.01);
  });

  it('lands the conductor on a later beat of the song with an offset', () => {
    const r = run({ lead: conductor(() => 1.8, 1), seconds: 10, latency: L, offset: 8 });
    expect(r.positions[Math.round(0.9 * HZ)].a).toBeCloseTo(songTimeOfBeat(driftingGrid(), 8), 6);
    expect(maxAbsErr(r, 5, 10)).toBeLessThan(0.01);
  });

  it('cues rather than chases a song far adrift, and never stops a running song for it', () => {
    const lead = conductor(() => 1.8, 1);
    const r = run({
      // The conductor's beat jumps 5 beats ahead at 6 s (a skipped passage).
      lead: (t) => {
        const m = lead(t);
        return t >= 6 ? { ...m, beat: m.beat + 5 } : m;
      },
      seconds: 10,
      latency: L,
    });
    const cues = new Set(r.states.map((s) => s.cue?.id));
    expect(cues.size).toBeGreaterThanOrEqual(3); // null, the start, the jump
    expect(r.positions.filter((p) => p.t > 1.5).every((p) => p.playing)).toBe(true);
    expect(maxAbsErr(r, 8, 10)).toBeLessThan(0.01);
  });

  it('is idle without a song ruler', () => {
    const servo = createBeatServo();
    const song = songTimeAt(EMPTY_SONG_GRID, 0, { t: 0, playing: false });
    const s = servo.step({ t: 0, lead: conductor(() => 2, -1)(0), song, rate: 1, latency: 0 });
    expect(s.mode).toBe('idle');
    expect(s.playing).toBe(false);
  });
});

describe('when the recording starts', () => {
  it('as soon as the conductor\'s beat advances, even while his follower is still finding the tempo', () => {
    const servo = createBeatServo();
    const grid = driftingGrid();
    const song = songTimeAt(grid, songTimeOfBeat(grid, 0), { t: 0, rate: 1, playing: false });
    const lead: MusicalTime = { t: 0, beat: 0.1, phase: 0.1, tempo: 90, period: 2 / 3, confidence: 0.1, nextBeatAt: Infinity, beatsPerBar: 4, beatInBar: 0, state: 'ready', anchors: 1 };
    expect(servo.step({ t: 0, lead, song, rate: 1, latency: 0 }).playing).toBe(true);
    // Before the first stroke, or holding: not.
    expect(createBeatServo().step({ t: 0, lead: { ...lead, anchors: 0, period: Infinity }, song, rate: 1, latency: 0 }).playing).toBe(false);
    expect(createBeatServo().step({ t: 0, lead: { ...lead, state: 'hold' }, song, rate: 1, latency: 0 }).playing).toBe(false);
  });
});

/** The drifting song tracked at double time (a beat between every two) or at half time
 *  (every other beat): the beat tracker's octave errors (#364 item 2). */
/** A conductor whose first strokes are on the speed fallback: `ready`, one anchor, at
 *  `fallback` beats per second (the beat advancing at it), running at `v` from `runAt`. */
function fallbackStart(fallback: number, v: number, start: number, runAt: number) {
  const base = conductor((t) => (t < runAt ? fallback : v), start);
  return (t: number): MusicalTime => {
    const m = base(t);
    return t > start && t < runAt ? { ...m, state: 'ready', confidence: 0.1 } : m;
  };
}

function doubleTimeGrid(): SongGrid {
  const g = driftingGrid();
  const beats = g.beats.flatMap((b, i) => (i + 1 < g.beats.length ? [b, (b + g.beats[i + 1]) / 2] : [b]));
  return { ...g, beats, periodS: 0.25, bpm: 240 };
}
function halfTimeGrid(): SongGrid {
  const g = driftingGrid();
  return { ...g, beats: g.beats.filter((_, i) => i % 2 === 0), periodS: 1, bpm: 60 };
}

describe('the level: a song tracked at another level than the conductor beats (#376, #364 item 2)', () => {
  const L = 0.05;

  it('a double-time grid: two song beats a conducted beat, followed as tightly as a 1:1 grid, never sought', () => {
    const r = run({ lead: conductor(() => 1.8, 1), seconds: 14, latency: L, grid: doubleTimeGrid(), k: 2 });
    const following = r.states.filter((s) => s.mode === 'following');
    expect(following.length).toBeGreaterThan(0);
    expect(following.every((s) => s.ratio === 2)).toBe(true);
    expect(maxAbsErr(r, 5, 14)).toBeLessThan(0.01);
    // The audio plays at about the recording's own tempo (1.8 / 2), not clamped at 0.5.
    expect(r.states.at(-1)!.rate).toBeGreaterThan(0.8);
    expect(r.states.at(-1)!.rate).toBeLessThan(1);
    // Cued while waiting and at the start: no seek after it.
    const cuesAfterStart = new Set(r.states.filter((s) => s.t > 1.5).map((s) => s.cue?.id));
    expect(cuesAfterStart.size).toBe(1);
  });

  it('the 1:1 law alone on that grid (the #364 failure): pinned at the slowest rate, drifting, sought', () => {
    const r = run({ lead: conductor(() => 1.8, 1), seconds: 14, latency: L, grid: doubleTimeGrid(), servo: { ratios: [1] } });
    expect(r.states.filter((s) => s.t > 1.5).every((s) => s.rate === SERVO_DEFAULTS.minRate)).toBe(true);
    expect(maxAbsErr(r, 5, 14)).toBeGreaterThan(1);
    const cuesAfterStart = new Set(r.states.filter((s) => s.t > 1.5).map((s) => s.cue?.id));
    expect(cuesAfterStart.size).toBeGreaterThan(1);
  });

  it('a conductor at 70 % of the recording from his first stroke beats it slowly, not at half time', () => {
    const r = run({ lead: conductor(() => 1.4, 1), seconds: 12, latency: L });
    expect(r.states.filter((s) => s.mode === 'following').every((s) => s.ratio === 1)).toBe(true);
    expect(maxAbsErr(r, 6, 12)).toBeLessThan(0.01);
  });

  it('the level is chosen at his first running tempo, not the speed fallback of a first stroke', () => {
    // The fallback reads 160 bpm (2.67 beats/s, a fast half-time against the song's 2) for
    // half a second; then he runs at the song's tempo.
    const r = run({ lead: fallbackStart(8 / 3, 2, 1, 1.5), seconds: 10, latency: L });
    expect(r.states.filter((s) => s.mode === 'following').every((s) => s.ratio === 1)).toBe(true);
    expect(maxAbsErr(r, 5, 10)).toBeLessThan(0.01);
  });

  it('a half-time grid: one song beat every two conducted beats', () => {
    const r = run({ lead: conductor(() => 1.8, 1), seconds: 14, latency: L, grid: halfTimeGrid(), k: 0.5 });
    expect(r.states.filter((s) => s.mode === 'following').every((s) => s.ratio === 0.5)).toBe(true);
    expect(maxAbsErr(r, 5, 14)).toBeLessThan(0.01);
  });

  it('a held ratio changes only once another has persisted, the song is not moved for it, and his beats land on its beats', () => {
    // He starts at half the recording's tempo (two song beats a beat), then doubles his
    // tempo at 6.25 s and beats every song beat; the switch falls between his beats.
    const r = run({ lead: conductor((t) => (t < 6.25 ? 1 : 2), 1), seconds: 18, latency: L });
    const ratioAt = (t: number) => r.states[Math.round(t * HZ)].ratio;
    expect(ratioAt(5)).toBe(2);
    // Still 2 for the persistence after the change (the song is pushed to the clamp).
    expect(ratioAt(8.75)).toBe(2);
    expect(ratioAt(9.75)).toBe(1);
    // Re-anchored by whole song beats: his beat sits on a song beat (the error is an
    // integer), not a fraction of one off.
    for (let t = 13; t <= 18; t += DT) expect(Math.abs(wrapPhase(r.errAt(t)))).toBeLessThan(0.01);
    const cuesAfterStart = new Set(r.states.filter((s) => s.t > 1.5).map((s) => s.cue?.id));
    expect(cuesAfterStart.size).toBe(1);
    expect(r.positions.filter((p) => p.t > 1.5).every((p) => p.playing)).toBe(true);
    // Settled again on 1:1 near the recording's own tempo.
    expect(r.states.at(-1)!.rate).toBeGreaterThan(0.9);
    expect(r.states.at(-1)!.rate).toBeLessThan(1.1);
  });
});
