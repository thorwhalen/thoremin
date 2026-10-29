/**
 * Measuring a sound mapper on a take with known onsets and labels: how often it named the
 * right class (on its fast and its final decision), how long after the true onset it decided
 * and how long until its sample was actually in the output, and what each render quantum cost
 * (`docs/research/audio-trigger-latency.md`; the ratchet in `test/audio/trigger_budget.test.ts`
 * and the reports of `scripts/audio/`).
 *
 * The latency is read from the OUTPUT, not from the mapper's own report: the first sample of
 * the answer above a threshold, after the true onset. That is what a loopback recording would
 * hear, minus the device's stages.
 */
import { createSoundMapper, type SoundMapperOptions } from './mapper';
import { firstAbove, runOffline } from './offline';
import { trainMapperModels, type SoundSnippet } from './examples';
import type { ClassEvent } from './types';
import { quantile } from '@thoremin/stats';

export interface LabelledOnset {
  frame: number;
  label: string;
}

export interface LabelledTake {
  sampleRate: number;
  pcm: Float32Array;
  onsets: readonly LabelledOnset[];
}

/** The truth nearest `frame`, within `tolerance` samples, or null. */
export function truthAt(onsets: readonly LabelledOnset[], frame: number, tolerance: number): LabelledOnset | null {
  let best: LabelledOnset | null = null;
  for (const o of onsets) if (Math.abs(o.frame - frame) <= tolerance && (!best || Math.abs(o.frame - frame) < Math.abs(best.frame - frame))) best = o;
  return best;
}

/** Teach from a take the way the app does: run the mapper with capture on, label each snippet by the truth. */
export function teachFromTake(take: LabelledTake, options: Partial<SoundMapperOptions> = {}): SoundSnippet[] {
  const m = createSoundMapper({ ...options, sampleRate: take.sampleRate });
  m.configure({ type: 'capture', on: true });
  const tol = Math.round(0.02 * take.sampleRate);
  return runOffline(m, take.pcm).events.flatMap((e) => {
    if (e.kind !== 'snippet') return [];
    const t = truthAt(take.onsets, e.frame, tol);
    return t ? [{ label: t.label, sampleRate: e.sampleRate, onset: e.onset, pcm: e.pcm }] : [];
  });
}

export interface MapperReport {
  taps: number;
  /** Taps the detector found (one class event each). */
  detected: number;
  /** Onsets with no truth near them. */
  falseOnsets: number;
  fastAccuracy: number;
  finalAccuracy: number;
  revised: number;
  /** Confusion of the final decisions: truth -> decided label (`null` = rejected) -> count. */
  confusion: Record<string, Record<string, number>>;
  /** True onset to the first sample of the answer in the output, ms. */
  heardMs: { p50: number; p95: number; max: number };
  /** Per-quantum cost, microseconds. */
  quantumUs: { p50: number; p99: number; max: number };
  /** The quantum's duration, microseconds (the budget's denominator). */
  quantumBudgetUs: number;
}

export interface EvaluateOptions extends Partial<SoundMapperOptions> {
  /** A mapped sample for every label (a unit click by default, so the answer is easy to find). */
  sample?: Float32Array;
}

export function evaluateMapper(teach: readonly SoundSnippet[], test: LabelledTake, options: EvaluateOptions = {}): MapperReport {
  const sr = test.sampleRate;
  const o = { ...options, sampleRate: sr };
  const m = createSoundMapper(o);
  const models = trainMapperModels(teach, { sampleRate: sr, windowMs: m.window / (sr / 1000), refineMs: m.refineWindow / (sr / 1000), preRoll: m.preRoll, subtractTail: o.subtractTail ?? false, shape: o.shape });
  if (!models) throw new Error('evaluateMapper: nothing taught');
  const labels = [...new Set(teach.map((s) => s.label))];
  const sample = options.sample ?? Float32Array.from({ length: 64 }, (_, i) => (i === 0 ? 1 : 0.5 * Math.exp(-i / 8)));
  for (const l of labels) m.configure({ type: 'sample', id: `s:${l}`, data: sample });
  m.configure({ type: 'model', fast: models.fast, final: models.final, refPeak: models.refPeak, mapping: Object.fromEntries(labels.map((l) => [l, `s:${l}`])) });
  const run = runOffline(m, test.pcm);
  const tol = Math.round(0.02 * sr);
  const classes = run.events.filter((e): e is ClassEvent => e.kind === 'class');
  const finalStage = m.refineWindow ? 'final' : 'fast';
  let okFast = 0;
  let okFinal = 0;
  let detected = 0;
  let falseOnsets = 0;
  let revised = 0;
  const confusion: Record<string, Record<string, number>> = {};
  const heard: number[] = [];
  for (const e of classes) {
    const t = truthAt(test.onsets, e.frame, tol);
    if (e.stage === 'fast') {
      if (!t) {
        falseOnsets++;
        continue;
      }
      detected++;
      if (e.label === t.label) okFast++;
      // The answer: the first output sample above a small threshold after the true onset.
      const at = firstAbove(run.output, t.frame, 0.05, t.frame + Math.round(0.1 * sr));
      if (at >= 0) heard.push(((at - t.frame) / sr) * 1000);
    }
    if (e.stage === finalStage && t) {
      if (e.label === t.label) okFinal++;
      const row = (confusion[t.label] ??= {});
      const k = String(e.label);
      row[k] = (row[k] ?? 0) + 1;
    }
    if (e.revised) revised++;
  }
  const q = (xs: number[], p: number) => (xs.length ? quantile(xs, p) : NaN);
  const us = [...run.quantumMs].map((x) => x * 1000);
  return {
    taps: test.onsets.length,
    detected,
    falseOnsets,
    fastAccuracy: detected ? okFast / detected : 0,
    finalAccuracy: detected ? okFinal / detected : 0,
    revised,
    confusion,
    heardMs: { p50: q(heard, 0.5), p95: q(heard, 0.95), max: heard.length ? Math.max(...heard) : NaN },
    quantumUs: { p50: q(us, 0.5), p99: q(us, 0.99), max: us.length ? Math.max(...us) : NaN },
    quantumBudgetUs: (128 / sr) * 1e6,
  };
}
