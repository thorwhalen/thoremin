/**
 * A chord renderer: a scale degree on a chord-source scale to voiced, rendered synth voices, over
 * time (#450). Extracted from `expression-chord` so every chord a categorizer plays (the face
 * chords, and a hand-shape or pose categorizer's chords) is voiced and articulated the same way:
 * the diatonic triad on the scale ({@link diatonicTriad}), voiced with a low bass ({@link voiceTriad}),
 * sorted by pitch so an arpeggio walks low to high, and rendered by a beat clock that restarts a
 * strum whenever the sounding pitches change ({@link renderGains}).
 *
 * It always emits `maxVoices` voices on stable ids (`idBase` + slot): the synth releases a voice it
 * still sees, so a vanishing voice would leave a chord stuck. Each renderer owns a block of ids,
 * so two of them can sound together. Stateful (the beat clock and the time since the chord last
 * changed) but deterministic given the tick timing, so it replays exactly.
 */
import { diatonicTriad, midiToFreq, type ScaleSpec } from './theory';
import { renderGains, voiceTriad, type RenderingId, type VoicingId } from './voicing';
import type { VoiceParams } from '../nodes/domain';

export interface ChordRenderInput {
  /** The scale degree (0-based); negative is silence. */
  degree: number;
  /** The chord-source scale; none is silence. */
  spec: ScaleSpec | undefined;
  voicing: VoicingId;
  rendering: RenderingId;
  bpm: number;
  octaveShift: number;
  /** The chord's volume (0..1). */
  gain: number;
  sound: VoiceParams['sound'];
  /** The sound a silent voice carries (the node's static one, so idle voices never re-key). */
  silentSound: VoiceParams['sound'];
  /** Seconds since the last tick (a non-finite one counts as 0). */
  dt: number;
}

export interface ChordRenderOutput {
  voices: VoiceParams[];
  /** The un-voiced scale triad (three tones), [] when silent: what the overlay highlights. */
  triad: number[];
}

export interface ChordRenderer {
  render(input: ChordRenderInput): ChordRenderOutput;
}

export function createChordRenderer({ idBase, maxVoices }: { idBase: number; maxVoices: number }): ChordRenderer {
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
