/**
 * The sound mapper's real-time budget, measured offline and ratcheted
 * (`docs/research/audio-trigger-latency.md`).
 *
 * A synthetic take with known onsets and surfaces runs through the mapper one 128-frame render
 * quantum at a time, exactly as the AudioWorklet runs it. What is measured is deterministic
 * (the take is seeded, the pipeline is sample-accurate), so the numbers are compared with the
 * committed baseline `trigger.baseline.json`: latency may only go down and accuracy only up.
 * A PR that improves one runs `THOREMIN_AUDIO_BASELINE=update npx vitest run test/audio/trigger_budget.test.ts`
 * and commits the new baseline. The per-quantum cost is not deterministic (the machine), so it
 * is held to a loose fraction of the quantum instead.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { synthTake, type Take } from '@thoremin/sdk/audio/synthetic_taps';
import { evaluateMapper, teachFromTake, type LabelledTake, type MapperReport } from '@thoremin/sdk/audio/evaluate';
import { createSoundMapper } from '@thoremin/sdk/audio/mapper';
import { runOffline } from '@thoremin/sdk/audio/offline';
import { trainMapperModels } from '@thoremin/sdk/audio/examples';

const SR = 48000;
const BASELINE = 'test/audio/trigger.baseline.json';

const labelled = (t: Take): LabelledTake => ({ sampleRate: t.sampleRate, pcm: t.pcm, onsets: t.taps.map((x) => ({ frame: x.frame, label: x.surface })) });
// Taught as the app teaches: taps with room between them, eight per surface.
const teachTake = labelled(synthTake({ sampleRate: SR, seed: 1, perSurface: 8, gapMin: 0.5, gapMax: 0.8 }));
// Played as a player plays: faster, louder and softer, tails overlapping.
const playTake = labelled(synthTake({ sampleRate: SR, seed: 7, perSurface: 40 }));

interface Baseline {
  fastAccuracy: number;
  finalAccuracy: number;
  heardP95Ms: number;
  heardMaxMs: number;
}

describe('sound mapper real-time budget (offline, quantum by quantum)', () => {
  const snippets = teachFromTake(teachTake);
  const report: MapperReport = evaluateMapper(snippets, playTake);

  it('teaches from the take it heard: one snippet per tap', () => {
    expect(snippets.length).toBeGreaterThanOrEqual(teachTake.onsets.length - 1);
  });

  it('finds every tap and invents none', () => {
    expect(report.detected).toBe(report.taps);
    expect(report.falseOnsets).toBe(0);
  });

  it('holds the committed latency and accuracy (a ratchet)', () => {
    const measured: Baseline = {
      fastAccuracy: +report.fastAccuracy.toFixed(4),
      finalAccuracy: +report.finalAccuracy.toFixed(4),
      heardP95Ms: +report.heardMs.p95.toFixed(3),
      heardMaxMs: +report.heardMs.max.toFixed(3),
    };
    if (process.env.THOREMIN_AUDIO_BASELINE === 'update') writeFileSync(BASELINE, `${JSON.stringify(measured, null, 2)}\n`);
    const base: Baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
    expect(measured.fastAccuracy).toBeGreaterThanOrEqual(base.fastAccuracy);
    expect(measured.finalAccuracy).toBeGreaterThanOrEqual(base.finalAccuracy);
    expect(measured.heardP95Ms).toBeLessThanOrEqual(base.heardP95Ms);
    expect(measured.heardMaxMs).toBeLessThanOrEqual(base.heardMaxMs);
    // And the budget the baseline must itself stay inside (the design doc's numbers).
    expect(base.heardP95Ms).toBeLessThanOrEqual(5);
    expect(base.finalAccuracy).toBeGreaterThanOrEqual(0.95);
  });

  it('answers within the fast window: latency = window - pre-roll + at most a detector hop', () => {
    const m = createSoundMapper({ sampleRate: SR });
    const floorMs = ((m.window - m.preRoll) / SR) * 1000;
    expect(report.heardMs.p50).toBeGreaterThanOrEqual(floorMs - 0.5);
    expect(report.heardMs.p50).toBeLessThanOrEqual(floorMs + (32 / SR) * 1000 + 0.1);
  });

  it('costs a small fraction of the render quantum', () => {
    // CI machines vary; the real figure (about 10 us of 2667 us) is in the doc.
    expect(report.quantumUs.p50).toBeLessThan(report.quantumBudgetUs * 0.1);
  });

  it('is decided the same whatever the render quantum (sample-accurate)', () => {
    const models = trainMapperModels(snippets, { sampleRate: SR, windowMs: 4, refineMs: 12, preRoll: 32, subtractTail: false })!;
    const decide = (quantum: number) => {
      const m = createSoundMapper({ sampleRate: SR });
      m.configure({ type: 'model', fast: models.fast, final: models.final, refPeak: models.refPeak, mapping: {} });
      return runOffline(m, playTake.pcm.subarray(0, SR * 5), { quantum }).events.flatMap((e) => (e.kind === 'class' ? [`${e.stage}:${e.frame}:${e.decidedFrame}:${e.label}`] : []));
    };
    expect(decide(64)).toEqual(decide(128));
    expect(decide(512)).toEqual(decide(128));
  });

  it('a revised hit is swapped in place: the corrected sample continues where the first had got to', () => {
    const labels = [...new Set(snippets.map((s) => s.label))];
    const models = trainMapperModels(snippets, { sampleRate: SR, windowMs: 4, refineMs: 12, preRoll: 32, subtractTail: false })!;
    const m = createSoundMapper({ sampleRate: SR, velocity: 0, gain: 1 });
    // A distinct steady tone per class, long enough to outlast the crossfade.
    labels.forEach((l, k) => m.configure({ type: 'sample', id: l, data: Float32Array.from({ length: SR / 10 }, (_, i) => 0.1 * (k + 1) * Math.sin((2 * Math.PI * 300 * (k + 1) * i) / SR)) }));
    m.configure({ type: 'model', fast: models.fast, final: models.final, refPeak: models.refPeak, mapping: Object.fromEntries(labels.map((l) => [l, l])) });
    const run = runOffline(m, playTake.pcm);
    const classes = run.events.filter((e) => e.kind === 'class');
    const revisions = classes.filter((e) => e.kind === 'class' && e.revised);
    expect(revisions.length).toBeGreaterThan(0);
    for (const r of revisions) {
      if (r.kind !== 'class' || r.label === null) continue;
      const fast = classes.find((e) => e.kind === 'class' && e.stage === 'fast' && e.frame === r.frame)!;
      if (fast.kind !== 'class') continue;
      // Skip one whose neighbour's sample overlaps (taps 150 ms apart, samples 100 ms long: rare).
      const t = r.decidedFrame + 4 * 48 + 10;
      const k = labels.indexOf(r.label);
      const expected = 0.1 * (k + 1) * Math.sin((2 * Math.PI * 300 * (k + 1) * (t - fast.decidedFrame)) / SR);
      const others = classes.some((e) => e.kind === 'class' && e.stage === 'fast' && e.frame !== r.frame && Math.abs(e.decidedFrame - t) < SR / 10);
      if (!others) expect(run.output[t]).toBeCloseTo(expected, 4);
    }
  });
});
