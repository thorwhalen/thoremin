/**
 * Binding a learned category to what the instrument does (#160's last verb).
 *
 * The trainer ends in a {@link TrainedModel}. This module is the pure half of making that
 * model PLAYABLE: the schema a saved model and its bindings persist under, the edge that
 * says "the player has just moved into category X", and the adapter onto the generic
 * {@link CategoryScores} contract every classifier in the repo reports through (the ASL
 * reader first, #303), so one readout and one overlay cue serve all of them.
 *
 * ## A category is a state; its command writes that state once, on entry
 *
 * The design question on #160 was whether a category is an EVENT (fire a command, like a
 * gesture) or a STATE (drive a dial continuously). The answer here is both, at different
 * layers: the category the player holds is a state, tracked with hysteresis by
 * {@link createCategoryTracker}; the binding is a command, dispatched through the #87
 * registry when the player moves INTO a category and has held it for `holdMs`. A command
 * that sets a dial leaves the dial set for as long as the player stays — the state lives
 * in the dial, where every other surface can see, undo and save it — so nothing is lost by
 * firing on the edge, and everything the write path offers (undo, the journal, the
 * confirmation gate, the AI tool surface) is had for free.
 *
 * Firing rules (pinned by `test/enroll_bind.test.ts`):
 *
 * 1. **Entry, never state.** One entry fires at most once, however long it is held.
 * 2. **Held.** The tracker must keep the category committed for `holdMs` from the commit.
 * 3. **A return fires again.** A -> B -> A fires A twice; A -> no-man's-land -> A does
 *    not, because the tracker HOLDS A through no-man's-land (that is the classifier's
 *    musical default: an excursion is not a change of mind).
 * 4. **No reading, no change.** A frame holding too few of the model's features (the face
 *    left the frame) is not classified at all: a missing feature contributes nothing to a
 *    distance, so an empty vector would otherwise sit at distance 0 from every centroid.
 *
 * Pure: no DAG, no React, no registry. The host (`src/app/enroll/categoryDispatch.ts`)
 * feeds it the live vector and owns what an entry dispatches.
 */
import { z } from 'zod';
import type { CategoryScores } from '../nodes/domain';
import { createCategoryTracker, type TrackerOptions } from './classify';
import type { Classification, FeatureVector, TrainedModel } from './types';

/** A category's binding: a command id and its fixed args (the gesture binding's shape). */
export const CategoryBindingSchema = z.object({
  command: z.string().min(1),
  args: z.record(z.string(), z.unknown()).optional(),
});
export type CategoryBinding = z.infer<typeof CategoryBindingSchema>;

/** A {@link TrainedModel} as persisted data (it is plain numbers by construction). */
export const TrainedModelSchema = z.object({
  categories: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string(),
      centroid: z.record(z.string(), z.number()),
      size: z.number(),
      radius: z.number(),
      members: z.array(z.number()),
      cues: z.record(z.string(), z.number()).optional(),
    }),
  ),
  weights: z.record(z.string(), z.number()),
  features: z.array(z.string()),
  rejectRadius: z.number(),
});

/** What a saved set of categories carries: the model, and what each category does. */
export const BoundCategoriesSchema = z.object({
  model: TrainedModelSchema,
  /** Category id -> binding. A category with no entry is recognised but does nothing. */
  bindings: z.record(z.string(), CategoryBindingSchema).default({}),
});
export type BoundCategories = z.infer<typeof BoundCategoriesSchema>;

/** A category's display name: its label, else its position ("category 2"). */
export function categoryName(model: Pick<TrainedModel, 'categories'>, id: string): string {
  const i = model.categories.findIndex((c) => c.id === id);
  if (i < 0) return id;
  return model.categories[i].label.trim() || `category ${i + 1}`;
}

/**
 * Re-key bindings from an old model onto a new one by category NAME. Retraining gives new
 * positional ids, but a player who bound "smile" and retrained still means "smile";
 * a name that no longer exists drops its binding rather than attaching it to a stranger.
 */
export function carryBindings(
  from: Pick<BoundCategories, 'model' | 'bindings'> | null | undefined,
  to: Pick<TrainedModel, 'categories'>,
): Record<string, CategoryBinding> {
  if (!from) return {};
  const byName = new Map<string, CategoryBinding>();
  for (const [id, b] of Object.entries(from.bindings)) {
    const label = from.model.categories.find((c) => c.id === id)?.label.trim();
    if (label) byName.set(label, b);
  }
  const out: Record<string, CategoryBinding> = {};
  for (const c of to.categories) {
    const b = byName.get(c.label.trim());
    if (b) out[c.id] = b;
  }
  return out;
}

/** True when `vector` holds at least `minPresent` (a fraction) of the model's features. */
export function hasReading(model: Pick<TrainedModel, 'features'>, vector: FeatureVector | null | undefined, minPresent: number): boolean {
  if (!vector || model.features.length === 0) return false;
  let n = 0;
  for (const f of model.features) if (Number.isFinite(vector[f])) n += 1;
  return n > 0 && n >= minPresent * model.features.length;
}

/** One stabilised reading: the tracker's classification, and whether a category is held. */
export type CategoryReading = Classification & { held: boolean };

/**
 * A reading as {@link CategoryScores}, the contract the overlay's `categoryLabel` /
 * `categoryBars` cues and the readouts draw: one bar per category (its soft membership),
 * the committed category named. `null` (no reading) is `present: false`.
 */
export function toCategoryScores(model: TrainedModel, reading: CategoryReading | null, title?: string): CategoryScores {
  const labels = model.categories.map((c) => categoryName(model, c.id));
  if (!reading) return { present: false, label: null, labels, scores: labels.map(() => 0), ...(title ? { title } : {}) };
  return {
    present: true,
    label: reading.categoryId ? categoryName(model, reading.categoryId) : null,
    labels,
    scores: model.categories.map((c) => reading.memberships[c.id] ?? 0),
    ...(title ? { title } : {}),
  };
}

export interface CategoryEdgeOptions extends TrackerOptions {
  /** How long (ms) a newly committed category must stay committed before its entry fires. */
  holdMs?: number;
  /** Fraction of the model's features a frame must hold to be classified at all. */
  minPresent?: number;
}

export const CATEGORY_EDGE_DEFAULTS = { holdMs: 150, minPresent: 0.5 } as const;

export interface CategoryStep {
  /** The stabilised reading, or null when the frame held no usable reading. */
  reading: CategoryReading | null;
  /** The category whose ENTRY completed on this frame (fire its binding), else null. */
  entered: string | null;
}

export interface CategoryEdge {
  /** Feed one frame (`nowMs` is its time); returns the reading and any completed entry. */
  push(vector: FeatureVector | null | undefined, nowMs: number): CategoryStep;
  /** The committed category, or null. */
  current(): string | null;
  /** Change the hold without disturbing what is committed (a slider drag must not re-fire). */
  setHoldMs(ms: number): void;
  /** Forget everything: the next commit is a fresh entry. */
  reset(): void;
}

/** Build the entry edge over a model (fresh tracker state). See the module doc for rules. */
export function createCategoryEdge(model: TrainedModel, options: CategoryEdgeOptions = {}): CategoryEdge {
  let holdMs = options.holdMs ?? CATEGORY_EDGE_DEFAULTS.holdMs;
  const minPresent = options.minPresent ?? CATEGORY_EDGE_DEFAULTS.minPresent;
  const tracker = createCategoryTracker(model, options);
  /** The committed category, when it was committed, and whether that entry is spent. */
  let committed: string | null = null;
  let since = 0;
  let spent = true;

  return {
    push(vector, nowMs) {
      if (!hasReading(model, vector, minPresent)) return { reading: null, entered: null };
      const reading = tracker.push(vector as FeatureVector);
      const now = tracker.current();
      if (now !== committed) {
        committed = now;
        since = nowMs;
        spent = now === null;
      }
      if (spent || nowMs - since < holdMs) return { reading, entered: null };
      spent = true;
      return { reading, entered: committed };
    },
    current: () => committed,
    setHoldMs(ms) {
      holdMs = ms;
    },
    reset() {
      tracker.reset();
      committed = null;
      since = 0;
      spent = true;
    },
  };
}
