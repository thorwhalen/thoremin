// @vitest-environment jsdom
/**
 * Pinned feature bars (#402; design C.4.1, C.3.1): a pinned feature always shows in the live
 * bars, above the chosen ones. The pins store (per modality, per device: a `DataProvider`, so a
 * fresh store over the same provider reads them back), the bars model's `choices`, and the panel:
 * Tools -> Your faces -> "Record my faces" opens Explore, where each bar has a pin and "Pin a
 * feature" offers the features not shown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createInMemoryProvider } from '@zodal/store';
import { createFaceSessionStore, type FaceSessionDeps } from '@thoremin/ext-faces/app/sessionStore';
import { createFaceModelStore, type FaceModelRecord } from '@thoremin/ext-faces/app/models';
import { memoryThumbStore } from '@thoremin/ext-faces/app/thumbnails';
import { syntheticSource } from '@thoremin/ext-faces/app/sources';
import { faceTestStore } from '@thoremin/ext-faces/app/faceSession';
import { FaceSessionView } from '@thoremin/ext-faces/panels/FaceSessionPanel';
import { BAR_PINS_DEFAULTS, BAR_PINS_STORAGE_KEY, createBarPinsStore, pinsOf, useBarPins, type BarPins } from '@thoremin/sdk-ui/enroll/barPins';
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
    isoNow: () => '2026-10-14T00:00:00.000Z',
  };
}

async function run(ms: number) {
  for (let t = 0; t < ms; t += 33) {
    clock += 33;
    await act(() => vi.advanceTimersByTimeAsync(33));
  }
}

beforeEach(() => {
  clock = 1000;
  localStorage.clear();
  useBarPins.setState({ pins: {} });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the pins store', () => {
  it('keeps pins per modality, deduplicated and capped, and a fresh store reads them back', async () => {
    const provider = createInMemoryProvider<BarPins>([], { idField: 'id' });
    const a = createBarPinsStore(provider);
    a.getState().setPinned('face', ['x', 'y', 'x']);
    a.getState().setPinned('hand', Array.from({ length: 20 }, (_, i) => `h${i}`));
    expect(pinsOf(a.getState(), 'face')).toEqual(['x', 'y']);
    expect(pinsOf(a.getState(), 'hand')).toHaveLength(BAR_PINS_DEFAULTS.max);
    expect(pinsOf(a.getState(), 'body')).toEqual([]);
    expect(pinsOf(a.getState(), 'body')).toBe(pinsOf(a.getState(), 'pose')); // a stable empty selector

    await vi.waitFor(async () => expect((await provider.getList({})).data).toHaveLength(2));
    const b = createBarPinsStore(provider);
    b.getState().setPinned('body', ['z']); // set before the read resolves: it wins
    await b.getState().hydrate();
    expect(b.getState().pins).toEqual({ face: ['x', 'y'], hand: pinsOf(a.getState(), 'hand'), body: ['z'] });
  });
});

describe('pinned bars in Explore', () => {
  it('pins a shown bar and a feature not shown; both stay first, and are saved for the modality', async () => {
    vi.useFakeTimers();
    const store = createFaceSessionStore(deps());
    store.getState().explore();
    await run(1500);
    const pinnedNow = () => pinsOf(useBarPins.getState(), 'face');

    // The snapshot's choices hold every feature a bar may show, more than are shown.
    const live = store.getState().live({ count: 6 })!;
    expect(live.choices.length).toBeGreaterThan(live.bars.length);

    render(<FaceSessionView store={store} test={faceTestStore()} />);
    await run(200);
    const rows = () => [...document.querySelectorAll('[data-feature-bar]')].map((el) => el.getAttribute('data-feature-bar'));
    const last = rows().at(-1)!;
    const lastLabel = live.choices.find((c) => c.id === last)!.label;

    // Click 3 from a cold load (Tools, Your faces, Record my faces, then this pin).
    fireEvent.click(screen.getByRole('button', { name: `Pin ${lastLabel}` }));
    expect(pinnedNow()).toEqual([last]);
    await run(200);
    expect(rows()[0]).toBe(last);
    expect(document.querySelector(`[data-feature-bar="${last}"]`)!.getAttribute('data-feature-bar-pinned')).toBe('true');

    // A feature not shown, through "Pin a feature".
    const picker = screen.getByRole('combobox', { name: 'Pin a feature' }) as HTMLSelectElement;
    const hidden = [...picker.options].map((o) => o.value).find((v) => v !== '' && !rows().includes(v))!;
    fireEvent.change(picker, { target: { value: hidden } });
    expect(pinnedNow()).toEqual([last, hidden]);
    await run(200);
    expect(rows().slice(0, 2)).toEqual([last, hidden]);

    // Saved per modality on this device.
    await vi.waitFor(() => expect(localStorage.getItem(BAR_PINS_STORAGE_KEY) ?? '').toContain(hidden));

    // Unpin: the feature is no longer held first.
    fireEvent.click(screen.getByRole('button', { name: `Unpin ${lastLabel}` }));
    expect(pinnedNow()).toEqual([hidden]);
    await run(200);
    expect(rows()[0]).toBe(hidden);
    store.getState().cancelRecording();
  });
});
