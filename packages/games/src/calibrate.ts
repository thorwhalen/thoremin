/**
 * The calibration take: clicks, the player taps or claps on each, the microphone's onsets are
 * paired with the clicks, and `@thoremin/judge`'s `estimateOffset` turns the pairs into the one
 * number every game subtracts (the research doc, section 6). Run through the same node and stage
 * as the games, so it is tested the same way.
 *
 * Unlike a game, the clicks sound DURING the take: that is the point. With a loudspeaker the
 * microphone hears each click as well as each tap, so a tap take wants headphones; with no player
 * at all, the clicks the microphone hears ARE the take (loopback: the device's round trip alone).
 * Heard times are NOT shifted by the old offset: the take measures it afresh.
 */
import { clickTimes, estimateOffset, type CalibrationResult } from '@thoremin/judge';
import { CLICK_MIDI, ACCENT_VELOCITY, CLICK_VELOCITY, createCueFeed, type Cue } from './cues';
import type { Heard } from './listen';
import type { GameView, ViewNote } from './view';

export interface CalibrateOptions {
  start: number;
  bpm?: number;
  /** Clicks before the ones that count. Default 4. */
  countIn?: number;
  /** Clicks that count. Default 16. */
  clicks?: number;
}

export function createCalibrationSession(opts: CalibrateOptions) {
  const bpm = opts.bpm ?? 100;
  const countIn = opts.countIn ?? 4;
  const n = opts.clicks ?? 16;
  const all = clickTimes(bpm, countIn + n, opts.start);
  const counted = all.slice(countIn);
  const end = all[all.length - 1] + 60 / bpm;
  const feed = createCueFeed(0.5);
  feed.add(all.map((t, i): Cue => ({ t, midi: CLICK_MIDI, velocity: i % 4 === 0 ? ACCENT_VELOCITY : CLICK_VELOCITY, kind: 'click' })));
  const onsets: number[] = [];
  let result: CalibrationResult | null = null;

  function tick(now: number, heard: Heard): { view: GameView; cues: Cue[] } {
    for (const o of heard.onsets) onsets.push(o.t);
    if (result === null && now >= end) result = estimateOffset(counted, onsets.filter((t) => t >= counted[0] - 0.25), { warmup: 0 });
    const phase = now < counted[0] ? 'count-in' : result ? 'results' : 'playing';
    const heardSoFar = onsets.filter((t) => t >= counted[0] - 0.25).length;
    const view: GameView = {
      game: 'calibrate',
      title: 'Audio timing',
      phase,
      now,
      from: now - 0.6,
      to: now + 3,
      low: 60,
      high: 60,
      toleranceCents: 0,
      notes: counted.map((t, id): ViewNote => ({ id, start: t, end: t, state: t < now ? 'hit' : 'pending' })).filter((x) => x.start >= now - 0.6 && x.start <= now + 3),
      trail: [],
      flashes: [],
      countdown: Math.max(0, Math.ceil(((counted[0] - now) * bpm) / 60)),
      accuracy: Math.min(1, heardSoFar / n),
      combo: heardSoFar,
      ...(result
        ? {
            results: {
              accuracy: result.refusal ? 0 : 1,
              counts: { heard: result.paired, kept: result.kept },
              summary: result.refusal
                ? `Not usable: ${result.refusal}. Try again, tapping firmly on every click.`
                : `Offset ${Math.round(result.offset * 1000)} ms, steady to ${Math.round(result.spread * 1000)} ms over ${result.kept} taps.`,
            },
          }
        : {}),
    };
    return { view, cues: feed.due(now) };
  }

  return { tick, result: () => result, clicks: counted, end };
}
