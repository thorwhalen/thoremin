/**
 * The shell's measured regions: a floating control cluster publishes its live height (the
 * Instruments panel its live width) as a CSS variable, and the other surfaces position
 * themselves from it (`index.css`: `.shell-tool-panel`, `.shell-instruments-card`; `App`'s
 * "Tap to play", which centres in the space the Instruments panel leaves). A constant was wrong both times it was tried: the tools bar
 * wraps to more rows as tools are added or the screen narrows, and the take cluster wraps to
 * two rows on a small phone, so a fixed reserve let each cover what sat above it.
 * `smoke/tests/occlusion.smoke.ts` hit-tests the result at desktop and phone widths.
 */

/** The tools bar's height (bottom-left). */
export const TOOLS_BAR_HEIGHT_VAR = '--tools-bar-h';
/** The take cluster's height (bottom-right: Annotations + Record). */
export const TAKE_CLUSTER_HEIGHT_VAR = '--take-cluster-h';
/** The Instruments panel's width (top-right; the gallery widens it to about half a laptop
 *  screen, where a centred "Tap to play" sat on its cards). */
export const INSTRUMENTS_WIDTH_VAR = '--instruments-w';

/**
 * Keep `cssVar` equal to `el`'s rendered height while it is mounted; on unmount, fall back
 * to the stylesheet's default. Without a `ResizeObserver` (jsdom) it measures once. Returns
 * the cleanup, for a layout effect.
 */
export function publishHeight(el: HTMLElement | null, cssVar: string): (() => void) | undefined {
  return publishSize(el, cssVar, 'height');
}

/** {@link publishHeight}, for either dimension. */
export function publishSize(
  el: HTMLElement | null,
  cssVar: string,
  dimension: 'height' | 'width',
): (() => void) | undefined {
  if (!el) return undefined;
  const root = document.documentElement.style;
  const write = () => {
    const size = el.getBoundingClientRect()[dimension];
    if (size > 0) root.setProperty(cssVar, `${size}px`);
  };
  write();
  if (typeof ResizeObserver === 'undefined') return () => root.removeProperty(cssVar);
  const ro = new ResizeObserver(write);
  ro.observe(el);
  return () => {
    ro.disconnect();
    root.removeProperty(cssVar);
  };
}
