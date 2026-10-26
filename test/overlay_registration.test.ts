/**
 * Overlay registration (#817): through the real `canvas-overlay` node, on a 4:3 canvas over a 16:9
 * camera frame, every landmark dot sits on the pixel the drawn video puts the same frame point on,
 * in all three fit modes. The video's placement is read back from the recorded canvas calls
 * (scale / translate / drawImage) as a canvas would apply them, independent of the transform under
 * test. A guard fails if an element goes back to doing its own frame math.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { NodeContext } from '@thoremin/dag';
import { makeCanvasOverlayNode, OVERLAY_ELEMENTS } from '@/nodes/output/canvas_overlay';
import { FITS, type Fit } from '@thoremin/sdk/view/frame_view';
import type { HandsFrame } from '@thoremin/sdk/nodes/domain';

interface Call {
  m: string;
  args: number[];
}
function makeCanvas(width: number, height: number) {
  const calls: Call[] = [];
  const ctx: Record<string, unknown> = { globalAlpha: 1, fillStyle: '', font: '', textBaseline: '', textAlign: '', strokeStyle: '', lineWidth: 1 };
  const rec = (m: string) => (...args: unknown[]) => void calls.push({ m, args: args.filter((a): a is number => typeof a === 'number') });
  for (const m of ['clearRect', 'save', 'restore', 'beginPath', 'arc', 'fill', 'stroke', 'moveTo', 'lineTo', 'drawImage', 'fillText', 'setLineDash', 'scale', 'translate', 'rotate', 'fillRect']) ctx[m] = rec(m);
  return { canvas: { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement, calls };
}

/** The recorded sweep's hands re-expressed in a 1280x720 frame (the fixture's own is square). */
const frames: HandsFrame[] = readFileSync('test/fixtures/video_hand_sweep/src.hands.ndjson', 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l).value as HandsFrame)
  .filter((f) => f.hands.length > 0)
  .map((f) => ({
    ...f,
    width: 1280,
    height: 720,
    hands: f.hands.map((h) => ({ ...h, keypoints: h.keypoints.map((k) => ({ ...k, x: (k.x / f.width) * 1280, y: (k.y / f.height) * 720 })) })),
  }));

const only = (names: string[]) => Object.fromEntries(OVERLAY_ELEMENTS.map((e) => [e.name, { show: names.includes(e.name) }]));

describe.each(FITS)('landmarks over the video, fit %s, 4:3 canvas over a 16:9 frame', (fit: Fit) => {
  it('every dot is on the pixel the drawn video puts its keypoint on', () => {
    const rc = makeCanvas(640, 480);
    const hands = frames[10]!;
    const video = { readyState: 2, videoWidth: 1280, videoHeight: 720 } as unknown as HTMLVideoElement;
    const node = makeCanvasOverlayNode();
    const h = node.make(node.params.parse(only(['video', 'landmarks'])));
    const ctx: NodeContext = { tick: 0, time: 1, dt: 0, resources: { canvas: rc.canvas, video, display: { fit } } };
    h.process({ hands }, ctx);

    const scale = rc.calls.find((c) => c.m === 'scale')!;
    const translate = rc.calls.find((c) => c.m === 'translate')!;
    const image = rc.calls.find((c) => c.m === 'drawImage')!;
    // A frame pixel, through the canvas state the backdrop was drawn under.
    const wherever = (x: number, y: number) => ({
      x: scale.args[0]! * ((x / 1280) * image.args[2]! + translate.args[0]!),
      y: scale.args[1]! * ((y / 720) * image.args[3]! + translate.args[1]!),
    });

    const dots = rc.calls.filter((c) => c.m === 'arc' && c.args[2] === 3);
    const keypoints = hands.hands.flatMap((hand) => hand.keypoints);
    expect(dots).toHaveLength(keypoints.length);
    keypoints.forEach((k, i) => {
      const want = wherever(k.x, k.y);
      expect(dots[i]!.args[0]).toBeCloseTo(want.x, 6);
      expect(dots[i]!.args[1]).toBeCloseTo(want.y, 6);
    });
  });
});

describe('the video and the elements follow the fit, not the canvas (#817)', () => {
  const draw = (fit: Fit, names: string[], inputs: Record<string, unknown>) => {
    const rc = makeCanvas(640, 480);
    const video = { readyState: 2, videoWidth: 1280, videoHeight: 720 } as unknown as HTMLVideoElement;
    const node = makeCanvasOverlayNode();
    const h = node.make(node.params.parse(only(names)));
    h.process(inputs, { tick: 0, time: 1, dt: 0, resources: { canvas: rc.canvas, video, display: { fit } } } as NodeContext);
    return rc.calls;
  };

  it('the backdrop is drawn at the size and offset the fit gives', () => {
    const contain = draw('contain', ['video'], {});
    expect(contain.find((c) => c.m === 'drawImage')!.args).toEqual([0, 0, 640, 360]);
    expect(contain.find((c) => c.m === 'translate')!.args).toEqual([-640, 60]);
    const cover = draw('cover', ['video'], {});
    expect(cover.find((c) => c.m === 'drawImage')!.args.slice(2)).toEqual([expect.closeTo(853.33, 1), 480]);
  });

  it('a scale guide spans the displayed frame, not the canvas (contain: inside the bars)', () => {
    const lines = draw('contain', ['scaleGuide'], { scale: [60, 62, 64, 65, 67, 69, 71, 72] }).filter((c) => c.m === 'moveTo');
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(l.args[1]).toBeCloseTo(60 + 0.12 * 360, 6); // rect.y + 0.12 * rect.h
    }
  });

  it('the face mesh is placed by the view (unmirrored fractions, flipped once)', () => {
    const face = { present: true, landmarks: [{ x: 0.25, y: 0.5, z: 0 }] };
    const arc = draw('contain', ['faceLandmarks'], { faceFrame: face }).find((c) => c.m === 'arc')!;
    expect(arc.args[0]).toBeCloseTo(640 - 0.25 * 640, 6);
    expect(arc.args[1]).toBeCloseTo(60 + 0.5 * 360, 6);
  });
});

describe('no in-scene element does its own frame math (#817)', () => {
  const dir = 'src/nodes/output/overlay/elements';
  const inScene = ['backdrop', 'landmarks', 'finger_lines', 'body_skeleton', 'face_mesh', 'control_markers', 'timbre_levels', 'scale_guide', 'chord_guide'].map((n) => `${dir}/${n}.ts`);
  const files = [...inScene, 'packages/ext-air/src/nodes/overlay/drum_pads.ts'];

  it.each(files)('%s never reads the canvas size', (file) => {
    // Everything in-scene goes through view.display (px / unit / shown / rect); W and H are HUD-space.
    expect(readFileSync(file, 'utf8')).not.toMatch(/\b[WH]\b/);
  });

  it('the harmony grids are drawn on the displayed frame, not the canvas', () => {
    expect(readFileSync('packages/ext-harmony/src/index.ts', 'utf8')).not.toMatch(/frame\.[WH]\b/);
    expect(readFileSync('packages/ext-harmony/src/nodes/chord_map.ts', 'utf8')).not.toMatch(/\b1\s*-\s*[\w.]+\s*\/\s*frame\.width\b/);
  });

  it.each([...readdirSync(dir).map((f) => `${dir}/${f}`), 'packages/ext-air/src/nodes/overlay/drum_pads.ts'])('%s has no hand-rolled mirror or pixel division', (file) => {
    const src = readFileSync(file, 'utf8');
    expect(src).not.toMatch(/\bmirrorX\b/);
    expect(src).not.toMatch(/\/\s*\w+\.(width|height)\b/);
    expect(src).not.toMatch(/\b1\s*-\s*[\w.]+\s*\/\s*[\w.]*(width|W)\b/);
  });
});
