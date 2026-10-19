/* The `expression-chord` node as it was before H6 of #613 gave expressions targets, copied verbatim from main (only this header added, and its type renamed): the reference test/harmony/expression_chord_reference.test.ts compares the new node against. */
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
 * Every reading is a CATEGORIZER's (#330 P4, P6): the general model's (its categories are the
 * seven expressions, each standing in for itself) or a player's own. The degree is the
 * categorizer's own choice for the category being read (`categoryDegrees`, by category id) or,
 * by default, the degree of the expression the category stands in for ({@link personalDegree}),
 * from the instrument's expression degrees (`degrees`). For the general model that default IS
 * its per-category degree, so its chords are exactly what the closed-label rule played. A
 * reading recorded before P6 (no `personal`) is read as the general one.
 *
 * Stateful (a beat clock + a strum re-trigger), but deterministic given the tick
 * timing — so it replays exactly.
 */
import { z } from 'zod';
import { defineNode } from '@thoremin/dag';
import type { NodeContext } from '@thoremin/dag';
import type { ScaleSpec } from '@thoremin/sdk/music/theory';
import { createChordRenderer } from '@thoremin/sdk/music/chord_render';
import { SoundSchema } from '@thoremin/sdk/music/sounds';
import {
  DEFAULT_EXPRESSION_TO_DEGREE,
  SILENCE_DEGREE,
  categorizerReading,
  personalDegree,
  type ExpressionScores,
  type ExpressionLabel,
} from '@/music/expression';
import { VOICINGS, RENDERINGS, type VoicingId, type RenderingId } from '@/music/voicing';
import type { VoiceParams } from '@thoremin/sdk/nodes/domain';

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
  type: 'expression-chord-reference',
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
    // A personal categorizer's per-category degrees, by category id (#330 P4); optional.
    // A category it does not name plays the degree of the expression it stands in for.
    { name: 'categoryDegrees', kind: 'category-degrees' },
  ],
  outputs: [
    { name: 'params', kind: 'synth-params' },
    // The un-voiced scale triad (three tones), for the overlay to highlight the
    // chord's pitch classes on the pitch guide — independent of the voicing.
    { name: 'triad', kind: 'number[]' },
    // The reading it played (whichever classifier made it, #330 P4), for the shell's readout.
    { name: 'played', kind: 'face-expression' },
  ],
  params: Params,
  make(p) {
    const renderer = createChordRenderer({ idBase: CHORD_VOICE_ID_BASE, maxVoices: MAX_CHORD_VOICES });

    return {
      process(inputs, ctx: NodeContext) {
        const cfg = (inputs.chordConfig as ChordConfig | undefined) ?? {};
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
        const categoryDegrees = inputs.categoryDegrees as Record<string, number> | undefined;
        const reading = active ? categorizerReading(expr!) : null;
        const degree = !reading
          ? SILENCE_DEGREE
          : personalDegree(reading, reading.id === null ? null : reading.ids.indexOf(reading.id), categoryDegrees, degreeFor);
        // Voiced, rendered and articulated by the shared chord renderer (the SDK's), so every
        // categorizer's chords sound alike; the triad is [] when idle or silent.
        const { voices, triad } = renderer.render({
          degree,
          spec,
          voicing: cfg.voicing ?? p.voicing,
          rendering: cfg.rendering ?? p.rendering,
          bpm: cfg.bpm ?? p.bpm,
          octaveShift: shift,
          gain: cfg.gain ?? p.gain,
          sound: cfg.sound ?? p.sound,
          silentSound: p.sound,
          dt: typeof ctx?.dt === 'number' ? ctx.dt : 0,
        });
        return { params: { voices }, triad, played: expr };
      },
    };
  },
});
