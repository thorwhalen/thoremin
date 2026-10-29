/**
 * Echo: the game plays a rhythm, counts "1, 2, 3, 4", and the player claps it back. A level is a
 * rhythm (onsets in beats, `LessonNote`s: a melody's notes are a rhythm too) cut into bars; the
 * rounds present the bars one at a time and then stacked (`stackRounds`), so a phrase is learnt in
 * pieces and then played whole, the call-and-response drill of every rhythm teacher.
 *
 * A round, all on the beat grid of the level's tempo:
 *   listen  the bars of the round, each onset a tap (or its note, when the rhythm is pitched),
 *           over a light metronome on every beat;
 *   count   one bar of count-in clicks, the numbers shown big;
 *   answer  the same bars, silent: the player's onsets judged against the round's onsets by
 *           `@thoremin/judge`'s onset judge (the metronome would be heard as claps, so it is off
 *           here unless `clickWhileAnswering`, for a player on headphones);
 *   result  one bar to read the round's verdict; a round under `passAt` is played again, up to
 *           `retries` times, before the game moves on.
 * Each round is placed on the clock when it begins (a retry changes what comes next), and its
 * sounds are handed out ahead through the cue feed, each once.
 *
 * Pure: fed the engine time and what was heard each tick.
 */
import { AUDIO_ONSET_WINDOWS, createOnsetJudge, scoreJudgments, type OnsetJudge, type OnsetJudgment, type Windows } from '@thoremin/judge';
import { ACCENT_VELOCITY, CLICK_MIDI, CLICK_VELOCITY, createCueFeed, type Cue } from './cues';
import { notesFrom, type LessonNote } from './lesson';
import { shifted, type Heard } from './listen';
import type { Results } from './view';
import { timingVerdict } from './view';

/** How the bars are stacked after each was heard alone. */
export const STACKS = ['end', 'grow'] as const;
export type Stack = (typeof STACKS)[number];

export interface EchoLevel {
  id: string;
  title: string;
  bpm: number;
  beatsPerBar: number;
  /** The rhythm, beats from its start; pitches, when present, are played in the call. */
  notes: LessonNote[];
  /** Bars per piece presented alone. Default 1. */
  barsPerPiece?: number;
  /** `end`: each piece, then all of them; `grow`: 1, 2, 1-2, 3, 1-3, ... Default `end`. */
  stack?: Stack;
  hint?: string;
}

export interface EchoOptions {
  start: number;
  windows?: Windows;
  /** Subtracted from every heard time (the player's calibrated offset), seconds. */
  offset?: number;
  /** A round at or above this accuracy passes. Default 0.7. */
  passAt?: number;
  /** Times a failed round is played again. Default 1. */
  retries?: number;
  /** Keep the metronome during the answer (with headphones). Default false. */
  clickWhileAnswering?: boolean;
}

export const ECHO_DEFAULTS = { passAt: 0.7, retries: 1, clickWhileAnswering: false };

/** The call's sounds: a metronome far quieter than the taps, the taps a lower, louder click. */
const METRONOME_VELOCITY = 0.22;
const TAP_MIDI = 84;
const TAP_VELOCITY = 0.9;

/** A round's bars, as a range of bar indices (inclusive). */
export interface RoundSpec {
  from: number;
  to: number;
}

/**
 * The rounds of a level of `bars` bars in pieces of `per`: each piece alone, then (`end`) all of
 * them, or (`grow`) after each piece from the second on, everything so far.
 */
export function stackRounds(bars: number, per = 1, stack: Stack = 'end'): RoundSpec[] {
  const pieces: RoundSpec[] = [];
  for (let b = 0; b < bars; b += per) pieces.push({ from: b, to: Math.min(bars, b + per) - 1 });
  if (pieces.length === 1) return pieces;
  if (stack === 'end') return [...pieces, { from: 0, to: bars - 1 }];
  const out: RoundSpec[] = [];
  pieces.forEach((p, i) => {
    out.push(p);
    if (i > 0) out.push({ from: 0, to: p.to });
  });
  return out;
}

/** How many bars a rhythm fills (its last note's start decides: a long last note may ring over). */
export const barsOf = (level: Pick<EchoLevel, 'notes' | 'beatsPerBar'>): number => Math.max(1, Math.floor(Math.max(...level.notes.map((n) => n.beat)) / level.beatsPerBar) + 1);

/** The round's notes, beats from the round's first bar. */
export function roundNotes(level: EchoLevel, r: RoundSpec): LessonNote[] {
  const b0 = r.from * level.beatsPerBar;
  const b1 = (r.to + 1) * level.beatsPerBar;
  return level.notes.filter((n) => n.beat >= b0 && n.beat < b1).map((n) => ({ ...n, beat: n.beat - b0 }));
}

export const roundLabel = (r: RoundSpec): string => (r.from === r.to ? `Bar ${r.from + 1}` : `Bars ${r.from + 1}-${r.to + 1}`);

export type EchoPhase = 'listen' | 'count' | 'answer' | 'result' | 'results';

/** A target of the round on the stage: where (beats into the round) and what the judge said. */
export interface EchoTarget {
  beat: number;
  beats: number;
  midi?: number;
  state: 'pending' | 'hit' | 'miss';
  /** The tier when hit. */
  label?: string;
  /** Beats, heard minus target, when hit. */
  offsetBeats?: number;
}

export interface EchoView {
  game: 'echo';
  title: string;
  phase: EchoPhase;
  now: number;
  /** "Bar 2", "Bars 1-4", and which round of how many. */
  round: { label: string; index: number; total: number; retry: boolean };
  beatsPerBar: number;
  /** Bars in this round. */
  bars: number;
  /** Where the playhead is, beats into the round (listen and answer), else null. */
  playhead: number | null;
  /** The count-in number to show (1..beatsPerBar), during the count. */
  count: number | null;
  targets: EchoTarget[];
  /** The player's onsets this round, beats into the round (the strays too). */
  heard: { beat: number; stray: boolean }[];
  /** The last round's verdict, during its result bar. */
  verdict?: { accuracy: number; passed: boolean; line: string };
  /** Each round's outcome: passed, failed (after its retries), or not played yet (null). */
  outcomes: (boolean | null)[];
  hint?: string;
  results?: Results;
  notice?: string;
}

export function createEchoSession(level: EchoLevel, opts: EchoOptions) {
  const o = { ...ECHO_DEFAULTS, ...opts };
  const windows = o.windows ?? AUDIO_ONSET_WINDOWS;
  const offset = o.offset ?? 0;
  const beat = 60 / level.bpm;
  const bpb = level.beatsPerBar;
  const rounds = stackRounds(barsOf(level), level.barsPerPiece ?? 1, level.stack ?? 'end');
  const feed = createCueFeed(0.5);
  const all: OnsetJudgment[] = [];
  let strays = 0;
  const outcomes: (boolean | null)[] = rounds.map(() => null);

  /** The round being played: its spec, its timeline and its judge. */
  interface Live {
    index: number;
    spec: RoundSpec;
    retry: boolean;
    tries: number;
    notes: LessonNote[];
    bars: number;
    listenAt: number;
    countAt: number;
    answerAt: number;
    resultAt: number;
    endAt: number;
    judge: OnsetJudge;
    targets: EchoTarget[];
    heard: { beat: number; stray: boolean }[];
    judged: OnsetJudgment[];
    strays: number;
    verdict?: EchoView['verdict'];
  }

  function place(index: number, at: number, tries: number): Live {
    const spec = rounds[index];
    const notes = roundNotes(level, spec);
    const bars = spec.to - spec.from + 1;
    const span = bars * bpb * beat;
    const listenAt = at;
    const countAt = listenAt + span;
    const answerAt = countAt + bpb * beat;
    const resultAt = answerAt + span;
    const endAt = resultAt + bpb * beat;
    const cues: Cue[] = [];
    const metronome = (from: number, beats: number) => {
      for (let k = 0; k < beats; k++) cues.push({ t: from + k * beat, midi: CLICK_MIDI, velocity: METRONOME_VELOCITY * (k % bpb === 0 ? 1.4 : 1), kind: 'click' });
    };
    metronome(listenAt, bars * bpb);
    for (const n of notes) cues.push(n.midi === undefined ? { t: listenAt + n.beat * beat, midi: TAP_MIDI, velocity: TAP_VELOCITY, kind: 'click' } : { t: listenAt + n.beat * beat, midi: n.midi, velocity: TAP_VELOCITY, kind: 'reference' });
    for (let k = 0; k < bpb; k++) cues.push({ t: countAt + k * beat, midi: CLICK_MIDI, velocity: k === 0 ? ACCENT_VELOCITY : CLICK_VELOCITY, kind: 'click' });
    if (o.clickWhileAnswering) metronome(answerAt, bars * bpb);
    feed.add(cues.sort((a, b) => a.t - b.t));
    return {
      index,
      spec,
      retry: tries > 0,
      tries,
      notes,
      bars,
      listenAt,
      countAt,
      answerAt,
      resultAt,
      endAt,
      judge: createOnsetJudge(notes.map((n, id) => ({ id, t: answerAt + n.beat * beat })), { windows }),
      targets: notes.map((n) => ({ beat: n.beat, beats: n.beats, ...(n.midi === undefined ? {} : { midi: n.midi }), state: 'pending' })),
      heard: [],
      judged: [],
      strays: 0,
    };
  }

  let live: Live = place(0, o.start, 0);
  let endedAt: number | null = null;

  const settle = (r: Live, j: OnsetJudgment) => {
    r.judged.push(j);
    const t = r.targets[j.target.id];
    if (j.kind === 'hit') {
      t.state = 'hit';
      t.label = j.tier;
      t.offsetBeats = j.offset / beat;
    } else {
      t.state = 'miss';
      t.label = 'miss';
    }
  };

  function tick(now: number, heardRaw: Heard): { view: EchoView; cues: Cue[] } {
    const heard = shifted(heardRaw, offset);
    const r = live;
    // The answer is listened to from just before its first beat to just after its last window.
    const open = r.answerAt - windows[windows.length - 1].early;
    for (const ev of [...heard.onsets].sort((a, b) => a.t - b.t)) {
      if (ev.t < open || ev.t > r.resultAt) continue;
      for (const m of r.judge.advance(ev.t)) settle(r, m);
      const j = r.judge.hit({ t: ev.t });
      const stray = j.kind === 'stray';
      if (stray) r.strays++;
      else if (j.kind === 'hit') settle(r, j);
      r.heard.push({ beat: (ev.t - r.answerAt) / beat, stray });
    }
    if (now >= r.answerAt) for (const m of r.judge.advance(now)) settle(r, m);

    // The round's verdict once its answer is over.
    if (now >= r.resultAt && !r.verdict) {
      for (const m of r.judge.advance(Infinity)) settle(r, m);
      const s = scoreJudgments(r.judged, r.strays);
      const ok = s.accuracy >= o.passAt;
      if (ok || r.tries >= o.retries) outcomes[r.index] = ok;
      all.push(...r.judged);
      strays += r.strays;
      r.verdict = { accuracy: s.accuracy, passed: ok, line: ok ? `${s.hits} of ${r.notes.length}: on to the next` : r.tries < o.retries ? `${s.hits} of ${r.notes.length}: once more` : `${s.hits} of ${r.notes.length}: moving on` };
    }
    // The next round (or the same again) starts as this one ends.
    if (now >= r.endAt && endedAt === null) {
      const again = !r.verdict!.passed && r.tries < o.retries;
      if (again) live = place(r.index, r.endAt, r.tries + 1);
      else if (r.index + 1 < rounds.length) live = place(r.index + 1, r.endAt, 0);
      else endedAt = r.endAt;
    }

    const c = live;
    const phase: EchoPhase = endedAt !== null ? 'results' : now < c.countAt ? 'listen' : now < c.answerAt ? 'count' : now < c.resultAt ? 'answer' : 'result';
    const playhead = phase === 'listen' ? (now - c.listenAt) / beat : phase === 'answer' ? (now - c.answerAt) / beat : null;
    const total = scoreJudgments([...all].sort((a, b) => a.target.t - b.target.t), strays);
    const view: EchoView = {
      game: 'echo',
      title: level.title,
      phase,
      now,
      round: { label: roundLabel(c.spec), index: c.index, total: rounds.length, retry: c.retry },
      beatsPerBar: bpb,
      bars: c.bars,
      playhead: playhead === null ? null : Math.max(0, playhead),
      count: phase === 'count' ? Math.min(bpb, Math.floor((now - c.countAt) / beat) + 1) : null,
      targets: c.targets.map((t) => ({ ...t })),
      heard: c.heard.map((h) => ({ ...h })),
      ...(phase === 'result' && c.verdict ? { verdict: c.verdict } : {}),
      outcomes: [...outcomes],
      ...(level.hint ? { hint: level.hint } : {}),
      ...(endedAt === null
        ? {}
        : {
            results: {
              accuracy: total.accuracy,
              counts: { ...total.counts, ...(strays ? { extra: strays } : {}) },
              ...(total.hits >= 2 ? { timing: timingVerdict(total.meanOffset, total.sdOffset) } : {}),
              summary: `${outcomes.filter(Boolean).length} of ${rounds.length} rounds passed, ${total.hits} claps on time`,
            },
          }),
    };
    return { view, cues: feed.due(now) };
  }

  return { tick, rounds, end: () => endedAt };
}

/** The shipped Echo levels: a few bars each, from steady beats to syncopation. */
export const ECHO_LEVELS: readonly EchoLevel[] = [
  { id: 'echo-quarters', title: 'Steady beats', bpm: 84, beatsPerBar: 4, notes: notesFrom('x x x x  x x - x  x - x x  x x x -'), hint: 'Listen, wait for 1-2-3-4, then clap it back.' },
  { id: 'echo-eighths', title: 'Eighth notes', bpm: 84, beatsPerBar: 4, notes: notesFrom('x x:0.5 x:0.5 x x  x:0.5 x:0.5 x x:0.5 x:0.5 x  x x x:0.5 x:0.5 x:0.5 x:0.5  x:0.5 x:0.5 x x:2') },
  { id: 'echo-rests', title: 'Rests and long notes', bpm: 80, beatsPerBar: 4, stack: 'grow', notes: notesFrom('x:2 x x  -:0.5 x:0.5 x x:2  x x:1.5 x:0.5 x  x:3 -') },
  { id: 'echo-offbeat', title: 'Off the beat', bpm: 76, beatsPerBar: 4, stack: 'grow', notes: notesFrom('x -:0.5 x:0.5 x x  -:0.5 x:0.5 -:0.5 x:0.5 x x  x:0.5 x x:0.5 x x  -:0.5 x x:0.5 x:2') },
];
