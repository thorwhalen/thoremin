/**
 * Feature demand (#163) — how a consumer other than the Lab asks for feature groups to
 * be COMPUTED.
 *
 * ## The bug this closes
 *
 * The two feature-vector nodes are gated on the Feature Lab: with the meters hidden
 * (the default) they emit an empty vector, so the catalog costs nothing while nobody
 * is looking at it (#136). That is the right default for a display — and it silently
 * starved the trainer. Trainer v1 (#160) tapped `faceVec.vector` / `handVec.vector`
 * and polled them while a step ran, but never asked for anything to be computed, so
 * with the Lab closed every sample it took was `{}`. Every test stayed green: the tap
 * named real edges, the sampler handled empty vectors without complaint, and the
 * coverage meter filled up with nothing. Nobody had run it with a webcam.
 *
 * ## The seam
 *
 * A demand is a CLAIM: "`owner` needs these groups computed while this claim stands."
 * The registry holds one claim per owner (re-claiming replaces), and the nodes read
 * the union of all live claims through `ctx.resources.featureDemand` each tick. The
 * gate ({@link resolveLabGate}) then computes the Lab's groups when the Lab is shown,
 * PLUS whatever is demanded — so a demand never turns the meters on, and the meters
 * never have to be on for a demand to be served.
 *
 * A consumer declares groups, never feature ids: groups are the catalog's unit of
 * enablement (the Lab picker, the node params), and a cue that says "I need
 * `face.head`" should not have to know which eight features that currently is.
 *
 * Written at human frequency (a cue starting or ending), read per tick — the same
 * holder-plus-synchronous-read shape as `ctx.resources.controls`, for the same reason:
 * nothing on the tick path may await or subscribe.
 */

/** The formula-only group id (mirrors `DERIVED_GROUP` in the catalog; kept as a literal
 *  here so this module has no import edge into the catalog). */
const DERIVED_GROUP = 'derived';

/** A live set of demanded feature groups, or `null` when nothing is demanded. */
export type DemandedGroups = ReadonlySet<string> | null;

export interface FeatureDemand {
  /** Replace `owner`'s claim with `groups`. An empty list is the same as releasing. */
  claim(owner: string, groups: readonly string[]): void;
  /** Drop `owner`'s claim. Unknown owners are a no-op. */
  release(owner: string): void;
  /** The union of every live claim, or `null` when there are none. */
  groups(): DemandedGroups;
  /** The owners with a live claim (for display / debugging). */
  owners(): string[];
  /** Forget every claim. */
  reset(): void;
  /** Be told after any change (claim / release / reset). Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/**
 * Build a demand registry. The union is recomputed on write, not on read, so the
 * per-tick `groups()` is a field read.
 */
export function createFeatureDemand(): FeatureDemand {
  const claims = new Map<string, ReadonlySet<string>>();
  let union: DemandedGroups = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of listeners) l();
  };

  const recompute = () => {
    if (claims.size === 0) {
      union = null;
      return;
    }
    const all = new Set<string>();
    for (const groups of claims.values()) for (const g of groups) all.add(g);
    union = all.size > 0 ? all : null;
  };

  return {
    claim(owner, groups) {
      // `derived` (Lab formulas) has no catalog features: demanding it would open the
      // gate for an empty result. Drop it here so every claim is a claim on real work.
      const real = groups.filter((g) => g !== DERIVED_GROUP);
      if (real.length === 0) {
        claims.delete(owner);
      } else {
        claims.set(owner, new Set(real));
      }
      recompute();
      notify();
    },
    release(owner) {
      if (claims.delete(owner)) {
        recompute();
        notify();
      }
    },
    groups: () => union,
    owners: () => [...claims.keys()],
    reset() {
      claims.clear();
      union = null;
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
