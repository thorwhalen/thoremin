/**
 * Playing a trained pattern (#269): each hit snapped to the pattern's grid at the
 * player's running tempo, with their own feel put back.
 *
 * The follower is the design's playback mode (`docs/research/drum-pattern-training.md`
 * §6), as a pure object the air drum node can hold. A `RhythmPrior` (the trend prior,
 * seeded at the model's tempo) follows the player's hits as beat anchors; a hit at
 * commit time is placed on the pattern by the prior's beat, assigned to the nearest
 * event within the window (the drum whose pad the player struck, else the event of the
 * hit's sound, else any), and sounds at that event's grid time plus the feel the model
 * learned for it, pulled there by `magnetism` (1 = fully snapped). The prior is then
 * told the beat the hit implied, so the grid keeps up with the player: the local tempo
 * is theirs, the placement is the pattern's.
 *
 * `start(t)` puts beat 0 of pass 0 at `t` (the count-in's end) and seeds the prior with
 * the count-in's beats, so the first hits already have a grid to land on. Pure: no
 * clock, no DAG, no audio.
 */
import { createTrendPrior, type RhythmPrior } from '@/ictus';
import { beatAt as priorBeatAt } from '@/ictus/types';
import type { DrumSound, PadId } from '@/nodes/music/drum_pads';
import type { DrumPattern } from '@/music/drum_patterns';
import type { DrumName } from '@/music/gm_drums';
import { playbackOffset, type PatternModel } from './pattern_fit';

/** What the air drum is handed to play a pattern: the pattern, its trained model, and
 *  when beat 0 of pass 0 falls (engine seconds; absent: the first hit is the one). */
export interface PatternPlay {
  pattern: DrumPattern;
  model: PatternModel;
  startAt?: number;
}

export interface PatternFollowerOptions {
  pattern: DrumPattern;
  model: PatternModel;
  /** The rhythm prior. Default: a trend prior at the model's tempo. */
  prior?: RhythmPrior;
  /** Half of this, in subdivisions, is how far from an event a hit may fall and still be
   *  it; farther, it is not snapped. Default 1. */
  windowSteps?: number;
  /** How far toward the grid (with feel) a hit is moved, 0..1. Default 1. */
  magnetism?: number;
  /** Beats of count-in the seed covers. Default 4. */
  countIn?: number;
  /** Confidence of the anchors the hits feed the prior. Default 0.8. */
  anchorConfidence?: number;
}

export interface Snap {
  /** The event the hit was taken as, or null (nothing near: sounds as struck). */
  event: number | null;
  /** The drum of that event, or null. */
  drum: DrumName | null;
  /** When it should sound, seconds. */
  at: number;
  /** The grid time of the event, seconds (null when unsnapped). */
  grid: number | null;
  /** The feel applied, in seconds. */
  feel: number;
  /** `at - t`: what the snap moved the hit by, seconds. */
  pull: number;
}

export interface PatternFollower {
  /** Beat 0 of pass 0 falls at `t`. Seeds the prior with the count-in before it. */
  start(t: number): void;
  /** Place a hit struck (or predicted) at `t`. */
  snap(t: number, hit?: { sound?: DrumSound; pad?: PadId | null }): Snap;
  /** The prior's state. */
  state(): ReturnType<RhythmPrior['state']>;
  /** Beats since the pattern started, at `t` (the cursor). Null before start. */
  beat(t: number): number | null;
  reset(): void;
}

const DEFAULTS = { windowSteps: 1, magnetism: 1, countIn: 4, anchorConfidence: 0.8 };

export function createPatternFollower(options: PatternFollowerOptions): PatternFollower {
  const o = { ...DEFAULTS, ...options };
  const { pattern, model } = o;
  const prior = o.prior ?? createTrendPrior({ initialTempo: model.bpm, beatsPerBar: 4 });
  const windowBeats = o.windowSteps / pattern.stepsPerBeat / 2;
  const period0 = 60 / model.bpm;
  /** The drum each pad is, on this player's kit. */
  const drumOfPad = new Map<PadId, DrumName>();
  for (const [drum, p] of Object.entries(model.positions)) if (p.pad) drumOfPad.set(p.pad, drum as DrumName);
  /** The prior's beat at the pattern's start: beat 0 of pass 0. */
  let beat0: number | null = null;
  /** The last whole pattern beat an anchor was fed for, and when. */
  let lastAnchorBeat = -1;
  let lastAnchorAt = -Infinity;

  const seed = (t: number) => {
    prior.reset();
    for (let k = o.countIn; k >= 0; k--) {
      prior.update({ t: t - k * period0, confidence: 1, strength: 1, sharpness: NaN, lateral: 0 });
    }
    beat0 = prior.state().beat;
    lastAnchorBeat = 0;
    lastAnchorAt = t;
  };

  const patternBeat = (t: number): number | null => {
    if (beat0 === null) return null;
    return priorBeatAt(prior.state(), t) - beat0;
  };

  return {
    start(t) {
      seed(t);
    },
    snap(t, hit = {}) {
      const unsnapped: Snap = { event: null, drum: null, at: t, grid: null, feel: 0, pull: 0 };
      if (beat0 === null) return unsnapped;
      prior.advance(t);
      const st = prior.state();
      const b = priorBeatAt(st, t) - beat0;
      if (!Number.isFinite(b) || b < -windowBeats) return unsnapped;
      const pass = Math.max(0, Math.floor(b / pattern.lengthBeats));
      // Candidates: events of the passes around, within the window; the struck pad's
      // drum first, then the hit's sound, then any.
      const padDrum = hit.pad ? drumOfPad.get(hit.pad) : undefined;
      let best: { event: number; absBeat: number; rank: number; dist: number } | null = null;
      for (const p of [pass - 1, pass, pass + 1]) {
        if (p < 0) continue;
        for (const e of pattern.events) {
          const ab = p * pattern.lengthBeats + e.beat;
          const dist = Math.abs(b - ab);
          if (dist > windowBeats) continue;
          const rank = padDrum ? (e.drum === padDrum ? 0 : 2) : hit.sound === undefined || hit.sound === e.sound ? 0 : 1;
          if (!best || rank < best.rank || (rank === best.rank && dist < best.dist)) best = { event: e.index, absBeat: ab, rank, dist };
        }
      }
      if (!best) return unsnapped;
      const e = pattern.events[best.event];
      const period = st.period;
      const grid = st.t + (best.absBeat + beat0 - st.beat) * period;
      const feel = playbackOffset(model, best.event) * period;
      const target = grid + feel;
      const at = t + Math.max(0, Math.min(1, o.magnetism)) * (target - t);
      // The beat this hit implies, for the prior. The trend prior counts a beat per
      // anchor (a gap of two periods counts two), so it is fed ONE anchor per whole beat:
      // the first hit on an event within the window of a whole beat, at the beat's time
      // implied by the hit (its own time less the event's offset from the beat and the
      // feel), so the grid follows the player. Off-beat hits are placed, not fed.
      const nearestBeat = Math.round(best.absBeat);
      if (Math.abs(best.absBeat - nearestBeat) <= windowBeats && nearestBeat > lastAnchorBeat) {
        const tAnchor = t - (best.absBeat - nearestBeat) * period - feel;
        if (tAnchor > lastAnchorAt) {
          lastAnchorBeat = nearestBeat;
          lastAnchorAt = tAnchor;
          prior.update({ t: tAnchor, confidence: o.anchorConfidence, strength: 1, sharpness: NaN, lateral: 0 });
        }
      }
      return { event: best.event, drum: e.drum, at, grid, feel, pull: at - t };
    },
    state: () => prior.state(),
    beat: patternBeat,
    reset() {
      prior.reset();
      beat0 = null;
      lastAnchorBeat = -1;
      lastAnchorAt = -Infinity;
    },
  };
}
