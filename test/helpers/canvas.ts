/**
 * A recording 2D canvas context — the shared test double for the overlay tests.
 *
 * The test runtime is Node (no DOM), so overlay elements are driven against a fake
 * canvas whose context records every draw call, plus the live `globalAlpha` /
 * `strokeStyle` / `fillStyle` AT CALL TIME (snapshotted, since the real code mutates
 * them between calls). That lets a test assert WHICH primitives an element drew, in
 * what colour, at what alpha — without rendering a pixel.
 *
 * This is the superset of the two copies that had grown in `overlay_elements.test.ts`
 * and `feature_lab_overlay.test.ts`: style snapshots + a stub `video` + the `texts()`
 * and `count()` conveniences.
 */

/** One recorded draw call, with the context style state at the moment of the call. */
export interface Call {
  m: string;
  args: unknown[];
  alpha: number;
  stroke: string;
  fill: string;
}

/** The 2D-context methods the overlay elements use (anything else would throw, which is
 *  the point: a new primitive must be added here deliberately). */
const RECORDED_METHODS = [
  'clearRect',
  'save',
  'restore',
  'beginPath',
  'arc',
  'fill',
  'stroke',
  'moveTo',
  'lineTo',
  'drawImage',
  'fillText',
  'setLineDash',
  'scale',
  'translate',
  'rotate',
  'fillRect',
] as const;

export interface RecordingCanvas {
  /** Pass as `ctx.resources.canvas`. */
  canvas: HTMLCanvasElement;
  /** Pass as `ctx.resources.video` (a `readyState: 2` stub, so the backdrop draws). */
  video: HTMLVideoElement;
  /** Every recorded draw call, in order. */
  calls: Call[];
  /** The text of every `fillText` call, in order. */
  texts: () => string[];
  /** How many times method `m` was called. */
  count: (m: string) => number;
}

/** Build a canvas whose 2D context records instead of rasterizes. */
export function makeRecordingCanvas(width = 1280, height = 720): RecordingCanvas {
  const calls: Call[] = [];
  // `ctx` is referenced by the recorders so they can snapshot live props.
  const ctx: Record<string, unknown> = {
    globalAlpha: 1,
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
  };
  const rec =
    (m: string) =>
    (...args: unknown[]) => {
      calls.push({
        m,
        args,
        alpha: ctx.globalAlpha as number,
        stroke: ctx.strokeStyle as string,
        fill: ctx.fillStyle as string,
      });
    };
  for (const m of RECORDED_METHODS) ctx[m] = rec(m);

  const canvas = { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement;
  const video = { readyState: 2 } as unknown as HTMLVideoElement;
  return {
    canvas,
    video,
    calls,
    texts: () => calls.filter((c) => c.m === 'fillText').map((c) => String(c.args[0])),
    count: (m: string) => calls.filter((c) => c.m === m).length,
  };
}
