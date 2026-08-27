/**
 * Cues and routines (#163) — what the trainer asks a player to do, as DATA.
 *
 * ## Vocabulary
 *
 * - A **cue** is one thing the system asks you to do: *"look to your left"*, *"hold any
 *   face and move closer"*. A cue is already a performance instruction in music, it is
 *   short, and the same word serves the spoken and the written form.
 * - A **routine** is a saved, ordered, named list of cues you run end to end.
 *
 * (Rejected: *prompt* — overloaded with LLMs in this codebase; *drill* — tetrachord's
 * term for something else; *step* — what v1 called it, too anonymous to be a collection
 * member; *exercise* — implies the player is practising, when here the system is the
 * one learning.)
 *
 * ## What a cue declares, and what it deliberately does not
 *
 * A cue declares the feature **groups** it attends to (`collects.groups`), never
 * feature ids and never a modality. "I need `face.head`" is a claim the catalog
 * resolves; the runner, the sampler and the sufficiency evaluator only ever see a
 * `FeatureVector` and a list of ids. That is the extension seam for other signals — a
 * hand routine is a different list of group ids, not a different type — and it is why
 * nothing in this file may mention a face.
 *
 * `collects.groups` is the cue's ATTENTION set: what "held" is judged on, and what the
 * sufficiency test measures. It is not what gets recorded. Every still-point in a take
 * carries the routine's full feature set (the union over its cues), because a point
 * with only head features and a point with a hundred expression features cannot be
 * compared, and the hierarchy compares every point with every other.
 *
 * ## The Zod schema is the SSOT (project rule: zodal)
 *
 * Cues persist as a named collection (`createNamedCollectionStore`), so the schema
 * below is what a cue *is*; the store, the picker and the voice generator all derive
 * from it. Every optional field carries a default, so a cue saved by an older build
 * still parses after fields are added.
 *
 * ## Two wording rules every cue must obey
 *
 * **Never show a target face to imitate.** Prescribed expressions are the failure mode
 * this whole feature exists to escape. A cue may ask for a *movement* ("look left") or
 * leave the choice to the player ("any face you can make reliably"); it may not name
 * an expression to produce. (`test/enroll_cues.test.ts` checks the starter set.)
 *
 * **The written and spoken forms say the same thing.** `instruction` is both. Voice is a
 * toggle, text is not — a player with sound off loses nothing.
 */
import { z } from 'zod';
import type { Invariance } from '@/features/types';

/** The confound axes a cue can demonstrate (mirrors `Invariance` — checked below). */
export const INVARIANCE_AXES = ['scale', 'position', 'yaw', 'pitch', 'roll'] as const satisfies readonly Invariance[];
// Exhaustiveness: if `Invariance` grows, this line fails to compile until the list is updated.
const _exhaustive: Exclude<Invariance, (typeof INVARIANCE_AXES)[number]> extends never ? true : never = true;
void _exhaustive;

export const InvarianceSchema = z.enum(INVARIANCE_AXES);

/**
 * How the runner decides it has ENOUGH for a cue — a reference to a strategy plus its
 * parameters. The evaluator (`sufficiency.ts`) dispatches on `kind`; a smarter
 * evaluator may ignore these and still honour the contract. Every parameter in noise
 * units is a multiple of a feature's own jitter (see `noise.ts`), so the same number
 * means the same thing for an angle and for a blendshape.
 */
export const SufficiencySchema = z.discriminatedUnion('kind', [
  /** Continuous cues: enough once `minFrames` frames carrying the cue's features arrived. */
  z.object({
    kind: z.literal('frames'),
    minFrames: z.number().int().min(1).default(90),
    /** Give up (verdict `cannot`) after this long without `enough`. */
    patienceMs: z.number().min(1000).default(20000),
  }),
  /**
   * A movement cue: enough once `minPoints` still-points sit at least `minExcursion`
   * noise-sigma (RMS over the cue's features) from the resting baseline. A point
   * closer than that earns a variation ("a bit further").
   */
  z.object({
    kind: z.literal('excursion'),
    minPoints: z.number().int().min(1).default(1),
    /**
     * Default 12 noise-sigma. The distance is the RMS of the cue's features (a head cue:
     * yaw, pitch, roll), each in units of its own jitter — so a single-axis turn is
     * DILUTED by ~sqrt(3), and this is measured against that RMS, not one axis.
     *
     * Measured on the recorded clip (`video_head_pose`), the genuinely-held deliberate
     * moves read (RMS, shipped sampler): look-right ~46σ, look-up ~38σ, look-down ~19σ —
     * the weakest, a soft chin-down, is ~19. The old default of 8 fired on a sub-2° twitch
     * ("Good" before the player did the cue); an over-eager 30 would REJECT that ~19σ
     * look-down and time out. 12 clears the weakest held move with ~1.5x margin (and room
     * for the ~1.8x sigma inflation across a routine of back-to-back moves) while still
     * rejecting a held sub-2° drift (~9σ RMS).
     *
     * A fixed sigma bar is inherently camera-dependent (the player's live report of "fires
     * too early" was on a different sensor than this clip): the RELIABLE controls for
     * pacing are the Done/Enter override and manual mode. Live-tune per #146 §8.
     */
    minExcursion: z.number().min(0).default(12),
    patienceMs: z.number().min(1000).default(20000),
  }),
  /**
   * A free-vocabulary cue: enough once `minPoints` MUTUALLY DISTINCT still-points
   * exist (each at least `minSeparation` noise-sigma from every other accepted one).
   * A near-duplicate earns "try a different one"; a long silence earns "hold it".
   */
  z.object({
    kind: z.literal('variety'),
    minPoints: z.number().int().min(1).default(6),
    /** Noise-sigma (RMS over the cue's features) two held poses must differ by to count
     *  as DISTINCT. Bumped modestly from 6 (which accepted micro-variations of one
     *  expression) to 10 — a separable expression change, without demanding so much that
     *  a player's real repertoire fails to accumulate. No expression clip to measure
     *  against yet; provisional, live-tune per #146 §8. */
    minSeparation: z.number().min(0).default(10),
    /** Without a new still-point for this long, ask the player to hold still. */
    holdNudgeMs: z.number().min(1000).default(8000),
    patienceMs: z.number().min(1000).default(60000),
  }),
]);
export type Sufficiency = z.infer<typeof SufficiencySchema>;

/** What a cue's samples are consumed as when the model is built. */
export const CueProductSchema = z.enum([
  /** The resting state: every frame; sets the reject (no-man's-land) baseline. */
  'baseline',
  /** A demonstrated nuisance: every frame; whatever moved is down-weighted. */
  'nuisance',
  /** Vocabulary: held poses become the still-points the categories are carved from. */
  'vocabulary',
]);
export type CueProduct = z.infer<typeof CueProductSchema>;

export const CueCollectsSchema = z.object({
  /** Feature GROUP ids the cue attends to (catalog groups, e.g. `face.head`). */
  groups: z.array(z.string().min(1)).min(1),
  /** Feature ids inside those groups to leave out (a raw frame position is where you
   *  sit, not what you do). */
  omit: z.array(z.string()).default([]),
  /** For a nuisance cue: the confound axes it demonstrates. */
  axes: z.array(InvarianceSchema).default([]),
});

/** The payload of a cue — everything but its identity. What the collection stores. */
export const CueSpecSchema = z
  .object({
    /** The instruction, written and spoken. Never "make THIS face". */
    instruction: z.string().min(1),
    /** One line on what it buys — shown so a cue never feels arbitrary. */
    rationale: z.string().default(''),
    collects: CueCollectsSchema,
    produces: CueProductSchema,
    sufficiency: SufficiencySchema,
    /** Follow-ups the evaluator can ask for, in order: "a bit further", "now slower". */
    variations: z.array(z.string().min(1)).default([]),
    /** Free-form labels for the picker's filter (`pose`, `expression`, `setup`, …). */
    tags: z.array(z.string()).default([]),
  })
  .superRefine((c, ctx) => {
    if (c.produces === 'nuisance' && c.collects.axes.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['collects', 'axes'], message: 'a nuisance cue must name the axes it demonstrates' });
    }
    const continuous = c.produces === 'baseline' || c.produces === 'nuisance';
    if (continuous && c.sufficiency.kind !== 'frames') {
      ctx.addIssue({ code: 'custom', path: ['sufficiency'], message: `a ${c.produces} cue samples every frame; its sufficiency must be 'frames'` });
    }
    if (!continuous && c.sufficiency.kind === 'frames') {
      ctx.addIssue({ code: 'custom', path: ['sufficiency'], message: 'a vocabulary cue samples still-points; its sufficiency cannot be frame-counting' });
    }
  });
export type CueSpec = z.infer<typeof CueSpecSchema>;
/** The loosest input the spec accepts (defaults not yet applied) — for authoring. */
export type CueSpecInput = z.input<typeof CueSpecSchema>;

/** A cue as the runner consumes it: identity plus spec, flat. */
export const CueSchema = z.object({ id: z.string().min(1), name: z.string().min(1) }).and(CueSpecSchema);
export type Cue = z.infer<typeof CueSchema>;

/** A cue as the named collection persists it (`{id, name, createdAt, cue}`). */
export const CueRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  cue: CueSpecSchema,
});
export type CueRecord = z.infer<typeof CueRecordSchema>;

/** Flatten a stored record into the runner's shape. */
export function cueFromRecord(record: CueRecord): Cue {
  return { id: record.id, name: record.name, ...record.cue };
}

/** The ordered list of cue ids a routine runs. Ids are unique: a session holds samples
 *  per cue id, so running one cue twice would silently replace the first run's take. */
export const RoutineSpecSchema = z.object({
  cueIds: z
    .array(z.string().min(1))
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'a routine lists each cue at most once' }),
});
export type RoutineSpec = z.infer<typeof RoutineSpecSchema>;

export const RoutineRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  routine: RoutineSpecSchema,
});
export type RoutineRecord = z.infer<typeof RoutineRecordSchema>;

/** How a cue samples: every frame (its content is the spread) or held poses only. */
export type CueSampling = 'continuous' | 'still-points';

export function samplingFor(cue: Pick<Cue, 'produces'>): CueSampling {
  return cue.produces === 'vocabulary' ? 'still-points' : 'continuous';
}

/**
 * Resolve a cue's attention set against a feature registry: the ids whose group is
 * one of the cue's groups, minus `omit`. `groupOf` is injected so this file stays
 * ignorant of the catalog (and so a test can use a toy registry).
 */
export function cueFeatures(
  cue: Pick<Cue, 'collects'>,
  allIds: readonly string[],
  groupOf: (id: string) => string | undefined,
): string[] {
  const groups = new Set(cue.collects.groups);
  const omit = new Set(cue.collects.omit);
  return allIds.filter((id) => !omit.has(id) && groups.has(groupOf(id) ?? ''));
}

/** The union of every cue's attention set — what a routine needs computed and recorded. */
export function routineFeatures(
  cues: readonly Pick<Cue, 'collects'>[],
  allIds: readonly string[],
  groupOf: (id: string) => string | undefined,
): string[] {
  const seen = new Set<string>();
  for (const cue of cues) for (const id of cueFeatures(cue, allIds, groupOf)) seen.add(id);
  // Keep the registry's order, not insertion order, so the set is stable across routines.
  return allIds.filter((id) => seen.has(id));
}

/** The union of every cue's groups — what a routine asks the engine to compute. */
export function routineGroups(cues: readonly Pick<Cue, 'collects'>[]): string[] {
  const out: string[] = [];
  for (const cue of cues) for (const g of cue.collects.groups) if (!out.includes(g)) out.push(g);
  return out;
}

/**
 * Resolve a routine's cue ids against a cue list, in order. Unknown ids are reported,
 * not thrown: a routine that names a cue someone deleted should run the rest and say
 * what it skipped. A repeated id runs once (its first occurrence).
 */
export function resolveRoutine(
  cueIds: readonly string[],
  cues: readonly Cue[],
): { cues: Cue[]; missing: string[] } {
  const byId = new Map(cues.map((c) => [c.id, c]));
  const found: Cue[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const id of cueIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const c = byId.get(id);
    if (c) found.push(c);
    else missing.push(id);
  }
  return { cues: found, missing };
}
