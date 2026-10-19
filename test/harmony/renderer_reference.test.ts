/**
 * The chord renderer against its predecessor, verbatim (H2 of #613; the review's follow-up to the
 * golden test): random scripts over every voicing and rendering, with the inputs the goldens do
 * not script: dt of 0, NaN and Infinity; a chord re-entered after a silence; unknown voicing and
 * rendering ids (a value stored by a newer build); long holds under slow arpeggios; non-integer
 * and out-of-range degrees; an absent spec. Equal output, tick for tick.
 */
import { describe, it, expect } from 'vitest';
import { createChordRenderer, type ChordRenderer } from '@thoremin/sdk/music/chord_render';
import { diatonicTriad, midiToFreq, type ScaleSpec } from '@thoremin/sdk/music/theory';
import { RENDERINGS, VOICINGS, renderGains, voiceTriad, type RenderingId, type VoicingId } from '@thoremin/sdk/music/voicing';
import type { VoiceParams } from '@thoremin/sdk/nodes/domain';

/** `createChordRenderer` as it was before the realization pipeline (main before H2), verbatim. */
function referenceRenderer({ idBase, maxVoices }: { idBase: number; maxVoices: number }): ChordRenderer {
  let beat = 0;
  let timeSinceChange = 0;
  let lastKey = '';

  const silent = (sound: VoiceParams['sound']): VoiceParams[] =>
    Array.from({ length: maxVoices }, (_, i) => ({ id: idBase + i, present: false, freq: midiToFreq(60), gain: 0, sound }));

  return {
    render({ degree, spec, voicing, rendering, bpm, octaveShift, gain, sound, silentSound, dt }) {
      const triad = degree >= 0 && spec ? diatonicTriad(spec, degree) : [];
      const voiced = (triad.length ? voiceTriad(triad, voicing, octaveShift) : []).sort((a, b) => a - b);
      const step = Number.isFinite(dt) ? dt : 0;
      beat += (bpm / 60) * step;
      // The key is the sounding pitches, so any genuine chord change restarts the strum (a
      // control tweak such as the rendering does not).
      const key = voiced.length ? voiced.join(',') : '';
      if (key !== lastKey) {
        timeSinceChange = 0;
        lastKey = key;
      } else {
        timeSinceChange += step;
      }
      if (voiced.length === 0) return { voices: silent(silentSound), triad: [] };
      const gains = renderGains(voiced.length, rendering, beat, timeSinceChange);
      const voices: VoiceParams[] = [];
      for (let i = 0; i < maxVoices; i++) {
        const midi = voiced[i];
        const raw = gains[i];
        const g = midi !== undefined && Number.isFinite(raw) ? gain * raw : 0;
        voices.push({ id: idBase + i, present: g > 0, freq: midiToFreq(midi ?? 60), gain: g, sound });
      }
      return { voices, triad };
    },
  };
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SPECS: (ScaleSpec | undefined)[] = [
  { root: 0, type: 'major', octaves: 2, baseOctave: 3 },
  { root: 4, type: 'minor', octaves: 1, baseOctave: 2 },
  { root: 7, type: 'blues', octaves: 2, baseOctave: 4 },
  { root: 2, type: 'chromatic', octaves: 1, baseOctave: 3 },
  undefined,
];
const DTS = [1 / 30, 1 / 60, 0, Number.NaN, Number.POSITIVE_INFINITY, 0.2, 1 / 144];
// The idioms (voiceLed is new in H3: the predecessor stacked it as spread).
const VOICING_IDS = [...VOICINGS.filter((v) => v !== 'voiceLed'), 'mystery' as VoicingId];
const RENDERING_IDS = [...RENDERINGS, 'mystery' as RenderingId];

describe('the chord renderer equals its predecessor', () => {
  it('on 400 random scripts of 150 ticks', () => {
    const r = rng(2);
    const pickOf = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
    for (let n = 0; n < 400; n++) {
      const a = createChordRenderer({ idBase: 50, maxVoices: 4 });
      const b = referenceRenderer({ idBase: 50, maxVoices: 4 });
      const spec = pickOf(SPECS);
      let degree = 0;
      for (let tick = 0; tick < 150; tick++) {
        // Hold a chord for a while (long holds under slow arpeggios), change, fall silent, come back.
        if (r() < 0.08) degree = pickOf([-1, -1, 0, 1, 2, 3, 4, 5, 6, 7, 9, 2.5, -3]);
        const input = {
          degree,
          spec,
          voicing: pickOf(VOICING_IDS),
          rendering: tick % 40 < 30 ? RENDERING_IDS[n % RENDERING_IDS.length] : pickOf(RENDERING_IDS),
          bpm: pickOf([40, 72, 120, 200]),
          octaveShift: pickOf([0, 0, 0, 1, -1, 2]),
          gain: pickOf([0.22, 0.5, 1, Number.NaN]),
          sound: 'warmPad' as VoiceParams['sound'],
          silentSound: 'triangle' as VoiceParams['sound'],
          dt: pickOf(DTS),
        };
        expect(a.render(input), `script ${n}, tick ${tick}`).toEqual(b.render(input));
      }
    }
  });
});
