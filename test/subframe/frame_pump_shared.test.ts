/**
 * One pump per camera element, shared by the models that read it (#570): a frame is stamped
 * once and every model gets that same stamp (so the stamp-keyed frame copy of #495 is shared),
 * a model that refuses a frame does not hold the others back, and the element's pump runs
 * exactly as long as someone listens.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { acquireFramePump, type FrameStamp, type VideoFrameMetadataLike } from '@/nodes/sources/frame_pump';

type Cb = (now: number, meta: VideoFrameMetadataLike) => void;

function fakeVideo() {
  let cb: Cb | null = null;
  let registrations = 0;
  const video = {
    readyState: 4,
    videoWidth: 640,
    currentTime: 0,
    requestVideoFrameCallback(c: Cb) {
      cb = c;
      registrations++;
      return registrations;
    },
    cancelVideoFrameCallback() {
      cb = null;
    },
  } as unknown as HTMLVideoElement;
  return {
    video,
    registrations: () => registrations,
    present(n: number) {
      const c = cb;
      cb = null;
      c?.(n * 33, { captureTime: n * 33 - 5, presentedFrames: n });
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

function setup() {
  let raf: (() => void) | null = null;
  vi.stubGlobal('requestAnimationFrame', (c: () => void) => ((raf = c), 1));
  vi.stubGlobal('cancelAnimationFrame', () => (raf = null));
  vi.stubGlobal('performance', { now: () => 1000 });
  return { tick: () => { const c = raf; raf = null; c?.(); } };
}

describe('acquireFramePump', () => {
  it('gives every listener the same stamp of the same frame, with one callback chain', () => {
    const s = setup();
    const f = fakeVideo();
    const a: FrameStamp[] = [];
    const b: FrameStamp[] = [];
    const pa = acquireFramePump(() => f.video, (st) => void a.push(st));
    const pb = acquireFramePump(() => f.video, (st) => void b.push(st));
    pa.start();
    pb.start();
    s.tick();
    f.present(1);
    f.present(2);
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
    expect(f.registrations()).toBeLessThanOrEqual(3);
  });

  it('a listener that refuses does not hold the others back or get the frame again', () => {
    const s = setup();
    const f = fakeVideo();
    const seen: number[] = [];
    let refused = 0;
    acquireFramePump(() => f.video, (st) => void seen.push(st.tMs)).start();
    acquireFramePump(() => f.video, () => (refused++, false)).start();
    s.tick();
    const base = seen.length; // the first animation frame delivers the element's first frame
    f.present(1);
    f.present(2);
    expect(seen.length).toBe(base + 2);
    expect(refused).toBe(base + 2);
  });

  it('runs while anyone listens and a late joiner sees the next frames', () => {
    const s = setup();
    const f = fakeVideo();
    const a: FrameStamp[] = [];
    const b: FrameStamp[] = [];
    const pa = acquireFramePump(() => f.video, (st) => void a.push(st));
    const pb = acquireFramePump(() => f.video, (st) => void b.push(st));
    pa.start();
    s.tick();
    const base = a.length;
    f.present(1);
    pb.start();
    f.present(2);
    pa.stop();
    f.present(3);
    expect(a.length).toBe(base + 2);
    expect(b.length).toBe(2);
    expect(pa.running).toBe(false);
    expect(pb.running).toBe(true);
    pb.stop();
    f.present(4);
    expect(b.length).toBe(2);
  });
});
