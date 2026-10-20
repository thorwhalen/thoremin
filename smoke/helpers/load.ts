/**
 * How loaded the browser is: the page's animation-frame rate, which is what the engine's frame
 * loop runs on. A test whose premise needs the pipeline's frame rate (a drum stroke falls in
 * 150 ms; at a few frames a second the tracker never sees it fall) reads it before blaming the
 * app, and skips with the measured rate when the runner could not give it (#803).
 */
import { test, type Page } from '@playwright/test';

/** Animation frames per second over `ms`, measured in the page. */
export async function pageFps(page: Page, ms = 2_000): Promise<number> {
  return page.evaluate(
    (window_) =>
      new Promise<number>((resolve) => {
        let n = 0;
        const t0 = performance.now();
        const step = (t: number) => {
          n++;
          if (t - t0 < window_) requestAnimationFrame(step);
          else resolve((n * 1000) / (t - t0));
        };
        requestAnimationFrame(step);
      }),
    ms,
  );
}

/** The frame rate a struck instrument needs for its strokes to be seen (the synthetic stroke's
 *  fall lasts 150 ms: at 20 frames a second that is three frames). */
export const STROKE_FPS = 20;

/** Skip the running test when the page cannot keep `minFps`, saying what it measured; otherwise
 *  return the rate, for the failure message. */
export async function skipWhenStarved(page: Page, what: string, minFps = STROKE_FPS): Promise<number> {
  const fps = await pageFps(page);
  test.skip(fps < minFps, `${what}: the runner gave the page ${fps.toFixed(1)} frames a second, under the ${minFps} a stroke needs to be seen (#803)`);
  return fps;
}
