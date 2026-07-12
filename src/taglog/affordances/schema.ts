/**
 * taglog — affordance schemas (the SSOT of what tagging data *is*).
 *
 * This is the reusable heart of the live-tagging tool (thoremin issue #92,
 * design research in discussion #81). It defines, with Zod, the two schemas the
 * whole system pivots on — the **TagDef** (a tag's definition, chosen before
 * recording) and the **TagEvent** (one wire row in `tags.jsonl`) — plus the
 * neutral in-memory types (`TagAction`, `EdgeEvent`, `TagState`, `ResolvedInterval`)
 * the pure logic passes around.
 *
 * Design crux (BORIS / Praat precedent): **`kind` lives on the definition, `status`
 * lives on the event.** A tag is declared `interval` or `point`; an event carries
 * `open` / `close` / `point`. That keeps the event log self-describing and small.
 *
 * Nothing here imports React, storage, or timers — it is the extraction-ready core
 * (`taglog`). Dependency direction is strictly presentation -> affordances <- provider.
 */
import { z } from 'zod';

/** The schema id written into a `annotations.jsonl` anchor record (version from day one,
 * per the annotation-systems survey). Overridable for a non-thoremin host.
 *
 * NOTE ON VOCABULARY: this library is `taglog` and its internal nouns are tag/TagDef/
 * TagEvent — a deliberately generic vocabulary, since it is built to be lifted out as a
 * standalone package. thoremin's *product* surface calls these **markers**, because
 * "tag" is already taken there by the instrument library (keywords on a saved preset),
 * and one word for two unrelated things was actively confusing. So: `tag` inside this
 * folder, `marker` in the UI and in the artifacts thoremin writes to disk. */
export const ANNOTATIONS_SCHEMA_ID = 'thoremin.annotations/1' as const;

/** A tag is either a labelled interval (open then close) or an instantaneous point. */
export const TagKindSchema = z.enum(['interval', 'point']);
export type TagKind = z.infer<typeof TagKindSchema>;

/** The event edge discriminator — the point/interval representation the user chose
 * as the recommended default (§4c strategy b): one row per action. */
export const TagStatusSchema = z.enum(['open', 'close', 'point']);
export type TagStatus = z.infer<typeof TagStatusSchema>;

/** Which clock an event `t` is on. `media` = the engine/recorder clock
 * (performance.now()/1000 = the DAG `ctx.time`), the SAME absolute clock
 * features.jsonl uses — so the take offset is `t - t0` for BOTH streams. `perf` =
 * raw performance.now (a non-recording fallback). */
export const TagClockSchema = z.enum(['media', 'perf']);
export type TagClock = z.infer<typeof TagClockSchema>;

/** Provenance of an event: a keyboard digit, a button click, or an auto-close
 * triggered by mutual exclusivity. */
export const TagSrcSchema = z.enum(['key', 'click', 'auto']);
export type TagSrc = z.infer<typeof TagSrcSchema>;

/**
 * A single tag's definition — chosen and ordered before recording, persisted as
 * part of a tag set (the provider layer). `id` is the stable slug that survives
 * renames/reorders; `number` (1..9) is the positional keyboard shortcut assigned
 * by display order (null past the ninth tag → click-only).
 */
export const TagDefSchema = z.object({
  /** Stable slug (survives label edits / reordering). */
  id: z.string().min(1),
  /** Human label shown on the button. */
  label: z.string(),
  /** Positional keyboard shortcut 1..9 (UI-assigned by order); null = no shortcut. */
  number: z.number().int().min(1).max(9).nullable().default(null),
  /** interval (default) | point — the BORIS/Praat "behavior type". */
  kind: TagKindSchema.default('interval'),
  /** Pre-roll seconds (single digit, §6): open shifts later, close earlier. 0 = none. */
  leadIn: z.number().min(0).max(9).default(0),
  /** Mutual-exclusivity group id (§7); null = ungrouped. */
  group: z.string().nullable().default(null),
  /** Presentation colour (kept here for convenience — the survey allows a UI hint). */
  color: z.string().default('#34d399'),
  /** Display / z order in the button stack. */
  order: z.number().int().default(0),
});
export type TagDef = z.infer<typeof TagDefSchema>;

/**
 * One JSONL row (the `statusEnum` wire representation, the thoremin default). `t`
 * is the RAW event time on the absolute engine clock (offset into the take = `t - t0`,
 * §5); `tCorrected` is `t` adjusted by the tag's lead-in (§6) and is a derived
 * convenience — `t` remains the source of truth.
 */
export const TagEventSchema = z.object({
  /** Raw event time, seconds, on the absolute engine clock (offset = t - t0). */
  t: z.number(),
  /** Lead-in-corrected time (derived; open = t+leadIn, close = t-leadIn, point = t). */
  tCorrected: z.number(),
  /** TagDef.id. */
  tag: z.string(),
  /** open | close | point. */
  status: TagStatusSchema,
  /** Monotonic event counter — tiebreak/order/gap-detection; auto-closes sort before
   * their triggering open by carrying a lower seq (so times stay clean, no epsilon). */
  seq: z.number().int(),
  /** Which clock `t` is relative to. */
  clock: TagClockSchema.default('media'),
  /** Provenance. */
  src: TagSrcSchema.default('click'),
  /** Set on a close whose lead-in inverted the interval (§6) — consumer falls back
   * to raw times rather than producing a negative interval. */
  degenerate: z.boolean().optional(),
});
export type TagEvent = z.infer<typeof TagEventSchema>;

/** Exclusivity mode (§7). `off` = overlapping tags; `single` = one implicit group
 * ("only one tag at a time"); `group` = per-tag `group` ids form exclusion sets. */
export const ExclusivityModeSchema = z.enum(['off', 'single', 'group']);
export type ExclusivityMode = z.infer<typeof ExclusivityModeSchema>;

/** The implicit group all interval tags share in `single` exclusivity mode. */
export const DEFAULT_EXCLUSIVITY_GROUP = '__default__' as const;

/**
 * Session-level tagging configuration (chosen at mode setup, persisted with the
 * tag set). The event `codec` name selects the wire representation strategy; the
 * `offset` is applied by a downstream segmentation tool, never baked into stored `t`.
 */
export const TaggingConfigSchema = z.object({
  exclusivity: ExclusivityModeSchema.default('off'),
  /** Registered EventCodec name (`statusEnum` default | `pointPair` | `kindField`). */
  codec: z.string().default('statusEnum'),
  /** Clock the events are stamped from. */
  clock: TagClockSchema.default('media'),
  /** Segmentation-time offset (seconds): `t_effective = t + offset`. Lossless. */
  offset: z.number().default(0),
});
export type TaggingConfig = z.infer<typeof TaggingConfigSchema>;

/** The all-defaults tagging config (materialized once for a `.default(...)`). */
export const DEFAULT_TAGGING_CONFIG: TaggingConfig = TaggingConfigSchema.parse({});

/**
 * The self-describing first line of a `tags.jsonl`: it records the anchor origin so
 * a consumer can interpret the file without trusting file-creation dates (§5). `t` is
 * the absolute engine-clock **origin** (== manifest.t0); every event `t` minus this
 * is its offset into the take — the same rule the manifest applies to every stream.
 */
export const AnchorRecordSchema = z.object({
  anchor: z.literal(true),
  /** The absolute engine-clock origin t0 (seconds); == manifest.t0. */
  t: z.number(),
  clock: TagClockSchema,
  /** For humans / debugging only — never the segmentation clock. */
  wallClockISO: z.string(),
  /** performance.now() at record start (cross-check for the media clock). */
  recStartPerf: z.number(),
  /** Session/take id, for cross-file correlation. */
  session: z.string(),
  /** Schema id + version (e.g. "thoremin.annotations/1"). */
  schema: z.string(),
});
export type AnchorRecord = z.infer<typeof AnchorRecordSchema>;

/**
 * The neutral in-memory action produced by a click or a keyboard digit — the ONE
 * shape the store pushes, so keyboard and mouse are indistinguishable downstream
 * (`src` records which). The timestamp is captured synchronously at the input event.
 */
export interface TagAction {
  /** TagDef.id being toggled. */
  tagId: string;
  /** Raw event time (seconds, absolute engine clock), captured at the input event. */
  t: number;
  /** How the action was triggered. */
  src: TagSrc;
}

/**
 * The neutral semantic event the state machine emits (representation-independent).
 * A codec serializes this to 1..2 wire rows; `resolveIntervals` reads a stream of
 * these. Carries `kind` (from the def) so codecs that want it are self-sufficient.
 */
export interface EdgeEvent {
  tag: string;
  kind: TagKind;
  status: TagStatus;
  /** Raw event time. */
  t: number;
  /** Lead-in-corrected time. */
  tCorrected: number;
  seq: number;
  clock: TagClock;
  src: TagSrc;
  /** Set on a close whose lead-in inverted the interval. */
  degenerate?: boolean;
}

/**
 * Live open-state for the toggle state machine. `open[tagId]` exists iff that
 * interval tag is currently open. `seq` is the running event counter. Pure data —
 * the store holds one of these and passes it through `applyToggle`.
 */
export interface TagState {
  open: Record<string, { openT: number; openCorrected: number; seq: number; leadIn: number }>;
  seq: number;
}

/** A fresh, empty tag state. */
export function emptyTagState(): TagState {
  return { open: {}, seq: 0 };
}

/**
 * A resolved interval/point, the output of `resolveIntervals` — what a segmentation
 * consumer cuts on. A point has `start === end`; `openEnded` marks an interval that
 * was still open at the end of the log; `degenerate` marks a lead-in inversion that
 * fell back to raw times.
 */
export interface ResolvedInterval {
  tag: string;
  kind: TagKind;
  /** Raw start (== end for a point). */
  start: number;
  /** Raw end. */
  end: number;
  /** Lead-in-corrected start / end (equal raw for a point). */
  startCorrected: number;
  endCorrected: number;
  /** The lead-in inverted the interval → corrected times fell back to raw. */
  degenerate: boolean;
  /** Never closed in the log (open at recording end). */
  openEnded: boolean;
  openSeq: number;
  closeSeq?: number;
}
