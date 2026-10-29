/**
 * `@thoremin/judge`: windows, onset matching with known offsets, score folds, pitch-note judging
 * and the calibration estimate, each against numbers worked out by hand.
 */
import { describe, it, expect } from 'vitest';
import {
  AUDIO_ONSET_WINDOWS,
  checkWindows,
  tier,
  tierOf,
  windowsInBeats,
  createOnsetJudge,
  judgeOnsets,
  scoreJudgments,
  centsOff,
  hzOf,
  midiOf,
  judgePitchLine,
  liveReading,
  estimateOffset,
  clickTimes,
  type OnsetTarget,
} from '@thoremin/judge';

const targets = (times: number[], lane?: string): OnsetTarget[] => times.map((t, id) => ({ id, t, lane }));

describe('windows', () => {
  it('reads the tier of an offset, inclusive at the edges', () => {
    expect(tierOf(0, AUDIO_ONSET_WINDOWS)?.name).toBe('perfect');
    expect(tierOf(-0.03, AUDIO_ONSET_WINDOWS)?.name).toBe('perfect');
    expect(tierOf(0.045, AUDIO_ONSET_WINDOWS)?.name).toBe('great');
    expect(tierOf(-0.1, AUDIO_ONSET_WINDOWS)?.name).toBe('good');
    expect(tierOf(0.1001, AUDIO_ONSET_WINDOWS)).toBeNull();
  });

  it('refuses tiers out of order and empty lists', () => {
    expect(() => checkWindows([])).toThrow(/at least one/);
    expect(() => checkWindows([tier('a', 0.05), tier('b', 0.02)])).toThrow(/must contain "a"/);
    expect(() => checkWindows([tier('a', 0)])).toThrow(/positive/);
  });

  it('scales beat windows by the beat period', () => {
    const w = windowsInBeats([tier('perfect', 0.125), tier('good', 0.25)], 0.5);
    expect(w[0].early).toBeCloseTo(0.0625);
    expect(w[1].late).toBeCloseTo(0.125);
  });

  it('judges an asymmetric tier by its own early and late reach', () => {
    const w = checkWindows([{ name: 'ok', early: 0.02, late: 0.06 }]);
    expect(tierOf(-0.03, w)).toBeNull();
    expect(tierOf(0.05, w)?.name).toBe('ok');
  });
});

describe('onset judging with known offsets', () => {
  it('assigns each event its tier, then misses and strays', () => {
    const { judgments, strays } = judgeOnsets(
      targets([0, 0.5, 1, 1.5, 2]),
      [{ t: 0.012 }, { t: 0.45 }, { t: 1.09 }, { t: 1.75 }, { t: 2.0 }],
      { windows: AUDIO_ONSET_WINDOWS },
    );
    expect(judgments.map((j) => (j.kind === 'hit' ? j.tier : 'miss'))).toEqual(['perfect', 'great', 'good', 'miss', 'perfect']);
    const first = judgments[0];
    expect(first.kind === 'hit' && first.offset).toBeCloseTo(0.012);
    expect(strays.map((s) => s.event.t)).toEqual([1.75]);
  });

  it('nearest matching takes the closer target; lock takes the earliest open one', () => {
    // Targets 80 ms apart; an event 60 ms after the first is 20 ms before the second.
    const t = targets([0, 0.08]);
    const near = judgeOnsets(t, [{ t: 0.06 }], { windows: AUDIO_ONSET_WINDOWS });
    expect(near.judgments.find((j) => j.kind === 'hit')?.target.id).toBe(1);
    const lock = judgeOnsets(t, [{ t: 0.06 }], { windows: AUDIO_ONSET_WINDOWS, matching: 'lock' });
    expect(lock.judgments.find((j) => j.kind === 'hit')?.target.id).toBe(0);
  });

  it('one event never satisfies two targets', () => {
    const { judgments } = judgeOnsets(targets([0, 0.02]), [{ t: 0.01 }], { windows: AUDIO_ONSET_WINDOWS });
    expect(judgments.filter((j) => j.kind === 'hit')).toHaveLength(1);
    expect(judgments.filter((j) => j.kind === 'miss')).toHaveLength(1);
  });

  it('matches only within a lane', () => {
    const t = [...targets([0], 'clap'), { id: 1, t: 0, lane: 'tap' }];
    const { judgments, strays } = judgeOnsets(t, [{ t: 0.005, lane: 'tap' }, { t: 0.01, lane: 'snap' }], { windows: AUDIO_ONSET_WINDOWS });
    expect(judgments.find((j) => j.kind === 'hit')?.target.lane).toBe('tap');
    expect(strays).toHaveLength(1);
  });

  it('live: advance closes targets once their late window has passed, in every lane', () => {
    const judge = createOnsetJudge([{ id: 0, t: 0, lane: 'a' }, { id: 1, t: 0.05, lane: 'b' }], { windows: AUDIO_ONSET_WINDOWS });
    expect(judge.advance(0.09)).toEqual([]);
    expect(judge.advance(0.101).map((j) => j.target.id)).toEqual([0]);
    expect(judge.done()).toBe(false);
    expect(judge.advance(0.2).map((j) => j.target.id)).toEqual([1]);
    expect(judge.done()).toBe(true);
  });

  it('refuses events out of time order', () => {
    const judge = createOnsetJudge(targets([0]), { windows: AUDIO_ONSET_WINDOWS });
    judge.hit({ t: 0.5 });
    expect(() => judge.hit({ t: 0.1 })).toThrow(/time order/);
  });
});

describe('score', () => {
  it('weighs tiers, counts combo and the timing bias', () => {
    const { judgments, strays } = judgeOnsets(
      targets([0, 1, 2, 3, 4]),
      [{ t: -0.02 }, { t: 1.02 }, { t: 2.05 }, { t: 4.0 }, { t: 4.6 }],
      { windows: AUDIO_ONSET_WINDOWS },
    );
    const s = scoreJudgments(judgments, strays.length, { strayCost: 0.5 });
    expect(s.counts).toEqual({ perfect: 3, great: 1, miss: 1 });
    // (1 + 1 + 0.75 + 1 - 0.5) / 5
    expect(s.accuracy).toBeCloseTo(0.65);
    expect(s.maxCombo).toBe(3);
    expect(s.combo).toBe(1);
    expect(s.early).toBe(1);
    expect(s.late).toBe(2);
    expect(s.meanOffset).toBeCloseTo((-0.02 + 0.02 + 0.05 + 0) / 4);
  });
});

describe('pitch', () => {
  it('converts between Hz, MIDI and cents', () => {
    expect(midiOf(440)).toBeCloseTo(69);
    expect(hzOf(60)).toBeCloseTo(261.626, 2);
    expect(centsOff(hzOf(69.5), 69)).toBeCloseTo(50);
    // An octave down is 1200 cents off, folded to 0.
    expect(centsOff(220, 69)).toBeCloseTo(-1200);
    expect(centsOff(220, 69, true)).toBeCloseTo(0);
    expect(centsOff(hzOf(69 + 6.5), 69, true)).toBeCloseTo(-550);
  });

  it('judges a note by the share of its time on pitch', () => {
    const notes = [{ id: 0, start: 0, end: 1, midi: 60 }, { id: 1, start: 1, end: 2, midi: 62 }];
    const samples = [];
    // Note 0: 100 samples, 90 within 30 cents, 10 unvoiced.
    for (let i = 0; i < 100; i++) samples.push({ t: i / 100, f0: i < 90 ? hzOf(60.3) : null });
    // Note 1: sung a semitone and a half flat for the whole note.
    for (let i = 0; i < 100; i++) samples.push({ t: 1 + i / 100, f0: hzOf(60.5), clarity: 0.9 });
    const [a, b] = judgePitchLine(notes, samples);
    expect(a.voiced).toBeCloseTo(0.9);
    expect(a.inTune).toBeCloseTo(0.9);
    expect(a.cents).toBeCloseTo(30);
    expect(a.tier).toBe('perfect');
    expect(b.inTune).toBe(0);
    expect(b.tier).toBe('miss');
    expect(judgePitchLine(notes, samples, { toleranceCents: 160 })[1].tier).toBe('perfect');
  });

  it('counts a low-clarity sample as unvoiced', () => {
    const [j] = judgePitchLine([{ id: 0, start: 0, end: 1, midi: 69 }], [{ t: 0.5, f0: 440, clarity: 0.2 }]);
    expect(j.voiced).toBe(0);
    expect(Number.isNaN(j.cents)).toBe(true);
  });

  it('gives a live reading for the note sounding now', () => {
    const notes = [{ id: 0, start: 0, end: 1, midi: 69 }];
    expect(liveReading(notes, { t: 0.5, f0: 440 })?.onPitch).toBe(true);
    expect(liveReading(notes, { t: 0.5, f0: hzOf(70.5) })?.onPitch).toBe(false);
    expect(liveReading(notes, { t: 1.5, f0: 440 })).toBeNull();
  });
});

describe('calibration', () => {
  it('recovers a known round trip from a loopback take', () => {
    const clicks = clickTimes(100, 16, 1);
    const jitter = [0.001, -0.002, 0, 0.002, -0.001];
    const heard = clicks.map((c, i) => c + 0.087 + jitter[i % jitter.length]);
    const r = estimateOffset(clicks, heard);
    expect(r.refusal).toBeNull();
    expect(r.offset).toBeCloseTo(0.087, 3);
    expect(r.kept).toBe(14);
  });

  it('drops an outlier and the warm-up, and refuses an irregular or short take', () => {
    const clicks = clickTimes(120, 12);
    const taps = clicks.map((c, i) => c + 0.04 + (i === 6 ? 0.2 : 0) + (i % 2 ? 0.003 : -0.003));
    const r = estimateOffset(clicks, taps);
    expect(r.offset).toBeCloseTo(0.04, 2);
    expect(r.kept).toBe(r.paired - 1);
    expect(estimateOffset(clicks.slice(0, 5), taps.slice(0, 5)).refusal).toMatch(/usable pairs/);
    const messy = clicks.map((c, i) => c + 0.04 + (i % 2 ? 0.06 : -0.06));
    expect(estimateOffset(clicks, messy).refusal).toMatch(/irregular/);
    expect(estimateOffset(clicks, []).refusal).toMatch(/no response/);
  });
});
