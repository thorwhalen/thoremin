/**
 * The stills of a hold (#385 E3), the two browser halves `face_stills.test.ts` replaces with
 * fakes: the IndexedDB store a saved categorizer's pictures live in (`idbThumbStore`, over the
 * in-memory fake of `test/helpers/fakeIndexedDb.ts`, falling back to memory where IndexedDB is
 * absent or refuses), and the frame grabber (`openLiveFrames`, over a stubbed `document` whose
 * canvas records its drawing): no frame yet is no still, the crop clamped into the frame, the
 * mirror, a hand skeleton drawn in the crop's own pixels, the still's size and quality, the luma
 * probe, and close letting the stream go without stopping it. Also the synthetic source's video
 * (`?carve.source=synthetic`): a painted canvas, its stream made once and stopped on dispose.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clampBox, idbThumbStore, openLiveFrames, GRAB_DEFAULTS } from '@thoremin/ext-faces/app/thumbnails';
import { sourceFromUrl, syntheticSource, FACE_SCRIPT } from '@thoremin/ext-faces/app/sources';
import { installFakeIndexedDb, type FakeIndexedDb } from '../helpers/fakeIndexedDb';

const g = globalThis as unknown as { indexedDB?: unknown };

let idb: FakeIndexedDb | null = null;
afterEach(() => {
  idb?.uninstall();
  idb = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const blob = (s: string) => new Blob([s], { type: 'image/jpeg' });

describe('idbThumbStore', () => {
  it('files, reads, lists and removes stills in IndexedDB', async () => {
    idb = installFakeIndexedDb();
    const store = idbThumbStore();
    const a = blob('a');
    await store.put('take1:0', a);
    await store.put('take1:1', blob('b'));
    expect(await store.get('take1:0')).toBe(a);
    expect(await store.get('missing')).toBeNull();
    expect((await store.keys()).sort()).toEqual(['take1:0', 'take1:1']);
    await store.remove(['take1:0', 'never-filed']);
    expect(await store.keys()).toEqual(['take1:1']);
    expect([...idb.data.keys()]).toEqual(['take1:1']);
  });

  it('lists only string keys', async () => {
    idb = installFakeIndexedDb();
    idb.data.set(7, blob('x'));
    idb.data.set('k', blob('y'));
    expect(await idbThumbStore().keys()).toEqual(['k']);
  });

  it('a write IndexedDB cannot keep rejects', async () => {
    idb = installFakeIndexedDb({ failWrites: true });
    await expect(idbThumbStore().put('k', blob('x'))).rejects.toMatchObject({ name: 'QuotaExceededError' });
  });

  it('is memory where IndexedDB is absent', async () => {
    const had = 'indexedDB' in g;
    const before = g.indexedDB;
    delete g.indexedDB;
    try {
      const store = idbThumbStore();
      await store.put('k', blob('x'));
      expect(await store.keys()).toEqual(['k']);
    } finally {
      if (had) g.indexedDB = before;
    }
  });

  it.each([
    ['refuses to open', (req: Record<string, (() => void) | null>) => setTimeout(() => req.onerror?.(), 0)],
    ['is blocked by another tab', (req: Record<string, (() => void) | null>) => setTimeout(() => req.onblocked?.(), 0)],
  ])('falls back to memory, kept for the page, when IndexedDB %s', async (_why, settle) => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        const req: Record<string, (() => void) | null> = { onerror: null, onblocked: null, onsuccess: null, onupgradeneeded: null };
        settle(req);
        return req;
      },
    });
    const store = idbThumbStore();
    const a = blob('a');
    await store.put('k', a);
    expect(await store.get('k')).toBe(a);
    await store.remove(['k']);
    expect(await store.keys()).toEqual([]);
  });

  it('falls back to memory when opening throws', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new Error('SecurityError');
      },
    });
    const store = idbThumbStore();
    await store.put('k', blob('a'));
    expect(await store.keys()).toEqual(['k']);
  });
});

describe('clampBox', () => {
  it('clamps a box into the frame, or null when nothing of it is inside', () => {
    expect(clampBox({ x: -10, y: 5, w: 50, h: 300 }, 100, 200)).toEqual({ x: 0, y: 5, w: 40, h: 195 });
    expect(clampBox({ x: 120, y: 0, w: 10, h: 10 }, 100, 100)).toBeNull();
    expect(clampBox({ x: 99.5, y: 0, w: 10, h: 10 }, 100, 100)).toBeNull();
  });
});

/** A `document` whose `<video>` and `<canvas>` record what they are asked. */
function fakeDom({ ready = 4, width = 640, height = 480, noContext = false, pixels = [255, 255, 255, 255] } = {}) {
  const calls: [string, ...unknown[]][] = [];
  const canvases: Record<string, unknown>[] = [];
  const ctx = new Proxy(
    {
      getImageData: (_x: number, _y: number, w: number, h: number) => {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < data.length; i++) data[i] = pixels[i % 4];
        return { data };
      },
    } as Record<string, unknown>,
    {
      get(target, prop: string) {
        if (prop in target) return target[prop];
        return (...args: unknown[]) => void calls.push([prop, ...args]);
      },
      set(target, prop: string, value) {
        calls.push([`set:${prop}`, value]);
        target[prop] = value;
        return true;
      },
    },
  );
  const video = {
    muted: false,
    playsInline: false,
    srcObject: null as unknown,
    readyState: ready,
    videoWidth: width,
    videoHeight: height,
    play: vi.fn(() => Promise.reject(new Error('autoplay'))),
    pause: vi.fn(),
  };
  const document = {
    createElement: (tag: string) => {
      if (tag === 'video') return video;
      const canvas: Record<string, unknown> = {
        width: 0,
        height: 0,
        getContext: vi.fn(() => (noContext ? null : ctx)),
        toBlob: (cb: (b: Blob | null) => void, type: string, quality: number) => cb(new Blob([`${type}@${quality}`])),
      };
      canvases.push(canvas);
      return canvas;
    },
  };
  vi.stubGlobal('document', document);
  return { calls, canvases, video };
}

const STREAM = { id: 'camera' } as unknown as MediaStream;

describe('openLiveFrames', () => {
  it('is null where there is no document', () => {
    expect(openLiveFrames(STREAM)).toBeNull();
  });

  it('plays the stream muted and inline, and close lets it go without stopping it', () => {
    const { video } = fakeDom();
    const frames = openLiveFrames(STREAM)!;
    expect(video).toMatchObject({ muted: true, playsInline: true, srcObject: STREAM });
    expect(video.play).toHaveBeenCalledOnce();
    frames.close();
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
  });

  it('has no still and no luma before a frame is showing', async () => {
    fakeDom({ ready: 1 });
    const frames = openLiveFrames(STREAM)!;
    expect(await frames.grab()).toBeNull();
    expect(frames.luma!()).toBeNull();
    fakeDom({ width: 0 });
    expect(await openLiveFrames(STREAM)!.grab()).toBeNull();
  });

  it('grabs the whole frame, mirrored, at the default width and quality', async () => {
    const { calls, canvases } = fakeDom();
    const still = await openLiveFrames(STREAM)!.grab();
    expect(await still!.text()).toBe(`image/jpeg@${GRAB_DEFAULTS.quality}`);
    expect(canvases[0]).toMatchObject({ width: 120, height: 90 });
    expect(calls).toContainEqual(['translate', 120, 0]);
    expect(calls).toContainEqual(['scale', -1, 1]);
    expect(calls).toContainEqual(['drawImage', expect.anything(), 0, 0, 640, 480, 0, 0, 120, 90]);
  });

  it('crops to the box clamped into the frame, unmirrored when asked, at the width asked', async () => {
    const { calls, canvases } = fakeDom();
    const frames = openLiveFrames(STREAM, { mirror: false, width: 50, quality: 0.5 })!;
    const crop = vi.fn(() => ({ x: 600, y: 100, w: 100, h: 200 }));
    const still = await frames.grab(crop);
    expect(crop).toHaveBeenCalledWith({ width: 640, height: 480 });
    expect(await still!.text()).toBe('image/jpeg@0.5');
    expect(canvases[0]).toMatchObject({ width: 50, height: 250 }); // 40 x 200 kept
    expect(calls).toContainEqual(['drawImage', expect.anything(), 600, 100, 40, 200, 0, 0, 50, 250]);
    expect(calls.some(([m]) => m === 'scale')).toBe(false);
  });

  it('a crop wholly outside the frame grabs the whole frame', async () => {
    const { calls } = fakeDom();
    await openLiveFrames(STREAM)!.grab(() => ({ x: 1000, y: 1000, w: 10, h: 10 }));
    expect(calls).toContainEqual(['drawImage', expect.anything(), 0, 0, 640, 480, 0, 0, 120, 90]);
  });

  it('draws the overlay polylines in the crop pixels, skipping a single point', async () => {
    const { calls } = fakeDom();
    await openLiveFrames(STREAM, { mirror: false, width: 100 })!.grab(
      () => ({ x: 100, y: 100, w: 200, h: 200 }),
      () => [
        [
          { x: 100, y: 100 },
          { x: 300, y: 200 },
        ],
        [{ x: 150, y: 150 }],
      ],
    );
    const drawn = calls.filter(([m]) => ['moveTo', 'lineTo', 'stroke', 'set:strokeStyle'].includes(m));
    expect(drawn).toEqual([
      ['set:strokeStyle', GRAB_DEFAULTS.overlayColor],
      ['moveTo', 0, 0],
      ['lineTo', 100, 50],
      ['stroke'],
    ]);
  });

  it('no 2D context is no still and no luma', async () => {
    fakeDom({ noContext: true });
    const frames = openLiveFrames(STREAM)!;
    expect(await frames.grab()).toBeNull();
    expect(frames.luma!()).toBeNull();
  });

  it('reads the mean luma of the crop from a small copy', () => {
    const { calls, canvases } = fakeDom({ pixels: [100, 100, 100, 255] });
    const frames = openLiveFrames(STREAM)!;
    expect(frames.luma!(() => ({ x: 0, y: 0, w: 320, h: 480 }))).toBeCloseTo(100, 9);
    const probe = canvases.at(-1)!;
    expect(probe).toMatchObject({ width: 24, height: 36 });
    expect(probe.getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true });
    expect(calls).toContainEqual(['drawImage', expect.anything(), 0, 0, 320, 480, 0, 0, 24, 36]);
    expect(frames.luma!()).toBeCloseTo(100, 9);
  });

  it('a frame the browser will not let it read (a tainted canvas) is no luma', () => {
    fakeDom();
    const frames = openLiveFrames(STREAM)!;
    const doc = (globalThis as unknown as { document: { createElement: (t: string) => Record<string, unknown> } }).document;
    const make = doc.createElement;
    doc.createElement = (t: string) => {
      const el = make(t);
      if (t === 'canvas')
        el.getContext = () => ({
          drawImage: () => {},
          getImageData: () => {
            throw new DOMException('tainted', 'SecurityError');
          },
        });
      return el;
    };
    expect(frames.luma!()).toBeNull();
  });
});

describe('the synthetic source', () => {
  it('reads the script from its own start, a frame count per read', () => {
    let t = 1000;
    const vectorAt = vi.fn((ms: number, frame: number) => ({ ms, frame }) as never);
    const src = syntheticSource(() => t, { vectorAt, labelAt: () => ({ name: 'smile', color: '#f00' }) });
    t = 1250;
    expect(src.read()).toEqual({ vector: { ms: 250, frame: 0 }, t: 1250 });
    src.read();
    expect(vectorAt).toHaveBeenLastCalledWith(250, 1);
    expect(src.kind).toBe('synthetic');
  });

  it('has no video where there is no document, or no captureStream', () => {
    expect(syntheticSource(() => 0).video()).toBeNull();
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
    expect(syntheticSource(() => 0).video()).toBeNull();
  });

  it('paints what it shows on a canvas stream at 15 fps, made once, stopped on dispose', () => {
    vi.useFakeTimers();
    const fills: string[] = [];
    const ctx = {
      set fillStyle(v: string) {
        fills.push(v);
      },
      fillRect: vi.fn(),
      fillText: vi.fn(),
      font: '',
      textAlign: '',
    };
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] };
    const canvas = { width: 0, height: 0, getContext: () => ctx, captureStream: vi.fn(() => stream) };
    vi.stubGlobal('document', { createElement: () => canvas });
    let t = 0;
    const src = syntheticSource(() => t, { vectorAt: () => ({}) as never, labelAt: (ms) => ({ name: ms < 100 ? 'rest' : 'smile', color: ms < 100 ? '#000' : '#f00' }) });
    expect(src.video()).toBe(stream);
    expect(src.video()).toBe(stream);
    expect(canvas.captureStream).toHaveBeenCalledOnce();
    expect(canvas.captureStream).toHaveBeenCalledWith(15);
    expect(canvas).toMatchObject({ width: 160, height: 120 });
    expect(ctx.fillText).toHaveBeenLastCalledWith('rest', 80, 68);
    t = 200;
    vi.advanceTimersByTime(1000 / 15);
    expect(ctx.fillText).toHaveBeenLastCalledWith('smile', 80, 68);
    expect(fills).toContain('#f00');
    src.dispose();
    expect(track.stop).toHaveBeenCalledOnce();
    const n = ctx.fillText.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(ctx.fillText.mock.calls.length).toBe(n);
  });

  it('the page picks it by its parameter, the face script by default', () => {
    expect(sourceFromUrl('?carve.source=synthetic').kind).toBe('synthetic');
    expect(FACE_SCRIPT.labelAt).toBeTypeOf('function');
  });
});
