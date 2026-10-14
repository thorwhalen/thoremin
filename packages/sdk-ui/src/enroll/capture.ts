/**
 * The live carve's capture control, as a seam (#385 E2): the one place a carve tool's session
 * says "I am reading the camera now, and this is how to start, pause and resume my capture".
 *
 * The host's command registry owns the verb (`carve.capture.toggle`, bound to Space, offered in
 * the palette, to gestures and to the assistant), and an extension cannot import the host; so
 * the session PROVIDES its control here while it is live (exploring, resting, capturing or
 * paused) and withdraws it when it ends, and the host's command resolves it at dispatch time.
 * With nothing provided, the command has nothing to do and Space stays the browser's.
 */

/** Where a live carve is: reading only, the rest, collecting, or paused. */
export type CaptureState = 'explore' | 'rest' | 'capturing' | 'paused';

export interface CarveCaptureControl {
  /** What is being carved, for a message (`faces`). */
  readonly what: string;
  state(): CaptureState;
  /** Explore: start capturing (the rest first). Capturing: pause. Paused: resume. The rest:
   *  nothing (it is a few seconds and has its own end). */
  toggle(): void;
  /** Begin a burst (one held face of every frame while it lasts, #385 E7), optionally named by
   *  the name typed beforehand. Only while capturing or paused. Returns whether a burst is now
   *  held (false: not in a phase that takes one, or one already held is kept). */
  beginBurst(): boolean;
  /** End the held burst: it becomes one hold. Returns whether a burst was held. */
  endBurst(): boolean;
}

let current: CarveCaptureControl | null = null;

/** Provide (or with null, withdraw) the live carve's control. Returns a withdraw that only
 *  withdraws THIS control, so a late cleanup never removes a newer session's. */
export function provideCarveCapture(control: CarveCaptureControl | null): () => void {
  current = control;
  return () => {
    if (current === control) current = null;
  };
}

/** The live carve's control, or null when no carve is reading the camera. */
export function carveCapture(): CarveCaptureControl | null {
  return current;
}
