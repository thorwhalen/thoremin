// @vitest-environment jsdom
/**
 * The camera opens only when something reads it (#869), through the real `useThoreminEngine`
 * on a machine with no camera (`getUserMedia` rejects).
 *
 * An instrument that only listens (no hand voices, no face, the video and the skeleton hidden)
 * boots, plays and never asks for the camera: the hand source is `no-hands`, so no hand model
 * loads either (in jsdom a hand model could not load at all, so reaching `ready` proves it was
 * never composed). Switching to an instrument that reads the camera asks for it then; a camera
 * that cannot open is said in a toast and the engine plays on, never the boot's full-screen error.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import { NO_SLOTS } from '@/app/graph';
import { useControls } from '@/app/store';
import { useToasts } from '@/app/shell/toasts';
import { DEBUG_HANDLE_KEY } from '@/app/engine/debugHandle';
import { Harness, stubMissingCamera, type Seen } from './helpers/engine_boot';

const initial = useControls.getState();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useControls.setState(initial, true);
});

/** Make the hot store an instrument that only listens: nothing composed or drawn reads the camera. */
function listenOnly(): void {
  const s = useControls.getState();
  useControls.setState({
    handMap: { ...s.handMap, maxGain: 0 },
    faceMapping: 'none',
    overlay: { ...s.overlay, video: { ...s.overlay.video, show: false }, landmarks: { ...s.overlay.landmarks, show: false } },
  });
}

/** The hand source's status as the running engine emits it. */
const handsStatus = () => window[DEBUG_HANDLE_KEY]?.getOutput('cam', 'status') as { phase?: string } | undefined;

/** Count animation frames the live clock schedules: a rising count is the loop running. */
function countFrames(): () => number {
  let scheduled = 0;
  const realRaf = window.requestAnimationFrame.bind(window);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    scheduled++;
    return realRaf(cb);
  });
  return () => scheduled;
}

describe('an instrument that reads no camera', () => {
  it('boots and plays with the hand source off, and never asks for the camera', async () => {
    listenOnly();
    const getUserMedia = stubMissingCamera();
    const frames = countFrames();
    const seen: Seen = {};
    render(<Harness slots={NO_SLOTS} seen={seen} />);

    await waitFor(() => expect(seen.status).toBe('ready'), { timeout: 4000 });
    await waitFor(() => expect(handsStatus()?.phase).toBe('off'), { timeout: 4000 });
    const before = frames();
    await waitFor(() => expect(frames()).toBeGreaterThan(before + 2), { timeout: 4000 });
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(seen.error).toBeNull();
  });

  it('asks for the camera when a switch makes something read it, and plays on when it cannot open', async () => {
    listenOnly();
    const getUserMedia = stubMissingCamera();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const frames = countFrames();
    const seen: Seen = {};
    render(<Harness slots={NO_SLOTS} seen={seen} />);
    await waitFor(() => expect(seen.status).toBe('ready'), { timeout: 4000 });
    expect(getUserMedia).not.toHaveBeenCalled();

    // Switch to a hand instrument: the hand voices on, the video shown.
    act(() => useControls.setState({ ...initial }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1), { timeout: 4000 });
    expect(getUserMedia.mock.calls[0][0]).toMatchObject({ video: expect.anything() });
    await waitFor(() => expect(useToasts.getState().toasts.some((t) => /camera/i.test(t.message))).toBe(true), { timeout: 4000 });

    // The engine plays on (the hand source still off, since no camera opened), with no boot error.
    expect(seen.status).toBe('ready');
    expect(seen.error).toBeNull();
    expect(handsStatus()?.phase).toBe('off');
    const before = frames();
    await waitFor(() => expect(frames()).toBeGreaterThan(before + 2), { timeout: 4000 });
    err.mockRestore();
  });

  it('a tool that reads the camera asks for it too (the hand gestures)', async () => {
    listenOnly();
    const getUserMedia = stubMissingCamera();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: Seen = {};
    render(<Harness slots={NO_SLOTS} seen={seen} />);
    await waitFor(() => expect(seen.status).toBe('ready'), { timeout: 4000 });
    expect(getUserMedia).not.toHaveBeenCalled();

    act(() => useControls.setState((s) => ({ gestures: { ...s.gestures, enabled: true } })));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled(), { timeout: 4000 });
  });
});
