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
 * that sets a dial leaves the dial set — the state lives in the dial, where every other
 * surface can see, undo and save it — and everything the write path offers (undo, the
 * journal, the confirmation gate, the AI tool surface) is had for free. What an edge does
 * NOT give is "leaving reverts": leaving a category sets nothing back. That is the
 * continuous reading (memberships -> a dial), tracked as #323.
 *
 * Firing rules (pinned by `test/enroll_bind.test.ts`; the gesture dispatcher's, #129):
 *
 * 1. **Entry, never state.** One entry fires at most once, however long it is held.
 * 2. **Held.** The player must be ON the category (the raw classification agrees with the
 *    committed one, frame after frame) for `holdMs` without a break. Three frames of A
 *    and away again fires nothing, whatever the tracker still has committed.
 * 3. **A return fires again.** A -> B -> A fires A twice, and so does A -> rest -> A: the
 *    rest pose IS no-man's-land (the baseline cue sets the reject radius), and a stay
 *    there past the tracker's exit hysteresis is an exit. A blink shorter than that is
 *    held through, as the classifier intends. A re-entry of the same category inside
 *    `cooldownMs` of its last fire is spent silently (boundary chatter).
 * 4. **No reading, no change.** A frame holding too few of the model's features (the face
 *    left the frame) is not classified at all: a missing feature contributes nothing to a
 *    distance, so a sparse vector would otherwise sit close to every centroid. A gap also
 *    breaks the hold.
 * 5. **Arming fires nothing.** A fresh (or reset) edge ADOPTS the first category it sees
 *    without firing it, unless it first saw the player outside every category. Enabling,
 *    a trainer closing, switching sets or an engine rebuild while the player holds a
 *    category arm only FUTURE entries ("enabling arms future transitions", #129).
 *
 * Pure: no DAG, no React, no registry. The host (`src/app/enroll/categoryDispatch.ts`)
 * feeds it the live vector and owns what an entry dispatches.
 */
import { HAND_CHOICES } from './modality';
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

/** One category of a persisted model. */
const CategorySchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  centroid: z.record(z.string(), z.number()),
  size: z.number(),
  radius: z.number(),
  members: z.array(z.number()),
  cues: z.record(z.string(), z.number()).optional(),
  /** A per-category size (#385 E7: every distance to it multiplied before any comparison), kept
   *  so a carved categorizer bound to commands reads as its live test does (#385 E8). */
  scale: z.number().positive().optional(),
});

/** A {@link TrainedModel} as persisted data (it is plain numbers by construction). */
export const TrainedModelSchema = z.object({
  categories: z.array(CategorySchema),
  weights: z.record(z.string(), z.number()),
  features: z.array(z.string()),
  rejectRadius: z.number(),
  /** The taught Neutral class's prototypes (#385 E5), when there is one. */
  neutral: z.array(CategorySchema).optional(),
});

/** What a saved set of categories carries: the model, and what each category does. */
/**
 * How a bound set reads the live vector (#385 E8): the carve modality its model was made in (its
 * features are that modality's keys, e.g. a hand categorizer's side-relative `index.curl`) and,
 * for a hand, which one; for a body, whether its mirror image is the same pose. Absent: the merged vector as is (the trainer's models, the face's).
 */
export const CategoryReadSchema = z.object({
  modality: z.string().min(1),
  hand: z.enum(HAND_CHOICES).optional(),
  /** A body categorizer reads a pose and its mirror image as one (#382). */
  mirror: z.literal(true).optional(),
});
export type CategoryRead = z.infer<typeof CategoryReadSchema>;

export const BoundCategoriesSchema = z.object({
  model: TrainedModelSchema,
  /** Category id -> binding. A category with no entry is recognised but does nothing. */
  bindings: z.record(z.string(), CategoryBindingSchema).default({}),
  /** How the live vector is read (a carved categorizer's modality); absent: as is. */
  read: CategoryReadSchema.optional(),
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
 * a name that no longer exists (or that two categories share) drops its binding rather
 * than attaching it to a stranger.
 */
export function carryBindings(
  from: Pick<BoundCategories, 'model' | 'bindings'> | null | undefined,
  to: Pick<TrainedModel, 'categories'>,
): Record<string, CategoryBinding> {
  if (!from) return {};
  // A name worn by two categories (on either side) is ambiguous: it carries nothing.
  const unique = (cats: readonly { label: string }[]) => {
    const n = new Map<string, number>();
    for (const c of cats) {
      const l = c.label.trim();
      if (l) n.set(l, (n.get(l) ?? 0) + 1);
    }
    return (l: string) => !!l && n.get(l) === 1;
  };
  const oldUnique = unique(from.model.categories);
  const newUnique = unique(to.categories);
  const byName = new Map<string, CategoryBinding>();
  for (const [id, b] of Object.entries(from.bindings)) {
    const label = from.model.categories.find((c) => c.id === id)?.label.trim() ?? '';
    if (oldUnique(label)) byName.set(label, b);
  }
  const out: Record<string, CategoryBinding> = {};
  for (const c of to.categories) {
    const label = c.label.trim();
    const b = newUnique(label) ? byName.get(label) : undefined;
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
  /** How long (ms) the player must be ON a newly entered category before its entry fires. */
  holdMs?: number;
  /** After a category fires, a re-entry of the SAME category within this many ms is spent
   *  silently (boundary chatter; a broken binding's toast cannot machine-gun). */
  cooldownMs?: number;
  /** Fraction of the model's features a frame must hold to be classified at all. */
  minPresent?: number;
}

export const CATEGORY_EDGE_DEFAULTS = { holdMs: 150, cooldownMs: 400, minPresent: 0.9 } as const;

export interface CategoryStep {
  /** The stabilised reading, or null when the frame held no usable reading. */
  reading: CategoryReading | null;
  /** The category whose ENTRY completed on this frame (fire its binding), else null. */
  entered: string | null;
}

export interface CategoryEdge {
  /** Feed one frame (`nowMs` is its time); returns the reading and any completed entry. */
  push(vector: FeatureVector | null | undefined, nowMs: number): CategoryStep;
  /** The category the player is in (committed, and not in admitted no-man's-land), or null. */
  current(): string | null;
  /** Change the hold without disturbing what is committed (a slider drag must not re-fire). */
  setHoldMs(ms: number): void;
  /** Forget everything. The next category the edge sees is ADOPTED, not fired. */
  reset(): void;
}

/** Build the entry edge over a model (fresh tracker state). See the module doc for rules. */
export function createCategoryEdge(model: TrainedModel, options: CategoryEdgeOptions = {}): CategoryEdge {
  let holdMs = options.holdMs ?? CATEGORY_EDGE_DEFAULTS.holdMs;
  const cooldownMs = options.cooldownMs ?? CATEGORY_EDGE_DEFAULTS.cooldownMs;
  const minPresent = options.minPresent ?? CATEGORY_EDGE_DEFAULTS.minPresent;
  // `holdOnReject: false`: a stay in no-man's-land past the exit hysteresis is a real exit,
  // so resting and coming back is a fresh entry. A blink (shorter than `exitFrames`) is not.
  const tracker = createCategoryTracker(model, { ...options, holdOnReject: false });
  let committed: string | null = null;
  /** True until the edge has seen the player OUTSIDE a category or entered one: the first
   *  category a fresh edge sees is where the player already was (rule 5). */
  let fresh = true;
  /** The current entry has fired (or was adopted, or cooled down). */
  let spent = true;
  /** Start of the current unbroken run of frames ON the committed category. */
  let since = 0;
  let onRun = false;
  const lastFire = new Map<string, number>();

  return {
    push(vector, nowMs) {
      if (!hasReading(model, vector, minPresent)) {
        onRun = false; // a gap breaks the hold (rule 4)
        return { reading: null, entered: null };
      }
      const reading = tracker.push(vector as FeatureVector);
      const now = tracker.current();
      if (fresh && now === null && reading.distance > model.rejectRadius) fresh = false;
      if (now !== committed) {
        committed = now;
        onRun = false;
        spent = now === null || fresh;
        if (now !== null) fresh = false;
      }
      // ON the category: the raw classification agrees with what is committed, this frame.
      const on = committed !== null && !reading.held && !reading.rejected && reading.categoryId === committed;
      if (!on) {
        onRun = false;
        return { reading, entered: null };
      }
      if (!onRun) {
        onRun = true;
        since = nowMs;
      }
      if (spent || nowMs - since < holdMs) return { reading, entered: null };
      spent = true;
      const last = lastFire.get(committed!);
      if (last !== undefined && nowMs - last < cooldownMs) return { reading, entered: null };
      lastFire.set(committed!, nowMs);
      return { reading, entered: committed };
    },
    current: () => committed,
    setHoldMs(ms) {
      holdMs = ms;
    },
    reset() {
      tracker.reset();
      committed = null;
      fresh = true;
      spent = true;
      onRun = false;
      since = 0;
      lastFire.clear();
    },
  };
}
