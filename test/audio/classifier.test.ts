/** The few-shot classifier: within-class scaling, nearest example per class, a learned reject radius. */
import { describe, expect, it } from 'vitest';
import { createSoundClassifier, trainSoundModel } from '@thoremin/sdk/audio/classifier';

describe('few-shot sound classifier', () => {
  // Feature 0 separates the classes; feature 1 is large noise inside every class.
  const ex = (label: string, a: number, noise: number) => ({ label, features: [a, noise] });
  const examples = [ex('x', 0, -50), ex('x', 0.1, 40), ex('x', -0.1, 10), ex('y', 1, 30), ex('y', 1.1, -45), ex('y', 0.9, 0)];

  it('scales by the within-class spread, so a noisy feature does not decide', () => {
    const c = createSoundClassifier(trainSoundModel(examples));
    expect(c.classify([0.05, 45]).label).toBe('x');
    expect(c.classify([0.95, -50]).label).toBe('y');
  });

  it('rejects a sound far from every example and still names the nearest', () => {
    const c = createSoundClassifier(trainSoundModel(examples));
    const d = c.classify([20, 0]);
    expect(d.label).toBeNull();
    expect(d.nearest).toBe('y');
  });

  it('is more confident in the middle of a class than between two', () => {
    const c = createSoundClassifier(trainSoundModel(examples));
    expect(c.classify([0, 0]).confidence).toBeGreaterThan(c.classify([0.45, 0]).confidence);
  });

  it('keeps a class struck in two places as two clusters (nearest example, not the mean)', () => {
    const two = [ex('x', 0, 0), ex('x', 0.05, 0), ex('x', 2, 0), ex('x', 2.05, 0), ex('y', 1, 0), ex('y', 1.05, 0)];
    const c = createSoundClassifier(trainSoundModel(two));
    expect(c.classify([1.02, 0]).label).toBe('y');
    expect(c.classify([2.02, 0]).label).toBe('x');
  });

  it('is plain data that survives JSON', () => {
    const model = trainSoundModel(examples);
    const again = createSoundClassifier(JSON.parse(JSON.stringify(model)));
    expect(again.classify([1, 0])).toEqual(createSoundClassifier(model).classify([1, 0]));
  });

  it('refuses an empty or ragged training set', () => {
    expect(() => trainSoundModel([])).toThrow(/no examples/);
    expect(() => trainSoundModel([ex('x', 0, 0), { label: 'y', features: [1] }])).toThrow(/feature length/);
  });
});
