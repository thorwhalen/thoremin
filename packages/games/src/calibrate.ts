/**
 * The calibration take: clicks, the microphone's onsets are paired with the clicks, and
 * `@thoremin/judge`'s `estimateOffset` turns the pairs into one number (the research doc,
 * section 6). Run through the same node and stage as the games, so it is tested the same way.
 *
 * Unlike a game, the clicks sound DURING the take: that is the point. Two modes, one take:
 *
 * - `tap` (the default): the player taps or claps on each click. The number is the round trip plus
 *   the player's own anticipation, the offset every timed game subtracts. With a loudspeaker the
 *   microphone hears each click as well as each tap, so a tap take wants headphones.
 * - `loopback` (#881): no player. The speaker is on and the clicks the microphone hears ARE the
 *   take, so the number is the device's own: the heard times were already moved back by the input
 *   stage in force, so what is measured is a residual, and the new input stage is that stage plus
 *   the residual minus the output stage the browser reports (`inputStageFromLoopback`). The take
 *   asks for those two stages when it ends ({@link LoopbackStages}), and its result says the stage
 *   to keep or why none is kept. It wants echo cancellation OFF (it would cancel the very clicks).
 *
 * Heard times are NOT shifted by the old offset: the take measures it afresh.
 */
import { clickTimes, estimateOffset, type CalibrationOptions, type CalibrationResult } from '@thoremin/judge';
import { inputStageFromLoopback, type InputStage, type LoopbackStage } from '@thoremin/sdk/timing/input_stage';
import { CLICK_MIDI, ACCENT_VELOCITY, CLICK_VELOCITY, createCueFeed, type Cue } from './cues';
import type { Heard } from './listen';
import type { GameView, ViewNote } from './view';

export type CalibrationMode = 'tap' | 'loopback';

/** What a loopback take reads when it ends: the stages its heard times went through. */
export interface LoopbackStages {
  /** The input stage the heard times were corrected by (the hub's, in force during the take). */
  inputStage(): InputStage;
  /** The output stage the browser reports, seconds, or null when it reports none. */
  outputStage(): number | null;
}

interface CalibrateBase {
  start: number;
  bpm?: number;
  /** Clicks before the ones that count. Default 4. */
  countIn?: number;
  /** Clicks that count. Default 16. */
  clicks?: number;
}

export type CalibrateOptions = CalibrateBase & ({ mode?: 'tap' } | { mode: 'loopback'; stages: LoopbackStages });

/** A take's result: the judge's estimate, and for a loopback take the input stage it sets (or why not). */
export type CalibrationTakeResult = CalibrationResult & { inputStage?: LoopbackStage; outputStage?: number | null };

const DEFAULT_BPM = 100;
const DEFAULT_COUNT_IN = 4;
const DEFAULT_CLICKS = 16;
/** Seconds the cue feed schedules ahead of the clock. */
const CUE_LOOKAHEAD_S = 0.5;
/** Clicks per bar: the first of each is accented. */
const BEATS_PER_BAR = 4;
/** The stage's window around now, seconds (behind, ahead). */
const VIEW_BEHIND_S = 0.6;
const VIEW_AHEAD_S = 3;
/** The stage's pitch axis, collapsed to one line: the clicks have no pitch to show. */
const VIEW_PITCH = 60;
/** A tap pairs with a click this close (the judge's own default). */
const TAP_MAX_PAIR_S = 0.25;

/** How each mode pairs, and what it says. A loopback pairs within half a click period: a round trip
 *  any longer would pair each click with its neighbour's echo, and a longer pair window costs nothing
 *  with no player to stray. */
const MODES: Record<CalibrationMode, { maxPair(period: number): number; unit: string; retry: string }> = {
  tap: { maxPair: () => TAP_MAX_PAIR_S, unit: 'taps', retry: 'Try again, tapping firmly on every click.' },
  loopback: { maxPair: (period) => period / 2, unit: 'clicks', retry: 'Try again with the speaker louder, no headphones, and the room quiet.' },
};

const ms = (s: number) => Math.round(s * 1000);

function summaryOf(result: CalibrationTakeResult, mode: CalibrationMode): string {
  const m = MODES[mode];
  if (result.refusal) return `Not usable: ${result.refusal}. ${m.retry}`;
  if (mode === 'tap') return `Offset ${ms(result.offset)} ms, steady to ${ms(result.spread)} ms over ${result.kept} ${m.unit}.`;
  // A loopback result with no refusal carries its stage (`finish`).
  const seconds = result.inputStage?.stage?.seconds ?? NaN;
  const out = result.outputStage == null ? 'output stage not reported, so not taken out' : `output stage ${ms(result.outputStage)} ms taken out`;
  return `Input stage ${ms(seconds)} ms (residual ${ms(result.offset)} ms, ${out}), steady to ${ms(result.spread)} ms over ${result.kept} ${m.unit}.`;
}

export function createCalibrationSession(opts: CalibrateOptions) {
  const mode: CalibrationMode = opts.mode ?? 'tap';
  const bpm = opts.bpm ?? DEFAULT_BPM;
  const period = 60 / bpm;
  const countIn = opts.countIn ?? DEFAULT_COUNT_IN;
  const n = opts.clicks ?? DEFAULT_CLICKS;
  const maxPair = MODES[mode].maxPair(period);
  const judge: CalibrationOptions = { warmup: 0, maxPair };
  const all = clickTimes(bpm, countIn + n, opts.start);
  const counted = all.slice(countIn);
  /** Onsets before this belong to the count-in. */
  const from = counted[0] - maxPair;
  const end = all[all.length - 1] + period;
  const feed = createCueFeed(CUE_LOOKAHEAD_S);
  feed.add(all.map((t, i): Cue => ({ t, midi: CLICK_MIDI, velocity: i % BEATS_PER_BAR === 0 ? ACCENT_VELOCITY : CLICK_VELOCITY, kind: 'click' })));
  const onsets: number[] = [];
  let result: CalibrationTakeResult | null = null;

  function finish(): CalibrationTakeResult {
    const r = estimateOffset(counted, onsets.filter((t) => t >= from), judge);
    if (opts.mode !== 'loopback') return r;
    const outputStage = opts.stages.outputStage();
    const inputStage: LoopbackStage = r.refusal ? { stage: null, refusal: r.refusal } : inputStageFromLoopback({ residual: r.offset, current: opts.stages.inputStage(), outputStage });
    return { ...r, refusal: inputStage.refusal, inputStage, outputStage };
  }

  function tick(now: number, heard: Heard): { view: GameView; cues: Cue[] } {
    for (const o of heard.onsets) onsets.push(o.t);
    if (result === null && now >= end) result = finish();
    const phase = now < counted[0] ? 'count-in' : result ? 'results' : 'playing';
    const heardSoFar = onsets.filter((t) => t >= from).length;
    const view: GameView = {
      game: 'calibrate',
      title: mode === 'loopback' ? 'Audio timing (loopback)' : 'Audio timing',
      phase,
      now,
      from: now - VIEW_BEHIND_S,
      to: now + VIEW_AHEAD_S,
      low: VIEW_PITCH,
      high: VIEW_PITCH,
      toleranceCents: 0,
      notes: counted.map((t, id): ViewNote => ({ id, start: t, end: t, state: t < now ? 'hit' : 'pending' })).filter((x) => x.start >= now - VIEW_BEHIND_S && x.start <= now + VIEW_AHEAD_S),
      trail: [],
      flashes: [],
      countdown: Math.max(0, Math.ceil((counted[0] - now) / period)),
      accuracy: Math.min(1, heardSoFar / n),
      combo: heardSoFar,
      ...(result ? { results: { accuracy: result.refusal ? 0 : 1, counts: { heard: result.paired, kept: result.kept }, summary: summaryOf(result, mode) } } : {}),
    };
    return { view, cues: feed.due(now) };
  }

  return { tick, result: () => result, clicks: counted, end, mode };
}
