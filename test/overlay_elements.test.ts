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
import { canvasOverlayNode, OVERLAY_ELEMENTS, OVERLAY_CATEGORIES } from '@/nodes/output/canvas_overlay';
import { OVERLAY_CONTROLS } from '@/app/overlayControls';
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
  stroke: string;
  fill: string;
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
      calls.push({
        m,
        args,
        alpha: ctx.globalAlpha as number,
        stroke: ctx.strokeStyle as string,
        fill: ctx.fillStyle as string,
      });
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

/** Draw with extra input-port values merged in (e.g. a faceFrame / expression). */
function drawWith(paramsPartial: unknown, extraInputs: Record<string, unknown> = {}) {
  const rc = makeRecordingCanvas();
  const handlers = canvasOverlayNode.make(canvasOverlayNode.params.parse(paramsPartial ?? {}));
  const ctx: NodeContext = { tick: 0, time: 0, dt: 0, resources: { canvas: rc.canvas, video: rc.video } };
  handlers.process({ ...fullInputs(), ...extraInputs }, ctx);
  return rc;
}

/** Everything off except the named element, so we can count its draws in isolation. */
const onlyElement = (name: string) =>
  Object.fromEntries(
    OVERLAY_ELEMENTS.map((e) => [e.name, { show: e.name === name }]),
  ) as Record<string, { show: boolean }>;

describe('canvas-overlay composable elements', () => {
  it('every element has a params key and a known category; z-order is sane', () => {
    const names = OVERLAY_ELEMENTS.map((e) => e.name);
    const paramKeys = Object.keys(canvasOverlayNode.params.parse({}) as Record<string, unknown>);
    const categories = new Set(OVERLAY_CATEGORIES.map((c) => c.id));
    for (const el of OVERLAY_ELEMENTS) {
      expect(paramKeys).toContain(el.name); // toggleable via its own params sub-object
      expect(categories.has(el.category)).toBe(true); // grouped under a known category
    }
    expect(names[0]).toBe('video'); // backdrop drawn first (bottom)
    expect(names[names.length - 1]).toBe('faceExpression'); // readout on top
  });

  it('every overlay element has a UI control descriptor (the panel is data-driven, no silent drop)', () => {
    const elementNames = new Set(OVERLAY_ELEMENTS.map((e) => e.name));
    const descNames = new Set(OVERLAY_CONTROLS.map((d) => d.name as string));
    expect(descNames).toEqual(elementNames); // descriptors ↔ elements, exactly
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

  it('faceLandmarks (Input): one dot per landmark when a present face frame has them', () => {
    const faceFrame = { present: true, blendshapes: {}, landmarks: [{ x: 0.5, y: 0.5 }, { x: 0.4, y: 0.6 }, { x: 0.6, y: 0.4 }] };
    const rc = drawWith(onlyElement('faceLandmarks'), { faceFrame });
    expect(rc.count('arc')).toBe(3); // one arc per landmark
    expect(rc.count('fill')).toBe(1); // ...all filled in a single path (perf)
  });

  it('faceLandmarks: mirrors x and keeps y (asymmetric landmark pins the geometry)', () => {
    const rc = drawWith(onlyElement('faceLandmarks'), {
      faceFrame: { present: true, blendshapes: {}, landmarks: [{ x: 0.1, y: 0.25 }] },
    });
    const arc = rc.calls.find((c) => c.m === 'arc')!;
    expect(arc.args[0] as number).toBeCloseTo((1 - 0.1) * 1280); // x mirrored (matches the video)
    expect(arc.args[1] as number).toBeCloseTo(0.25 * 720); // y un-mirrored
  });

  it('faceLandmarks: nothing with no face / no landmarks / absent / toggled off', () => {
    const arcs = (params: unknown, faceFrame?: unknown) => drawWith(params, { faceFrame }).count('arc');
    expect(arcs(onlyElement('faceLandmarks'))).toBe(0); // no face frame
    expect(arcs(onlyElement('faceLandmarks'), { present: false, blendshapes: {} })).toBe(0); // absent
    expect(arcs(onlyElement('faceLandmarks'), { present: true, blendshapes: {} })).toBe(0); // no landmarks
    expect(arcs({ ...onlyElement('faceLandmarks'), faceLandmarks: { show: false } },
      { present: true, blendshapes: {}, landmarks: [{ x: 0.5, y: 0.5 }] })).toBe(0); // off
  });

  it('faceExpression (Output): an activation bar + threshold tick per emotion; the winner glows gold', () => {
    const expression = {
      present: true,
      label: 'happy',
      scores: [0.7, 0.1, 0.1, 0.1, 0.1, 0.1],
      thresholds: [0.4, 0.4, 0.45, 0.4, 0.45, 0.4],
      fired: [true, false, false, false, false, false],
    };
    const rc = drawWith(onlyElement('faceExpression'), { expression });
    expect(rc.count('fillText')).toBe(1); // the label
    const strokes = rc.calls.filter((c) => c.m === 'stroke');
    expect(strokes).toHaveLength(12); // 6 emotions × (activation bar + threshold tick)
    expect(strokes[0].stroke).toBe('#f5d142'); // happy bar — the winner glows gold
    expect(strokes[1].stroke).toBe('#ffffff'); // happy's threshold tick is white
    expect(strokes[2].stroke).toBe('#22d3ee'); // sad bar — face cyan (not the winner)
  });

  it('faceExpression: abstention (present but neutral) draws bars but glows NONE gold', () => {
    // The classifier's central new state: a present face that cleared no emotion's
    // bar → label 'neutral'. 'neutral' is not in EMOTIONS, so no bar should glow.
    const expression = {
      present: true,
      label: 'neutral',
      scores: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
      thresholds: [0.4, 0.4, 0.45, 0.4, 0.45, 0.4],
      fired: [false, false, false, false, false, false],
    };
    const rc = drawWith(onlyElement('faceExpression'), { expression });
    expect(rc.count('fillText')).toBe(1); // 'neutral' label still renders
    const strokes = rc.calls.filter((c) => c.m === 'stroke');
    expect(strokes).toHaveLength(12);
    // No activation bar (even indices) uses the gold winner colour.
    expect(strokes.filter((_, i) => i % 2 === 0).every((s) => s.stroke !== '#f5d142')).toBe(true);
  });

  it('faceExpression: nothing when the expression is absent or toggled off', () => {
    expect(drawWith(onlyElement('faceExpression'), {}).count('fillText')).toBe(0); // no expression
    expect(
      drawWith(onlyElement('faceExpression'), {
        expression: { present: false, label: 'neutral', scores: [], thresholds: [], fired: [] },
      }).count('fillText'),
    ).toBe(0);
    const expression = {
      present: true,
      label: 'happy',
      scores: [1, 0, 0, 0, 0, 0],
      thresholds: [0.4, 0.4, 0.45, 0.4, 0.45, 0.4],
      fired: [true, false, false, false, false, false],
    };
    expect(drawWith({ ...onlyElement('faceExpression'), faceExpression: { show: false } }, { expression }).count('stroke')).toBe(0);
  });

  it('timbreLevels (Output): two bars per present hand; nothing when off', () => {
    // fullInputs has two present hands + synth voices 0/1.
    expect(drawWith(onlyElement('timbreLevels')).count('stroke')).toBe(4); // 2 hands × (brightness + vibrato)
    expect(drawWith({ ...onlyElement('timbreLevels'), timbreLevels: { show: false } }).count('stroke')).toBe(0);
    // Default is off (opt-in).
    expect((canvasOverlayNode.params.parse({}) as { timbreLevels: { show: boolean } }).timbreLevels.show).toBe(false);
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
