// @vitest-environment jsdom
/**
 * Camera-free boot: selecting a finished-frame source must not ask for hardware.
 *
 * The source slot (#104) chooses the `cam` NODE TYPE inside `defaultGraph`, but
 * the host's video acquisition is a separate decision made in `useEngine` before
 * the engine exists. Getting the first right and the second wrong produces the
 * worst possible version of this feature: the one URL a developer is told to use
 * for hardware-free verification is the one URL that still demands a camera — and
 * on a machine without one, `getUserMedia` rejects and the engine is never built
 * at all. An adversarial review caught exactly that, in code that passed every
 * other test, because every other source-slot test constructs an `Engine`
 * directly and never goes through the hook.
 *
 * So this is the half that has to be tested through the hook. It renders the real
 * `useThoreminEngine` in jsdom with `getUserMedia` rejecting — a machine with no
 * camera — and asserts the camera-free selection never calls it and still boots.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { useThoreminEngine } from '@/app/useEngine';
import { DEFAULT_SOURCE } from '@/app/sourceSpec';
import { sourceNeedsVideo, NO_SLOTS, type SlotSelection } from '@/app/graph';
import { createAppRegistry } from '@/nodes/browser';
import { readLiveVector } from '@/app/enroll/liveVector';

/**
 * Engine time, in ms, as seen by the live feature tap — 0 before the first tick.
 *
 * This is a deliberately end-to-end observable: `LiveVectorTap` is attached to the
 * engine and only fires from inside `engine.tick()`, so a rising value proves the whole
 * path ran — clock -> Applier -> tick -> nodes -> tap. A hook that constructed an engine
 * and never drove it leaves this at 0, which is exactly the regression these tests are
 * for.
 */
const tickTime = () => readLiveVector()?.t ?? 0;

/** A camera that is not there: every request rejects, as on a webcam-less machine. */
function stubMissingCamera() {
  const getUserMedia = vi.fn(() => Promise.reject(new DOMException('Requested device not found', 'NotFoundError')));
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
  return getUserMedia;
}

/** Mounts the hook and exposes what it reported. */
function Harness({ slots, seen }: { slots: SlotSelection; seen: { status?: string; error?: string | null } }) {
  const { videoRef, canvasRef, status, error } = useThoreminEngine(DEFAULT_SOURCE, slots);
  seen.status = status;
  seen.error = error;
  return (
    <>
      <video ref={videoRef} />
      <canvas ref={canvasRef} />
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('sourceNeedsVideo', () => {
  it('is true only for the default (the one candidate that runs MediaPipe on a video)', () => {
    const reg = createAppRegistry();
    expect(sourceNeedsVideo(NO_SLOTS, reg)).toBe(true);
    expect(sourceNeedsVideo({ source: 'webcam-hands' }, reg)).toBe(true);
    expect(sourceNeedsVideo({ source: 'synthetic-hands' }, reg)).toBe(false);
    expect(sourceNeedsVideo({ source: 'replay-hands' }, reg)).toBe(false);
  });

  it('is true for a selection that falls back to the default', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(sourceNeedsVideo({ source: 'not-a-node' }, createAppRegistry())).toBe(true);
    warn.mockRestore();
  });
});

describe('booting with a finished-frame source', () => {
  it('never asks for a camera, and reaches ready on a machine that has none', async () => {
    const getUserMedia = stubMissingCamera();
    const seen: { status?: string; error?: string | null } = {};
    render(<Harness slots={{ source: 'synthetic-hands' }} seen={seen} />);

    await waitFor(() => expect(seen.status).toBe('ready'), { timeout: 4000 });
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(seen.error).toBeNull();
  });

  // #101 M-D, live half. The three tests below are the closest thing this repo has to
  // the design's "browser smoke test" gate, and they are worth more than the structural
  // guards in engine_wiring.test.ts because they observe the loop RUNNING rather than
  // the source text describing it. What they still cannot reach is the real browser:
  // AudioContext, MediaPipe and rAF under load. That residual is #146.
  it('the Applier actually TICKS the engine — the live loop runs, not just builds', async () => {
    stubMissingCamera();
    const seen: { status?: string; error?: string | null } = {};
    render(<Harness slots={{ source: 'synthetic-hands' }} seen={seen} />);
    await waitFor(() => expect(seen.status).toBe('ready'), { timeout: 4000 });

    // `synthetic-hands` is deterministic and time-driven, so a rising tick count is the
    // signal that frames are being produced. Reading it off the store the graph writes
    // means this passes only if the WHOLE path ran: clock -> Applier -> engine.tick ->
    // nodes -> store. A hook that built an engine and never drove it fails here.
    const before = tickTime();
    await waitFor(() => expect(tickTime()).toBeGreaterThan(before), { timeout: 4000 });
  });

  it('stops SCHEDULING frames on unmount — a leaked rAF chain spins forever', async () => {
    // The observable here has to be the SCHEDULING, not the ticking. `engine.dispose()`
    // also runs in cleanup and `Engine.tick` returns early when disposed, so a
    // tick-based assertion goes quiet whether or not the loop stopped — it passes for
    // the wrong reason. (It did: mutating `shouldStop` to `() => false` left it green.)
    // What a leak actually looks like is `RealtimeClock` re-arming rAF forever, burning
    // a frame callback per frame against a dead engine.
    stubMissingCamera();
    let scheduled = 0;
    const realRaf = window.requestAnimationFrame.bind(window);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      scheduled++;
      return realRaf(cb);
    });

    const seen: { status?: string; error?: string | null } = {};
    const { unmount } = render(<Harness slots={{ source: 'synthetic-hands' }} seen={seen} />);
    await waitFor(() => expect(seen.status).toBe('ready'), { timeout: 4000 });
    await waitFor(() => expect(scheduled).toBeGreaterThan(2), { timeout: 4000 });

    unmount();
    // Let any in-flight frame resolve; the clock polls `shouldStop` before each one, so
    // at most one more can land after `disposed` flips.
    await new Promise((r) => setTimeout(r, 60));
    const settled = scheduled;
    await new Promise((r) => setTimeout(r, 150));
    expect(scheduled).toBe(settled);
  });

  it('the DEFAULT source still asks — and honestly reports the failure', async () => {
    // The control case. Without it, "never asks" would also pass if the hook had
    // simply stopped acquiring video for everyone.
    const getUserMedia = stubMissingCamera();
    const seen: { status?: string; error?: string | null } = {};
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<Harness slots={NO_SLOTS} seen={seen} />);

    await waitFor(() => expect(seen.status).toBe('error'), { timeout: 4000 });
    expect(getUserMedia).toHaveBeenCalled();
    err.mockRestore();
  });
});
