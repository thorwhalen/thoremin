// @vitest-environment jsdom
/**
 * The map of the holds in Sorting (#434, design C.3.2), rendered on its own: too few holds says
 * so; otherwise every hold is a dot coloured by its category (Neutral and the unplaced drawn
 * apart, a selected hold larger and white), the camera's live reading is a red ring that follows
 * it and goes when it goes, a dragged box selects the holds inside it (in data units, whatever
 * size the canvas is shown at), a click without a drag clears the selection, and the caption
 * says which projection it drew. The canvas is a recording 2D context (jsdom has none).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PersonalCategorizerSchema, CATEGORIZER_FORMAT, CATEGORIZER_VERSION, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { faceModality } from '@thoremin/sdk/features/modalities/face';
import type { FaceSessionState } from '@thoremin/ext-faces/app/sessionStore';

const live = vi.hoisted(() => ({ value: null as null | { vector: Record<string, number>; t: number } }));
vi.mock('@thoremin/sdk-ui/enroll/liveVector', async (orig) => ({
  ...(await orig<object>()),
  readLiveVector: () => live.value,
}));
// Not a package export (only Sorting renders it): imported from its source, as other tests do.
import { SortingMap } from '../../packages/ext-faces/src/panels/SortingMap';

const FEATURES = ['face.a', 'face.b'];

/** Holds at known places: three categories in three corners, a neutral pair, one set aside (drawn as unplaced). */
function categorizer(): PersonalCategorizer {
  const at = (id: string, a: number, b: number) => ({ id, vector: { 'face.a': a, 'face.b': b }, t: 0, cue: 'c' });
  const samples = [
    at('h1', 0, 0),
    at('h2', 0.1, 0.1),
    at('h3', 10, 0),
    at('h4', 10.1, 0.1),
    at('h5', 0, 10),
    at('h6', 0.1, 10.1),
    at('n1', 5, 5),
    at('n2', 5.1, 5.1),
    at('u1', 5, 0),
  ];
  return PersonalCategorizerSchema.parse({
    format: CATEGORIZER_FORMAT,
    version: CATEGORIZER_VERSION,
    name: 'map',
    features: FEATURES,
    weights: { 'face.a': 1, 'face.b': 1 },
    strangers: 'nearest',
    samples,
    categories: [
      { id: 'c1', label: 'one', members: ['h1', 'h2'] },
      { id: 'c2', label: 'two', members: ['h3', 'h4'] },
      { id: 'c3', label: 'three', members: ['h5', 'h6'] },
    ],
    neutral: ['n1', 'n2'],
    aside: ['u1'],
  });
}

const state = (working: PersonalCategorizer | null) => ({ working, modality: faceModality }) as unknown as FaceSessionState;

let calls: [string, ...unknown[]][];
beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, p: string) => (p in t ? t[p] : (...a: unknown[]) => void calls.push([p, ...a])),
    set: (t, p: string, v) => {
      t[p] = v;
      calls.push([`set:${p}`, v]);
      return true;
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
  // Shown at twice the backing size: pointer positions are scaled back.
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 680, height: 440 } as DOMRect);
  live.value = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const dots = () => calls.filter((c) => c[0] === 'arc' && (c[3] === 3.5 || c[3] === 5));
const fills = () => calls.filter((c) => c[0] === 'set:fillStyle').map((c) => c[1]).slice(1); // past the backdrop

describe('the map of the holds', () => {
  it('says there are not enough holds when there is no carve', () => {
    render(<SortingMap s={state(null)} selected={new Set()} onSelect={() => {}} />);
    expect(screen.getByText(/Not enough holds to draw a map yet/)).toBeTruthy();
  });

  it('draws a dot per hold, coloured by category, Neutral and the unplaced apart', () => {
    render(<SortingMap s={state(categorizer())} selected={new Set()} onSelect={() => {}} />);
    expect(dots()).toHaveLength(9);
    const f = fills();
    expect(f[0]).toBe(f[1]); // one category, one colour
    expect(new Set([f[0], f[2], f[4]]).size).toBe(3);
    expect(f[6]).toBe('rgba(255,255,255,0.45)'); // neutral
    expect(f[8]).toBe('rgba(255,255,255,0.2)'); // unplaced
    expect(screen.getByText(/The two directions that best pull your categories apart/)).toBeTruthy();
  });

  it('draws a selected hold larger and white', () => {
    render(<SortingMap s={state(categorizer())} selected={new Set(['h3'])} onSelect={() => {}} />);
    expect(dots().filter((c) => c[3] === 5)).toHaveLength(1);
    expect(fills()).toContain('#ffffff');
  });

  it('a red ring follows what the camera sees, and goes when it goes', () => {
    render(<SortingMap s={state(categorizer())} selected={new Set()} onSelect={() => {}} />);
    const rings = () => calls.filter((c) => c[0] === 'arc' && c[3] === 7);
    expect(rings()).toHaveLength(0);
    live.value = { vector: { 'face.a': 10, 'face.b': 0 }, t: 0 };
    act(() => void vi.advanceTimersByTime(100));
    expect(rings()).toHaveLength(1);
    expect(calls).toContainEqual(['set:strokeStyle', '#f43f5e']);
    calls.length = 0;
    live.value = null;
    act(() => void vi.advanceTimersByTime(100));
    expect(rings()).toHaveLength(0);
  });

  it('a dragged box selects the holds inside it, at the size the canvas is shown', () => {
    const onSelect = vi.fn();
    render(<SortingMap s={state(categorizer())} selected={new Set()} onSelect={onSelect} />);
    const canvas = screen.getByLabelText(/Map of your holds/);
    // Find where hold h3 (and its neighbour h4) were drawn, in backing pixels.
    const at = dots().map((c) => [c[1], c[2]] as [number, number]);
    const [x3, y3] = at[2];
    const [x4, y4] = at[3];
    const lo = [Math.min(x3, x4) - 3, Math.min(y3, y4) - 3];
    const hi = [Math.max(x3, x4) + 3, Math.max(y3, y4) + 3];
    fireEvent.pointerDown(canvas, { clientX: lo[0] * 2, clientY: lo[1] * 2 });
    fireEvent.pointerMove(canvas, { clientX: hi[0] * 2, clientY: hi[1] * 2 });
    expect(calls.some((c) => c[0] === 'strokeRect')).toBe(true);
    fireEvent.pointerUp(canvas);
    expect(onSelect).toHaveBeenCalledOnce();
    expect([...onSelect.mock.calls[0][0]].sort()).toEqual(['h3', 'h4']);
  });

  it('a click without a drag clears the selection; leaving without a press does nothing', () => {
    const onSelect = vi.fn();
    render(<SortingMap s={state(categorizer())} selected={new Set(['h1'])} onSelect={onSelect} />);
    const canvas = screen.getByLabelText(/Map of your holds/);
    fireEvent.pointerLeave(canvas);
    fireEvent.pointerMove(canvas, { clientX: 10, clientY: 10 });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100 });
    fireEvent.pointerLeave(canvas);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect.mock.calls[0][0].size).toBe(0);
  });

  it('with too few categories it says it drew the directions the holds vary most', () => {
    const c = categorizer();
    const one = { ...c, categories: [{ ...c.categories[0], members: c.samples.map((x) => x.id) }], neutral: [], aside: [] };
    render(<SortingMap s={state(one)} selected={new Set()} onSelect={() => {}} />);
    expect(screen.getByText(/Too few categories to pull apart/)).toBeTruthy();
  });
});
