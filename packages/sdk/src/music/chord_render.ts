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
 *
 * Since H2 of #613 it is a facade over the realization pipeline (`../harmony/realize`): the
 * voicing and the rendering are two of its five seams (with no coloration, no reduction and the
 * root in the bass), and `test/harmony/renderer_golden.test.ts` holds the output sample for sample.
 */
import { diatonicTriad, type ScaleSpec } from './theory';
import type { RenderingId, VoicingId } from './voicing';
import { createRealizer, DEFAULT_CONTROLS, DEFAULT_SPEC, tonesInRegister } from '../harmony/realize';
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
  const realizer = createRealizer({ idBase, maxVoices });
  return {
    render({ degree, spec, voicing, rendering, bpm, octaveShift, gain, sound, silentSound, dt }) {
      const triad = degree >= 0 && spec ? diatonicTriad(spec, degree) : [];
      const { voices, voiced } = realizer.render({
        tones: tonesInRegister(triad),
        spec: { ...DEFAULT_SPEC, voicing, figuration: rendering },
        controls: { ...DEFAULT_CONTROLS, register: octaveShift },
        bpm,
        gain,
        sound,
        silentSound,
        dt,
      });
      return { voices, triad: voiced.length ? triad : [] };
    },
  };
}
