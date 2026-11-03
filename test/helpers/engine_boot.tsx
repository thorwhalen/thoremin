/**
 * Booting the real `useThoreminEngine` in jsdom, on a machine with no camera: the harness the
 * camera tests share (the camera-free boot of a finished-frame source, the camera opened only
 * for an instrument that reads it, #869).
 *
 * A boot test has to go through the hook: whether the camera is asked for is decided there,
 * before the engine exists, and every test that builds an `Engine` directly never reaches it.
 */
import { vi } from 'vitest';
import { useThoreminEngine } from '@/app/engine/useEngine';
import { DEFAULT_SOURCE } from '@/app/engine/sourceSpec';
import type { SlotSelection } from '@/app/graph';
import { readLiveVector } from '@/app/enroll/liveVector';

/**
 * Engine time, in ms, as seen by the live feature tap: 0 before the first tick. `LiveVectorTap`
 * fires only from inside `engine.tick()`, so a rising value proves the whole path ran (clock,
 * Applier, tick, nodes, tap); a hook that built an engine and never drove it leaves it at 0.
 */
export const tickTime = (): number => readLiveVector()?.t ?? 0;

/** A camera that is not there: every request rejects, as on a webcam-less machine. */
export function stubMissingCamera() {
  const getUserMedia = vi.fn((_constraints?: MediaStreamConstraints) => Promise.reject(new DOMException('Requested device not found', 'NotFoundError')));
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
  return getUserMedia;
}

/** What the hook reported, written on every render. */
export interface Seen {
  status?: string;
  error?: string | null;
}

/** Mounts the hook and exposes what it reported. */
export function Harness({ slots, seen }: { slots: SlotSelection; seen: Seen }) {
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
