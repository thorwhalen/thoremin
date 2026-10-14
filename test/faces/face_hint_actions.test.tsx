// @vitest-environment jsdom
/**
 * #435 (design C.4.8): a CLOSE pair's hint offers, beside Merge, "Show me on the bars" (a take
 * whose bars show the hint's distinguishing features first with the two centres marked, paused
 * after the rest for a rehearsal) and "Record more" for the category (a take whose every hold goes
 * to it, pinned, so it stays there at every k). On the scripted carve, whose "open smile" is close
 * to "smile".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createInMemoryProvider } from '@zodal/store';
import { exportCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { placeOf, recutBounds } from '@thoremin/sdk/enroll/sorting';
import { scriptedCarve } from '../helpers/scripted_carve';
import { createFaceSessionStore, type FaceSessionDeps } from '@thoremin/ext-faces/app/sessionStore';
import { createFaceModelStore, type FaceModelRecord } from '@thoremin/ext-faces/app/models';
import { memoryThumbStore } from '@thoremin/ext-faces/app/thumbnails';
import { syntheticSource } from '@thoremin/ext-faces/app/sources';
import { SYNTHETIC_TIMELINE } from '@thoremin/ext-faces/lib/synthetic';
import { faceTestStore } from '@thoremin/ext-faces/app/faceSession';
import { FaceSessionView } from '@thoremin/ext-faces/panels/FaceSessionPanel';
import '@/app/dials/useDialsSettings';

let clock = 0;
function deps(): FaceSessionDeps {
  return {
    source: () => ({ ...syntheticSource(() => clock), video: () => null }),
    thumbs: memoryThumbStore(),
    frames: () => null,
    models: createFaceModelStore(createInMemoryProvider<FaceModelRecord>([], { idField: 'id', searchFields: ['name'] })),
    now: () => clock,
    pollMs: 33,
    claim: () => undefined,
    newTakeId: () => 'take-more',
    isoNow: () => '2026-10-14T00:00:00.000Z',
  };
}
async function run(ms: number) {
  for (let t = 0; t < ms; t += 33) {
    clock += 33;
    await act(() => vi.advanceTimersByTimeAsync(33));
  }
}
const button = (root: Element, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the hint offers Show me on the bars and Record more (#435)', () => {
  it('Record more "open smile": every hold of the take lands in "open smile", pinned, at every k', async () => {
    vi.useFakeTimers();
    const store = createFaceSessionStore(deps());
    const s = () => store.getState();
    expect(s().importFile(exportCategorizer(scriptedCarve()))).toBe(true);
    render(<FaceSessionView store={store} test={faceTestStore()} />);
    const base = new Set(s().working!.samples.map((x) => x.id));
    const hint = document.querySelector('[data-face-hint="cat-2"]')!;
    fireEvent.click(button(hint, 'Record more open smile'));
    expect(s().phase).toBe('rest');
    expect(s().holdsAs).toBe('open smile');
    expect(document.querySelector('[data-faces-merging]')?.textContent).toContain('every face you hold goes to "open smile"');
    await run(SYNTHETIC_TIMELINE.restMs + 4 * (SYNTHETIC_TIMELINE.holdMs + SYNTHETIC_TIMELINE.glideMs));
    await act(() => s().stop());
    const c = s().working!;
    const added = c.samples.filter((x) => !base.has(x.id)).map((x) => x.id);
    expect(added.length).toBeGreaterThan(1);
    const smile = c.categories.find((x) => x.label === 'open smile')!.id;
    for (const id of added) expect(c.pins?.[id]).toBe(smile);
    const { minK, maxK } = recutBounds(c);
    for (let k = minK; k <= Math.min(maxK, minK + 3); k++) {
      act(() => s().setK(k));
      const w = s().working!;
      const at = w.categories.find((x) => x.label === 'open smile')!.id;
      for (const id of added) expect(placeOf(w, id)).toBe(at);
    }
  });

  it('Show me on the bars: the hint\'s features first, the two centres marked, paused after the rest', async () => {
    vi.useFakeTimers();
    const store = createFaceSessionStore(deps());
    const s = () => store.getState();
    expect(s().importFile(exportCategorizer(scriptedCarve()))).toBe(true);
    render(<FaceSessionView store={store} test={faceTestStore()} />);
    const hintFeatures = s().view!.hints.get('cat-2')!.movements.map((m) => m.feature);
    expect(hintFeatures.length).toBeGreaterThan(0);
    fireEvent.click(button(document.querySelector('[data-face-hint="cat-2"]')!, 'Show me on the bars'));
    expect(s().focus?.features).toEqual([...new Set(hintFeatures)]);
    expect(s().focus?.marks.map((m) => m.label)).toEqual(['open smile', 'smile']);
    expect(s().holdsAs).toBe('open smile');
    await run(SYNTHETIC_TIMELINE.restMs + 1000);
    expect(s().phase).toBe('paused');
    const bars = s().live({ count: 4, pinned: [] })!;
    expect(bars.bars.slice(0, hintFeatures.length).map((b) => b.id)).toEqual([...new Set(hintFeatures)]);
    expect(bars.bars[0].marks?.map((m) => m.label)).toEqual(['open smile', 'smile']);
    // The panel draws them, and says what to do.
    await run(400);
    expect(document.querySelectorAll('[data-feature-bar-mark="open smile"]').length).toBeGreaterThan(0);
    expect(document.querySelector('[data-faces-focus]')?.textContent).toContain('Rehearse a bigger "open smile"');
    // Cancel returns to the carve, the focus gone.
    act(() => s().cancelRecording());
    expect(s().focus).toBeNull();
    expect(s().holdsAs).toBeNull();
  });

  it('Record more pins by category id: a category named like the Neutral bin keeps its holds (review)', async () => {
    vi.useFakeTimers();
    const store = createFaceSessionStore(deps());
    const s = () => store.getState();
    expect(s().importFile(exportCategorizer(scriptedCarve()))).toBe(true);
    act(() => s().rename('cat-2', 'Neutral'));
    expect(s().working!.categories.find((c) => c.id === 'cat-2')!.label).toBe('Neutral');
    const base = new Set(s().working!.samples.map((x) => x.id));
    expect(s().recordMore('cat-2')).toBe(true);
    await run(SYNTHETIC_TIMELINE.restMs + 3 * (SYNTHETIC_TIMELINE.holdMs + SYNTHETIC_TIMELINE.glideMs));
    await act(() => s().stop());
    const c = s().working!;
    const added = c.samples.filter((x) => !base.has(x.id)).map((x) => x.id);
    expect(added.length).toBeGreaterThan(0);
    for (const id of added) expect(placeOf(c, id)).toBe('cat-2');
  });

  it('a Show-me take cancelled during its rest leaves no pause behind for the next take (review)', async () => {
    vi.useFakeTimers();
    const store = createFaceSessionStore(deps());
    const s = () => store.getState();
    expect(s().importFile(exportCategorizer(scriptedCarve()))).toBe(true);
    expect(s().showOnBars('cat-2')).toBe(true);
    await run(500);
    act(() => s().cancelRecording());
    act(() => s().reset());
    act(() => s().start());
    await run(SYNTHETIC_TIMELINE.restMs + 1000);
    expect(s().phase).toBe('faces');
    expect(s().focus).toBeNull();
  });
});
