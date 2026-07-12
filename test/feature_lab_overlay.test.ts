/**
 * Feature Lab overlay element (#119) drawn headlessly against the shared recording 2D
 * context (`./helpers/canvas`): the node hands the incoming face/hand vectors to the
 * lab-meter computer (which owns the normalizer — unit-tested in lab_meters.test.ts)
 * and the featureLab element RENDERS the grouped meters. We assert it is opt-in, that
 * it draws a titled panel with per-feature bars + labels once warmed, and that the live
 * overlayConfig drives show/groups.
 */
import { describe, it, expect } from 'vitest';
import type { NodeContext } from '@/dag';
import { canvasOverlayNode } from '@/nodes/output/canvas_overlay';
import { makeRecordingCanvas } from './helpers/canvas';

/** Run the overlay node `ticks` times, feeding a slightly different jaw-open value
 *  each tick so the normalizer warms up, and return the LAST tick's recording. */
function runLab(params: unknown, ticks: number, extraInputs: Record<string, unknown> = {}) {
  const handlers = canvasOverlayNode.make(canvasOverlayNode.params.parse(params));
  let rc = makeRecordingCanvas();
  for (let i = 0; i < ticks; i++) {
    rc = makeRecordingCanvas();
    const ctx: NodeContext = { tick: i, time: i / 30, dt: 1 / 30, resources: { canvas: rc.canvas } };
    const faceVector = { 'face.blendshape.jaw.open': (i % 10) / 10, 'face.blendshape.jaw.left': 0.2 };
    handlers.process({ faceVector, ...extraInputs }, ctx);
  }
  return rc;
}

describe('featureLab overlay element (#119)', () => {
  it('is opt-in: nothing drawn when show is false (the default)', () => {
    const rc = runLab({}, 5);
    expect(rc.texts()).not.toContain('Feature Lab');
    const parsed = canvasOverlayNode.params.parse({}) as { featureLab: { show: boolean } };
    expect(parsed.featureLab.show).toBe(false);
  });

  it('draws a titled panel with grouped bars + labels once shown and warmed', () => {
    const rc = runLab({ featureLab: { show: true, groups: ['face.blendshape.jaw'] } }, 40);
    const texts = rc.texts();
    expect(texts).toContain('Feature Lab'); // panel title
    expect(texts.some((t) => t.includes('Jaw'))).toBe(true); // group header
    expect(texts.some((t) => t === 'open' || t === 'left')).toBe(true); // per-feature label
    expect(rc.count('fillRect')).toBeGreaterThan(1); // backdrop + meter track(s) + fill(s)
    // Percentile ticks are drawn as short strokes once the band is warm.
    expect(rc.count('stroke')).toBeGreaterThan(0);
  });

  it('only draws features whose group is enabled', () => {
    // Enable a group NOT present in the fed vector → the panel has no meters.
    const rc = runLab({ featureLab: { show: true, groups: ['face.blendshape.brow'] } }, 20);
    const texts = rc.texts();
    // Title still drawn (panel present) but no jaw feature/label leaks through.
    expect(texts).toContain('Feature Lab');
    expect(texts.some((t) => t === 'open')).toBe(false);
  });

  it('showValues prints the raw value beside a meter', () => {
    const rc = runLab({ featureLab: { show: true, groups: ['face.blendshape.jaw'], showValues: true } }, 30);
    // Some label is a 2-dp number (e.g. "0.20" for jaw.left held constant).
    expect(rc.texts().some((t) => /^\d\.\d\d$/.test(t))).toBe(true);
  });

  it('derived (formula) features are computed over the merged vector and shown', () => {
    const rc = runLab(
      {
        featureLab: {
          show: true,
          groups: ['face.blendshape.jaw', 'derived'],
          derived: [{ id: 'jawDoubled', formula: 'face_blendshape_jaw_open * 2' }],
        },
      },
      40,
    );
    const texts = rc.texts();
    expect(texts.some((t) => t.includes('Derived'))).toBe(true); // derived group header
    expect(texts).toContain('jawDoubled'); // the derived feature label
  });

  it('an invalid / unsafe derived formula is skipped without crashing', () => {
    // A member-access formula (the RCE class) must not produce a feature or throw.
    expect(() =>
      runLab(
        {
          featureLab: {
            show: true,
            groups: ['face.blendshape.jaw', 'derived'],
            derived: [
              { id: 'evil', formula: 'face_blendshape_jaw_open.constructor' },
              { id: 'typo', formula: 'not_a_feature + 1' },
            ],
          },
        },
        10,
      ),
    ).not.toThrow();
    const rc = runLab(
      {
        featureLab: {
          show: true,
          groups: ['face.blendshape.jaw', 'derived'],
          derived: [{ id: 'evil', formula: 'face_blendshape_jaw_open.constructor' }],
        },
      },
      10,
    );
    expect(rc.texts()).not.toContain('evil'); // the unsafe formula produced nothing
  });
});
