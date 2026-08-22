/**
 * The dispatch middleware seam (#127) — the ONE place `registry.dispatch` is wrapped.
 *
 * #87 Phase 4 asks for three things (undo/redo, telemetry, command export/replay) and
 * the issue's own note is the design: *they are the same mechanism viewed three ways*,
 * so the seam is built once and each feature is a `Middleware` over it. The alternative
 * — three independent monkey-patches of `registry.dispatch` — makes install ORDER an
 * emergent property of module evaluation order, and dispose order a latent bug (acture's
 * own `acture-undo` README warns that disposing an outer wrapper while inner wrappers
 * still hold its captured dispatch leaves dangling wrappers). One composed install makes
 * the order explicit and reversible.
 *
 * Ordering is the load-bearing part, and it is stated as data at the call site in
 * `registry.ts`: the FIRST middleware is the OUTERMOST. The confirmation gate (#87
 * Phase 3) must be outermost, because a gated command that returns `confirmation_required`
 * DID NOT RUN — journaling it as a dispatch or snapshotting an undo entry for it would
 * record a mutation that never happened.
 *
 * This module deliberately knows nothing about dials, undo or telemetry. It is the seam,
 * not a consumer of it.
 */
import type { Registry, Result } from 'acture';

/**
 * The shape of `registry.dispatch` a middleware wraps — a local alias, not an acture
 * export. Trailing args (acture's `options`) are forwarded untouched so a middleware
 * never silently drops a parameter a future acture version adds.
 */
export type Dispatch = (
  command: string,
  params?: unknown,
  context?: unknown,
  ...rest: unknown[]
) => Promise<Result<unknown>>;

/** A dispatch middleware: given the next link in the chain, return the wrapped dispatch. */
export type Middleware = (next: Dispatch) => Dispatch;

/**
 * Compose middlewares into one, FIRST = OUTERMOST.
 *
 * `composeMiddleware(a, b, c)(base)` is `a(b(c(base)))`, so a call enters `a` first and
 * reaches `base` last. Reading the install list top-to-bottom therefore reads outermost-
 * to-innermost, which is the order the guards actually apply in.
 */
export function composeMiddleware(...middlewares: Middleware[]): Middleware {
  return (next) => middlewares.reduceRight<Dispatch>((acc, mw) => mw(acc), next);
}

/**
 * Install middlewares onto a registry by reassigning its `dispatch` in place (the idiom
 * acture's own instrumenters use). FIRST argument is OUTERMOST.
 *
 * Returns a dispose that restores the ORIGINAL dispatch — restoring the captured value
 * rather than unwrapping one layer, so disposing is correct even if something else
 * wrapped dispatch afterwards (it drops those too, loudly, rather than leaving a chain
 * whose middle link points at a function nobody can reach).
 */
export function installMiddleware(registry: Registry, ...middlewares: Middleware[]): () => void {
  // Keep the ORIGINAL property value for restore, and a bound copy for the chain's tail.
  // Restoring the bound copy instead would leave `registry.dispatch` observably different
  // from what was there before — enough to defeat an equality check in a test that
  // installs and disposes between cases.
  const original = registry.dispatch;
  const next = original.bind(registry) as Dispatch;
  registry.dispatch = composeMiddleware(...middlewares)(next) as typeof registry.dispatch;
  return () => {
    registry.dispatch = original;
  };
}
