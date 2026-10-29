/**
 * How well the vowel cursor follows a SUNG vowel: each recording through the formant analyser and
 * the vowel cursor, exactly as the Vowels page runs them, scored against the vowel named in the
 * file name (VocalSet's `..._a.wav` etc., or `--vowel`).
 *
 * The CLI is `measure_vowels.ts`.
 *
 * Per file: `on` = share of live cursor frames whose nearest primary vowel is the sung one (a
 * sung "a" counts as [a] or [ɑ], "e" as [e] or [ɛ], "o" as [o] or [ɔ]: VocalSet's singers sing the
 * vowels of their language, not cardinal ones); `step` = the median and 90th percentile distance
 * the dot moves per 10 ms (units of the chart's height), the jitter a player sees; `live` = the
 * share of the file's voiced windows the dot is live.
 */
import { createFormantAnalyser } from '@thoremin/sdk/audio/formants';
import { runOffline } from '@thoremin/sdk/audio/offline';
import type { FormantEvent } from '@thoremin/sdk/audio/types';
import { CALIBRATION_VOWELS, createVowelCursor, fitVoice, voiceSampleOf, type VoiceMap, nearestVowel, PRIMARY_VOWELS, vowelByIpa, type VowelCursorOptions } from '@thoremin/games/vowels';
import type { Heard } from '@thoremin/games/listen';

/** The sung label to the primary vowels that count as on it. */
export const ACCEPT: Record<string, string[]> = { a: ['a', 'ɑ'], e: ['e', 'ɛ'], i: ['i'], o: ['o', 'ɔ'], u: ['u'] };

export interface VowelScore {
  file: string;
  vowel: string;
  on: number;
  stepMedian: number;
  stepP90: number;
  live: number;
}

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN;
};

/** Score one recording (mono PCM) for one sung vowel label. */
export function scoreVowel(pcm: Float32Array, sampleRate: number, vowel: string, cursorOptions: VowelCursorOptions = {}, file = ''): VowelScore {
  const run = runOffline(createFormantAnalyser(sampleRate), pcm);
  const events = run.events.filter((e) => e.kind === 'formants') as FormantEvent[];
  const cursor = createVowelCursor(cursorOptions);
  const primary = PRIMARY_VOWELS.map((ipa) => vowelByIpa(ipa)!);
  const accept = ACCEPT[vowel] ?? [vowel];
  let live = 0;
  let on = 0;
  const steps: number[] = [];
  let prev: { x: number; y: number } | null = null;
  for (const e of events) {
    const t = e.frame / sampleRate;
    const heard: Heard = { pitch: [], onsets: [], formants: [{ t, f1: e.f1, f2: e.f2, f3: e.f3, rms: e.rms }] };
    const c = cursor.push(heard, t);
    if (!c?.live) {
      prev = null;
      continue;
    }
    live++;
    if (accept.includes(nearestVowel(c, primary).ipa)) on++;
    if (prev) steps.push(Math.hypot(c.x - prev.x, c.y - prev.y));
    prev = { x: c.x, y: c.y };
  }
  const voiced = events.filter((e) => e.f1 !== null).length;
  return { file, vowel, on: live ? on / live : 0, stepMedian: quantile(steps, 0.5), stepP90: quantile(steps, 0.9), live: voiced ? live / voiced : 0 };
}

/** The formant windows of a recording, as the cursor receives them. */
export function formantFrames(pcm: Float32Array, sampleRate: number) {
  const run = runOffline(createFormantAnalyser(sampleRate), pcm);
  return (run.events.filter((e) => e.kind === 'formants') as FormantEvent[]).map((e) => ({ t: e.frame / sampleRate, f1: e.f1, f2: e.f2, f3: e.f3, rms: e.rms }));
}

/** VocalSet's sung labels for the calibration corners: "i" is ee, "u" is oo, "a" is ah. */
const LABEL_OF: Record<string, string> = { i: 'i', u: 'u', ä: 'a' };

/** A singer's calibration from one recording per corner vowel (by sung label). */
export function calibrateFrom(recordings: Record<string, { pcm: Float32Array; sampleRate: number }>): VoiceMap {
  const samples = CALIBRATION_VOWELS.map((c) => {
    const r = recordings[LABEL_OF[c.ipa]];
    if (!r) throw new Error(`calibrateFrom: no recording for ${c.word}`);
    const s = voiceSampleOf(formantFrames(r.pcm, r.sampleRate), c.place);
    if (!s) throw new Error(`calibrateFrom: too little voice in the ${c.word} recording`);
    return s;
  });
  return fitVoice(samples);
}
