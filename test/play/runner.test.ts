/**
 * The standalone game loop (`play/src/runner.ts`) runs a whole Match the Note with a scripted
 * microphone: pitch events stamped in context frames, moved to the context clock minus the input
 * stage, judged, and the reference notes handed to the synth once each.
 */
import { createMatchSession } from '@thoremin/games/match';
import { lessonById } from '@thoremin/games/lessons';
import type { Cue } from '@thoremin/games/cues';
import type { LeaseEvent } from '@thoremin/sdk-ui/audio/hub';
import { createRunner } from '../../play/src/runner';

const SR = 48_000;
const HOP_S = 0.01;
const hzOf = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** A singer who answers each reference note `answerS` after it, in tune, an octave down. */
function play(answerS: number, stageS: number) {
  const lesson = lessonById('match-triad')!;
  const session = createMatchSession(lesson, { start: 0.5 });
  let now = 0;
  let pending: LeaseEvent[] = [];
  const played: Cue[] = [];
  // The note the singer is answering (set by the synth callback, so held in an object TypeScript does not narrow).
  const singer: { current: { midi: number; from: number } | null } = { current: null };
  let lastHop = 0;
  const runner = createRunner(session, {
    drain: () => {
      const out = pending;
      pending = [];
      return out;
    },
    now: () => now,
    sampleRate: () => SR,
    inputStage: () => ({ seconds: stageS, source: 'measured' }),
    micState: () => 'live',
    play: (c) => {
      played.push(c);
      singer.current = { midi: c.midi, from: c.t + answerS };
    },
  });
  let view = runner.tick();
  for (let k = 0; k < 60 * 60 && view?.phase !== 'results'; k++) {
    now += 1 / 60;
    // The audio thread's pitch hops since the last tick, stamped where the sound reached the
    // context (the room time plus the input stage).
    for (; lastHop + HOP_S <= now; lastHop += HOP_S) {
      const t = lastHop + HOP_S;
      const note = singer.current;
      const voiced = note !== null && t >= note.from;
      pending.push({ source: 'pitch', event: { kind: 'pitch', frame: Math.round((t + stageS) * SR), f0: voiced ? hzOf(note.midi - 12) : null, clarity: voiced ? 0.9 : 0.1 } });
    }
    view = runner.tick();
  }
  return { view: view!, played, targets: session.targets };
}

describe('the standalone runner', () => {
  it('plays each reference note once and finds every note of a prompt singer', () => {
    const { view, played, targets } = play(1.3, 0.02);
    expect(played.map((c) => c.midi)).toEqual(targets);
    expect(new Set(played.map((c) => c.t)).size).toBe(played.length);
    expect(view.phase).toBe('results');
    expect(view.results!.accuracy).toBe(1);
    expect(view.notice).toBeUndefined();
  });

  it('returns nothing before the context exists, and says why the microphone is not live', () => {
    const session = createMatchSession(lessonById('match-triad')!, { start: 0 });
    const deps = { drain: () => [], sampleRate: () => SR, inputStage: () => ({ seconds: 0.01, source: 'prior' as const }), play: () => {} };
    expect(createRunner(session, { ...deps, now: () => null, micState: () => 'idle' }).tick()).toBeNull();
    expect(createRunner(session, { ...deps, now: () => 0.1, micState: () => 'denied' }).tick()?.notice).toMatch(/refused/);
  });
});
