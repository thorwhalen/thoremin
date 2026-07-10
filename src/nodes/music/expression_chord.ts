/**
 * `expression-chord` node — turns a classified facial expression into a played
 * chord (issue #64 + the voicing/rendering follow-up). The expression (from
 * `face-expression`) selects a scale degree via {@link DEFAULT_EXPRESSION_TO_DEGREE};
 * the triad on the CHORD-SOURCE scale ({@link diatonicTriad}) — decoupled from the
 * right-hand melody scale since #75 — is then VOICED (a tasteful arrangement with a
 * low bass fundamental — {@link voiceTriad}) and RENDERED over time (sustained pad or
 * a tempo-based arpeggio/pulse/strum — {@link renderGains}). The `spec` input is the
 * chord source (auto-derived from the melody, or a custom scale), so a pentatonic
 * melody still gets chords and any scale can be the chord source.
 *
 * It emits chord voices on ids ≥ {@link CHORD_VOICE_ID_BASE}, so they never collide
 * with the two hand voices (0, 1) and can be unioned into the synth alongside the
 * hand melody (see `synth-merge`). It is the live gate for chord mode: voices sound
 * ONLY when `faceMapping === 'chord'`, the expression is present, and a chord-source
 * `spec` is wired — otherwise all voices are silent.
 *
 * It ALWAYS emits {@link MAX_CHORD_VOICES} voices on stable ids: the synth releases
 * voices it still sees in the array, so a vanishing voice would leave a chord stuck
 * sounding. Stable ids also let the synth glide/re-articulate cleanly.
 *
 * Live config (sound / volume / voicing / rendering / tempo) arrives on the
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
import { SoundSchema } from '@/music/sounds';
import {
  DEFAULT_EXPRESSION_TO_DEGREE,
  SILENCE_DEGREE,
  type ExpressionScores,
  type ExpressionLabel,
} from '@/music/expression';
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
  sound: SoundSchema.default('triangle'),
  /** How the triad is arranged (low bass + upper structure). */
  voicing: z.enum(VOICINGS).default('spread'),
  /** How the voiced chord is played over time. */
  rendering: z.enum(RENDERINGS).default('sustained'),
  /** Tempo (BPM) for the tempo-based renderings. */
  bpm: z.number().min(40).max(200).default(100),
});
type Params = z.infer<typeof Params>;

/** Live chord settings from the UI store (override the static params each tick). */
interface ChordConfig {
  sound?: VoiceParams['sound'];
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
    'Facial expression → a voiced, rendered diatonic chord on the chord-source scale (active only in face "chord" mode).',
  inputs: [
    { name: 'expression', kind: 'face-expression' },
    { name: 'spec', kind: 'scale-spec' },
    { name: 'faceMapping', kind: 'face-mapping', default: 'none' },
    // Live keyboard octave shift, so the chord tracks the melody's register.
    { name: 'octaveShift', kind: 'number', default: 0 },
    // Live chord settings (sound / volume / voicing / rendering / tempo).
    { name: 'chordConfig', kind: 'chord-config' },
    // Per-expression scale-degree map (which triad each expression plays); optional.
    { name: 'degrees', kind: 'expression-degrees' },
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
        sound: p.sound,
      }));

    return {
      process(inputs, ctx: NodeContext) {
        const cfg = (inputs.chordConfig as ChordConfig | undefined) ?? {};
        const sound = cfg.sound ?? p.sound;
        const gain = cfg.gain ?? p.gain;
        const voicing = cfg.voicing ?? p.voicing;
        const rendering = cfg.rendering ?? p.rendering;
        const bpm = cfg.bpm ?? p.bpm;

        const expr = inputs.expression as ExpressionScores | undefined;
        const spec = inputs.spec as ScaleSpec | undefined;
        const shift = typeof inputs.octaveShift === 'number' ? inputs.octaveShift : 0;
        const active = inputs.faceMapping === 'chord' && !!expr && expr.present && !!spec;

        // Which scale degree the expression plays — the live per-expression map
        // (from the store), falling back to the confusion-aware default per label.
        // A negative degree (SILENCE_DEGREE) means "play nothing" (e.g. neutral).
        const degrees = inputs.degrees as Partial<Record<ExpressionLabel, number>> | undefined;
        const degreeFor = (label: ExpressionLabel) =>
          degrees?.[label] ?? DEFAULT_EXPRESSION_TO_DEGREE[label];
        const degree = active ? degreeFor(expr!.label) : SILENCE_DEGREE;
        // The un-voiced scale triad (3 tones) for the overlay highlight; [] when
        // idle or when the expression maps to silence (a non-seven-note chord source
        // now yields a generalized chord rather than [], per #75).
        const triad = degree >= 0 ? diatonicTriad(spec!, degree) : [];
        // Voice the chord, then sort ascending by pitch so arpeggios traverse
        // low→high by actual pitch (some voicings stack out of pitch order). The
        // ids stay stable (one per array slot), so the synth still releases all.
        const voiced = (triad.length ? voiceTriad(triad, voicing, shift) : []).sort((a, b) => a - b);

        // Beat clock (NaN-guarded so a degenerate dt can't poison it) + chord-change
        // detection. The key is the actual sounding pitches, so ANY genuine chord
        // change (expression, scale root/type/baseOctave, octave shift, voicing)
        // restarts the strum. (Switching rendering mid-chord does NOT re-roll — a
        // live strum re-rolls on a new chord, not on a control tweak.)
        const dt = typeof ctx?.dt === 'number' && Number.isFinite(ctx.dt) ? ctx.dt : 0;
        beat += (bpm / 60) * dt;
        const key = voiced.length ? voiced.join(',') : '';
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
          const raw = gains[i];
          const g = midi !== undefined && Number.isFinite(raw) ? gain * raw : 0;
          voices.push({
            id: CHORD_VOICE_ID_BASE + i,
            present: g > 0,
            freq: midiToFreq(midi ?? 60),
            gain: g,
            sound,
          });
        }
        return { params: { voices }, triad };
      },
    };
  },
});
