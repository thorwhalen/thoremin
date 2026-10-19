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
 * Since #600 S16b it is the Lab slice's: its per-device `PrefSlice` (`featureLab`, the key it
 * always had), read by its overlay element through a derived `store-controls` port and by its panel
 * through the SDK's controls seam.
 */
import { z } from 'zod';
import { DEFAULT_LAB_GROUPS } from '@thoremin/sdk/features/catalog';
import { BODY_GROUP_IDS, FACE_GROUP_IDS, HAND_GROUP_IDS } from '@thoremin/sdk/features/sources';

/** The hot-store field of the Lab's per-device pref (the key it had in core). */
export const LAB_PREF = 'featureLab';

/**
 * A dense grid of grouped, online-normalized meters over the raw face/hand feature
 * vectors, so heterogeneous ranges read as comparable levels.
 *
 * `groups` is the display *and* compute selection: while the meters are shown the Lab claims
 * them as a feature demand (`src/app/labDemand.ts`, #600 S16a), which the feature-vector gate
 * reads (`./groups.ts`), so it drives what is *measured*, not only what is drawn — with the
 * meters off, the nodes emit an empty vector and the catalog costs nothing. `normalizer` picks the level mapping.
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

/** Does the Lab need the body model loaded? (The face rule, for `webcam-body`.) */
export function labWantsBody(cfg: FeatureLabConfig | undefined): boolean {
  if (!cfg?.show) return false;
  return cfg.groups.some((g) => BODY_GROUP_IDS.includes(g));
}

/** Does the open Lab show a hand group? (The face rule, for how many hands the model looks for.) */
export function labWantsHands(cfg: FeatureLabConfig | undefined): boolean {
  if (!cfg?.show) return false;
  return cfg.groups.some((g) => HAND_GROUP_IDS.includes(g));
}
