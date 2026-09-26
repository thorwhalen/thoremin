/**
 * The held-out training harness every air instrument's CLI runs: the same three
 * numbers, the same probe report, the same markdown, so a flute result reads like the
 * guitar result. Pure over `Sample[]` (no file IO; the CLIs read and write).
 *
 * 1. leave-one-player-out, softmax  — does what one player does transfer to another?
 * 2. leave-one-player-out, centroid — would the trainer's own classifier have done?
 * 3. within-player random split     — the optimistic bound (adjacent frames leak).
 * Groups with fewer than `minPerGroup` frames are dropped (a fold of twelve frames is
 * not a fold). Probe samples (label `?`) are reported by prediction and confidence.
 */
import {
  centroidTrainer,
  formatFolds,
  leaveOneGroupOut,
  predictProba,
  softmaxTrainer,
  trainSoftmax,
  withinGroupSplit,
  type Evaluation,
  type LeaveOneGroupOutResult,
  type Sample,
  type SoftmaxModel,
} from './lib_chord_shape_model';

export interface HeldOutOptions {
  features: readonly string[];
  epochs?: number;
  smoothWindow?: number;
  minPerGroup?: number;
  /** A name for the markdown heading, e.g. "chord shape" or "pitch class". */
  target: string;
}

export interface ProbeReport {
  frames: number;
  predicted: Record<string, number>;
  meanMaxProb: number;
}

export interface HeldOutReport {
  features: string[];
  labels: string[];
  perLabel: Record<string, number>;
  dropped: string[];
  epochs: number;
  smoothWindow: number;
  lovoSoftmax: LeaveOneGroupOutResult;
  lovoCentroid: LeaveOneGroupOutResult;
  within: Evaluation;
  probe: Record<string, ProbeReport>;
}

export function runHeldOut(samples: readonly Sample[], probe: readonly Sample[], o: HeldOutOptions): { report: HeldOutReport; model: SoftmaxModel; markdown: string } {
  const epochs = o.epochs ?? 300;
  const smoothWindow = o.smoothWindow ?? 9;
  const minPerGroup = o.minPerGroup ?? 30;
  const perGroup = new Map<string, number>();
  for (const s of samples) perGroup.set(s.group, (perGroup.get(s.group) ?? 0) + 1);
  const kept = samples.filter((s) => (perGroup.get(s.group) ?? 0) >= minPerGroup);
  const dropped = [...perGroup].filter(([, n]) => n < minPerGroup).map(([g, n]) => `${g} (${n})`);
  if (kept.length === 0) throw new Error('runHeldOut: no group has enough frames');
  const features = [...o.features];
  const labels = [...new Set(kept.map((s) => s.label))].sort();
  const perLabel: Record<string, number> = {};
  for (const s of kept) perLabel[s.label] = (perLabel[s.label] ?? 0) + 1;

  const lovoSoftmax = leaveOneGroupOut(kept, features, softmaxTrainer({ epochs }), { smoothWindow });
  const lovoCentroid = leaveOneGroupOut(kept, features, centroidTrainer, { smoothWindow });
  const within = withinGroupSplit(kept, features, softmaxTrainer({ epochs }));
  const model = trainSoftmax(kept, features, { epochs });

  const probeReport: Record<string, ProbeReport> = {};
  for (const s of probe) {
    const p = predictProba(model, s.vector);
    const best = Object.entries(p).sort((a, b) => b[1] - a[1])[0];
    const r = (probeReport[s.group] ??= { frames: 0, predicted: {}, meanMaxProb: 0 });
    r.frames += 1;
    r.predicted[best[0]] = (r.predicted[best[0]] ?? 0) + 1;
    r.meanMaxProb += best[1];
  }
  for (const r of Object.values(probeReport)) r.meanMaxProb = r.frames ? r.meanMaxProb / r.frames : 0;

  const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
  const groups = perGroup.size - dropped.length;
  const conf = lovoSoftmax.pooledRaw.confusion;
  const lines = [
    `Target: ${o.target}. Features: ${features.length}. Labels: ${labels.join(', ')}.`,
    `Samples: ${kept.length} frames over ${groups} players${dropped.length ? `; dropped ${dropped.join(', ')}` : ''}.`,
    `Per label: ${Object.entries(perLabel).map(([k, v]) => `${k}=${v}`).join(', ')}.`,
    '',
    `### Leave-one-player-out, softmax regression`,
    formatFolds(lovoSoftmax),
    '',
    `### Leave-one-player-out, nearest centroid (the trainer's classifier)`,
    formatFolds(lovoCentroid),
    '',
    `### Within-player random split (optimistic bound): accuracy ${pct(within.accuracy)}, macro-F1 ${pct(within.macroF1)} on ${within.n} frames`,
  ];
  if (Object.keys(probeReport).length) {
    lines.push('', `### Probe (holdout, unlabelled): what the final model says`);
    for (const [g, r] of Object.entries(probeReport)) {
      lines.push(`- ${g}: ${r.frames} frames; predicted ${Object.entries(r.predicted).map(([k, v]) => `${k}=${v}`).join(', ')}; mean max-probability ${r.meanMaxProb.toFixed(2)}`);
    }
  }
  const keys = Object.keys(conf);
  if (keys.length <= 14) {
    lines.push('', 'Pooled confusion (softmax, raw), rows = truth:', '| | ' + keys.join(' | ') + ' |', '|---|' + keys.map(() => '---').join('|') + '|');
    for (const [t, row] of Object.entries(conf)) lines.push(`| **${t}** | ${Object.values(row).join(' | ')} |`);
  }
  return {
    report: { features, labels, perLabel, dropped, epochs, smoothWindow, lovoSoftmax, lovoCentroid, within, probe: probeReport },
    model,
    markdown: lines.join('\n'),
  };
}
