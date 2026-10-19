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
import { isSevenNoteScale, type ScaleSpec } from '@thoremin/sdk/music/theory';
import { diatonicChords, keyOf } from '@thoremin/sdk/harmony/chord';
import { voiceLeadingCost } from '@thoremin/sdk/harmony/distance';
import { RELATIONS } from '@thoremin/sdk/harmony/space';
import { parseTarget } from '@thoremin/sdk/harmony/target';
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

/** The degree a move from `from` reaches on the key's seven chords (the degree itself when the
 *  move does not apply or leaves the key: the face chord stays in its key). */
export function movedDegree(spec: ScaleSpec, from: number, relation: string): number {
  const key = keyOf(spec);
  const chords = diatonicChords(key);
  const to = RELATIONS.get(relation)?.apply(chords[from], key)[0];
  const d = to ? chords.findIndex((c) => c.root === to.root && c.quality === to.quality) : -1;
  return d >= 0 ? d : from;
}

/** The chords each Riemann function names on a major or minor key (iii names none: §2.1). */
const FUNCTION_DEGREES: Readonly<Record<'T' | 'S' | 'D', readonly number[]>> = { T: [0, 5], S: [3, 1], D: [4, 6] };

/** The chord with that function nearest the chord in force (least voice-leading motion; on a
 *  tie the function's main chord: I, IV, V). */
export function functionDegree(spec: ScaleSpec, from: number, fn: 'T' | 'S' | 'D'): number {
  const key = keyOf(spec);
  const chords = diatonicChords(key);
  const options = FUNCTION_DEGREES[fn];
  return options.reduce((best, d) => (voiceLeadingCost(chords[from], chords[d]) < voiceLeadingCost(chords[from], chords[best]) ? d : best), options[0]);
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
    // A personal categorizer's per-category degrees, by category id (#330 P4); optional.
    // A category it does not name plays the degree of the expression it stands in for.
    { name: 'categoryDegrees', kind: 'category-degrees' },
    // What each expression stands for beyond a degree (H6 of #613): a move from the chord in
    // force, a function, or the seventh while held, as `@thoremin/sdk/harmony/target` strings;
    // optional, and an expression with no target plays its degree, as before.
    { name: 'targets', kind: 'expression-targets' },
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
    // The harmony a move or a function starts from: the degree last played (-1: none yet, the
    // tonic), and the category read last, so a move is made once when its expression begins.
    let current = SILENCE_DEGREE;
    let lastCategory: string | null = null;
    let lastSpecKey = '';

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
        const index = reading && reading.id !== null ? reading.ids.indexOf(reading.id) : null;
        let degree = !reading ? SILENCE_DEGREE : personalDegree(reading, index, categoryDegrees, degreeFor);
        let coloration: string | undefined;

        // A target beyond the degree (H6 of #613): only for a category with no degree of its own,
        // on a seven-note chord source (moves and functions walk the key's seven chords).
        const specKey = spec ? `${spec.root}|${spec.type}` : '';
        if (specKey !== lastSpecKey) {
          lastSpecKey = specKey;
          current = SILENCE_DEGREE;
        }
        const targets = inputs.targets as Partial<Record<ExpressionLabel, string>> | undefined;
        const category = reading?.id ?? null;
        const entered = category !== lastCategory;
        lastCategory = category;
        if (reading && index !== null && index >= 0 && spec && isSevenNoteScale(spec.type) && !(reading.ids[index] in (categoryDegrees ?? {}))) {
          const target = parseTarget(targets?.[reading.standsFor[index] ?? 'neutral']);
          if (target.kind !== 'degree') {
            const from = current >= 0 ? current : 0;
            if (target.kind === 'control') {
              degree = from;
              coloration = 'diatonicSeventh';
            } else if (entered) {
              degree = target.kind === 'move' ? movedDegree(spec, from, target.relation) : functionDegree(spec, from, target.riemann);
            } else {
              degree = current >= 0 ? current : from;
            }
          }
        }
        if (degree >= 0) current = degree;
        // Voiced, rendered and articulated by the shared chord renderer (the SDK's), so every
        // categorizer's chords sound alike; the triad is [] when idle or silent.
        const { voices, triad } = renderer.render({
          degree,
          spec,
          voicing: cfg.voicing ?? p.voicing,
          rendering: cfg.rendering ?? p.rendering,
          coloration,
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
