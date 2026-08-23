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
