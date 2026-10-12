/**
 * The browser featurisers agree with the training ones. `test/fixtures/asl/parity.json` holds
 * real hands and one real motion window (from the training data) with the features and
 * probabilities `scripts/asl/` computed for them; `@thoremin/asl` must reproduce them. A
 * drift here means the shipped weights are being fed something they were not trained on.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handFeatures, mlpPredict, parseMlpModel, toMotionFrame, windowFeatures, motionMeta, type FeatureKind, type HandInput } from '@thoremin/asl';
import staticJson from '@thoremin/asl/models/static.json';
import motionJson from '@thoremin/asl/models/motion.json';

interface Fixture {
  hands: { gloss: string; width: number; height: number; hand: HandInput; features: number[]; post: number[] }[];
  window: { width: number; height: number; frames: { t: number; hand: HandInput }[]; features: number[]; probs: number[] };
}
const fx = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'asl', 'parity.json'), 'utf8')) as Fixture;
const staticModel = parseMlpModel(staticJson);
const motionModel = parseMlpModel(motionJson);
const close = (a: readonly number[], b: readonly number[], tol = 2e-3) => {
  expect(a).toHaveLength(b.length);
  a.forEach((v, i) => expect(Math.abs(v - b[i]!), `index ${i}: ${v} vs ${b[i]}`).toBeLessThan(tol));
};

describe('ASL featurisation parity with training', () => {
  it('has both hands in the fixture (the mirroring is exercised)', () => {
    expect(new Set(fx.hands.map((h) => h.hand.handedness)).size).toBe(2);
  });

  for (const h of fx.hands) {
    it(`static features and posterior: a ${h.hand.handedness} "${h.gloss}"`, () => {
      const x = handFeatures(h.hand, h.width, staticModel.features as FeatureKind);
      close(x!, h.features);
      close(mlpPredict(staticModel, x!), h.post);
    });
  }

  it('a motion window: features and probabilities', () => {
    const frames = fx.window.frames.map(({ t, hand }) => toMotionFrame(hand, mlpPredict(staticModel, handFeatures(hand, fx.window.width, staticModel.features as FeatureKind)!), t));
    const f = windowFeatures(frames, motionMeta(motionModel));
    close(f, fx.window.features);
    close(mlpPredict(motionModel, f), fx.window.probs);
  });
});
