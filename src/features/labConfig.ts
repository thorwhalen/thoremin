/**
 * The Feature Instrumentation Lab's configuration (#119) — its schema, defaults, and
 * the "does the lab need the face model?" predicate.
 *
 * This lives on its own (rather than inline in the overlay node's params, where it
 * started) because the Lab is a **tooling preference, not an instrument parameter**.
 * It is the same call `#88` made for recording settings: how you *measure* the
 * instrument is not part of the instrument, so it must not ride the per-instrument
 * `overlay` dial — otherwise opening a measuring tool marks your instrument dirty and
 * switching instruments silently re-configures your meters (#136).
 *
 * Two consumers share this SSOT:
 *  - the `canvas-overlay` node, whose `featureLab` element draws the meters (the node's
 *    params still carry the config — `store-controls` composes it in each tick);
 *  - the app's hot control store, which owns the value and persists it per-device.
 */
import { z } from 'zod';
import type { DemandedGroups } from './demand';
import { DEFAULT_LAB_GROUPS, DERIVED_GROUP, FEATURE_GROUPS } from './catalog';

/**
 * A dense grid of grouped, online-normalized meters over the raw face/hand feature
 * vectors, so heterogeneous ranges read as comparable levels.
 *
 * `groups` is the display *and* compute selection: the feature-vector nodes read it off
 * the control snapshot ({@link resolveLabGate}), so it drives what is *measured*, not only
 * what is drawn — with the meters off, the nodes emit an empty vector and the catalog
 * costs nothing. `normalizer` picks the level mapping.
 */
export const FeatureLabSchema = z
  .object({
    show: z.boolean().default(false),
    groups: z.array(z.string()).default([...DEFAULT_LAB_GROUPS]),
    normalizer: z.enum(['minmax', 'quantile', 'zscore']).default('minmax'),
    /** Number of newspaper-flow columns in the meter grid. */
    columns: z.number().int().min(1).max(8).default(3),
    /** Draw the percentile-band reference ticks on each meter. */
    showMarkers: z.boolean().default(true),
    /** Print the raw value beside each meter. */
    showValues: z.boolean().default(false),
    /** User-defined derived features: a safe formula (jsep whitelist) over feature
     *  safe-names (`face.geom.mouth.openness` → `face_geom_mouth_openness`) + the
     *  helper set. Evaluated over the merged face+hand vector; shown under the
     *  `derived` group. An invalid formula is skipped (the editor shows the error). */
    derived: z.array(z.object({ id: z.string(), formula: z.string() })).default([]),
    /**
     * The rolling correlation matrix (#150) over the watched features — the diagnostic
     * that makes #131's invariance labels and `residual`/`deconfound` helpers actionable
     * by showing WHICH confound is actually biting.
     *
     * Default OFF, per the issue: it is O(k^2) per computed frame, and a matrix is a
     * thing you open when you are debugging a mapping, not a thing you play with.
     */
    showCorrelation: z.boolean().default(false),
    /** Cap on how many watched features enter the matrix. Both a cost guard (the work is
     *  quadratic) and a legibility one — a 200x200 grid on a webcam overlay says nothing. */
    correlationMaxFeatures: z.number().int().min(2).max(24).default(12),
    /** Compute the matrix every Nth frame; 1 = every frame. The estimator's window is
     *  divided by this internally, so changing the stride changes the COST, not the
     *  responsiveness. */
    correlationEveryNFrames: z.number().int().min(1).max(30).default(4),
    /** Bump to re-zero the online statistics (a manual "recalibrate"). */
    resetNonce: z.number().default(0),
  })
  .prefault({});

export type FeatureLabConfig = z.infer<typeof FeatureLabSchema>;

/** A fresh default config (never a shared mutable — `groups`/`derived` are arrays). */
export const defaultFeatureLab = (): FeatureLabConfig => FeatureLabSchema.parse({});

/**
 * The feature groups sourced from the FACE. `DERIVED_GROUP` is excluded even though
 * the catalog files it under `source: 'face'` — a derived formula may reference only
 * hand features, so it is not on its own evidence that the face model is wanted.
 */
export const FACE_GROUP_IDS: readonly string[] = FEATURE_GROUPS.filter(
  (g) => g.source === 'face' && g.id !== DERIVED_GROUP,
).map((g) => g.id);

/**
 * Does the Lab need the face model loaded?
 *
 * This is what lets the Lab be a true *measuring* instrument: before #136 the face
 * model loaded only when `faceMapping !== 'none'`, so you could not look at a face
 * meter without also putting your face in charge of the sound — you could not observe
 * without altering. `webcam-face` now gates on the mapping OR on this, so measuring
 * the face costs exactly the model load and nothing musical.
 */
export function labWantsFace(cfg: FeatureLabConfig | undefined): boolean {
  if (!cfg?.show) return false;
  return cfg.groups.some((g) => FACE_GROUP_IDS.includes(g));
}

/**
 * Does a live feature DEMAND (#163) need the face model loaded? The trainer claims
 * face groups while a cue runs; without this the vector node would be computing from a
 * face frame that is never produced, because the model gate only knew about the Lab
 * and the sound mapping.
 */
export function demandWantsFace(demanded: DemandedGroups): boolean {
  if (!demanded) return false;
  for (const g of demanded) if (FACE_GROUP_IDS.includes(g)) return true;
  return false;
}

// ---- The compute gate the feature-vector nodes share ------------------------------

/** The slice of the lab config the feature-vector nodes need off a control snapshot. */
export interface LiveLabConfig {
  show?: boolean;
  groups?: string[];
}

/**
 * A control snapshot as seen through `ctx.resources.controls`, which is the RAW control
 * store — NOT the composed `store-controls` output. So the lab config is at the top
 * level. The nested `overlay.featureLab` is also accepted: that is the composed shape
 * (what `canvas-overlay` receives) and the pre-#136 store shape, and honouring both is
 * what keeps a caller that passes either from silently reading `undefined`.
 */
export type LabControlsSnapshot = {
  featureLab?: LiveLabConfig;
  overlay?: { featureLab?: LiveLabConfig };
};

/** Read the live lab config off a control snapshot, whichever shape it is in. */
export function readLiveLab(controls: LabControlsSnapshot | undefined): LiveLabConfig | undefined {
  return controls?.featureLab ?? controls?.overlay?.featureLab;
}

/**
 * The feature-vector nodes' gate: are we computing at all, and which groups?
 *
 * Shared by `face-feature-vector` and `hand-feature-vector` — they each carried their own
 * copy, and when #136 moved the config off `overlay` both copies kept reading the old
 * path, silently returning `undefined`. An `undefined` live config means "headless", which
 * means "always active": the gate did not fail closed, it failed OPEN, and every user
 * started evaluating the whole 248-feature catalog every frame with the Lab switched off.
 * One copy, in the module that owns the config.
 *
 * `undefined` live config (a headless test / a host that wires no controls) → active with
 * the params' groups. A live config → active only when the meters are shown — OR when
 * some other consumer has a live feature DEMAND (#163, `@/features/demand`): the trainer
 * claims the groups its running cue needs, and those compute whether or not the Lab is
 * open. The Lab's own groups still compute only while it is shown, so a demand never
 * turns the meters on and never widens what they measure.
 */
export function resolveLabGate(
  params: { groups?: string[] },
  controls: LabControlsSnapshot | undefined,
  demanded: DemandedGroups = null,
): { active: boolean; enabled: (group: string) => boolean } {
  const live = readLiveLab(controls);
  const labActive = live ? live.show === true : true;
  const groups = live?.groups ?? params.groups;
  const labSet = groups ? new Set(groups) : null;
  const demand = demanded && demanded.size > 0 ? demanded : null;
  const active = labActive || demand !== null;
  return {
    active,
    enabled: (group: string) =>
      (labActive && (labSet ? labSet.has(group) : true)) || (demand !== null && demand.has(group)),
  };
}
