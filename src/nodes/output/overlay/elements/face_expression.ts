/**
 * The face-expression cue (a bar graph of the expressions and the chord each stands for).
 *
 * Part of the `canvas-overlay` node (`../../canvas_overlay.ts` is its public face; split into these
 * files by #600 S19a, the drawing unchanged).
 */
import { chordName } from '@thoremin/sdk/music/theory';
import { categorizerReading, personalDegree, readingName, type ExpressionScores } from '@/music/expression';
import { clamp01 } from '@thoremin/sdk/features/math';
import { drawBarGraph, measureBarGraph, type BarSpec } from '@thoremin/sdk/overlay/bar_graph';
import { categoryTarget, isDiatonicMove, parseTarget, targetText } from '@thoremin/sdk/harmony/target';
import { FACE_COLOR, type OverlayElement } from '../view';

/**
 * Diatonic triad tones for a scale degree, by stacking thirds WITHIN the scale's own
 * octave and wrapping high degrees up an octave (so `vi`/`vii` don't run off a
 * single-octave array). `per` = notes per octave, detected from the scale — so it
 * generalizes to a non-seven-note chord source (#75), matching {@link diatonicChord}.
 * Fed the CHORD-SOURCE scale (not the melody), so the label agrees with the audio.
 */
function triadForDegree(scale: number[] | undefined, degree: number): number[] {
  if (!Array.isArray(scale) || scale.length < 3 || degree < 0) return [];
  const per = scale.filter((m) => m < scale[0] + 12).length || scale.length;
  const at = (d: number): number | undefined => {
    const base = scale[((d % per) + per) % per];
    return typeof base === 'number' ? base + Math.floor(d / per) * 12 : undefined;
  };
  return [at(degree), at(degree + 2), at(degree + 4)].filter((n): n is number => typeof n === 'number');
}

/**
 * The air flute's breath: one bar, filled while the mouth is blowing (the voice sounding),
 * dim while resting, with a hint until the mouth is enrolled. This is what the flute needs
 * from the face; the mesh and the expression bars are not (§2.2 of the ADR).
 */
export const faceExpressionCue: OverlayElement = {
  name: 'faceExpression',
  category: 'output',
  cue: true,
  positionOf: (view) => view.params.faceExpression.position,
  measure(view) {
    const expr = view.inputs.expression;
    if (!view.params.faceExpression.show || !expr?.present || !expr.scores?.length) return null;
    const p = view.params.faceExpression;
    // Chord labels are only meaningful (and correct) in chord mode — that's where a
    // chord actually plays and the app enforces a seven-note scale.
    const chordMode = view.inputs.faceMapping === 'chord';
    const labelLines = (p.exprLabels ? 1 : 0) + (p.chordLabels && chordMode ? 1 : 0);
    return measureBarGraph(
      expr.scores.map(() => ({ value: 0, labels: new Array(labelLines).fill('x') })),
      { title: p.topLabel ? faceExpressionTitle(expr) : undefined },
    );
  },
  draw(g, view) {
    const expr = view.inputs.expression;
    const origin = view.layout['faceExpression'];
    if (!expr?.present || !expr.scores?.length || !origin) return;
    const p = view.params.faceExpression;
    const chordMode = view.inputs.faceMapping === 'chord';
    // Name each bar's chord from the CHORD-SOURCE scale (#75), not the melody — so the
    // printed name matches the audible chord for a pentatonic melody.
    const chordScale = view.inputs.chordScale ?? view.inputs.scale;
    const chordLabel = (deg: number): string => (deg >= 0 ? chordName(triadForDegree(chordScale, deg)) : '—');
    const degreeFor = (name: string): number => view.inputs.faceDegrees?.[name] ?? -1;
    // A bar per category of the categorizer that read the face (#330 P4, P6: the general
    // model's are the seven expressions), named as it names them, its chord the one the
    // renderer plays for it.
    const reading = categorizerReading(expr);
    const bars: BarSpec[] = expr.scores.map((score, i) => {
      const name = reading.names[i] ?? '';
      const isWinner = reading.id !== null && reading.ids[i] === reading.id;
      const labels: string[] = [];
      if (p.exprLabels) labels.push(name);
      if (p.chordLabels && chordMode) {
        // A target beyond the degree (H6 of #613) prints what it does, since the chord depends on the one in force.
        const target = targetText(parseTarget(categoryTarget(reading.ids[i], reading.standsFor[i], { own: view.inputs.categoryTargets, degrees: view.inputs.categoryDegrees, expressions: view.inputs.faceTargets }), { moves: isDiatonicMove }));
        labels.push(target || chordLabel(personalDegree(reading, i, view.inputs.categoryDegrees, degreeFor)));
      }
      return {
        value: clamp01(score),
        threshold: clamp01(expr.thresholds?.[i] ?? 0),
        color: FACE_COLOR,
        highlight: isWinner,
        fired: expr.fired?.[i] ?? false,
        labels,
      };
    });
    drawBarGraph(g, origin.x, origin.y, bars, { title: p.topLabel ? faceExpressionTitle(expr) : undefined, labelColor: FACE_COLOR });
  },
};

/** The bar graph's title: the name of the category read, or its categorizer's "none of these"
 *  (`neutral` for the general model; #330 P4, P6). */
function faceExpressionTitle(expr: ExpressionScores): string {
  return readingName(expr);
}
