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
import type { FrameView } from '@thoremin/sdk/view/frame_view';
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
  /** The frame-to-display transform of the pass being drawn (#817). */
  display: FrameView;
  /** The engine time of this frame. */
  t: number;
  layout: Record<string, { x: number; y: number }>;
  /** True on the overlay-only (alpha) pass: the transparent take, with no backdrop. */
  overlayOnly?: boolean;
  /** Each contributed element's state in THIS overlay instance, by element id (made in the node's
   *  `make`, so a new overlay, or one built from a reused registry, starts fresh). */
  elementState?: Record<string, { memo: Record<string, unknown>; broken: boolean }>;
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
  /** Once per tick, before every pass draws (#600 S16b: `OverlayElementImpl.update`). */
  update?(view: V): void;
}

/** How an element that threw is reported (once; a test may watch the console). */
const reportBroken = (id: string, err: unknown): void => console.error(`[thoremin] the overlay element "${id}" threw and is skipped from now on`, err);

/**
 * The overlay element made from a contribution. An element that throws (from `draw`, `measure`
 * or `positionOf`) is reported once and skipped from then on: it must never take the frame, the
 * other elements or the nodes after the overlay down with it.
 */
export function adaptContributed<V extends ContributedView>(c: ContributedElement): DrawnElement<V> {
  /** This element's state in the overlay instance drawing it (kept on the view by that instance). */
  const stateOf = (view: V): { memo: Record<string, unknown>; broken: boolean } => {
    const all = (view.elementState ??= {});
    return (all[c.id] ??= { memo: {}, broken: false });
  };
  const frameOf = (view: V): OverlayFrame => ({ W: view.W, H: view.H, display: view.display, t: view.t, origin: view.layout[c.id], overlayOnly: view.overlayOnly === true });
  const inputsOf = (view: V): Readonly<Record<string, unknown>> => view.contributed?.[c.id] ?? {};
  /** Run `f` against the impl, unless it is absent or broke before in this overlay; a throw breaks it. */
  const guarded = <T>(view: V, fallback: T, f: (impl: OverlayElementImpl) => T): T => {
    const state = stateOf(view);
    const impl = state.broken ? undefined : c.impl();
    if (!impl) return fallback;
    try {
      return f(impl);
    } catch (err) {
      state.broken = true;
      reportBroken(c.id, err);
      return fallback;
    }
  };
  const el: DrawnElement<V> = {
    name: c.id,
    category: c.decl.category,
    draw(g, view) {
      guarded(view, undefined, (impl) => {
        g.save();
        try {
          impl.draw(g, frameOf(view), inputsOf(view), stateOf(view).memo);
        } finally {
          g.restore();
        }
      });
    },
  };
  el.update = (view) => guarded(view, undefined, (impl) => impl.update?.(frameOf(view), inputsOf(view), stateOf(view).memo));
  if (c.decl.cue) {
    el.cue = true;
    el.measure = (view) => guarded(view, null, (impl) => impl.measure?.(frameOf(view), inputsOf(view)) ?? null);
    el.positionOf = (view) => guarded(view, 'right' as const, (impl) => impl.positionOf?.(frameOf(view), inputsOf(view)) ?? 'right');
  }
  return el;
}

/** The draw list with the contributed elements in place (z order): one that names a core element
 *  (`drawBefore`) just beneath it; otherwise in-scene ones above every core in-scene element and
 *  below the HUD cues, and cues among the core cues, below the tag HUD (and so below the trainer
 *  HUD and the finger bars, which stay on top). */
export function withContributed<E extends { name: string; cue?: boolean }>(core: readonly E[], contributed: readonly E[], before: Readonly<Record<string, string | undefined>> = {}): readonly E[] {
  if (contributed.length === 0) return core;
  const out = [...core];
  // An element that names the core element it draws beneath goes just before it.
  const placed = contributed.filter((e) => before[e.name] && out.some((c) => c.name === before[e.name]));
  const rest = contributed.filter((e) => !placed.includes(e));
  const at = (i: number) => (i < 0 ? out.length : i);
  out.splice(at(out.findIndex((e) => e.name === 'tagHud')), 0, ...rest.filter((e) => e.cue));
  out.splice(at(out.findIndex((e) => e.cue)), 0, ...rest.filter((e) => !e.cue));
  for (const e of placed) out.splice(out.findIndex((c) => c.name === before[e.name]), 0, e);
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
