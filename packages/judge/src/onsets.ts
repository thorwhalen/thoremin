/**
 * Judging onsets: expected targets against the events a player made, one target per event.
 *
 * The live judge (`createOnsetJudge`) is the one machine; the offline `judgeOnsets` runs it over a
 * whole take. An event is matched to an unresolved target whose window contains it, in one of
 * two ways:
 *
 * - `nearest` (the default): the unresolved target closest in time. Forgiving when targets are
 *   dense and the player is a little late on one and early on the next.
 * - `lock`: the EARLIEST unresolved target only (osu!'s notelock). One hit can never jump ahead
 *   over a target the player has not dealt with; a later target opens once the earlier one is
 *   hit or has closed.
 *
 * An event that matches nothing is a STRAY (Guitar Hero's overstrum, IIDX's empty poor): a
 * scoring rule can count it, so that hitting everything all the time scores below playing the
 * chart. A target whose late window has passed unmatched is a MISS, reported by `advance(now)`.
 *
 * Targets may carry a `lane` (a pad, a drum, a clap versus a tap); then an event only matches a
 * target of its own lane. Times are seconds on ONE clock, the caller's: the judge never reads a
 * clock, and calibration (the input offset) is subtracted from event times before they get here.
 *
 * Pure: no DOM, no clock.
 */
import { checkWindows, reach, tierOf, type Windows } from './windows';

/** An expected onset. `id` is the caller's (a chart index); `lane` optional. */
export interface OnsetTarget {
  id: number;
  t: number;
  lane?: string;
}

/** A player's onset, its time already corrected by the input offset. */
export interface OnsetEvent {
  t: number;
  lane?: string;
}

/** What became of a target: hit in a tier (with its offset, event minus target) or missed. */
export type OnsetJudgment =
  | { kind: 'hit'; target: OnsetTarget; event: OnsetEvent; offset: number; tier: string }
  | { kind: 'miss'; target: OnsetTarget };

/** An event that matched no target. */
export interface Stray {
  kind: 'stray';
  event: OnsetEvent;
}

export type Matching = 'nearest' | 'lock';

export interface OnsetJudgeOptions {
  windows: Windows;
  /** See the module header. Default `nearest`. */
  matching?: Matching;
}

export interface OnsetJudge {
  /** Judge one event; events must come in time order. */
  hit(event: OnsetEvent): OnsetJudgment | Stray;
  /** Close every target whose late window ended before `now`; returns their misses. */
  advance(now: number): OnsetJudgment[];
  /** Every judgment so far, in target order once all are resolved. */
  judgments(): OnsetJudgment[];
  strays(): Stray[];
  /** True when every target is resolved. */
  done(): boolean;
}

export function createOnsetJudge(targets: readonly OnsetTarget[], opts: OnsetJudgeOptions): OnsetJudge {
  const windows = checkWindows(opts.windows);
  const matching = opts.matching ?? 'nearest';
  const { early, late } = reach(windows);
  const pending = [...targets].sort((a, b) => a.t - b.t);
  const resolved = new Map<number, OnsetJudgment>();
  const strays: Stray[] = [];
  let lastT = -Infinity;

  const sameLane = (target: OnsetTarget, event: OnsetEvent) => target.lane === undefined || target.lane === event.lane;
  const close = (now: number): OnsetJudgment[] => {
    // Every lane closes on its own: a later target in one lane may close while an earlier one
    // in another lane is still open, so the whole pending list is swept, not just its head.
    const out: OnsetJudgment[] = [];
    for (let i = 0; i < pending.length; ) {
      if (pending[i].t - early > now) break;
      if (pending[i].t + late < now) {
        const [target] = pending.splice(i, 1);
        const j: OnsetJudgment = { kind: 'miss', target };
        resolved.set(target.id, j);
        out.push(j);
      } else i++;
    }
    return out;
  };

  return {
    hit(event) {
      if (event.t < lastT) throw new Error(`onset judge: events must come in time order (${event.t} after ${lastT})`);
      lastT = event.t;
      let best = -1;
      for (let i = 0; i < pending.length; i++) {
        const target = pending[i];
        if (target.t - early > event.t) break;
        if (!sameLane(target, event)) continue;
        const offset = event.t - target.t;
        if (tierOf(offset, windows) === null) continue;
        if (matching === 'lock') {
          best = i;
          break;
        }
        if (best < 0 || Math.abs(offset) < Math.abs(event.t - pending[best].t)) best = i;
      }
      if (best < 0) {
        const s: Stray = { kind: 'stray', event };
        strays.push(s);
        return s;
      }
      const [target] = pending.splice(best, 1);
      const offset = event.t - target.t;
      const j: OnsetJudgment = { kind: 'hit', target, event, offset, tier: tierOf(offset, windows)!.name };
      resolved.set(target.id, j);
      return j;
    },
    advance: close,
    judgments() {
      return [...resolved.values()].sort((a, b) => a.target.t - b.target.t);
    },
    strays: () => [...strays],
    done: () => pending.length === 0,
  };
}

/** Judge a whole take: every event in time order, then every target closed. */
export function judgeOnsets(
  targets: readonly OnsetTarget[],
  events: readonly OnsetEvent[],
  opts: OnsetJudgeOptions,
): { judgments: OnsetJudgment[]; strays: Stray[] } {
  const judge = createOnsetJudge(targets, opts);
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    judge.advance(e.t);
    judge.hit(e);
  }
  judge.advance(Infinity);
  return { judgments: judge.judgments(), strays: judge.strays() };
}
