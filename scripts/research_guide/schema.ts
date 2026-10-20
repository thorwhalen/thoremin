/**
 * The research guide's curation contract: the shape of the hand-written data the
 * generator merges with what it reads from the repo and from GitHub.
 *
 * Two files share it. `guide.json` (committed, beside this module) holds only what is
 * derived from public material: the repo's docs, its issues, PRs and discussions.
 * The private overlay (outside the repo, see `config.ts`) holds the same shapes for the
 * private working documents, the ledger-only measurements and the annals links. A doc
 * found on disk with no entry in either file is not dropped: it is listed as "new,
 * needs an abstract", which is what keeps the guide from silently missing a doc.
 */
import { z } from 'zod';

export const AREA_IDS = [
  'timing', 'body', 'conductor', 'face', 'trainer', 'air', 'harmony', 'asl',
  'latency', 'datasets', 'generative', 'architecture',
] as const;
export const AreaIdSchema = z.enum(AREA_IDS);
export type AreaId = z.infer<typeof AreaIdSchema>;

const nums = z.array(z.number().int().positive()).optional();

export const AreaSchema = z.object({
  id: AreaIdSchema,
  title: z.string(),
  blurb: z.string(),
});

export const DocEntrySchema = z.object({
  /** Repo-relative path, or `private:<path under a private root>`. */
  path: z.string(),
  title: z.string(),
  area: AreaIdSchema,
  abstract: z.string(),
  status: z.enum(['current', 'superseded', 'moved', 'measured-negative', 'design-record', 'implemented', 'open']),
  numbers: z.array(z.string()).optional(),
  issues: nums,
  prs: nums,
  /** Repo-relative (or `private:`) images or CSVs the doc uses. */
  figures: z.array(z.string()).optional(),
  /** The doc's annals page, when one was published. */
  annals: z.string().optional(),
});
export type DocEntry = z.infer<typeof DocEntrySchema>;

export const ExperimentSchema = z.object({
  id: z.string(),
  title: z.string(),
  area: AreaIdSchema,
  verdict: z.enum(['positive', 'negative', 'mixed', 'inconclusive']),
  number: z.string(),
  summary: z.string(),
  issues: nums,
  prs: nums,
  doc: z.string().optional(),
  date: z.string().optional(),
  /** Where a private record came from (`ledger:<name>`). */
  source: z.string().optional(),
});
export type Experiment = z.infer<typeof ExperimentSchema>;

export const DecisionSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(['adr', 'design', 'decision']),
  status: z.enum(['accepted', 'implemented', 'open', 'superseded', 'proposed', 'rejected']),
  decided: z.string(),
  path: z.string().optional(),
  issue: z.number().int().positive().optional(),
  prs: nums,
  date: z.string().optional(),
  supersededBy: z.string().optional(),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const IdeaSchema = z.object({
  title: z.string(),
  source: z.string(),
  issue: z.number().int().positive().optional(),
  summary: z.string(),
});
export type Idea = z.infer<typeof IdeaSchema>;

/** Open issues are grouped by the first theme whose label or keyword matches. */
export const ThemeSchema = z.object({
  id: z.string(),
  title: z.string(),
  labels: z.array(z.string()).optional(),
  keywords: z.array(z.string()),
});

/** A bar chart drawn at build time from a CSV under the repo (`agg` over `value`, one bar per `groupBy`). */
export const ChartSchema = z.object({
  id: z.string(),
  title: z.string(),
  caption: z.string(),
  csv: z.string(),
  filter: z.record(z.string(), z.string()).optional(),
  groupBy: z.string(),
  value: z.string(),
  agg: z.enum(['max', 'mean', 'min']),
  /** The doc the chart illustrates (its card shows the chart). */
  doc: z.string().optional(),
});
export type Chart = z.infer<typeof ChartSchema>;

export const DiagramSchema = z.object({
  id: z.string(),
  title: z.string(),
  caption: z.string(),
  mermaid: z.string(),
});

export const GuideDataSchema = z.object({
  areas: z.array(AreaSchema),
  docs: z.array(DocEntrySchema),
  experiments: z.array(ExperimentSchema),
  decisions: z.array(DecisionSchema),
  ideas: z.array(IdeaSchema).default([]),
  themes: z.array(ThemeSchema),
  epics: z.array(z.number().int().positive()),
  discussions: z.array(z.number().int().positive()),
  charts: z.array(ChartSchema).default([]),
  diagrams: z.array(DiagramSchema).default([]),
  /** Repo doc globs (prefix match) that are not research, design or reference: never listed as "needs an abstract". */
  ignoreDocs: z.array(z.string()).default([]),
});
export type GuideData = z.infer<typeof GuideDataSchema>;

/** The private overlay: the same records, for material that must never reach the repo. */
export const PrivateDataSchema = z.object({
  docs: z.array(DocEntrySchema).default([]),
  experiments: z.array(ExperimentSchema).default([]),
  ideas: z.array(IdeaSchema).default([]),
  /** Annals links for repo docs too (a repo doc's page published to the in-tray). */
  annals: z.record(z.string(), z.string()).default({}),
  /** `private:` path prefixes that are not research (drafts, page sources): never listed as "needs an abstract". */
  ignoreDocs: z.array(z.string()).default([]),
});
export type PrivateData = z.infer<typeof PrivateDataSchema>;
