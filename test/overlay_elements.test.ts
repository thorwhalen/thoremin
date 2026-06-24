/**
 * Drives the `canvas-overlay` node with a recording 2D context and asserts that
 * each composable overlay element is independently toggled/parameterized by its
 * own params sub-object — the contract behind the per-overlay settings panel.
 *
 * Uses a fake canvas/context (the test runtime is Node, no DOM) that records
 * every draw call (and the live `globalAlpha` at call time), so we can assert
 * which primitives an element drew without rendering pixels.
 */
import { describe, it, expect } from 'vitest';
import { Engine } from '@/dag';
import type { NodeContext } from '@/dag';
import { createAppRegistry } from '@/nodes/browser';
import { defaultGraph } from '@/app/graph';
import { canvasOverlayNode, OVERLAY_ELEMENTS } from '@/nodes/output/canvas_overlay';
import {
  makeHandKeypoints,
  type HandFeatures,
  type HandsFrame,
  type SynthParams,
} from '@/nodes/domain';

interface Call {
  m: string;
  args: unknown[];
  alpha: number;
}

function makeRecordingCanvas(width = 1280, height = 720) {
  const calls: Call[] = [];
  // `ctx` is referenced by the recorders so they can snapshot live props.
  const ctx: Record<string, unknown> = {
    globalAlpha: 1,
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
  };
  const rec =
    (m: string) =>
    (...args: unknown[]) => {
      calls.push({ m, args, alpha: ctx.globalAlpha as number });
    };
  for (const m of [
    'clearRect', 'save', 'restore', 'beginPath', 'arc', 'fill', 'stroke',
    'moveTo', 'lineTo', 'drawImage', 'fillText', 'setLineDash', 'scale', 'translate',
  ]) {
    ctx[m] = rec(m);
  }
  const canvas = {
    width,
    height,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
  const video = { readyState: 2 } as unknown as HTMLVideoElement;
  return { canvas, video, calls, count: (m: string) => calls.filter((c) => c.m === m).length };
}

function fullInputs() {
  const frame: HandsFrame = {
    width: 640,
    height: 480,
    hands: [
      {
        handedness: 'Left', // displayed-right
        keypoints: makeHandKeypoints({ cx: 200, cy: 240, scale: 60, spread: 0.7, pinch: 0.2, handedness: 'Left' }),
        score: 1,
      },
      {
        handedness: 'Right', // displayed-left
        keypoints: makeHandKeypoints({ cx: 440, cy: 240, scale: 60, spread: 0.3, pinch: 0.8, handedness: 'Right' }),
        score: 1,
      },
    ],
  };
  const features: HandFeatures = {
    right: { present: true, x: 0.7, y: 0.4, openness: 0.6, pinch: 0.2 },
    left: { present: true, x: 0.3, y: 0.6, openness: 0.3, pinch: 0.8 },
  };
  const params: SynthParams = {
    voices: [
      { id: 0, present: true, freq: 440, gain: 0.5, instrument: 'warmPad' },
      { id: 1, present: true, freq: 330, gain: 0.4, instrument: 'glass' },
    ],
  };
  return {
    hands: frame,
    features,
    params,
    scale: [48, 50, 52, 55, 57, 60],
    scaleLeft: [45, 48, 50, 52, 55, 57],
    octaveShift: 0,
  };
}

function draw(paramsPartial: unknown, resourcesExtra: Record<string, unknown> = {}) {
  const rc = makeRecordingCanvas();
  const handlers = canvasOverlayNode.make(canvasOverlayNode.params.parse(paramsPartial ?? {}));
  const ctx: NodeContext = {
    tick: 0,
    time: 0,
    dt: 0,
    resources: { canvas: rc.canvas, video: rc.video, ...resourcesExtra },
  };
  handlers.process(fullInputs(), ctx);
  return rc;
}

describe('canvas-overlay composable elements', () => {
  it('the element list and the params schema agree on names', () => {
    const names = OVERLAY_ELEMENTS.map((e) => e.name);
    const paramKeys = Object.keys(canvasOverlayNode.params.parse({}) as Record<string, unknown>);
    for (const n of names) expect(paramKeys).toContain(n);
    // z-order: video first, markers last.
    expect(names[0]).toBe('video');
    expect(names[names.length - 1]).toBe('markers');
  });

  it('defaults: clears once, draws the video, guide, and markers; index-guide OFF', () => {
    const rc = draw({});
    expect(rc.count('clearRect')).toBe(1);
    expect(rc.count('drawImage')).toBe(1); // video backdrop
    expect(rc.count('moveTo')).toBeGreaterThan(0); // scale-guide vertical lines
    expect(rc.count('fillText')).toBeGreaterThan(0); // guide labels + note names
    expect(rc.count('setLineDash')).toBe(0); // index-finger guide is opt-in
  });

  it('video: show toggles the backdrop; alpha is the grey-out amount', () => {
    expect(draw({ video: { show: false } }).count('drawImage')).toBe(0);
    const rc = draw({ video: { show: true, alpha: 0.1 } });
    const img = rc.calls.find((c) => c.m === 'drawImage');
    expect(img?.alpha).toBeCloseTo(0.1);
  });

  it('scaleGuide: lines and labels toggle independently', () => {
    // No guide at all → no vertical lines (markers use arcs, not moveTo).
    expect(draw({ scaleGuide: { show: false }, indexGuide: { show: false } }).count('moveTo')).toBe(0);
    // Lines on, labels off, markers off → fillText not called.
    expect(
      draw({ scaleGuide: { show: true, showLabels: false }, markers: { show: false } }).count('fillText'),
    ).toBe(0);
    // Lines on, labels on, markers off → guide labels drawn.
    expect(
      draw({ scaleGuide: { show: true, showLabels: true }, markers: { show: false } }).count('fillText'),
    ).toBeGreaterThan(0);
  });

  it('indexGuide: opt-in dashed line, one per detected hand', () => {
    const on = draw({ indexGuide: { show: true, dashed: true } });
    const dashes = on.calls.filter((c) => c.m === 'setLineDash' && Array.isArray(c.args[0]) && (c.args[0] as number[]).length === 2);
    expect(dashes.length).toBe(2); // two hands
    // dashed=false → still drawn (lineTo) but no dash pattern set.
    const solid = draw({ indexGuide: { show: true, dashed: false } });
    expect(solid.count('setLineDash')).toBe(0);
    expect(solid.count('lineTo')).toBeGreaterThan(0);
  });

  it('landmarks and markers toggle off cleanly', () => {
    // Everything off → only the one clearRect, nothing drawn.
    const rc = draw({
      video: { show: false },
      scaleGuide: { show: false },
      indexGuide: { show: false },
      landmarks: { show: false },
      markers: { show: false },
    });
    expect(rc.count('clearRect')).toBe(1);
    expect(rc.count('arc')).toBe(0);
    expect(rc.count('drawImage')).toBe(0);
    expect(rc.count('fillText')).toBe(0);
  });

  it('markers.showNotes hides the per-hand note label without hiding the marker', () => {
    const noNotes = draw({ markers: { show: true, showNotes: false }, scaleGuide: { show: false } });
    expect(noNotes.count('arc')).toBeGreaterThan(0); // rings + fills still drawn
    expect(noNotes.count('fillText')).toBe(0); // but no note labels
  });

  const onlyChord = {
    video: { show: false },
    scaleGuide: { show: false },
    indexGuide: { show: false },
    landmarks: { show: false },
    markers: { show: false },
  };
  const drawChord = (chord: number[] | undefined, paramsOverride: unknown = onlyChord) => {
    const rc = makeRecordingCanvas();
    const handlers = canvasOverlayNode.make(canvasOverlayNode.params.parse(paramsOverride));
    const ctx: NodeContext = { tick: 0, time: 0, dt: 0, resources: { canvas: rc.canvas, video: rc.video } };
    handlers.process({ ...fullInputs(), chord }, ctx);
    return rc;
  };

  it('chordGuide: highlights every visible guide line of the chord pitch classes (with octave repetition)', () => {
    // Scale [48,50,52,55,57,60] = C,D,E,G,A,C → C appears twice (48 and 60).
    // A C chord {C,E,A} = pcs {0,4,9} lights up 48(C), 52(E), 57(A) AND 60(C) = 4 lines.
    const rc = drawChord([48, 52, 57]);
    expect(rc.count('stroke')).toBe(4);
    expect(rc.count('moveTo')).toBe(4);
  });

  it('chordGuide: lights every octave of a chord pitch class regardless of the rendered octave', () => {
    // 72 = C5 (pitch class 0) — highlights BOTH C guide lines (48=C3, 60=C4),
    // independent of the rendered voicing's octave.
    expect(drawChord([72]).count('stroke')).toBe(2);
  });

  it('chordGuide: draws nothing with no chord, off, or pitch classes absent from the scale', () => {
    expect(drawChord(undefined).count('stroke')).toBe(0); // no chord input → idle
    expect(drawChord([48, 52, 57], { ...onlyChord, chordGuide: { show: false } }).count('stroke')).toBe(0); // off
    // C# (pitch class 1) is not in the scale {C,D,E,G,A} → no match.
    expect(drawChord([49]).count('stroke')).toBe(0);
  });

  it('a live overlayConfig input overrides the static params', () => {
    const rc = makeRecordingCanvas();
    // Static params: index guide OFF, video ON. Live config flips both.
    const handlers = canvasOverlayNode.make(canvasOverlayNode.params.parse({}));
    const liveConfig = canvasOverlayNode.params.parse({
      indexGuide: { show: true, dashed: true },
      video: { show: false },
    });
    const ctx: NodeContext = {
      tick: 0,
      time: 0,
      dt: 0,
      resources: { canvas: rc.canvas, video: rc.video },
    };
    handlers.process({ ...fullInputs(), overlayConfig: liveConfig }, ctx);
    expect(rc.count('setLineDash')).toBeGreaterThan(0); // index guide ON via live config
    expect(rc.count('drawImage')).toBe(0); // video OFF via live config
  });

  it('no canvas resource → no-op, no throw', () => {
    const handlers = canvasOverlayNode.make(canvasOverlayNode.params.parse({}));
    const ctx: NodeContext = { tick: 0, time: 0, dt: 0, resources: {} };
    expect(() => handlers.process(fullInputs(), ctx)).not.toThrow();
  });

  it('runs inside the real production graph (overlay clears the canvas each tick)', () => {
    const rc = makeRecordingCanvas();
    const engine = new Engine(defaultGraph(), createAppRegistry(), {
      resources: { canvas: rc.canvas }, // no video → webcam/backdrop stay no-op
    });
    expect(() => {
      engine.tick();
      engine.tick();
    }).not.toThrow();
    expect(rc.count('clearRect')).toBe(2); // overlay ran both ticks
  });
});
