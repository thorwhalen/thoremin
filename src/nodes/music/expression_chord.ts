/**
 * `expression-chord` node — turns a classified facial expression into a played
 * chord (issue #64 + the voicing/rendering follow-up). The expression (from
 * `face-expression`) selects a scale degree via {@link DEFAULT_EXPRESSION_TO_DEGREE};
 * the diatonic triad on the active seven-note scale ({@link diatonicTriad}) is then
 * VOICED (a tasteful arrangement with a low bass fundamental — {@link voiceTriad})
 * and RENDERED over time (sustained pad or a tempo-based arpeggio/pulse/strum —
 * {@link renderGains}).
 *
 * It emits chord voices on ids ≥ {@link CHORD_VOICE_ID_BASE}, so they never collide
 * with the two hand voices (0, 1) and can be unioned into the synth alongside the
 * hand melody (see `synth-merge`). It is the live gate for chord mode: voices sound
 * ONLY when `faceMapping === 'chord'`, the expression is present, and the current
 * scale has seven notes — otherwise all voices are silent.
 *
 * It ALWAYS emits {@link MAX_CHORD_VOICES} voices on stable ids: the synth releases
 * voices it still sees in the array, so a vanishing voice would leave a chord stuck
 * sounding. Stable ids also let the synth glide/re-articulate cleanly.
 *
 * Live config (instrument / volume / voicing / rendering / tempo) arrives on the
 * `chordConfig` input (from the UI store via `store-controls`), so changing it
 * never rebuilds the graph. The `triad` output is the un-voiced scale triad (three
 * tones), used by the overlay to highlight the chord's pitch classes on the guide.
 *
 * Stateful (a beat clock + a strum re-trigger), but deterministic given the tick
 * timing — so it replays exactly.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';
import { diatonicTriad, midiToFreq, type ScaleSpec } from '@/music/theory';
import { InstrumentSchema } from '@/music/instruments';
import { DEFAULT_EXPRESSION_TO_DEGREE, type ExpressionScores } from '@/music/expression';
import { VOICINGS, RENDERINGS, voiceTriad, renderGains, type VoicingId, type RenderingId } from '@/music/voicing';
import type { VoiceParams } from '../domain';

/** Chord voices start at this id, above the two hand voices (0 = right, 1 = left). */
export const CHORD_VOICE_ID_BASE = 2;

/** The largest voicing is four notes; we always emit this many voices on stable ids. */
export const MAX_CHORD_VOICES = 4;

const Params = z.object({
  /** Volume of the chord (0..1) — gentle by default so it supports the melody. */
  gain: z.number().min(0).max(1).default(0.22),
  /** Instrument timbre for the chord voices. */
  instrument: InstrumentSchema.default('triangle'),
  /** How the triad is arranged (low bass + upper structure). */
  voicing: z.enum(VOICINGS).default('spread'),
  /** How the voiced chord is played over time. */
  rendering: z.enum(RENDERINGS).default('sustained'),
  /** Tempo (BPM) for the tempo-based renderings. */
  bpm: z.number().min(20).max(300).default(100),
});
type Params = z.infer<typeof Params>;

/** Live chord settings from the UI store (override the static params each tick). */
interface ChordConfig {
  instrument?: VoiceParams['instrument'];
  gain?: number;
  voicing?: VoicingId;
  rendering?: RenderingId;
  bpm?: number;
}

export const expressionChordNode = defineNode<Params>({
  type: 'expression-chord',
  roles: ['music'],
  title: 'Expression Chord',
  description:
    'Facial expression → a voiced, rendered diatonic chord on the current seven-note scale (active only in face "chord" mode).',
  inputs: [
    { name: 'expression', kind: 'face-expression' },
    { name: 'spec', kind: 'scale-spec' },
    { name: 'faceMapping', kind: 'face-mapping', default: 'none' },
    // Live keyboard octave shift, so the chord tracks the melody's register.
    { name: 'octaveShift', kind: 'number', default: 0 },
    // Live chord settings (instrument / volume / voicing / rendering / tempo).
    { name: 'chordConfig', kind: 'chord-config' },
  ],
  outputs: [
    { name: 'params', kind: 'synth-params' },
    // The un-voiced scale triad (three tones), for the overlay to highlight the
    // chord's pitch classes on the pitch guide — independent of the voicing.
    { name: 'triad', kind: 'number[]' },
  ],
  params: Params,
  make(p) {
    let beat = 0;
    let timeSinceChange = 0;
    let lastKey = '';

    const silent = (): VoiceParams[] =>
      Array.from({ length: MAX_CHORD_VOICES }, (_, i) => ({
        id: CHORD_VOICE_ID_BASE + i,
        present: false,
        freq: midiToFreq(60),
        gain: 0,
        instrument: p.instrument,
      }));

    return {
      process(inputs, ctx: NodeContext) {
        const cfg = (inputs.chordConfig as ChordConfig | undefined) ?? {};
        const instrument = cfg.instrument ?? p.instrument;
        const gain = cfg.gain ?? p.gain;
        const voicing = cfg.voicing ?? p.voicing;
        const rendering = cfg.rendering ?? p.rendering;
        const bpm = cfg.bpm ?? p.bpm;

        const expr = inputs.expression as ExpressionScores | undefined;
        const spec = inputs.spec as ScaleSpec | undefined;
        const shift = typeof inputs.octaveShift === 'number' ? inputs.octaveShift : 0;
        const active = inputs.faceMapping === 'chord' && !!expr && expr.present && !!spec;

        // The un-voiced scale triad (3 tones) for the overlay highlight; [] off a
        // seven-note scale or when idle.
        const triad = active ? diatonicTriad(spec!, DEFAULT_EXPRESSION_TO_DEGREE[expr!.label]) : [];
        const voiced = triad.length ? voiceTriad(triad, voicing, shift) : [];

        // Beat clock + chord-change detection (a new chord restarts the strum).
        const dt = typeof ctx?.dt === 'number' ? ctx.dt : 0;
        beat += (bpm / 60) * dt;
        const key = voiced.length ? `${expr!.label}:${voicing}:${shift}` : '';
        if (key !== lastKey) {
          timeSinceChange = 0;
          lastKey = key;
        } else {
          timeSinceChange += dt;
        }

        if (voiced.length === 0) return { params: { voices: silent() }, triad: [] };

        const gains = renderGains(voiced.length, rendering, beat, timeSinceChange);
        const voices: VoiceParams[] = [];
        for (let i = 0; i < MAX_CHORD_VOICES; i++) {
          const midi = voiced[i];
          const g = midi !== undefined ? gain * (gains[i] ?? 0) : 0;
          voices.push({
            id: CHORD_VOICE_ID_BASE + i,
            present: g > 0,
            freq: midiToFreq(midi ?? 60),
            gain: g,
            instrument,
          });
        }
        return { params: { voices }, triad };
      },
    };
  },
});
