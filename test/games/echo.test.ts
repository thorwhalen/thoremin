/**
 * Echo the Rhythm's pure session: the rounds a level stacks into, the sounds each round plays and
 * when (call over a quiet metronome, the count, a silent answer), the answer judged by the onset
 * judge, a failed round played again, and claps rendered as audio through the real onset analyser.
 */
import { describe, it, expect } from 'vitest';
import { barsOf, createEchoSession, ECHO_LEVELS, roundNotes, stackRounds, type EchoLevel, type EchoView } from '@thoremin/games/echo';
import { notesFrom } from '@thoremin/games/lesson';
import type { Cue } from '@thoremin/games/cues';
import { createOnsetAnalyser } from '@thoremin/sdk/audio/analysers';
import { runOffline } from '@thoremin/sdk/audio/offline';
import { seededRandom } from '@thoremin/games/field';

const LEVEL: EchoLevel = { id: 't', title: 'Test', bpm: 120, beatsPerBar: 4, notes: notesFrom('x x x x  x:0.5 x:0.5 x x:2') };
const BEAT = 0.5;

/** Tick a session every 20 ms from `start`, clapping `claps` (engine seconds), until its results. */
function run(level: EchoLevel, opts: Parameters<typeof createEchoSession>[1], claps: (answerAt: number, round: number, retry: boolean, notes: { beat: number }[]) => number[]) {
  const s = createEchoSession(level, opts);
  const cues: Cue[] = [];
  const views: EchoView[] = [];
  let queue: number[] = [];
  let planned = '';
  let prevPhase = '';
  for (let now = opts.start; now < opts.start + 300; now += 0.02) {
    const due = queue.filter((t) => t <= now);
    queue = queue.filter((t) => t > now);
    const r = s.tick(now, { pitch: [], onsets: due.map((t) => ({ t, strength: 1 })) });
    cues.push(...r.cues);
    views.push(r.view);
    const key = `${r.view.round.index}:${r.view.round.retry}`;
    // As the count starts, the player plans this round's claps (the answer starts a bar later).
    if (r.view.phase === 'count' && prevPhase !== 'count' && key !== planned) {
      planned = key;
      const answerAt = now + level.beatsPerBar * (60 / level.bpm);
      queue.push(...claps(answerAt, r.view.round.index, r.view.round.retry, r.view.targets));
    }
    prevPhase = r.view.phase;
    if (r.view.phase === 'results') break;
  }
  return { s, cues, views, last: views[views.length - 1] };
}

describe('the rounds of a level', () => {
  it('stacks bars one by one then all (end), or growing (grow), in pieces', () => {
    const at = (rs: { from: number; to: number }[]) => rs.map((r) => `${r.from}-${r.to}`);
    expect(at(stackRounds(4))).toEqual(['0-0', '1-1', '2-2', '3-3', '0-3']);
    expect(at(stackRounds(4, 1, 'grow'))).toEqual(['0-0', '1-1', '0-1', '2-2', '0-2', '3-3', '0-3']);
    expect(at(stackRounds(4, 2))).toEqual(['0-1', '2-3', '0-3']);
    expect(at(stackRounds(1))).toEqual(['0-0']);
  });

  it('cuts the rhythm into bars by onset', () => {
    expect(barsOf(LEVEL)).toBe(2);
    expect(roundNotes(LEVEL, { from: 1, to: 1 }).map((n) => n.beat)).toEqual([0, 0.5, 1, 2]);
    expect(roundNotes(LEVEL, { from: 0, to: 1 })).toHaveLength(8);
  });

  it('every shipped level is a whole number of bars of claps', () => {
    for (const l of ECHO_LEVELS) {
      expect(l.notes.length, l.id).toBeGreaterThan(4);
      expect(barsOf(l), l.id).toBeGreaterThanOrEqual(2);
      expect(l.notes.every((n) => n.midi === undefined), l.id).toBe(true);
    }
  });
});

describe('a round', () => {
  it('plays the call over a quiet metronome, counts four, and is silent while the player answers', () => {
    const { views, cues } = run(LEVEL, { start: 1 }, (answerAt, _r, _x, notes) => notes.map((n) => answerAt + n.beat * BEAT));
    const first = 1;
    const countAt = first + 4 * BEAT;
    const answerAt = countAt + 4 * BEAT;
    const roundOne = cues.filter((c) => c.t < answerAt + 4 * BEAT);
    // Call: four taps on the beats (louder), four metronome clicks (quieter).
    const taps = roundOne.filter((c) => c.t < countAt && c.midi === 84);
    const metronome = roundOne.filter((c) => c.t < countAt && c.midi === 96);
    expect(taps.map((c) => c.t - first)).toEqual([0, 0.5, 1, 1.5]);
    expect(metronome).toHaveLength(4);
    expect(Math.max(...metronome.map((c) => c.velocity))).toBeLessThan(Math.min(...taps.map((c) => c.velocity)));
    // Count: four clicks, the first accented, and the view says 1, 2, 3, 4.
    expect(roundOne.filter((c) => c.t >= countAt && c.t < answerAt).map((c) => c.t - countAt)).toEqual([0, 0.5, 1, 1.5]);
    expect([...new Set(views.filter((v) => v.phase === 'count' && v.round.index === 0).map((v) => v.count))]).toEqual([1, 2, 3, 4]);
    // Answer: no sound at all.
    expect(roundOne.filter((c) => c.t >= answerAt)).toEqual([]);
  });

  it('with the metronome kept on while answering (headphones), clicks the answer too', () => {
    const { cues } = run(LEVEL, { start: 1, clickWhileAnswering: true }, () => []);
    const answerAt = 1 + 8 * BEAT;
    expect(cues.filter((c) => c.t >= answerAt && c.t < answerAt + 4 * BEAT).length).toBe(4);
  });

  it('a player who claps it back on time passes every round: bar 1, bar 2, then both', () => {
    const { last, views } = run(LEVEL, { start: 1 }, (answerAt, _r, _x, notes) => notes.map((n) => answerAt + n.beat * BEAT + 0.01));
    expect([...new Set(views.map((v) => v.round.label))]).toEqual(['Bar 1', 'Bar 2', 'Bars 1-2']);
    expect(last.phase).toBe('results');
    expect(last.outcomes).toEqual([true, true, true]);
    expect(last.results!.accuracy).toBeGreaterThan(0.9);
    expect(last.results!.summary).toBe('3 of 3 rounds passed, 16 claps on time');
  });

  it('a round played badly is played again once, then the game moves on', () => {
    // Silent on the first try of every round, perfect on the retry.
    const { last, views } = run(LEVEL, { start: 1 }, (answerAt, _r, retry, notes) => (retry ? notes.map((n) => answerAt + n.beat * BEAT) : []));
    const order = views.filter((v) => v.phase === 'listen').map((v) => `${v.round.label}${v.round.retry ? '*' : ''}`);
    expect([...new Set(order)]).toEqual(['Bar 1', 'Bar 1*', 'Bar 2', 'Bar 2*', 'Bars 1-2', 'Bars 1-2*']);
    expect(last.outcomes).toEqual([true, true, true]);
    const verdicts = [...new Set(views.filter((v) => v.verdict).map((v) => v.verdict!.line))];
    expect(verdicts[0]).toBe('0 of 4: once more');
    // Never passing: each round is tried twice and recorded as failed.
    const never = run(LEVEL, { start: 1 }, () => []).last;
    expect(never.outcomes).toEqual([false, false, false]);
  });

  it('claps rendered as sound, through the onset analyser, are judged like the taps', () => {
    // The player's answers as audio: a 6 ms noise burst per clap, 30 ms late (a run where every
    // round passes, so the second run has the same rounds at the same times).
    const rate = 48000;
    const plan: number[] = [];
    run(LEVEL, { start: 1 }, (answerAt, _r, _x, notes) => {
      const ts = notes.map((n) => answerAt + n.beat * BEAT + 0.03);
      plan.push(...ts);
      return ts;
    });
    const pcm = new Float32Array(Math.ceil((Math.max(...plan) + 1) * rate));
    const rand = seededRandom(3);
    for (const t of plan) for (let k = 0; k < 0.006 * rate; k++) pcm[Math.round(t * rate) + k] += (rand() * 2 - 1) * 0.5 * Math.exp(-k / (0.002 * rate));
    const heard = runOffline(createOnsetAnalyser(rate), pcm).events.filter((e) => e.kind === 'onset').map((e) => (e as { frame: number }).frame / rate);
    expect(heard.length).toBe(plan.length);
    const { last } = run(LEVEL, { start: 1 }, (answerAt, _r, _x, notes) => heard.filter((t) => t >= answerAt - 0.1 && t < answerAt + (Math.max(...notes.map((n) => n.beat)) + 1) * BEAT));
    expect(last.outcomes.every(Boolean)).toBe(true);
    expect(last.results!.timing?.verdict).toBe('dragging');
  });
});
