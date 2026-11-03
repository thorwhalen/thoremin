// @vitest-environment jsdom
/**
 * The camera opens only when something reads it (#869), through the real `useThoreminEngine`
 * on a machine with no camera (`getUserMedia` rejects).
 *
 * An instrument that only listens (no hand voices, no face, the video and the skeleton hidden)
 * boots, plays and never asks for the camera: the hand source is `no-hands`, so no hand model
 * loads either (in jsdom a hand model could not load at all, so reaching `ready` proves it was
 * never composed). Switching to an instrument that reads the camera asks for it then; a camera
 * that cannot open is said in a toast and the engine plays on, never the boot's full-screen error;
 * once the player grants it, the page shown again asks once more and the hand source goes live
 * (#960), with no second toast and no request in a loop.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import { NO_SLOTS } from '@/app/graph';
import { useControls } from '@/app/store';
import { useToasts } from '@/app/shell/toasts';
import { DEBUG_HANDLE_KEY } from '@/app/engine/debugHandle';
import { Harness, stubMissingCamera, type Seen } from './helpers/engine_boot';
import type { Mock } from 'vitest';

const initial = useControls.getState();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useControls.setState(initial, true);
  // The page's visibility and the Permissions API a test stubbed on the instances: back to jsdom's.
  delete (document as { visibilityState?: unknown }).visibilityState;
  delete (navigator as { permissions?: unknown }).permissions;
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

  it('asks once more when the page is shown after a refusal, quietly, never again on a later show or a branch change, and goes live once granted (#960)', async () => {
    listenOnly();
    const getUserMedia = stubMissingCamera() as Mock<(c?: MediaStreamConstraints) => Promise<MediaStream>>;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    // The Permissions API, whose camera status the player turns to granted (a request then cannot prompt).
    const permission = Object.assign(new EventTarget(), { state: 'prompt' as PermissionState, name: 'camera', onchange: null });
    Object.defineProperty(navigator, 'permissions', { value: { query: async () => permission }, configurable: true });
    const showPage = () => act(() => void document.dispatchEvent(new Event('visibilitychange')));
    const settle = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
    const cameraToasts = () => useToasts.getState().toasts.filter((t) => /camera/i.test(t.message)).length;
    useToasts.setState({ toasts: [] });
    const seen: Seen = {};
    const { container } = render(<Harness slots={NO_SLOTS} seen={seen} />);
    await waitFor(() => expect(seen.status).toBe('ready'), { timeout: 4000 });

    // A switch to a hand instrument: refused, said once.
    act(() => useControls.setState({ ...initial }));
    await waitFor(() => expect(cameraToasts()).toBe(1), { timeout: 4000 });
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    // Two page-shows while still refused: ONE more request (it could prompt), no toast, no loop.
    showPage();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2), { timeout: 4000 });
    await settle(100);
    showPage();
    await settle(200);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(cameraToasts()).toBe(1);

    // A branch change while the camera is still wanted (the hand voices off, the video still
    // shown) asks for nothing.
    act(() => useControls.setState((st) => ({ handMap: { ...st.handMap, maxGain: 0 } })));
    await settle(200);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(handsStatus()?.phase).toBe('off');
    act(() => useControls.setState((st) => ({ handMap: { ...st.handMap, maxGain: initial.handMap.maxGain } })));

    // The player grants it in the browser: the camera opens, the source goes live, no new toast.
    const video = container.querySelector('video')!;
    getUserMedia.mockImplementation(async () => {
      setTimeout(() => video.onloadedmetadata?.(new Event('loadedmetadata')), 0);
      return { getTracks: () => [], getVideoTracks: () => [] } as unknown as MediaStream;
    });
    act(() => {
      permission.state = 'granted';
      permission.dispatchEvent(new Event('change'));
    });
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(3), { timeout: 4000 });
    await waitFor(() => expect(handsStatus()?.phase).toBeDefined(), { timeout: 4000 });
    await waitFor(() => expect(handsStatus()?.phase).not.toBe('off'), { timeout: 4000 });
    expect(cameraToasts()).toBe(1);
    expect(seen.error).toBeNull();

    // Open now: the page shown again asks for nothing.
    showPage();
    await settle(100);
    expect(getUserMedia).toHaveBeenCalledTimes(3);
  });
});
