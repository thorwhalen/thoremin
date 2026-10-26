/**
 * The held-frame option (#842): a ring of frames by capture time (closing what it evicts), the
 * hand source keeping the frame it offered, and the backdrop drawing the held frame in place of
 * the live video, for exactly the time of the hand result on screen.
 */
import { describe, expect, it } from 'vitest';
import type { NodeContext } from '@thoremin/dag';
import { createFrameHold, FRAME_HOLD_RESOURCE_KEY, type FrameHold } from '@thoremin/sdk/view/frame_hold';
import { holdFrame } from '@/nodes/sources/webcam_hands';
import { workerHandRunner, mainHandRunner, type FromWorker, type WorkerLike } from '@/nodes/sources/hand_runner';
import { makeCanvasOverlayNode, OVERLAY_ELEMENTS } from '@/nodes/output/canvas_overlay';

const frame = (name: string) => ({ name, closed: 0, close() { this.closed += 1; } });

describe('createFrameHold', () => {
  it('keeps the latest frames by time and closes the evicted ones', () => {
    const hold = createFrameHold(2);
    const [a, b, c] = [frame('a'), frame('b'), frame('c')];
    hold.put(1, a);
    hold.put(2, b);
    hold.put(3, c);
    expect(hold.get(1)).toBeUndefined();
    expect(a.closed).toBe(1);
    expect(hold.get(2)).toBe(b);
    expect(hold.get(3)).toBe(c);
    expect(b.closed + c.closed).toBe(0);
  });

  it('replacing a time closes the old frame; get is exact', () => {
    const hold = createFrameHold(3);
    const [a, b] = [frame('a'), frame('b')];
    hold.put(1, a);
    hold.put(1, b);
    expect(a.closed).toBe(1);
    expect(hold.get(1)).toBe(b);
    expect(hold.get(1.0001)).toBeUndefined();
  });

  it('dispose closes everything, and a put after it is closed at once', () => {
    const hold = createFrameHold(3);
    const [a, b] = [frame('a'), frame('b')];
    hold.put(1, a);
    hold.dispose();
    expect(a.closed).toBe(1);
    hold.put(2, b);
    expect(b.closed).toBe(1);
    expect(hold.get(2)).toBeUndefined();
  });

  it('at(): the exact frame, else the newest earlier one (never the live video in the gap), else nothing', () => {
    const hold = createFrameHold(3);
    const [a, b] = [frame('a'), frame('b')];
    hold.put(1, a);
    hold.put(1.1, b);
    expect(hold.at(1.1)).toBe(b);
    expect(hold.at(1.133)).toBe(b); // the result is newer than its snapshot (main thread: the bitmap resolves later)
    expect(hold.at(0.5)).toBeUndefined();
    expect(hold.at(1.5)).toBeUndefined(); // too old to stand for it
    expect(hold.stats()).toEqual({ exact: 1, earlier: 1, none: 2 });
  });
});

describe('holdFrame', () => {
  const video = {} as HTMLVideoElement;

  it('stores the snapshot under the stamp time once it resolves; nothing without a hold', async () => {
    const hold = createFrameHold<ImageBitmap>();
    const bmp = frame('x') as unknown as ImageBitmap;
    holdFrame(hold, video, 12.5, () => Promise.resolve(bmp));
    await Promise.resolve();
    await Promise.resolve();
    expect(hold.get(12.5)).toBe(bmp);
    let called = 0;
    holdFrame(undefined, video, 1, () => (called++, Promise.resolve(bmp)));
    expect(called).toBe(0);
  });

  it('a snapshot that fails is simply not held', async () => {
    const hold = createFrameHold<ImageBitmap>();
    holdFrame(hold, video, 1, () => Promise.reject(new Error('no frame')));
    await Promise.resolve();
    await Promise.resolve();
    expect(hold.get(1)).toBeUndefined();
  });
});

describe('the backdrop draws the held frame for the hand result on screen', () => {
  const drawn: unknown[] = [];
  const ctx = {
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
    save() {}, restore() {}, scale() {}, translate() {}, clearRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {}, fillText() {}, setLineDash() {}, fillRect() {}, rotate() {},
    drawImage(image: unknown) { drawn.push(image); },
  };
  const canvas = { width: 640, height: 480, getContext: () => ctx } as unknown as HTMLCanvasElement;
  const video = { readyState: 2, videoWidth: 640, videoHeight: 480 } as unknown as HTMLVideoElement;
  const only = Object.fromEntries(OVERLAY_ELEMENTS.map((e) => [e.name, { show: e.name === 'video' }]));
  const run = (hold: FrameHold<ImageBitmap> | undefined, t: number) => {
    drawn.length = 0;
    const node = makeCanvasOverlayNode();
    node.make(node.params.parse(only)).process({ hands: { width: 640, height: 480, hands: [], t } }, { tick: 0, time: 1, dt: 0, resources: { canvas, video, ...(hold ? { [FRAME_HOLD_RESOURCE_KEY]: hold } : {}) } } as NodeContext);
    return drawn[0];
  };

  it('the held bitmap when the result time is held, the live video otherwise or with no hold', () => {
    const hold = createFrameHold<ImageBitmap>();
    const bmp = frame('held') as unknown as ImageBitmap;
    hold.put(7, bmp);
    expect(run(hold, 7)).toBe(bmp);
    expect(run(hold, 7.05)).toBe(bmp); // a snapshot a moment behind its result still beats the live video
    expect(run(hold, 9)).toBe(video); // nothing near: live
    expect(run(undefined, 7)).toBe(video);
  });
});

describe('which frames a runner reports as accepted (#842)', () => {
  const stamp = (tMs: number) => ({ tMs, source: 'capture' as const, lagMs: 0, skipped: 0 });
  const video = { videoWidth: 640, videoHeight: 480 } as HTMLVideoElement;

  it('the main runner accepts every frame it infers, with the stamp its result carries', () => {
    const results: number[] = [];
    const runner = mainHandRunner({ detectForVideo: () => ({ landmarks: [], handedness: [] }), setOptions: async () => {}, close() {} }, (r) => results.push(r.stamp.tMs));
    const accepted: number[] = [];
    runner.offer(video, stamp(100), (_v, s) => accepted.push(s.tMs));
    expect(accepted).toEqual([100]);
    expect(results).toEqual([100]);
  });

  it('the worker runner accepts the frame it sends and none of those it drops while busy', async () => {
    const posted: unknown[] = [];
    let onmessage: WorkerLike['onmessage'] = null;
    const worker: WorkerLike = {
      postMessage: (m) => void posted.push(m),
      terminate() {},
      get onmessage() { return onmessage; },
      set onmessage(f) { onmessage = f; },
      onerror: null,
    };
    const p = workerHandRunner({ wasmBase: '', modelUrl: '', delegate: 'CPU', numHands: 2 }, () => {}, { createWorker: () => worker, createImageBitmap: async () => ({ close() {} }) as unknown as ImageBitmap });
    onmessage!({ data: { type: 'ready', delegate: 'CPU' } as FromWorker } as MessageEvent<FromWorker>);
    const runner = await p;
    const accepted: number[] = [];
    const note = (_v: HTMLVideoElement, s: { tMs: number }) => accepted.push(s.tMs);
    runner.offer(video, stamp(100), note);
    for (const t of [133, 166, 200, 233, 266]) runner.offer(video, stamp(t), note); // the worker is busy: all dropped
    expect(accepted).toEqual([100]);
  });
});
