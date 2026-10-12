/**
 * The overlay's category cues (the ASL reader's display): the named class written large, a
 * bar per class with its label, and a second label (the chord) where the producer sends one.
 * Nothing is drawn without a reading, or when the cue is switched off.
 */
import { describe, expect, it } from 'vitest';
import type { NodeContext } from '@thoremin/dag';
import { canvasOverlayNode, OVERLAY_ELEMENTS } from '@/nodes/output/canvas_overlay';
import type { CategoryScores } from '@thoremin/sdk/nodes/domain';

interface Call {
  m: string;
  args: unknown[];
}
function makeCanvas(width = 1280, height = 720) {
  const calls: Call[] = [];
  const ctx: Record<string, unknown> = { globalAlpha: 1, fillStyle: '', font: '', textBaseline: '', textAlign: '', strokeStyle: '', lineWidth: 1 };
  const rec = (m: string) => (...args: unknown[]) => void calls.push({ m, args });
  for (const m of ['clearRect', 'save', 'restore', 'beginPath', 'arc', 'fill', 'stroke', 'moveTo', 'lineTo', 'drawImage', 'fillText', 'setLineDash', 'scale', 'translate', 'rotate', 'fillRect']) ctx[m] = rec(m);
  const canvas = { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, calls, texts: () => calls.filter((c) => c.m === 'fillText').map((c) => c.args[0] as string) };
}

const only = (names: string[], extra: Record<string, unknown> = {}) => ({
  ...Object.fromEntries(OVERLAY_ELEMENTS.map((e) => [e.name, { show: names.includes(e.name) }])),
  ...extra,
});

function run(categories: CategoryScores | null, captions: string[] | null = null, params = only(['categoryLabel', 'categoryBars'])) {
  const rc = makeCanvas();
  const handlers = canvasOverlayNode.make(canvasOverlayNode.params.parse(params));
  const ctx: NodeContext = { tick: 0, time: 1, dt: 0, resources: { canvas: rc.canvas } };
  handlers.process({ categories, categoryCaptions: captions }, ctx);
  return rc;
}

const reading: CategoryScores = { present: true, label: 'THANK', text: 'THANK YOU', labels: ['A', 'B', 'F', 'THANK'], scores: [0.05, 0.05, 0.1, 0.8], title: 'ASL' };

describe('the category cues', () => {
  it('write the named class large and label every bar', () => {
    const t = run(reading).texts();
    expect(t).toContain('THANK YOU');
    expect(t).toEqual(expect.arrayContaining(['A', 'B', 'F', 'THANK', 'ASL']));
  });

  it('draw the producer\'s captions under the bars', () => {
    expect(run(reading, ['D', 'Em', 'F#m', '']).texts()).toEqual(expect.arrayContaining(['F#m', 'Em']));
  });

  it('draw nothing without a reading, with no hand, or switched off', () => {
    expect(run(null).texts()).toEqual([]);
    expect(run({ ...reading, present: false }).texts()).toEqual([]);
    expect(run(reading, null, only([])).texts()).toEqual([]);
  });

  it('show the bars but no big label while nothing is named', () => {
    const t = run({ ...reading, label: null, text: undefined }).texts();
    expect(t).not.toContain('THANK YOU');
    expect(t).toContain('A');
  });
});
