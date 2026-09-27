/**
 * Scripted sequence training (#263) — a list of TARGETS the player is walked through.
 *
 * ## Why this is not a cue
 *
 * A cue (`cue.ts`, #163) never names what to produce: it asks for a movement or leaves
 * the choice to the player, and the categories are carved out of whatever they held.
 * That is the right shape for faces, where a prescribed expression is the failure mode.
 * An air instrument's vocabulary is the opposite case: the player already knows the
 * names (D5, a G chord) and wants to show each one in turn, quickly. Here the target IS
 * the point, the label is known before the take, and what is learned is a supervised
 * entry per label (`src/air/vocabulary.ts`). So a sequence is a sibling of a routine
 * with the same conventions (a caller-driven clock, `say` strings, events) and none of
 * the cue machinery: no sufficiency evaluator, no still-point sampler, no hierarchy.
 *
 * ## Vocabulary
 *
 * - A **sequence** is a saved, ordered list of targets to show one after another.
 * - A **target** is one label to hold ("D5"), with an optional hold length of its own.
 * - The **lead-in** is the pause before the first target: time to read the list.
 * - The **countdown** precedes every target: "Next: D5. 3, 2, 1."
 * - The **hold** is the capture. Its first `settleMs` are not captured (the hand is
 *   still moving into the shape; the enrolment UI's lesson), the rest is.
 *
 * ## Time comes from the caller
 *
 * As in `runner.ts`: `push(vector, tMs)` carries a sample's time, `tick(tMs)` advances
 * time without one. The host pushes once per new frame (it is the host's job to not
 * push the same frame twice: a captured take is what the host pushed). Tests drive it
 * deterministically.
 *
 * ## The verdict is injected
 *
 * When a hold ends, an optional `check(label, samples)` says whether the take looked
 * like its label. This module knows nothing about hands, notes or charts; the fingering
 * prior (`src/air/fingering_prior.ts`) is one such check, a "does it look like the
 * enrolled entry of that name" another. A mismatch does not stop the sequence: it is
 * reported on the `target-end` event and in `state().results`, and the host may `redo`.
 *
 * ## What it says
 *
 * Every event that wants the player's attention carries a `say` string built from the
 * finite set in {@link SEQUENCE_PHRASES} plus the target labels, so a voice can cache
 * one clip per phrase and per label (the trainer's speakable rule, #163 §4).
 */
import { z } from 'zod';
import type { FeatureVector } from './types';

/** One target of a sequence: what to hold, and for how long if not the sequence's default. */
export const SequenceTargetSchema = z.object({
  label: z.string().trim().min(1),
  /** Milliseconds of hold for THIS target (else the sequence's `holdMs`). */
  holdMs: z.number().min(200).max(60000).optional(),
});
export type SequenceTarget = z.infer<typeof SequenceTargetSchema>;

/** The payload of a sequence — what the collection stores. Every optional field has a
 *  default so a sequence saved by an older build still parses. */
export const SequenceSpecSchema = z.object({
  targets: z.array(SequenceTargetSchema).min(1),
  /** Before the first countdown: time to read the list. */
  leadInMs: z.number().min(0).max(30000).default(3000),
  /** Before every target's hold: "Next: D5", counting down. */
  countdownMs: z.number().min(0).max(30000).default(3000),
  /** The first part of every hold that is NOT captured: settling into the shape. */
  settleMs: z.number().min(0).max(5000).default(300),
  /** The hold (settle included) when a target does not say otherwise. Two seconds of
   *  capture is what the chord enrolment measured as enough (#249). */
  holdMs: z.number().min(200).max(60000).default(2300),
  /** How many times the whole list is run through. More loops, more samples per label. */
  loops: z.number().int().min(1).max(100).default(1),
});
export type SequenceSpec = z.infer<typeof SequenceSpecSchema>;
/** The loosest input the spec accepts (defaults not yet applied) — for authoring. */
export type SequenceSpecInput = z.input<typeof SequenceSpecSchema>;

/** A sequence as the named collection persists it. */
export const SequenceRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  sequence: SequenceSpecSchema,
});
export type SequenceRecord = z.infer<typeof SequenceRecordSchema>;

/** A sequence over plain labels, every other field defaulted. */
export function sequenceOf(labels: readonly string[], overrides: Partial<Omit<SequenceSpecInput, 'targets'>> = {}): SequenceSpec {
  return SequenceSpecSchema.parse({ targets: labels.map((label) => ({ label })), ...overrides });
}

/** The check's answer for one hold. `read` is what the take looked like instead. */
export type TargetVerdict =
  | { kind: 'ok' }
  | { kind: 'mismatch'; read: string; /** How much closer the take was to `read` than to the target, in the check's own units. */ margin: number }
  | { kind: 'unknown' };

export type TargetCheck = (label: string, samples: readonly FeatureVector[]) => TargetVerdict;

/** Why a hold ended. */
export type TargetOutcome = 'held' | 'skipped' | 'empty';

export interface TargetResult {
  /** Which run through the list, 0-based. */
  loop: number;
  index: number;
  label: string;
  outcome: TargetOutcome;
  samples: FeatureVector[];
  verdict: TargetVerdict | null;
}

/** The fixed phrases; the label is spliced in by {@link sayFor}. */
export const SEQUENCE_PHRASES = {
  leadIn: 'Get ready.',
  next: 'Next:',
  hold: 'Hold',
  held: 'Good.',
  mismatch: 'That looked like',
  empty: 'Nothing was seen.',
  done: 'That is everything. Thank you.',
} as const;

export const sayFor = {
  next: (label: string) => `${SEQUENCE_PHRASES.next} ${label}.`,
  hold: (label: string) => `${SEQUENCE_PHRASES.hold} ${label}.`,
  mismatch: (read: string) => `${SEQUENCE_PHRASES.mismatch} ${read}.`,
} as const;

export type SequencePhase = 'idle' | 'lead-in' | 'countdown' | 'hold' | 'done' | 'stopped';

export type SequenceEvent =
  | { type: 'lead-in'; say: string; t: number }
  | { type: 'target-start'; loop: number; index: number; label: string; say: string; t: number }
  | { type: 'hold-start'; loop: number; index: number; label: string; say: string; t: number }
  | { type: 'target-end'; result: TargetResult; say: string; t: number }
  | { type: 'done'; say: string; t: number }
  | { type: 'stopped'; t: number };

export interface SequenceState {
  phase: SequencePhase;
  loop: number;
  /** Index of the current target (countdown or hold); -1 when idle or done. */
  index: number;
  /** The target being counted down to or held, or null. */
  current: SequenceTarget | null;
  /** The target after it (wrapping into the next loop), or null when this is the last. */
  next: SequenceTarget | null;
  /** Milliseconds left in the current phase (lead-in, countdown, or hold). */
  remainingMs: number;
  /** Whole seconds left, rounded up: what a countdown shows ("3, 2, 1"). */
  countdown: number;
  /** Samples captured so far in the current hold. */
  samples: number;
  /** Whether the hold is capturing yet (past `settleMs`). */
  capturing: boolean;
  /** 0..1 through the whole sequence, counting targets over all loops. */
  progress: number;
  results: TargetResult[];
}

export interface SequenceRunnerOptions {
  spec: SequenceSpec;
  check?: TargetCheck;
}

export interface SequenceRunner {
  /** Begin at `tMs`: the lead-in first, then target 0's countdown. */
  start(tMs: number): void;
  /** Feed a live vector at `tMs`. Captured only during a hold, past its settle. Every
   *  push feeds time forward, as `tick` does. */
  push(vector: FeatureVector, tMs: number): void;
  /** Advance time without a sample. */
  tick(tMs: number): void;
  /** Skip the current target (countdown or hold): it ends `skipped`, no samples kept. */
  skip(tMs: number): void;
  /** Run the current target again (or, once it has ended, the last one): back to its
   *  countdown. The previous result of that target is dropped. */
  redo(tMs: number): void;
  /** Abort. Results so far stay readable. */
  stop(tMs: number): void;
  state(): SequenceState;
  subscribe(listener: (event: SequenceEvent) => void): () => void;
}

/** The number of targets over all loops. */
export const sequenceLength = (spec: Pick<SequenceSpec, 'targets' | 'loops'>): number => spec.targets.length * spec.loops;

/** The total scheduled time of a sequence, in ms (what a progress bar is over). */
export function sequenceDurationMs(spec: SequenceSpec): number {
  const perTarget = spec.targets.reduce((s, t) => s + spec.countdownMs + (t.holdMs ?? spec.holdMs), 0);
  return spec.leadInMs + perTarget * spec.loops;
}

export function createSequenceRunner(options: SequenceRunnerOptions): SequenceRunner {
  const { spec, check } = options;
  const listeners = new Set<(e: SequenceEvent) => void>();
  const emit = (e: SequenceEvent) => {
    for (const l of listeners) l(e);
  };

  let phase: SequencePhase = 'idle';
  let loop = 0;
  let index = -1;
  /** When the current phase began and ends. */
  let phaseStart = 0;
  let phaseEnd = 0;
  let samples: FeatureVector[] = [];
  let results: TargetResult[] = [];
  /** The last target that ended (for `redo` after the end). */
  let lastEnded: { loop: number; index: number } | null = null;
  /** The time last seen, so `state()` can report what is left. */
  let now = 0;

  const holdOf = (t: SequenceTarget) => t.holdMs ?? spec.holdMs;
  const targetAt = (i: number): SequenceTarget | null => (i >= 0 && i < spec.targets.length ? spec.targets[i] : null);
  const nextOf = (lp: number, i: number): SequenceTarget | null => {
    if (i + 1 < spec.targets.length) return spec.targets[i + 1];
    return lp + 1 < spec.loops ? spec.targets[0] : null;
  };
  const isLast = (lp: number, i: number) => i + 1 >= spec.targets.length && lp + 1 >= spec.loops;

  const beginCountdown = (lp: number, i: number, tMs: number) => {
    loop = lp;
    index = i;
    samples = [];
    phase = 'countdown';
    phaseStart = tMs;
    phaseEnd = tMs + spec.countdownMs;
    const label = spec.targets[i].label;
    emit({ type: 'target-start', loop: lp, index: i, label, say: sayFor.next(label), t: tMs });
    // A zero countdown goes straight to the hold.
    if (spec.countdownMs <= 0) beginHold(tMs);
  };

  const beginHold = (tMs: number) => {
    const target = spec.targets[index];
    phase = 'hold';
    phaseStart = tMs;
    phaseEnd = tMs + holdOf(target);
    samples = [];
    emit({ type: 'hold-start', loop, index, label: target.label, say: sayFor.hold(target.label), t: tMs });
  };

  const endTarget = (outcome: TargetOutcome, tMs: number) => {
    const target = spec.targets[index];
    const kept = outcome === 'held' ? samples : [];
    const verdict = outcome === 'held' && check ? check(target.label, kept) : null;
    const result: TargetResult = { loop, index, label: target.label, outcome, samples: kept, verdict };
    // A redo replaced the earlier result of the same target; otherwise append.
    results = results.filter((r) => !(r.loop === loop && r.index === index));
    results.push(result);
    lastEnded = { loop, index };
    const say =
      outcome === 'empty' ? SEQUENCE_PHRASES.empty : verdict?.kind === 'mismatch' ? sayFor.mismatch(verdict.read) : outcome === 'held' ? SEQUENCE_PHRASES.held : '';
    const last = isLast(loop, index);
    // Commit before emitting: a listener may re-enter (redo, stop).
    const endedLoop = loop;
    const endedIndex = index;
    if (last) {
      phase = 'done';
      index = -1;
    }
    emit({ type: 'target-end', result, say, t: tMs });
    if (last) {
      if (phase === 'done') emit({ type: 'done', say: SEQUENCE_PHRASES.done, t: tMs });
      return;
    }
    // A listener may have redone or stopped: only advance if nothing else moved us.
    if (phase === 'hold' && loop === endedLoop && index === endedIndex) {
      if (endedIndex + 1 < spec.targets.length) beginCountdown(endedLoop, endedIndex + 1, tMs);
      else beginCountdown(endedLoop + 1, 0, tMs);
    }
  };

  /** Move the clock: end phases whose time is up. Loops because a zero-length phase
   *  can end in the same instant as the one after it. */
  const advance = (tMs: number) => {
    now = Math.max(now, tMs);
    for (let guard = 0; guard < 8; guard++) {
      if (phase === 'lead-in' && tMs >= phaseEnd) {
        beginCountdown(0, 0, tMs);
        continue;
      }
      if (phase === 'countdown' && tMs >= phaseEnd) {
        beginHold(tMs);
        continue;
      }
      if (phase === 'hold' && tMs >= phaseEnd) {
        endTarget(samples.length > 0 ? 'held' : 'empty', tMs);
        continue;
      }
      return;
    }
  };

  const capturing = (tMs: number) => phase === 'hold' && tMs - phaseStart >= spec.settleMs;

  return {
    start(tMs) {
      results = [];
      lastEnded = null;
      loop = 0;
      index = -1;
      now = tMs;
      phase = 'lead-in';
      phaseStart = tMs;
      phaseEnd = tMs + spec.leadInMs;
      emit({ type: 'lead-in', say: SEQUENCE_PHRASES.leadIn, t: tMs });
      advance(tMs);
    },
    push(vector, tMs) {
      advance(tMs);
      if (capturing(tMs)) samples.push(vector);
    },
    tick(tMs) {
      advance(tMs);
    },
    skip(tMs) {
      advance(tMs);
      if (phase !== 'countdown' && phase !== 'hold') return;
      // Treated as a hold that ended without samples, so the list moves on.
      phase = 'hold';
      endTarget('skipped', tMs);
    },
    redo(tMs) {
      advance(tMs);
      if (phase === 'countdown' || phase === 'hold') {
        beginCountdown(loop, index, tMs);
        return;
      }
      if ((phase === 'done' || phase === 'stopped') && lastEnded) {
        beginCountdown(lastEnded.loop, lastEnded.index, tMs);
      }
    },
    stop(tMs) {
      now = Math.max(now, tMs);
      if (phase === 'idle' || phase === 'done' || phase === 'stopped') return;
      if (phase === 'hold' || phase === 'countdown') lastEnded = { loop, index };
      phase = 'stopped';
      index = -1;
      samples = [];
      emit({ type: 'stopped', t: tMs });
    },
    state() {
      const active = phase === 'countdown' || phase === 'hold';
      const current = active ? targetAt(index) : null;
      const remainingMs = phase === 'lead-in' || active ? Math.max(0, phaseEnd - now) : 0;
      // Skipped targets count as passed: progress is through the list, not the take.
      const doneTargets = results.length;
      const total = sequenceLength(spec);
      return {
        phase,
        loop,
        index: active ? index : -1,
        current,
        next: active ? nextOf(loop, index) : phase === 'lead-in' ? targetAt(0) : null,
        remainingMs,
        countdown: Math.ceil(remainingMs / 1000),
        samples: phase === 'hold' ? samples.length : 0,
        capturing: capturing(now),
        progress: total <= 0 ? 1 : Math.min(1, doneTargets / total),
        results: results.slice(),
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
