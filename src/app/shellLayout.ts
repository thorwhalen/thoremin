/**
 * The shell's measured regions: a floating control cluster publishes its live height as a
 * CSS variable, and the panels position themselves from it (`index.css`: `.shell-tool-panel`,
 * `.shell-instruments-card`). A constant was wrong both times it was tried: the tools bar
 * wraps to more rows as tools are added or the screen narrows, and the take cluster wraps to
 * two rows on a small phone, so a fixed reserve let each cover what sat above it.
 * `smoke/tests/occlusion.smoke.ts` hit-tests the result at desktop and phone widths.
 */

/** The tools bar's height (bottom-left). */
export const TOOLS_BAR_HEIGHT_VAR = '--tools-bar-h';
/** The take cluster's height (bottom-right: Annotations + Record). */
export const TAKE_CLUSTER_HEIGHT_VAR = '--take-cluster-h';

/**
 * Keep `cssVar` equal to `el`'s rendered height while it is mounted; on unmount, fall back
 * to the stylesheet's default. Without a `ResizeObserver` (jsdom) it measures once. Returns
 * the cleanup, for a layout effect.
 */
export function publishHeight(el: HTMLElement | null, cssVar: string): (() => void) | undefined {
  if (!el) return undefined;
  const root = document.documentElement.style;
  const write = () => {
    const h = el.getBoundingClientRect().height;
    if (h > 0) root.setProperty(cssVar, `${h}px`);
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
