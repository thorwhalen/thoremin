/**
 * Saved lab-view schema (#119) — a named snapshot of the Feature Lab's config:
 * which feature groups are shown/measured, the normalizer mode + layout, and the
 * set of derived (formula) features. Modeled as its OWN Zod schema and persisted
 * as a zodal collection (see {@link ./labViews}), deliberately separate from the
 * instrument presets (a lab view is an analysis workspace, not a sound).
 *
 * Every field carries a `.default(...)` so a view saved by an older build still
 * parses after new fields are added (the same forward-compat discipline as the
 * settings + recording schemas). The `config` mirrors the drawable subset of the
 * `featureLab` overlay params (not `show`/`resetNonce`, which are live UI state).
 */
import { z } from 'zod';

/** One derived feature: a readable id + a safe formula over feature safe-names. */
export const DerivedFeatureSchema = z.object({
  id: z.string(),
  formula: z.string(),
});
export type DerivedFeature = z.infer<typeof DerivedFeatureSchema>;

/** The persistable Feature Lab configuration (what a saved view captures). */
export const LabViewConfigSchema = z.object({
  groups: z.array(z.string()).default([]),
  normalizer: z.enum(['minmax', 'quantile', 'zscore']).default('minmax'),
  columns: z.number().int().min(1).max(8).default(3),
  showMarkers: z.boolean().default(true),
  showValues: z.boolean().default(false),
  derived: z.array(DerivedFeatureSchema).default([]),
});
export type LabViewConfig = z.infer<typeof LabViewConfigSchema>;

/** A named, persisted lab view. */
export const LabViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  config: LabViewConfigSchema,
});
export type LabView = z.infer<typeof LabViewSchema>;

/** Metadata-only summary (for listing without loading the config payload). */
export type LabViewSummary = Pick<LabView, 'id' | 'name' | 'createdAt'>;
