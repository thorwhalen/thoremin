/**
 * The burned-in tag HUD overlay element (#92) — drives the `canvas-overlay` node with
 * a fake recording 2D context and asserts it paints the open tags + timecode ONLY
 * while a take is recording (the `tagOverlay` resource returns a snapshot), and is a
 * silent no-op otherwise (the common case, so it must cost nothing).
 */
import { describe, it, expect } from 'vitest';
import type { NodeContext } from '@/dag';
import { canvasOverlayNode, OVERLAY_ELEMENTS } from '@/nodes/output/canvas_overlay';
import type { TagOverlaySnapshot } from '@/taglog/presentation';

interface Call {
  m: string;
  args: unknown[];
}
function makeCanvas(width = 1280, height = 720) {
  const calls: Call[] = [];
  const ctx: Record<string, unknown> = { globalAlpha: 1, fillStyle: '', font: '', textBaseline: '', textAlign: '' };
  const rec = (m: string) => (...args: unknown[]) => void calls.push({ m, args });
  for (const m of ['clearRect', 'save', 'restore', 'beginPath', 'arc', 'fill', 'stroke', 'moveTo', 'lineTo', 'drawImage', 'fillText', 'setLineDash', 'scale', 'translate', 'rotate', 'fillRect']) {
    ctx[m] = rec(m);
  }
  const canvas = { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, calls, texts: () => calls.filter((c) => c.m === 'fillText').map((c) => c.args[0] as string) };
}

/** Every element off except tagHud, so only its draws show up. */
const onlyTagHud = Object.fromEntries(OVERLAY_ELEMENTS.map((e) => [e.name, { show: e.name === 'tagHud' }]));

function run(snapshot: TagOverlaySnapshot | null, time: number, position?: 'left' | 'right') {
  const rc = makeCanvas();
  const params = { ...onlyTagHud, tagHud: { show: true, ...(position ? { position } : {}) } };
  const handlers = canvasOverlayNode.make(canvasOverlayNode.params.parse(params));
  const ctx: NodeContext = {
    tick: 0,
    time,
    dt: 0,
    resources: { canvas: rc.canvas, tagOverlay: () => snapshot },
  };
  handlers.process({}, ctx);
  return rc;
}

const snap: TagOverlaySnapshot = { t0: 0, open: [{ tag: 'a', label: 'Pluck', color: '#34d399' }] };

describe('tagHud burned-in overlay (#92)', () => {
  it('draws a box + REC timecode header + a chip per open tag while recording', () => {
    const rc = run(snap, 3.5);
    expect(rc.calls.filter((c) => c.m === 'fillRect').length).toBeGreaterThanOrEqual(1); // box
    const texts = rc.texts();
    expect(texts).toContain('REC 00:00:03.500'); // media timecode from ctx.time - t0
    expect(texts).toContain('Pluck'); // the open tag's label
    expect(rc.calls.some((c) => c.m === 'arc')).toBe(true); // the blink dots
  });

  it('draws nothing when not recording (tagOverlay resource returns null)', () => {
    const rc = run(null, 10);
    expect(rc.calls.some((c) => c.m === 'fillRect')).toBe(false);
    expect(rc.texts()).toHaveLength(0);
  });

  it('draws nothing when toggled off even while recording', () => {
    const rc = makeCanvas();
    const handlers = canvasOverlayNode.make(
      canvasOverlayNode.params.parse({ ...onlyTagHud, tagHud: { show: false } }),
    );
    const ctx: NodeContext = { tick: 0, time: 2, dt: 0, resources: { canvas: rc.canvas, tagOverlay: () => snap } };
    handlers.process({}, ctx);
    expect(rc.texts()).toHaveLength(0);
  });

  it('still shows the timecode header when no tags are open', () => {
    const rc = run({ t0: 0, open: [] }, 61);
    expect(rc.texts()).toEqual(['REC 00:01:01.000']);
  });

  it('anchors left vs right (x differs)', () => {
    const leftX = run(snap, 1, 'left').calls.find((c) => c.m === 'fillRect')!.args[0] as number;
    const rightX = run(snap, 1, 'right').calls.find((c) => c.m === 'fillRect')!.args[0] as number;
    expect(leftX).toBe(12);
    expect(rightX).toBeGreaterThan(12);
  });
});
