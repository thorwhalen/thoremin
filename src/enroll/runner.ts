/**
 * The cue runner (#163) — steps a routine through its cues, driven by the data.
 *
 * The runner owns no samples and no maths: it hands every frame to the
 * {@link Session} (which samples and, later, builds the model) and asks a
 * {@link SufficiencyEvaluator} what to do next. Its whole job is the *conversation*:
 * start a cue and say its instruction; say a variation when the evaluator asks for
 * one (and not again until something changes); end the cue on `enough` or `cannot`;
 * after a short beat, start the next. When the last cue ends, it is `done` and the
 * host builds.
 *
 * ## What it says, and through which channel
 *
 * Everything the runner wants the player to hear is an event with a `say` string —
 * the instruction on `cue-start`, the variation on `guidance`, a fixed phrase on
 * `cue-end`. The host shows `say` as text ALWAYS and plays a cached clip for it when
 * voice is on (#163 §4). Written and spoken are the same string on purpose: a player
 * with sound off loses nothing, and the clip set is exactly the set of strings this
 * file can emit plus the cues' own text — finite and content-addressable.
 *
 * ## Time comes from the caller
 *
 * No clock of its own: `push(vector, tMs)` carries the sample's time and `tick(tMs)`
 * advances time without a sample (no face in frame, say — the runner must still be
 * able to run out of patience and move on). Tests drive it deterministically; the host
 * polls it at human frequency, never from the audio/tick path.
 *
 * ## Speech is rate-limited HERE, not in the evaluator
 *
 * The evaluator is pure and reports the situation every time it is asked (every
 * `evaluateEveryMs`). If it says `need-variation`, the runner speaks only when the
 * situation has changed since it last spoke — a new sample arrived — or when
 * `repeatSayMs` has passed. Otherwise "a bit further" would be said four times a
 * second.
 */
import type { Cue } from './cue';
import { samplingFor } from './cue';
import type { Session } from './session';
import { defaultSufficiency, type SufficiencyEvaluator, type Verdict } from './sufficiency';
import type { FeatureVector } from './types';

/** Fixed phrases the runner may say at a cue's end (a finite set, for the clip cache). */
export const RUNNER_PHRASES = {
  enough: 'Good.',
  cannot: 'Moving on.',
  done: 'That is everything. Thank you.',
} as const;

export type CueOutcome = 'enough' | 'cannot' | 'skipped';

export type RunnerEvent =
  | { type: 'cue-start'; cue: Cue; index: number; say: string; t: number }
  | { type: 'guidance'; cue: Cue; index: number; say: string; t: number }
  | { type: 'cue-end'; cue: Cue; index: number; outcome: CueOutcome; why?: string; say?: string; samples: number; t: number }
  | { type: 'done'; say: string; t: number }
  | { type: 'stopped'; t: number };

export type RunnerStatus = 'idle' | 'running' | 'between' | 'done' | 'stopped';

export interface RunnerState {
  status: RunnerStatus;
  /** Index of the active (or, between cues, the next) cue; -1 when idle/done. */
  index: number;
  cue: Cue | null;
  /** Samples captured for the active cue (still-points or counted frames). */
  samples: number;
  /** Fraction of the cue's declared minimum captured so far — the coverage meter. */
  coverage: number;
  elapsedMs: number;
  /** The last verdict for the active cue. */
  verdict: Verdict | null;
  /** The last thing said (instruction or guidance) — what the panel shows large. */
  say: string | null;
  /** Per-cue outcomes so far, by index. */
  outcomes: (CueOutcome | null)[];
}

export interface RunnerOptions {
  cues: readonly Cue[];
  session: Session;
  evaluate?: SufficiencyEvaluator;
  /** How often the evaluator is consulted. */
  evaluateEveryMs?: number;
  /** Pause between a cue's end and the next cue's start — room for "Good." */
  beatMs?: number;
  /** Minimum gap before the same guidance is repeated with no new sample in between. */
  repeatSayMs?: number;
}

const DEFAULTS = { evaluateEveryMs: 250, beatMs: 1500, repeatSayMs: 6000 };

export interface Runner {
  /** Begin the routine at `tMs` (cue 0 starts immediately). */
  start(tMs: number): void;
  /** Feed a live vector at `tMs`. No-op unless running. */
  push(vector: FeatureVector, tMs: number): void;
  /** Advance time without a sample (so patience and beats still elapse). */
  tick(tMs: number): void;
  /** The player skips the active cue. */
  skip(tMs: number): void;
  /** Abort the routine. Captured samples stay in the session. */
  stop(tMs: number): void;
  state(): RunnerState;
  subscribe(listener: (event: RunnerEvent) => void): () => void;
}

/** Progress as a 0..1 fraction of the cue's own minimum — what the meter shows. */
export function cueCoverage(cue: Cue, samples: number): number {
  const s = cue.sufficiency;
  const min = s.kind === 'frames' ? s.minFrames : s.minPoints;
  return min <= 0 ? 1 : Math.max(0, Math.min(1, samples / min));
}

export function createRunner(options: RunnerOptions): Runner {
  const o = { ...DEFAULTS, ...options };
  const { cues, session } = o;
  const evaluate = o.evaluate ?? defaultSufficiency;
  const listeners = new Set<(e: RunnerEvent) => void>();

  let status: RunnerStatus = 'idle';
  let index = -1;
  let startedAt = 0;
  let lastEvaluatedAt = 0;
  let lastSampleAt: number | null = null;
  let lastSampleCount = 0;
  /** Speech bookkeeping for the active cue. */
  let said: string | null = null;
  let saidAt = 0;
  let saidAtSampleCount = -1;
  let askedVariations = 0;
  let verdict: Verdict | null = null;
  /** When the next cue should start (status 'between'). */
  let nextAt = 0;
  const outcomes: (CueOutcome | null)[] = cues.map(() => null);

  const emit = (e: RunnerEvent) => {
    for (const l of listeners) l(e);
  };

  const activeCue = (): Cue | null => (index >= 0 && index < cues.length ? cues[index] : null);

  const samplesOf = (cue: Cue): number =>
    samplingFor(cue) === 'still-points' ? session.pointsFor(cue.id).length : session.framesFor(cue.id);

  const beginCue = (i: number, tMs: number) => {
    index = i;
    const cue = cues[i];
    session.beginCue(cue);
    status = 'running';
    startedAt = tMs;
    lastEvaluatedAt = tMs;
    lastSampleAt = null;
    lastSampleCount = 0;
    said = cue.instruction;
    saidAt = tMs;
    saidAtSampleCount = 0;
    askedVariations = 0;
    verdict = null;
    emit({ type: 'cue-start', cue, index: i, say: cue.instruction, t: tMs });
  };

  const endCue = (outcome: CueOutcome, tMs: number, why?: string) => {
    const cue = activeCue();
    if (!cue) return;
    session.endCue();
    outcomes[index] = outcome;
    const say = outcome === 'enough' ? RUNNER_PHRASES.enough : outcome === 'cannot' ? RUNNER_PHRASES.cannot : undefined;
    emit({ type: 'cue-end', cue, index, outcome, why, say, samples: samplesOf(cue), t: tMs });
    if (index + 1 >= cues.length) {
      status = 'done';
      index = -1;
      emit({ type: 'done', say: RUNNER_PHRASES.done, t: tMs });
      return;
    }
    status = 'between';
    nextAt = tMs + o.beatMs;
  };

  const consider = (tMs: number) => {
    const cue = activeCue();
    if (!cue || status !== 'running') return;
    if (tMs - lastEvaluatedAt < o.evaluateEveryMs) return;
    lastEvaluatedAt = tMs;
    const samples = samplesOf(cue);
    if (samples !== lastSampleCount) {
      lastSampleCount = samples;
      lastSampleAt = tMs;
    }
    const v = evaluate({
      cue,
      features: session.featuresFor(cue),
      points: session.pointsFor(cue.id),
      frames: session.framesFor(cue.id),
      elapsedMs: tMs - startedAt,
      sinceLastSampleMs: lastSampleAt === null ? tMs - startedAt : tMs - lastSampleAt,
      baseline: session.baseline(),
      sigma: session.sigma,
      askedVariations,
    });
    verdict = v;
    switch (v.verdict) {
      case 'enough':
        endCue('enough', tMs);
        return;
      case 'cannot':
        endCue('cannot', tMs, v.why);
        return;
      case 'need-variation': {
        const changed = samples !== saidAtSampleCount;
        const stale = tMs - saidAt >= o.repeatSayMs;
        if (v.say !== said ? changed || stale : stale) {
          said = v.say;
          saidAt = tMs;
          saidAtSampleCount = samples;
          askedVariations += 1;
          emit({ type: 'guidance', cue, index, say: v.say, t: tMs });
        }
        return;
      }
      case 'need-more':
        return;
    }
  };

  const advance = (tMs: number) => {
    if (status === 'between' && tMs >= nextAt) beginCue(index + 1, tMs);
  };

  return {
    start(tMs) {
      if (cues.length === 0) {
        status = 'done';
        emit({ type: 'done', say: RUNNER_PHRASES.done, t: tMs });
        return;
      }
      outcomes.fill(null);
      beginCue(0, tMs);
    },
    push(vector, tMs) {
      advance(tMs);
      if (status !== 'running') return;
      session.push(vector, tMs);
      consider(tMs);
    },
    tick(tMs) {
      advance(tMs);
      consider(tMs);
    },
    skip(tMs) {
      if (status === 'running') endCue('skipped', tMs);
      else if (status === 'between') beginCue(index + 1, tMs);
    },
    stop(tMs) {
      if (status === 'running') {
        session.endCue();
        outcomes[index] = 'skipped';
      }
      status = 'stopped';
      index = -1;
      emit({ type: 'stopped', t: tMs });
    },
    state() {
      const cue = status === 'running' ? activeCue() : status === 'between' ? cues[index + 1] ?? null : null;
      const samples = status === 'running' && cue ? samplesOf(cue) : 0;
      return {
        status,
        index: status === 'between' ? index + 1 : index,
        cue,
        samples,
        coverage: cue ? cueCoverage(cue, samples) : 0,
        elapsedMs: status === 'running' ? lastEvaluatedAt - startedAt : 0,
        verdict,
        say: status === 'running' ? said : null,
        outcomes: outcomes.slice(),
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
