/**
 * Overlay elements as a contribution point (#600 S5; `docs/design/vertical-slices.md` §5): an
 * extension declares an element (its inputs, category, cue-ness, config dial) and ships its
 * drawing code; the overlay grows one port per input and draws the element in the z-order and
 * the cue layout of the core ones. Drawn headlessly against the recording 2D context, the
 * pattern of `overlay_elements.test.ts`.
 *
 * The contract: an element sees ONLY its own inputs and the frame; it is not drawn (not even
 * called) when the composed element set leaves it out; a lazy extension's element whose code has
 * not loaded is simply skipped; and the core overlay (no contribution) has exactly the core ports.
 */
import { describe, expect, it, vi } from 'vitest';
import type { NodeContext } from '@thoremin/dag';
import type { OverlayElementImpl } from '@thoremin/sdk/instruments/extension';
import { canvasOverlayNode, makeCanvasOverlayNode, overlayElementOrder, OVERLAY_ELEMENTS, type ContributedElement } from '@/nodes/output/canvas_overlay';
import { makeRecordingCanvas } from './helpers/canvas';

const ctx = (rc: ReturnType<typeof makeRecordingCanvas>): NodeContext => ({ tick: 0, time: 0, dt: 0, resources: { canvas: rc.canvas, video: rc.video } });

function contributed(impl: OverlayElementImpl | undefined, over: Partial<ContributedElement['decl']> = {}): ContributedElement {
  const decl = { name: 'bar', category: 'output' as const, inputs: [{ name: 'level', kind: 'number' }], ...over };
  return { id: 'ext/bar', decl, ports: { level: 'ext.bar.level' }, kinds: { level: 'number' }, impl: () => impl };
}

/** Run one overlay tick with `inputs`, everything core turned off so only contributions draw. */
function tick(node: ReturnType<typeof makeCanvasOverlayNode>, inputs: Record<string, unknown>) {
  const rc = makeRecordingCanvas();
  const allOff = Object.fromEntries(OVERLAY_ELEMENTS.map((e) => [e.configKey ?? e.name, { show: false }]));
  const handlers = node.make(node.params.parse(allOff));
  handlers.process({ octaveShift: 0, ...inputs }, ctx(rc));
  return rc;
}

describe('a contributed overlay element', () => {
  it('grows one overlay port per input, of the declared kind; the core overlay has only core ports', () => {
    const node = makeCanvasOverlayNode([contributed({ name: 'bar', draw: () => undefined })]);
    const coreNames = canvasOverlayNode.inputs.map((p) => p.name);
    expect(node.inputs.map((p) => p.name)).toEqual([...coreNames, 'ext.bar.level']);
    expect(node.inputs.at(-1)?.kind).toBe('number');
    expect(coreNames.some((n) => n.includes('.'))).toBe(false);
  });

  it('draws with only its own inputs and the frame', () => {
    const seen: unknown[] = [];
    const impl: OverlayElementImpl = {
      name: 'bar',
      draw(g, frame, inputs) {
        seen.push({ frame, inputs });
        g.fillRect(0, 0, (inputs.level as number) * 10, 1);
      },
    };
    const rc = tick(makeCanvasOverlayNode([contributed(impl)]), { 'ext.bar.level': 0.5, chord: [60, 64, 67] });
    expect(seen).toEqual([{ frame: { W: 1280, H: 720, t: 0, origin: undefined, overlayOnly: false }, inputs: { level: 0.5 } }]);
    expect(rc.calls.filter((c) => c.m === 'fillRect').map((c) => c.args)).toContainEqual([0, 0, 5, 1]);
  });

  it('is not called at all when the composed element set leaves it out', () => {
    const impl: OverlayElementImpl = { name: 'bar', draw: vi.fn() };
    tick(makeCanvasOverlayNode([contributed(impl)]), { 'ext.bar.level': 1, elements: ['video'] });
    expect(impl.draw).not.toHaveBeenCalled();
    tick(makeCanvasOverlayNode([contributed(impl)]), { 'ext.bar.level': 1, elements: ['video', 'ext/bar'] });
    expect(impl.draw).toHaveBeenCalledTimes(1);
  });

  it('a lazy element whose code has not loaded is skipped, and the frame still draws', () => {
    const rc = tick(makeCanvasOverlayNode([contributed(undefined)]), { 'ext.bar.level': 1 });
    expect(rc.count('clearRect')).toBe(1);
  });

  it('a cue joins the shared layout: it gets an origin on its edge, and a cue with nothing to show gets none', () => {
    const origins: unknown[] = [];
    const cue: OverlayElementImpl = {
      name: 'bar',
      measure: (_f, inputs) => (inputs.level ? { w: 100, h: 30 } : null),
      positionOf: () => 'left',
      draw: (_g, frame) => void origins.push(frame.origin),
    };
    tick(makeCanvasOverlayNode([contributed(cue, { cue: true })]), { 'ext.bar.level': 1 });
    tick(makeCanvasOverlayNode([contributed(cue, { cue: true })]), { 'ext.bar.level': 0 });
    expect(origins[0]).toEqual({ x: 12, y: 68 });
    expect(origins[1]).toBeUndefined();
  });

  it('draws in z-order: an in-scene element above the core in-scene ones, a cue below the top HUDs', () => {
    const cueEl: ContributedElement = { id: 'ext/cue', decl: { name: 'cue', category: 'output', cue: true, inputs: [] }, ports: {}, kinds: {}, impl: () => undefined };
    const order = overlayElementOrder([contributed(undefined), cueEl]);
    const firstCoreCue = OVERLAY_ELEMENTS.find((e) => e.cue)!.name;
    expect(order.indexOf('ext/bar')).toBe(order.indexOf(firstCoreCue) - 1);
    expect(order.indexOf('ext/cue')).toBe(order.indexOf('tagHud') - 1);
    expect(order.at(-1)).toBe('fingerBars');
    expect(overlayElementOrder([])).toEqual(OVERLAY_ELEMENTS.map((e) => e.name));
  });

  it('a cue the composed set leaves out is never measured or placed either', () => {
    const cue: OverlayElementImpl = { name: 'bar', measure: vi.fn(() => ({ w: 1, h: 1 })), positionOf: vi.fn(() => 'left' as const), draw: vi.fn() };
    tick(makeCanvasOverlayNode([contributed(cue, { cue: true })]), { elements: ['video'] });
    expect(cue.measure).not.toHaveBeenCalled();
    expect(cue.positionOf).not.toHaveBeenCalled();
    expect(cue.draw).not.toHaveBeenCalled();
  });

  it('an element that throws is reported once and skipped; the others and the frame still draw', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const thrower: OverlayElementImpl = { name: 'bar', draw: vi.fn(() => { throw new Error('boom'); }) };
      const fine: OverlayElementImpl = { name: 'ok', draw: (g) => g.fillRect(1, 2, 3, 4) };
      const okEl: ContributedElement = { id: 'ext/ok', decl: { name: 'ok', category: 'output', inputs: [] }, ports: {}, kinds: {}, impl: () => fine };
      const node = makeCanvasOverlayNode([contributed(thrower), okEl]);
      const rc = makeRecordingCanvas();
      const handlers = node.make(node.params.parse({}));
      handlers.process({ octaveShift: 0 }, ctx(rc));
      handlers.process({ octaveShift: 0 }, ctx(rc));
      expect(thrower.draw).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledTimes(1);
      expect(rc.calls.filter((c) => c.m === 'fillRect' && c.args[0] === 1)).toHaveLength(2);
      expect(rc.count('drawImage')).toBe(2); // the video backdrop, both frames
      expect(rc.count('save')).toBe(rc.count('restore'));
    } finally {
      error.mockRestore();
    }
  });

  it('a cue whose measure throws does not stop the layout or the frame', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const cue: OverlayElementImpl = { name: 'bar', measure: () => { throw new Error('boom'); }, draw: vi.fn() };
      const node = makeCanvasOverlayNode([contributed(cue, { cue: true })]);
      const rc = makeRecordingCanvas();
      node.make(node.params.parse({})).process({ octaveShift: 0 }, ctx(rc));
      expect(rc.count('drawImage')).toBe(1);
      expect(cue.draw).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it('an element\'s memo belongs to one overlay instance: two instances from one node do not share it', () => {
    const seen: unknown[] = [];
    const impl: OverlayElementImpl = { name: 'bar', draw: (_g, _f, _i, memo) => { memo.n = ((memo.n as number) ?? 0) + 1; seen.push(memo.n); } };
    const node = makeCanvasOverlayNode([contributed(impl)]);
    const a = node.make(node.params.parse({}));
    const b = node.make(node.params.parse({}));
    const rc = makeRecordingCanvas();
    a.process({ octaveShift: 0 }, ctx(rc));
    a.process({ octaveShift: 0 }, ctx(rc));
    b.process({ octaveShift: 0 }, ctx(rc));
    expect(seen).toEqual([1, 2, 1]);
  });

  it('knows the overlay-only (alpha) pass: the frame says so there and only there', () => {
    const flags: unknown[] = [];
    const impl: OverlayElementImpl = { name: 'bar', draw: (_g, frame) => void flags.push(frame.overlayOnly) };
    const node = makeCanvasOverlayNode([contributed(impl)]);
    const rc = makeRecordingCanvas();
    const alpha = makeRecordingCanvas();
    node.make(node.params.parse({})).process({ octaveShift: 0 }, { ...ctx(rc), resources: { canvas: rc.canvas, video: rc.video, overlayAlphaCanvas: alpha.canvas } });
    expect(flags).toEqual([false, true]);
  });
});
