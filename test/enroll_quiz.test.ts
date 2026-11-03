/**
 * The quiz and the everyday check (#385 E7), pure: the quiz's order (each category twice, no
 * repeat in a row), its scoring of hit / slow / miss on a scripted reading stream (with the
 * confusion a miss names, the hold that must be unbroken, a run begun before the deadline allowed
 * to finish), the per-category summary and the guard against a renamed category; the everyday
 * check's fires (entries only, Neutral never) and flags; and the per-category size
 * (`Category.scale`), which leaves an unsized model's classification untouched. A moving gesture
 * is asked like a category and answered by a fire (#954).
 */
import { describe, expect, it } from 'vitest';
import { createQuiz, quizOrder, QUIZ_DEFAULTS, reproducibilityOf, reproducibilityScore, summarizeQuiz, QuizResultSchema } from '@thoremin/sdk/enroll/quiz';
import { createEverydayCheck, everydayFlags, everydayResult, EverydayResultSchema } from '@thoremin/sdk/enroll/everyday';
import { classify, scaledDistance } from '@thoremin/sdk/enroll/classify';
import { liveMargin } from '@thoremin/sdk/enroll/quality';
import type { TrainedModel } from '@thoremin/sdk/enroll/types';

/** Feed `quiz` one reading per 33 ms from `from` to `to` (ms). */
function feed(quiz: ReturnType<typeof createQuiz>, from: number, to: number, categoryId: string | null) {
  for (let t = from; t < to; t += 33) quiz.push({ categoryId }, t, { x: categoryId === null ? 0 : 1 });
}

describe('quizOrder', () => {
  it('asks each category twice, never the same twice in a row', () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let run = 0; run < 50; run++) {
      const order = quizOrder(['a', 'b', 'c'], { random });
      expect([...order].sort()).toEqual(['a', 'a', 'b', 'b', 'c', 'c']);
      for (let i = 1; i < order.length; i++) expect(order[i]).not.toBe(order[i - 1]);
    }
    expect(quizOrder(['solo'])).toEqual(['solo', 'solo']);
    // Any repeat count and size: never twice in a row when an order without it exists (review:
    // the swap-based fix-up left some).
    for (let run = 0; run < 3000; run++) {
      const n = 2 + (run % 6);
      const order = quizOrder(Array.from({ length: n }, (_, i) => `c${i}`), { repeats: 1 + (run % 4), random });
      for (let i = 1; i < order.length; i++) expect(order[i]).not.toBe(order[i - 1]);
    }
  });
});

describe('createQuiz', () => {
  const { relaxMs, hitMs, holdMs, timeoutMs } = QUIZ_DEFAULTS;

  it('scores a hit, a slow answer and a miss (with what it read instead)', () => {
    const quiz = createQuiz(['smile', 'frown', 'wow']);
    quiz.start(0);
    expect(quiz.step(0)).toMatchObject({ kind: 'relax', next: 'smile' });
    // smile: entered 500 ms after the prompt, held: a hit.
    let t = relaxMs;
    feed(quiz, 0, t + 500, null);
    expect(quiz.step()).toMatchObject({ kind: 'ask', categoryId: 'smile' });
    feed(quiz, t + 500, t + 500 + holdMs + 66, 'smile');
    expect(quiz.trials()).toHaveLength(1);
    // frown: 3 s of the wrong face, then frown: slow.
    t = t + 500 + holdMs + 66;
    const askFrown = t + relaxMs;
    feed(quiz, t, askFrown + 3000, 'smile');
    feed(quiz, askFrown + 3000, askFrown + 3000 + holdMs + 66, 'frown');
    // wow: never made, smile read instead: a miss.
    t = askFrown + 3000 + holdMs + 66;
    feed(quiz, t, t + relaxMs + timeoutMs + 66, 'smile');
    expect(quiz.done()).toBe(true);
    const [a, b, c] = quiz.trials();
    expect(a).toMatchObject({ categoryId: 'smile', outcome: 'hit' });
    expect(a.timeToHitMs!).toBeLessThanOrEqual(hitMs);
    expect(a.vector).toEqual({ x: 1 });
    expect(b).toMatchObject({ categoryId: 'frown', outcome: 'slow', confusedWith: null });
    expect(b.timeToHitMs!).toBeGreaterThan(hitMs);
    expect(c).toMatchObject({ categoryId: 'wow', outcome: 'miss', timeToHitMs: null, confusedWith: 'smile' });
    expect(quiz.step()).toEqual({ kind: 'done', total: 3 });
  });

  it('a face already held when the prompt comes must be let go and found again (review)', () => {
    const quiz = createQuiz(['smile', 'b']);
    quiz.start(0);
    // Smile made during the relax and held into the prompt: not a hit.
    feed(quiz, 0, relaxMs + 1500, 'smile');
    expect(quiz.trials()).toHaveLength(0);
    // Let go, then made: found, timed from the prompt.
    feed(quiz, relaxMs + 1500, relaxMs + 1700, null);
    feed(quiz, relaxMs + 1700, relaxMs + 1700 + holdMs + 66, 'smile');
    expect(quiz.trials()[0]).toMatchObject({ outcome: 'hit' });
    expect(quiz.trials()[0].timeToHitMs!).toBeGreaterThan(1500);
  });

  it('a hold broken before a second is not a hit; a run begun before the deadline may finish', () => {
    const quiz = createQuiz(['a', 'a2']);
    quiz.start(0);
    // a: held 600 ms, broken, then held again from 4.5 s (before the 5 s deadline) to 5.6 s.
    feed(quiz, 0, relaxMs, null);
    feed(quiz, relaxMs, relaxMs + 600, 'a');
    feed(quiz, relaxMs + 600, relaxMs + 4500, null);
    expect(quiz.trials()).toHaveLength(0);
    feed(quiz, relaxMs + 4500, relaxMs + 4500 + holdMs + 66, 'a');
    expect(quiz.trials()[0]).toMatchObject({ outcome: 'slow' });
    // a2: nothing at all until past the deadline: a miss that names nothing.
    const t = relaxMs + 4500 + holdMs + 66;
    feed(quiz, t, t + relaxMs + timeoutMs + 66, null);
    expect(quiz.trials()[1]).toMatchObject({ outcome: 'miss', confusedWith: null });
  });

  it('summarizes per category, and a renamed category does not show an old result', () => {
    const trials = [
      { categoryId: 'cat-1', outcome: 'hit' as const, timeToHitMs: 400, confusedWith: null },
      { categoryId: 'cat-1', outcome: 'slow' as const, timeToHitMs: 2600, confusedWith: null },
      { categoryId: 'cat-2', outcome: 'miss' as const, timeToHitMs: null, confusedWith: 'cat-1' },
      { categoryId: 'cat-2', outcome: 'hit' as const, timeToHitMs: 800, confusedWith: null },
    ];
    const r = QuizResultSchema.parse(summarizeQuiz(trials, new Map([['cat-1', 'smile'], ['cat-2', 'frown']]), '2026-10-13T00:00:00.000Z'));
    expect(r.categories['cat-1']).toEqual({ label: 'smile', asked: 2, hits: 1, slow: 1, misses: 0, medianTimeMs: 1500, confusedWith: null });
    expect(r.categories['cat-2']).toMatchObject({ hits: 1, misses: 1, confusedWith: 'cat-1', medianTimeMs: 800 });
    expect(reproducibilityScore(r.categories['cat-1'])).toBe(0.75);
    expect(reproducibilityOf(r, { id: 'cat-1', label: 'Smile' })).not.toBeNull();
    expect(reproducibilityOf(r, { id: 'cat-1', label: 'grin' })).toBeNull();
    expect(reproducibilityOf(null, { id: 'cat-1', label: 'smile' })).toBeNull();
  });
});

describe('the everyday check', () => {
  it('the face held as the check begins is not an accidental fire (review)', () => {
    const check = createEverydayCheck({ durationMs: 60_000 });
    check.start(0);
    for (let t = 0; t < 60_000; t += 1000) check.push({ categoryId: 'smile' }, t);
    expect(check.fires()).toEqual({});
  });

  it('counts entries, never Neutral, only within its time, and flags the frequent ones', () => {
    const check = createEverydayCheck({ durationMs: 60_000 });
    const seq: (string | null)[] = [null, 'a', 'a', null, 'a', 'b', 'b', null, null, 'a'];
    check.push({ categoryId: 'a' }, -5); // before start: ignored
    check.start(0);
    seq.forEach((id, i) => check.push({ categoryId: id }, i * 1000));
    check.push({ categoryId: 'b' }, 60_000); // past the minute: ignored
    expect(check.fires()).toEqual({ a: 3, b: 1 });
    expect(check.done(60_000)).toBe(true);
    const result = EverydayResultSchema.parse(everydayResult(check, 60_000, new Map([['a', 'surprise'], ['b', 'frown']]), 'now'));
    expect(everydayFlags(result)).toEqual([
      { categoryId: 'a', label: 'surprise', fires: 3, perMinute: 3 },
      { categoryId: 'b', label: 'frown', fires: 1, perMinute: 1 },
    ]);
    expect(everydayFlags(result, { flagPerMinute: 2 }).map((f) => f.categoryId)).toEqual(['a']);
  });
});

describe('per-category size (Category.scale)', () => {
  const model: TrainedModel = {
    features: ['x'],
    weights: { x: 1 },
    categories: [
      { id: 'small', label: 'small', centroid: { x: 10 }, size: 3, radius: 1, members: [0, 1, 2] },
      { id: 'big', label: 'big', centroid: { x: -10 }, size: 3, radius: 1, members: [3, 4, 5] },
    ],
    neutral: [{ id: 'neutral-1', label: '', centroid: { x: 0 }, size: 3, radius: 1, members: [6, 7, 8] }],
    rejectRadius: 6,
  } as TrainedModel;

  it('leaves an unsized model untouched, and a size of 1 is no size', () => {
    expect(scaledDistance({}, 3.5)).toBe(3.5);
    expect(scaledDistance({ scale: 1 }, 3.5)).toBe(3.5);
    expect(scaledDistance({ scale: 0.5 }, 3.5)).toBe(1.75);
  });

  it('a smaller size lets a small face reach its category; a larger one takes a bigger face', () => {
    // 4 out of 10 toward "small": nearer Neutral (4) than small (6).
    expect(classify(model, { x: 4 }).neutral).toBe(true);
    const sized = { ...model, categories: model.categories.map((c) => (c.id === 'small' ? { ...c, scale: 0.5 } : c)) };
    const r = classify(sized, { x: 4 });
    expect(r.categoryId).toBe('small');
    expect(r.distance).toBe(3);
    expect(liveMargin(sized, { x: 4 }).nearest).toBe('small');
    // Bigger: x = 7 is "small" unsized (3 < 7), and Neutral at size 3 (9 > 7).
    expect(classify(model, { x: 7 }).categoryId).toBe('small');
    const bigger = { ...model, categories: model.categories.map((c) => (c.id === 'small' ? { ...c, scale: 3 } : c)) };
    expect(classify(bigger, { x: 7 }).neutral).toBe(true);
  });
});

describe('a moving gesture in the quiz: answered by a fire (#954)', () => {
  const { relaxMs, hitMs, timeoutMs } = QUIZ_DEFAULTS;
  /** A quiz over `order` (every id a gesture), started at 0. */
  const quizOver = (order: string[]) => {
    const q = createQuiz(order, { events: order });
    q.start(0);
    return q;
  };

  it('a fire of the asked gesture begun soon after the prompt is a hit, later a slow answer', () => {
    const q = quizOver(['wave', 'circle']);
    q.push({ categoryId: null }, relaxMs); // the prompt, at relaxMs
    expect(q.step()).toMatchObject({ kind: 'ask', categoryId: 'wave' });
    q.fire('wave', relaxMs + 1500, relaxMs + 500);
    expect(q.trials()[0]).toMatchObject({ categoryId: 'wave', outcome: 'hit', timeToHitMs: 500 });
    const second = relaxMs + 1500 + relaxMs;
    q.push({ categoryId: null }, second);
    expect(q.step()).toMatchObject({ kind: 'ask', categoryId: 'circle' });
    q.fire('circle', second + hitMs + 1000, second + hitMs + 500);
    expect(q.trials()[1]).toMatchObject({ categoryId: 'circle', outcome: 'slow', timeToHitMs: hitMs + 500 });
    expect(q.done()).toBe(true);
  });

  it('a movement begun before the prompt does not answer it; another gesture\'s fire is the confusion; the deadline is a miss', () => {
    const q = quizOver(['wave']);
    q.push({ categoryId: null }, relaxMs);
    q.fire('wave', relaxMs + 400, relaxMs - 300); // begun in the relax
    expect(q.trials()).toHaveLength(0);
    q.fire('circle', relaxMs + 800, relaxMs + 200);
    q.push({ categoryId: null }, relaxMs + timeoutMs);
    expect(q.trials()[0]).toMatchObject({ categoryId: 'wave', outcome: 'miss', confusedWith: 'circle' });
  });

  it('a fire in the relax, before start or after the end, changes nothing', () => {
    const q = createQuiz(['wave'], { events: ['wave'] });
    q.fire('wave', 10);
    q.start(0);
    q.fire('wave', 100);
    expect(q.step(100)).toMatchObject({ kind: 'relax' });
    expect(q.trials()).toHaveLength(0);
  });

  it('a movement begun before the deadline is not timed out while it is made (polled between frames, #954 review)', () => {
    // A 1.5 s wave begun 3.4 s after the prompt fires at its closing quiet, about 5.1 s: past the
    // 5 s deadline, and still an answer (slow), as a held run begun before it may finish.
    const q = quizOver(['wave']);
    q.push({ categoryId: null }, relaxMs);
    const begin = relaxMs + 3400;
    const firesAt = relaxMs + 5100;
    for (let t = relaxMs + 33; t < firesAt; t += 33) {
      q.push({ categoryId: null, moving: t >= begin }, t);
      // The panel polls the step between frames: still asking.
      expect(q.step(t + 10)).toMatchObject({ kind: 'ask', categoryId: 'wave' });
    }
    q.fire('wave', firesAt, begin);
    expect(q.trials()[0]).toMatchObject({ outcome: 'slow', timeToHitMs: 3400 });
    // A movement begun AFTER the deadline does not hold it.
    const late = quizOver(['wave']);
    late.push({ categoryId: null }, relaxMs);
    late.push({ categoryId: null, moving: true }, relaxMs + timeoutMs + 10);
    expect(late.trials()[0]).toMatchObject({ outcome: 'miss' });
  });

  it('confusion is counted in the target\'s kind: fires for a gesture, readings for a category', () => {
    // A held category read on every frame of a gesture prompt, one other gesture fired: the fire wins.
    const q = createQuiz(['wave', 'smile'], { events: ['wave', 'circle'] });
    q.start(0);
    q.push({ categoryId: 'smile' }, relaxMs);
    for (let t = relaxMs + 33; t < relaxMs + 1000; t += 33) q.push({ categoryId: 'smile' }, t);
    q.fire('circle', relaxMs + 1000, relaxMs + 500);
    q.push({ categoryId: 'smile' }, relaxMs + timeoutMs);
    expect(q.trials()[0]).toMatchObject({ categoryId: 'wave', outcome: 'miss', confusedWith: 'circle' });
    // For an asked category, a gesture's fires do not count: what was read does.
    const next = relaxMs + timeoutMs + relaxMs;
    q.push({ categoryId: 'frown' }, next);
    for (let k = 0; k < 5; k++) q.fire('circle', next + 100 + k, next + 50);
    q.push({ categoryId: 'frown' }, next + timeoutMs);
    expect(q.trials()[1]).toMatchObject({ categoryId: 'smile', outcome: 'miss', confusedWith: 'frown' });
  });
});
