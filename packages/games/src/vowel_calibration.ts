/**
 * Calibrate a player's vowels: the chart asks for a few vowels in turn ("ee", "oo", "ah" by
 * default: the trapezoid's corners), each shown at its place, and keeps the formant windows heard
 * while the player holds it loud enough. Once each has `holdS` of voice, the samples (their median
 * F1 and F2, `voiceSampleOf`) fit the player's map (`fitVoice`), which the vowel cursor then uses.
 *
 * A session like the others (`tick(now, heard)` -> view and cues), so a page runs it with the same
 * runner; `result()` is the fitted map once it is done, null before or when the fit failed.
 *
 * Pure: fed the engine time and what was heard each tick.
 */
import type { Cue } from './cues';
import { CLICK_MIDI } from './cues';
import type { Backdrop, FieldView, Point } from './field';
import type { Heard, HeardFormants } from './listen';
import { NOTHING_HEARD } from './listen';
import { CALIBRATION_VOWELS, fitVoice, voiceSampleOf, type VoiceMap, type VoiceSample } from './vowels';

export interface CalibrationStep {
  ipa: string;
  /** What the player is asked to sing ("ee"). */
  word: string;
  place: Point;
}

export interface CalibrationOptions {
  start: number;
  backdrop: Backdrop;
  steps?: readonly CalibrationStep[];
  /** Seconds of voice to collect per vowel. Default 2. */
  holdS?: number;
  /**
   * A window counts only above this share of the loudest window heard for this vowel (each vowel
   * against itself: a sung [u] is some 10 dB under an [a], so a range learned across vowels would
   * shut it out). Default 0.25.
   */
  gate?: number;
  /** ...and above this rms. Default 0.004. */
  minRms?: number;
  /** The balloon's radius at each place (units of the height). Default 0.1. */
  r?: number;
}

export const CALIBRATION_DEFAULTS = { holdS: 2, gate: 0.25, minRms: 0.004, r: 0.1 };

/** The step's own sound: a click as each vowel is taken. */
const DONE_CUE = (t: number): Cue => ({ t, midi: CLICK_MIDI, velocity: 0.5, kind: 'click' });

export function createVowelCalibration(opts: CalibrationOptions) {
  const o = { ...CALIBRATION_DEFAULTS, ...opts };
  const steps = o.steps ?? CALIBRATION_VOWELS;
  const taken: VoiceSample[] = [];
  let frames: HeardFormants[] = [];
  let k = 0;
  let voiced = 0;
  let loudest = 0;
  let endedAt: number | null = null;
  let map: VoiceMap | null = null;
  let failure: string | null = null;
  const HOP_S = 0.01;

  function tick(now: number, heard: Heard = NOTHING_HEARD): { view: FieldView; cues: Cue[] } {
    const cues: Cue[] = [];
    if (endedAt === null && now >= o.start) {
      for (const f of heard.formants ?? []) {
        if (f.f1 === null || f.f2 === null || f.rms < o.minRms) continue;
        loudest = Math.max(loudest, f.rms);
        if (f.rms < o.gate * loudest) continue;
        frames.push(f);
        voiced += HOP_S;
      }
      if (voiced >= o.holdS) {
        const s = voiceSampleOf(frames, steps[k].place);
        if (s) taken.push(s);
        cues.push(DONE_CUE(now));
        k++;
        frames = [];
        voiced = 0;
        loudest = 0;
        if (k === steps.length) {
          endedAt = now;
          try {
            map = fitVoice(taken);
          } catch (e) {
            failure = (e as Error).message;
          }
        }
      }
    }
    const step = steps[Math.min(k, steps.length - 1)];
    const view: FieldView = {
      game: 'vowels',
      title: endedAt === null ? `Your vowels: ${k + 1} of ${steps.length}` : 'Your vowels',
      phase: endedAt === null ? 'playing' : 'results',
      now,
      wrapX: false,
      backdrop: o.backdrop,
      cursor: null,
      trail: [],
      targets:
        endedAt === null
          ? [{ id: k, ...step.place, r: o.r, label: step.ipa, progress: Math.min(1, voiced / o.holdS), state: 'live' }]
          : [],
      score: { done: k, total: steps.length, elapsed: Math.max(0, (endedAt ?? now) - o.start) },
      ...(endedAt === null ? { hint: `Sing "${step.word}" and hold it, as steady as you can.` } : {}),
      ...(endedAt === null
        ? {}
        : {
            results: {
              accuracy: map ? 1 : 0,
              counts: { vowels: taken.length },
              summary: map ? 'Saved: the chart now follows your vowels.' : `Not saved: ${failure ?? 'too little voice'}. Try again, a little louder.`,
            },
          }),
    };
    return { view, cues };
  }
  return { tick, result: (): VoiceMap | null => map };
}
