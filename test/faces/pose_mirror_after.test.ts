/**
 * #459: the pose categorizer's mirror turned on AFTER the take. A saved categorizer that tells
 * "left arm out" from "right arm out" reads them as one pose once the mirror is on (every hold on
 * one side, a re-cut at the suggested k), and Undo restores the exact document.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bodyModality } from '@thoremin/sdk/features/modalities/body';
import { mirrorOn } from '@thoremin/sdk/enroll/sorting';
import { modelFromCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { classify } from '@thoremin/sdk/enroll/classify';
import { POSES, poseVector } from '../helpers/body_poses';
import { namesByPose, resetPoseClock, take } from '../helpers/pose_take';

beforeEach(() => {
  vi.useFakeTimers();
  resetPoseClock();
});
afterEach(() => vi.useRealTimers());

const NAMES = ['left arm out', 'right arm out', 'arms up'] as const;
const tools = { image: bodyModality.mirrorImage!, side: bodyModality.mirrorSide!, skeleton: (v: Parameters<NonNullable<typeof bodyModality.skeleton>>[0]) => bodyModality.skeleton!(v) };

describe('the mirror after the take (#459)', () => {
  it('a saved categorizer: turning the mirror on merges left and right arm out at the suggested k; Undo restores the exact document', async () => {
    const store = await take(NAMES);
    expect(await store.getState().save('arms')).toBe(true);
    store.getState().rename(store.getState().working!.categories.find((c) => c.label !== 'arms up' && namesByPose(store, NAMES).find((n) => n.label === c.label)?.pose === 'left arm out')!.id, 'my left');
    const before = store.getState().working!;
    expect(before.mirror).not.toBe(true);
    expect(before.categories).toHaveLength(3);

    store.getState().setMirror(true);
    const after = store.getState().working!;
    expect(after.mirror).toBe(true);
    expect(store.getState().mirror).toBe(true);
    expect(after.categories).toHaveLength(2);
    // Both sides' holds in one category; the arms-up holds in the other.
    const byPose = namesByPose(store, ['left arm out', 'arms up']);
    expect(byPose.map((x) => x.pose).sort()).toEqual(['arms up', 'left arm out']);
    // The merged category's name is not one side's (the player's "my left" is half of it).
    const merged = byPose.find((x) => x.pose === 'left arm out')!;
    expect(merged.label).not.toBe('my left');
    expect(merged.label).not.toMatch(/left|right/);
    // Every hold now reads on one side, its stick figure redrawn from its vector.
    for (const s of after.samples) {
      expect(bodyModality.mirrorSide!(s.vector)).toBeGreaterThanOrEqual(0);
      if (s.skeleton) expect(s.skeleton).toEqual(JSON.parse(JSON.stringify(bodyModality.skeleton!(s.vector))));
    }
    // A live right arm out now reads as the merged category.
    const model = modelFromCategorizer(after);
    const live = bodyModality.read(poseVector(POSES['right arm out'], 9999))!;
    const read = classify(model, bodyModality.mirrorSide!(live) < 0 ? bodyModality.mirrorImage!(live) : live);
    expect(after.categories.find((c) => c.id === read.categoryId)?.label).toBe(merged.label);

    // Turning it off is refused (no hold kept its side); Undo puts the exact document back.
    store.getState().setMirror(false);
    expect(store.getState().working).toBe(after);
    store.getState().undo();
    expect(store.getState().working).toEqual(before);
    expect(store.getState().mirror).toBe(false);
  });

  it('a named category that survives keeps its name and id; turning the mirror on twice is refused', async () => {
    {
      const store = await take(NAMES);
      const c = store.getState().working!;
      const up = namesByPose(store, NAMES).find((x) => x.pose === 'arms up')!;
      const upId = c.categories.find((k) => k.label === up.label)!.id;
      const named = { ...c, categories: c.categories.map((k) => (k.id === upId ? { ...k, label: 'reach' } : k)) };
      const r = mirrorOn(named, tools);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const reach = r.categorizer.categories.find((k) => k.label === 'reach')!;
      expect(reach.id).toBe(upId);
      expect(new Set(reach.members)).toEqual(new Set(c.categories.find((k) => k.id === upId)!.members));
      expect(mirrorOn(r.categorizer, tools)).toEqual({ ok: false, error: 'left and right are already the same pose' });
    }
  });

  it('a reopened categorizer: the feature list gains each twin, two same-side poses stay apart, and a sided default name is not kept', async () => {
    const store = await take(['right arm up', 'right arm out']);
    expect(await store.getState().save('right')).toBe(true);
    const id = store.getState().saved[0].id;
    store.getState().reset();
    await store.getState().open(id);
    await vi.advanceTimersByTimeAsync(0);
    const before = store.getState().working!;
    expect(before.categories.map((c) => c.label)).toContain('right arm up');

    store.getState().setMirror(true);
    const after = store.getState().working!;
    expect(after.mirror).toBe(true);
    for (const f of before.features) {
      const twin = Object.keys(bodyModality.mirrorImage!({ [f]: 0.25 }))[0];
      expect(after.features).toContain(twin);
      expect(after.weights[twin]).toBe(Object.hasOwn(before.weights, twin) ? before.weights[twin] : before.weights[f]);
    }
    // Both poses lean the same way: still two categories, the same holds, far apart.
    expect(after.categories).toHaveLength(2);
    expect(new Set(after.categories.map((c) => [...c.members].sort().join()))).toEqual(new Set(before.categories.map((c) => [...c.members].sort().join())));
    const model = modelFromCategorizer(after);
    const [a, b] = model.categories;
    let d2 = 0;
    for (const f of model.features) if (Number.isFinite(a.centroid[f]) && Number.isFinite(b.centroid[f])) d2 += ((a.centroid[f] - b.centroid[f]) * (model.weights[f] ?? 1)) ** 2;
    expect(Math.sqrt(d2)).toBeGreaterThan(4 * Math.max(a.radius, b.radius));
    // "right arm up" was the general model's sided name: the mirror's words replace it.
    expect(after.categories.map((c) => c.label).join(' ')).not.toMatch(/right|left/);
  });
});
