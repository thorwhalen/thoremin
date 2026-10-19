/**
 * The overlay's side of overlay elements as a contribution point (#600 S5): how an element an
 * extension contributes becomes one of the overlay's own elements. Kept out of
 * `canvas_overlay.ts` (which only calls these) so the overlay node does not grow with the seam.
 *
 * The rules: a contributed element draws through the extension's impl with ONLY its declared
 * inputs and the frame geometry; it is a no-op while its impl has not loaded (a lazy
 * extension); a cue is measured and placed by the shared cue layout; and the z-order puts
 * in-scene elements above the core in-scene ones and cues among the core cues, below the tag HUD.
 *
 * The types are structural (`ContributedView`, `DrawnElement`) so this module imports nothing of
 * the overlay's, and the overlay's own view and element types satisfy them.
 */
import type { OverlayElementDecl, OverlayElementImpl, OverlayFrame } from '@thoremin/sdk/instruments/extension';

/**
 * An extension's overlay element as the overlay receives it: built by the contribution registry
 * (`src/host/contributions.ts`, `ContributedOverlayElement`). `ports` maps each declared input to
 * its overlay port and `kinds` gives each port's kind; `impl` is undefined until a lazy
 * extension's node half has loaded.
 */
export interface ContributedElement {
  id: string;
  decl: OverlayElementDecl;
  ports: Readonly<Record<string, string>>;
  /** Each input's port kind (`config`: the dial slice's kind). */
  kinds: Readonly<Record<string, string>>;
  impl: () => OverlayElementImpl | undefined;
}

/** What of the overlay's view a contributed element reads: the frame, the cue layout, and each
 *  contributed element's inputs this tick, by element id. */
export interface ContributedView {
  W: number;
  H: number;
  layout: Record<string, { x: number; y: number }>;
  /** True on the overlay-only (alpha) pass: the transparent take, with no backdrop. */
  overlayOnly?: boolean;
  contributed?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/** The shape of an overlay element, as far as the seam needs it. */
export interface DrawnElement<V> {
  name: string;
  category: OverlayElementDecl['category'];
  cue?: boolean;
  measure?(view: V): { w: number; h: number } | null;
  positionOf?(view: V): 'left' | 'right' | 'top' | 'bottom';
  draw(g: CanvasRenderingContext2D, view: V): void;
}

/** How an element that threw is reported (once; a test may watch the console). */
const reportBroken = (id: string, err: unknown): void => console.error(`[thoremin] the overlay element "${id}" threw and is skipped from now on`, err);

/**
 * The overlay element made from a contribution. An element that throws (from `draw`, `measure`
 * or `positionOf`) is reported once and skipped from then on: it must never take the frame, the
 * other elements or the nodes after the overlay down with it.
 */
export function adaptContributed<V extends ContributedView>(c: ContributedElement): DrawnElement<V> {
  let broken = false;
  const frameOf = (view: V): OverlayFrame => ({ W: view.W, H: view.H, origin: view.layout[c.id], overlayOnly: view.overlayOnly === true });
  const inputsOf = (view: V): Readonly<Record<string, unknown>> => view.contributed?.[c.id] ?? {};
  /** Run `f` against the impl, unless it is absent or broke before; a throw breaks it. */
  const guarded = <T>(fallback: T, f: (impl: OverlayElementImpl) => T): T => {
    const impl = broken ? undefined : c.impl();
    if (!impl) return fallback;
    try {
      return f(impl);
    } catch (err) {
      broken = true;
      reportBroken(c.id, err);
      return fallback;
    }
  };
  const el: DrawnElement<V> = {
    name: c.id,
    category: c.decl.category,
    draw(g, view) {
      guarded(undefined, (impl) => {
        g.save();
        try {
          impl.draw(g, frameOf(view), inputsOf(view));
        } finally {
          g.restore();
        }
      });
    },
  };
  if (c.decl.cue) {
    el.cue = true;
    el.measure = (view) => guarded(null, (impl) => impl.measure?.(frameOf(view), inputsOf(view)) ?? null);
    el.positionOf = (view) => guarded('right' as const, (impl) => impl.positionOf?.(frameOf(view), inputsOf(view)) ?? 'right');
  }
  return el;
}

/** The draw list with the contributed elements in place (z order): in-scene ones above every core
 *  in-scene element and below the HUD cues; cues among the core cues, below the tag HUD (and so
 *  below the trainer HUD and the finger bars, which stay on top). */
export function withContributed<E extends { name: string; cue?: boolean }>(core: readonly E[], contributed: readonly E[]): readonly E[] {
  if (contributed.length === 0) return core;
  const scene = contributed.filter((e) => !e.cue);
  const cues = contributed.filter((e) => e.cue);
  const at = (i: number) => (i < 0 ? core.length : i);
  const out = [...core];
  out.splice(at(core.findIndex((e) => e.name === 'tagHud')), 0, ...cues);
  out.splice(at(core.findIndex((e) => e.cue)), 0, ...scene);
  return out;
}

/** Each drawn contributed element's inputs this tick, read from the overlay's input ports. */
export function contributedInputs(contributed: readonly ContributedElement[], drawn: ReadonlySet<string>, inputs: Readonly<Record<string, unknown>>): Record<string, Record<string, unknown>> {
  const byId: Record<string, Record<string, unknown>> = {};
  for (const c of contributed) {
    if (!drawn.has(c.id)) continue;
    const own: Record<string, unknown> = {};
    for (const [input, port] of Object.entries(c.ports)) own[input] = inputs[port];
    byId[c.id] = own;
  }
  return byId;
}
