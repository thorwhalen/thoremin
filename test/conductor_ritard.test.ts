/**
 * The KTH final-ritard prior in the conductor (#333): off by default, and then the node is exactly what it
 * was; chosen, it replaces the speed fallback in the last beats of the piece, so where the gesture is
 * unsure the tempo slows toward the end the way a performer would, and a confident gesture still wins.
 * Run on the 4/4 conducting fixture (stated 70 bpm) with the fallback threshold raised to 1, so the
 * oscillator's confidence (always below 1) leaves a share of the tempo to the prior.
 */
import { describe, expect, it } from 'vitest';
import { replayNode } from '@thoremin/dag';
import { conductorNode, type HandsFrame } from '@/nodes';
import type { ScoreDoc } from '@thoremin/sdk/score/schema';
import { loadStream } from './helpers/fixtures';

const FPS = 30;
const frames = loadStream('conducting_44', 'src.hands') as HandsFrame[];
const RECORDED = { mirrorX: false, mirrorHandedness: false };
/** A piece whose last note starts at beat 12, so the ritard (8 beats) runs from beat 4. */
const doc = { v: 1, title: 't', source: 'midi', parts: [{ id: 'a', name: 'A', percussion: false, notes: Array.from({ length: 13 }, (_, i) => ({ midi: 60, start: i, duration: 1, velocity: 0.8 })) }], tempoMap: [], timeSignatures: [], dynamics: [], fermatas: [], lengthBeats: 13 } as unknown as ScoreDoc;

async function run(params: Record<string, unknown>) {
  const h = conductorNode.make(conductorNode.params.parse({ enabled: true, ...RECORDED, fallbackBelowConfidence: 1, ...params }));
  return replayNode(h, { hands: frames, doc: frames.map(() => doc) }, { dt: 1 / FPS });
}
const bpmOf = (outs: Record<string, unknown>[]) => outs.map((o) => (o.time as { tempo: number }).tempo);
const beatOf = (outs: Record<string, unknown>[]) => outs.map((o) => o.beat as number);

describe('the KTH final-ritard prior', () => {
  it('is off by default: the node is byte for byte what it was', async () => {
    const base = await run({});
    expect(await run({ tempoPrior: 'none' })).toEqual(base);
    expect(conductorNode.params.parse({}).tempoPrior).toBe('none');
  });

  it('changes nothing before the ritard begins, and slows the tempo inside it', async () => {
    const none = await run({});
    const kth = await run({ tempoPrior: 'kth-final-ritard', ritardBeats: 8 });
    const nb = beatOf(none);
    const kb = beatOf(kth);
    const tn = bpmOf(none);
    const tk = bpmOf(kth);
    // Until the beat first reaches the ritard (beat 4), the two runs are the same run.
    const entry = nb.findIndex((b) => b >= 4);
    expect(entry).toBeGreaterThan(10);
    for (let i = 0; i < entry - 1; i++) expect(tk[i]).toBeCloseTo(tn[i], 9);
    // Inside it the prior's share pulls the tempo below the plain run's, on average and by a margin.
    const inside = nb.map((b, i) => (b >= 5 && b <= 11 && tn[i] > 0 && tk[i] > 0 ? i : -1)).filter((i) => i >= 0);
    expect(inside.length).toBeGreaterThan(20);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(inside.map((i) => tk[i]))).toBeLessThan(mean(inside.map((i) => tn[i])) - 3);
    // On this clip it ends the run behind the plain one (it slowed the music); the beat stays monotone.
    expect(kb.at(-1)!).toBeLessThan(nb.at(-1)!);
    for (let i = 1; i < kb.length; i++) expect(kb[i]).toBeGreaterThanOrEqual(kb[i - 1]);
  });

  it('a confident gesture overrides it: on every tick the oscillator is sure of, the tempo is the gesture\'s, prior or not', async () => {
    // Threshold 0.3 (the default): w is 1 wherever confidence >= 0.3. The tempo on such a tick is the
    // inferred one in both runs, whatever the beat is, because the prior's share is (1 - w) = 0.
    const none = await run({ fallbackBelowConfidence: 0.3 });
    const kth = await run({ fallbackBelowConfidence: 0.3, tempoPrior: 'kth-final-ritard' });
    const conf = none.map((o) => (o.time as { confidence: number }).confidence);
    let sure = 0;
    conf.forEach((c, i) => {
      if (c >= 0.3 && bpmOf(none)[i] > 0 && bpmOf(kth)[i] > 0) {
        sure++;
        expect(bpmOf(kth)[i], `tick ${i}`).toBeCloseTo(bpmOf(none)[i], 9);
      }
    });
    expect(sure).toBeGreaterThan(100);
  });

  it('the curve starts from the tempo in force where the ritard BEGINS, not from a tempo that has since slowed', async () => {
    // Threshold 0.9: the oscillator is sure (w = 1) on the better part of the clip and blended on the
    // rest, so a confident tempo is known when the beat enters the ritard (beat 4). Inside it the prior's
    // share can never exceed that start tempo times 1 (the curve only falls from it).
    const kth = await run({ fallbackBelowConfidence: 0.9, tempoPrior: 'kth-final-ritard', ritardBeats: 8 });
    const none = await run({ fallbackBelowConfidence: 0.9 });
    const nb = beatOf(none);
    const entry = nb.findIndex((b) => b >= 4);
    const startTempo = bpmOf(none)[entry - 1];
    expect(startTempo).toBeGreaterThan(40);
    // The blended ticks (confidence under 0.9) inside the ritard: tempo = w * inferred + (1 - w) * curve,
    // and the curve never exceeds the start tempo, so the tempo never exceeds the larger of the inferred
    // tempo and the start tempo.
    const kb = beatOf(kth);
    kth.forEach((o, i) => {
      const t = o.time as { confidence: number; tempo: number; beat: number };
      if (kb[i] >= 4.5 && kb[i] <= 12 && t.tempo > 0 && t.confidence < 0.9) {
        const w = t.confidence / 0.9;
        const inferred = (none[i].time as { tempo: number }).tempo;
        expect(t.tempo, `tick ${i}`).toBeLessThanOrEqual(w * Math.max(inferred, 1e3) + (1 - w) * Math.max(startTempo, bpmOf(none)[i]) + 1e-6);
      }
    });
  });

  it('without a piece there is no end to slow toward: the prior is silent', async () => {
    const h = conductorNode.make(conductorNode.params.parse({ enabled: true, ...RECORDED, fallbackBelowConfidence: 1, tempoPrior: 'kth-final-ritard' }));
    const h2 = conductorNode.make(conductorNode.params.parse({ enabled: true, ...RECORDED, fallbackBelowConfidence: 1 }));
    expect(await replayNode(h, { hands: frames }, { dt: 1 / FPS })).toEqual(await replayNode(h2, { hands: frames }, { dt: 1 / FPS }));
  });
});
