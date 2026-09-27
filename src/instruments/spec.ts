/**
 * The instrument spec: what the library lists and the player picks, as one record
 * (`docs/design/instruments-as-graphs-and-extensions.md` §3.2; PR 4).
 *
 * The record is a JOIN, not a third store. An instrument is persisted in two places that
 * already exist and are keyed by the same name: the dials profile store holds its settings
 * `Layer` (what it sounds like), and the library's metadata blob holds what is known ABOUT
 * it (starred, tags, and since PR 4: a class cache, an optional explicit branch list, an
 * optional training route). `assembleSpec` puts the two together with the derivation the
 * settings imply, so every consumer reads one shape and no consumer has to know where a
 * field lives. One Zod schema describes the assembled record, so an export, an import or
 * a hand-written spec can be validated the same way.
 *
 * Two rules, both from `instrument-library.md` (Decision 6) and the ADR (§3.4):
 *
 *  - **The class is derived, always.** "An air instrument wins; a stale category is
 *    impossible." A persisted `class` is a cache the UI may read before the derivation has
 *    run, never a vote against it. `assembleSpec` takes the derived class when it has one
 *    and normalises a cached one (`theremin` → `field`) when it does not.
 *  - **Branches are explicit when written, derived otherwise.** A spec with a `branches`
 *    field composes exactly those (plus whatever a live tool demands); one without derives
 *    them from its settings (`branchIdsFor`), which is what every instrument saved before
 *    PR 4 does, unchanged.
 *
 * Pure: Zod and the class registry only. No store, no React.
 */
import { z } from 'zod';
import { INSTRUMENT_CLASSES, normaliseClassId, DEFAULT_CLASS, type InstrumentClassId } from '@/app/library/category';

/** Where "train this instrument" goes: a route the trainer stream resolves (its shape is
 *  the trainer's; the spec only carries it). */
export const TrainingLinkSchema = z.object({ route: z.string().min(1) });
export type TrainingLink = z.infer<typeof TrainingLinkSchema>;

const ClassIdSchema = z
  .string()
  .transform((id, ctx) => {
    const current = normaliseClassId(id);
    if (!current) {
      ctx.addIssue({ code: 'custom', message: `unknown instrument class "${id}" (known: ${INSTRUMENT_CLASSES.map((c) => c.id).join(', ')})` });
      return z.NEVER;
    }
    return current;
  });

export const InstrumentSpecSchema = z.object({
  /** The instrument's name, which is also its key in both stores. */
  id: z.string().min(1),
  name: z.string().min(1),
  class: ClassIdSchema,
  tags: z.array(z.string()).default([]),
  emoji: z.string().optional(),
  /** Explicit branch ids, when the instrument declares them; absent → derived from settings. */
  branches: z.array(z.string()).optional(),
  /** The dials Layer (sparse, dotted keys), exactly what the profile store persists. */
  settings: z.record(z.string(), z.unknown()),
  training: TrainingLinkSchema.optional(),
  /** A picture for the gallery view (discussion #272): a reference (URL, app-relative path
   *  or store key), never bytes. */
  image: z.string().optional(),
  /**
   * The facet the Instruments view filters on besides class and tags: the capabilities the
   * instrument uses, which are exactly its branch ids (`face-chord`, `air-drum`, ...) minus
   * the trunk. Derived, never edited: it equals `branches` when those are known.
   */
  features: z.array(z.string()).default([]),
});
export type InstrumentSpec = z.infer<typeof InstrumentSpecSchema>;
export type InstrumentSpecInput = z.input<typeof InstrumentSpecSchema>;

/** The two halves the spec is assembled from, plus what the settings derive to. */
export interface SpecParts {
  name: string;
  /** The profile store's Layer for this name. */
  layer: Record<string, unknown>;
  /** The library's metadata record, if any. */
  meta?: { tagIds?: string[]; class?: string; branches?: string[]; training?: TrainingLink; emoji?: string; image?: string };
  /** What the settings derive to, when the derivation has run: the class and the branch set. */
  derived?: { class: InstrumentClassId; branches: string[] };
}

/**
 * Assemble the spec for one instrument. The derived class wins over a cached one; the
 * branches are the explicit list when there is one, else the derived set, else absent
 * (the caller derives at composition time).
 */
export function assembleSpec(parts: SpecParts): InstrumentSpec {
  const cached = parts.meta?.class ? normaliseClassId(parts.meta.class) : undefined;
  const cls: InstrumentClassId = parts.derived?.class ?? cached ?? DEFAULT_CLASS;
  const spec: InstrumentSpecInput = {
    id: parts.name,
    name: parts.name,
    class: cls,
    tags: parts.meta?.tagIds ?? [],
    settings: parts.layer,
  };
  if (parts.meta?.emoji) spec.emoji = parts.meta.emoji;
  if (parts.meta?.image) spec.image = parts.meta.image;
  if (parts.meta?.branches) spec.branches = [...parts.meta.branches];
  else if (parts.derived) spec.branches = [...parts.derived.branches];
  if (parts.meta?.training) spec.training = { ...parts.meta.training };
  spec.features = spec.branches ? [...spec.branches] : [];
  return InstrumentSpecSchema.parse(spec);
}

/** Whether a stored class cache disagrees with the derivation (the cache is then stale and
 *  the library rewrites it; the derivation is never overruled). */
export function classCacheIsStale(cached: string | undefined, derived: InstrumentClassId): boolean {
  if (cached === undefined) return true;
  return normaliseClassId(cached) !== derived;
}
