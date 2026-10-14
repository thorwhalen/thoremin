// @vitest-environment jsdom
/**
 * #385 E7 in the panel: the burst row while capturing (B held, or the button held; typing a B in
 * the name field never starts one; a named burst says where it goes), and an open categorizer's
 * checks: Quiz me and the everyday check start and stop, one size dial per category writes the
 * tuning, and a kept quiz result shows beside the category's quality chip. Clicks from a cold
 * load: bursts are Tools, Your faces, Record my faces, Start capturing (then hold B); the checks
 * are Tools, Your faces, Open, Quiz me (or Everyday check).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createInMemoryProvider } from '@zodal/store';
import { exportCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { scriptedCarve } from '../helpers/scripted_carve';
import { createFaceSessionStore, type FaceSessionDeps } from '@thoremin/ext-faces/app/sessionStore';
import { createFaceTestStore } from '@thoremin/ext-faces/app/testStore';
import { createFaceModelStore, type FaceModelRecord } from '@thoremin/ext-faces/app/models';
import { memoryThumbStore } from '@thoremin/ext-faces/app/thumbnails';
import { syntheticSource } from '@thoremin/ext-faces/app/sources';
import { SYNTHETIC_TIMELINE, syntheticExpressionVector } from '@thoremin/ext-faces/lib/synthetic';
import { faceTestStore } from '@thoremin/ext-faces/app/faceSession';
import { FaceSessionView } from '@thoremin/ext-faces/panels/FaceSessionPanel';
import '@/app/dials/useDialsSettings'; // the dials host the panel's "Play it" reads

let clock = 1000;

function deps(): FaceSessionDeps {
  return {
    source: () => ({ ...syntheticSource(() => clock), video: () => null }),
    thumbs: memoryThumbStore(),
    frames: () => null,
    models: createFaceModelStore(createInMemoryProvider<FaceModelRecord>([], { idField: 'id', searchFields: ['name'] })),
    now: () => clock,
    pollMs: 33,
    claim: () => undefined,
    newTakeId: () => 'take-1',
    isoNow: () => '2026-10-13T00:00:00.000Z',
  };
}

async function run(ms: number) {
  for (let t = 0; t < ms; t += 33) {
    clock += 33;
    await act(() => vi.advanceTimersByTimeAsync(33));
  }
}

const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the burst row', () => {
  it('B held (not typed into the name) or the button held records one named hold', async () => {
    vi.useFakeTimers();
    const store = createFaceSessionStore(deps());
    const s = () => store.getState();
    render(<FaceSessionView store={store} test={faceTestStore()} />);
    act(() => s().start());
    // Into the first smile, well held.
    await run(SYNTHETIC_TIMELINE.restMs + SYNTHETIC_TIMELINE.glideMs + 150);
    expect(s().phase).toBe('faces');
    expect(document.querySelector('[data-faces-burst="off"]')).not.toBeNull();
    const name = document.querySelector('input[aria-label="Name for the next burst"]') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'grin' } });
    expect(s().burstName).toBe('grin');
    expect(document.querySelector('[data-faces-burst]')?.textContent).toContain('put straight into "grin"');
    // Typing a "b" in the field is typing.
    fireEvent.keyDown(name, { key: 'b' });
    expect(s().burst).toBeNull();
    const before = s().points;
    act(() => {
      fireEvent.keyDown(window, { key: 'b' });
    });
    expect(s().burst).toMatchObject({ label: 'grin' });
    await run(500);
    expect(document.querySelector('[data-faces-burst="on"]')?.textContent).toContain('named "grin"');
    act(() => {
      fireEvent.keyUp(window, { key: 'b' });
    });
    expect(s().burst).toBeNull();
    expect(s().points).toBe(before + 1);
    // The button, held.
    act(() => {
      fireEvent.pointerDown(button('Hold to record a burst')!);
    });
    expect(s().burst).not.toBeNull();
    await run(400);
    act(() => {
      fireEvent.pointerUp(button('let go to keep it')!);
    });
    expect(s().burst).toBeNull();
    expect(s().points).toBe(before + 2);
    act(() => s().reset());
  });
});

describe("an open categorizer's checks", () => {
  function opened() {
    const store = createFaceSessionStore(deps());
    expect(store.getState().importFile(exportCategorizer(scriptedCarve()))).toBe(true);
    let frame = 0;
    const test = createFaceTestStore({
      source: () => ({ kind: 'synthetic', read: () => ({ vector: syntheticExpressionVector('rest', frame++), t: clock }), video: () => null, dispose: () => {} }),
      claim: () => undefined,
      now: () => clock,
      pollMs: 33,
      publishMs: 100,
    });
    render(<FaceSessionView store={store} test={test} />);
    return { store, test, s: () => store.getState() };
  }

  it('Quiz me and the everyday check start and stop; a size per category writes the tuning', async () => {
    vi.useFakeTimers();
    const { s, test } = opened();
    act(() => {
      fireEvent.click(button('Quiz me')!);
    });
    expect(test.getState().running).toBe(true);
    await run(200);
    expect(document.querySelector('[data-faces-quiz="relax"]')?.textContent).toContain('Relax...');
    act(() => {
      fireEvent.click(button('Stop the quiz')!);
    });
    expect(document.querySelector('[data-faces-quiz]')).toBeNull();
    act(() => {
      fireEvent.click(button('Everyday check')!);
    });
    await run(1100);
    expect(document.querySelector('[data-faces-everyday="running"]')?.textContent).toContain('1 s of 60 s');
    act(() => {
      fireEvent.click(button('Stop the check')!);
    });
    expect(document.querySelector('[data-faces-everyday]')).toBeNull();
    const sizes = document.querySelectorAll('[data-faces-sizes] input[type="range"]');
    expect(sizes).toHaveLength(s().working!.categories.length);
    act(() => {
      fireEvent.change(document.querySelector('input[aria-label="Size of surprise"]')!, { target: { value: '1.5' } });
    });
    expect(s().tuning.sizes).toEqual({ 'cat-3': { scale: 1.5, label: 'surprise' } });
    act(() => test.getState().stop());
  });

  it('a quiz miss offers "Merge X into Neutral" (#444): the category goes, its holds pinned in Neutral; undo brings it back', () => {
    const { s, test } = opened();
    const [smile, other] = s().working!.categories;
    act(() => {
      s().setChecks({ quiz: { at: 'now', categories: { [smile.id]: { label: smile.label, asked: 2, hits: 0, slow: 0, misses: 2, medianTimeMs: null, confusedWith: null }, [other.id]: { label: other.label, asked: 2, hits: 2, slow: 0, misses: 0, medianTimeMs: 400, confusedWith: null } } } });
      test.setState({ quiz: { step: { kind: 'done', total: 4 }, trials: [] } });
    });
    expect(document.querySelector(`[data-faces-quiz-result="${other.id}"]`)).not.toBeNull();
    expect(document.querySelector(`[data-faces-quiz-neutral="${other.id}"]`)).toBeNull();
    const merge = document.querySelector(`[data-faces-quiz-neutral="${smile.id}"]`) as HTMLButtonElement;
    expect(merge.textContent).toBe(`Merge ${smile.label} into Neutral`);
    const taught = s().working!.neutralTrained === true || s().working!.strangers === 'neutral';
    expect(merge.title.includes('Neutral is not taught')).toBe(!taught);
    act(() => {
      fireEvent.click(merge);
    });
    const w = s().working!;
    expect(w.categories.map((c) => c.id)).not.toContain(smile.id);
    for (const id of smile.members) {
      expect(w.neutral).toContain(id);
      expect(w.pins?.[id]).toBe('neutral');
    }
    expect(document.querySelector(`[data-faces-quiz-result="${smile.id}"]`)).toBeNull();
    act(() => s().undo());
    expect(s().working!.categories.map((c) => c.id)).toContain(smile.id);
  });

  it('a kept quiz result shows beside the chip, and not once the category is renamed', () => {
    const { s } = opened();
    act(() =>
      s().setChecks({
        quiz: { at: 'now', categories: { 'cat-1': { label: 'smile', asked: 2, hits: 1, slow: 0, misses: 1, medianTimeMs: 500, confusedWith: 'cat-2' } } },
        everyday: { at: 'now', durationMs: 60_000, fires: { 'cat-3': 4 }, labels: { 'cat-3': 'surprise' } },
      }),
    );
    expect(document.querySelector('[data-face-checks="cat-1"]')?.textContent).toBe('found 1 of 2');
    expect(document.querySelector('[data-face-checks="cat-3"]')?.textContent).toBe('fired 4x');
    act(() => s().rename('cat-1', 'grin'));
    expect(document.querySelector('[data-face-checks="cat-1"]')).toBeNull();
  });
});
