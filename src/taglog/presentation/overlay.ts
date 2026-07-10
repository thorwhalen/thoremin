/**
 * taglog presentation — the burned-in corner overlay's pure compute (design §5/§10).
 *
 * The overlay is the in-band "second opinion" composited into the recorded video:
 * the currently-open tags + a media timecode + a blink phase, so alignment is
 * *verifiable in the pixels a model trains on*, not just trusted metadata. The canvas
 * DRAWING is host-specific (thoremin's `canvas_overlay.ts`), but WHAT to draw is this
 * pure function — so it is reusable and unit-testable, and the host stays dumb.
 *
 * A host supplies a {@link TagOverlaySnapshot} (from the runtime store; null when not
 * recording) plus the engine's current time; this returns the frame to draw, or null
 * to draw nothing.
 */
import { formatTimecode } from '../affordances/time';

/** One open-tag chip to render in the corner (label + colour). */
export interface OpenTagChip {
  tag: string;
  label: string;
  color: string;
}

/** The runtime snapshot the host installs as a resource: the take anchor + open tags.
 *  Null means "not recording" — the overlay draws nothing. */
export interface TagOverlaySnapshot {
  /** The take's t0 (engine-clock seconds), so mediaTime = engineTime - t0. */
  t0: number;
  open: OpenTagChip[];
}

/** The computed corner-overlay frame: what to actually paint this tick. */
export interface TagOverlayFrame {
  /** mm:ss.mmm since record start (the burned-in timecode). */
  timecode: string;
  /** Media-relative seconds since t0. */
  mediaTime: number;
  /** ~1 Hz blink phase — a REC-light so a dropped frame is detectable. */
  blinkOn: boolean;
  chips: OpenTagChip[];
}

/** Blink rate for the REC dot / open-tag pulse (Hz). */
const BLINK_HZ = 1;

/**
 * Compute the corner-overlay frame from the runtime snapshot and the engine clock.
 * `engineTime` is `ctx.time` (performance.now()/1000, the same clock t0 is on), so
 * `mediaTime = engineTime - t0` is the recording-relative timecode. Returns null when
 * there is nothing to draw (not recording).
 */
export function computeTagOverlay(
  snapshot: TagOverlaySnapshot | null,
  engineTime: number,
): TagOverlayFrame | null {
  if (!snapshot) return null;
  const mediaTime = Math.max(0, engineTime - snapshot.t0);
  return {
    timecode: formatTimecode(mediaTime),
    mediaTime,
    blinkOn: Math.floor(mediaTime * BLINK_HZ * 2) % 2 === 0,
    chips: snapshot.open,
  };
}
