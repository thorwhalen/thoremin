/**
 * Feature Lab overlay element (#119) drawn headlessly against the shared recording 2D
 * context (`../helpers/canvas`): since #600 S16b it is the Lab slice's contributed element, whose
 * `update` hands the incoming face/hand vectors to the lab-meter computer (which owns the normalizer
 * — unit-tested in lab_meters.test.ts) once per tick and whose `draw` RENDERS the grouped meters.
 * We assert it is opt-in, that it draws a titled panel with per-feature bars + labels once warmed,
 * and that the live config (its `lab` input, a derived port of the Lab's pref) drives show/groups.
 */
import { describe, it, expect } from 'vitest';
import { labMeters } from '@/slices/lab/nodes/meters';
import { FeatureLabSchema } from '@/slices/lab/schema';
import { makeRecordingCanvas } from '../helpers/canvas';
import { LAB } from '../helpers/extensions';

/** Run the element `ticks` times, feeding a slightly different jaw-open value each tick so the
 *  normalizer warms up, and return the LAST tick's recording. (Was: the overlay node with the Lab
 *  config among its params; the element now reads it as its `lab` input.) */
function runLab(params: { featureLab?: unknown }, ticks: number) {
  const lab = FeatureLabSchema.parse(params.featureLab ?? {});
  const memo: Record<string, unknown> = {};
  let rc = makeRecordingCanvas();
  for (let i = 0; i < ticks; i++) {
    rc = makeRecordingCanvas();
    const g = rc.canvas.getContext('2d') as CanvasRenderingContext2D;
    const frame = { W: rc.canvas.width, H: rc.canvas.height, t: i / 30 };
    const face = { 'face.blendshape.jaw.open': (i % 10) / 10, 'face.blendshape.jaw.left': 0.2 };
    const inputs = { lab, face };
    labMeters.update!(frame, inputs, memo);
    labMeters.draw(g, frame, inputs, memo);
  }
  return rc;
}

describe.runIf(LAB)('featureLab overlay element (#119)', () => {
  it('is opt-in: nothing drawn when show is false (the default)', () => {
    const rc = runLab({}, 5);
    expect(rc.texts()).not.toContain('Feature Lab');
    expect(FeatureLabSchema.parse(undefined).show).toBe(false);
  });

  it('tells the player how to turn it off, in the panel they are looking at', () => {
    // The meters keep drawing after the Lab panel is closed, and their off switch is
    // inside that panel — which is how this became a panel players could not get rid
    // of. The tools bar carries the real control (tools_shell.test.tsx); this line is
    // the signpost to it, drawn at the thing covering their video.
    const rc = runLab({ featureLab: { show: true, columns: 3, groups: ['face.blendshape.jaw'] } }, 40);
    expect(rc.texts()).toContain('stop in the Tools bar');
  });

  it('drops the hint rather than overlapping the title on a one-column panel', () => {
    const rc = runLab({ featureLab: { show: true, columns: 1, groups: ['face.blendshape.jaw'] } }, 40);
    expect(rc.texts()).toContain('Feature Lab'); // still titled
    expect(rc.texts()).not.toContain('stop in the Tools bar');
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

/**
 * The rolling correlation matrix element (#150) — the DISPLAY half. The statistics are
 * unit-tested in lab_correlation.test.ts / lab_meters.test.ts; what matters here is that
 * they reach a canvas, that the element is genuinely opt-in, and that it says how much
 * evidence it has rather than presenting a three-frame coefficient like a measurement.
 */
describe.runIf(LAB)('featureCorrelation overlay element (#150)', () => {
  const shown = (over: Record<string, unknown> = {}) => ({
    featureLab: { show: true, groups: ['face.blendshape.jaw'], showCorrelation: true, ...over },
  });

  it('is opt-in twice over: off by default, and silent while the Lab itself is closed', () => {
    expect(FeatureLabSchema.parse(undefined).showCorrelation).toBe(false);
    expect(runLab({}, 20).texts()).not.toContain('Correlation');

    // Meters ON, correlation OFF — the case the other two miss, since they both have the
    // meters closed. This asserts the END-TO-END behaviour; the gate it actually exercises
    // is the COMPUTE one (labMeters does not populate `correlation` unless asked, which is
    // what makes the quadratic work genuinely free when off — pinned in lab_meters.test.ts
    // and mutation-verified there). The element's own flag check is a redundant second
    // gate, and this test would pass without it.
    const corrOff = runLab({ featureLab: { show: true, groups: ['face.blendshape.jaw'], showCorrelation: false } }, 40);
    expect(corrOff.texts()).toContain('Feature Lab'); // the meters ARE drawn…
    expect(corrOff.texts()).not.toContain('Correlation'); // …and the matrix is not.

    // Meters closed but the correlation flag on: still nothing — the matrix is a view OF
    // the watched features, so it cannot outlive the thing that decides what is watched.
    const labClosed = runLab({ featureLab: { show: false, showCorrelation: true } }, 20);
    expect(labClosed.texts()).not.toContain('Correlation');
  });

  it('draws a titled heat grid once shown', () => {
    const rc = runLab(shown(), 40);
    expect(rc.texts()).toContain('Correlation');
    // One cell per pair, plus the panel backdrop.
    expect(rc.count('fillRect')).toBeGreaterThan(1);
    // Row labels name the features being compared.
    expect(rc.texts().some((t) => t === 'open' || t === 'left')).toBe(true);
  });

  it('states its sample count — an r from a handful of frames is not evidence', () => {
    // The grid looks identical whether it has 5 samples or 5000, which invites reading
    // noise as structure. The frame count is what distinguishes them.
    const rc = runLab(shown(), 40);
    expect(rc.texts().some((t) => /^\d+f$/.test(t))).toBe(true);
  });

  it('says so when the cap dropped features, rather than quietly showing a subset', () => {
    // Four jaw blendshapes in view, capped at 2 → two dropped. `runLab`'s fixture supplies
    // only two, so this one drives the element directly with the fuller vector.
    const lab = FeatureLabSchema.parse(shown({ correlationMaxFeatures: 2 }).featureLab);
    const memo: Record<string, unknown> = {};
    let rc = makeRecordingCanvas();
    for (let i = 0; i < 40; i++) {
      rc = makeRecordingCanvas();
      const v = (i % 10) / 10;
      const face = {
        'face.blendshape.jaw.open': v,
        'face.blendshape.jaw.left': v,
        'face.blendshape.jaw.right': 1 - v,
        'face.blendshape.jaw.forward': 0.3,
      };
      const frame = { W: rc.canvas.width, H: rc.canvas.height, t: i / 30 };
      labMeters.update!(frame, { lab, face }, memo);
      labMeters.draw(rc.canvas.getContext('2d') as CanvasRenderingContext2D, frame, { lab, face }, memo);
    }
    expect(rc.texts().some((t) => t.includes('not shown'))).toBe(true);
  });
});
