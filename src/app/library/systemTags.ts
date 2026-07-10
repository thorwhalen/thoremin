/**
 * System tags (issue #114) — read-only tags DERIVED from an instrument's parametrization,
 * never hand-edited. They surface the few facts that genuinely distinguish instruments
 * at a glance (scale quality, note-control source, face mode, split voices, finger FX)
 * as emoji chips in the list's tags column, rendered exactly like custom tags but with a
 * `sys:*` id so they can never be renamed, deleted, or stored in an instrument's
 * associations (see {@link ../model.SYSTEM_TAG_PREFIX}).
 *
 * Derivation is a pure function of the shared {@link InstrumentSummary} (so it stays in
 * lockstep with the tooltip, issue #115) and is recomputed on read — a stale value is
 * impossible. The emoji/label set is an SSOT map below and is a PROPOSAL flagged for the
 * maintainer's sign-off (colored circles read cleanly at small size; the M/m/P/p letter
 * cue lives in the tooltip).
 */
import { SYSTEM_TAG_PREFIX } from './model';
import {
  summarizeInstrument,
  type InstrumentSummary,
  type ScaleQuality,
  type FaceMode,
} from './summarize';
import type { Settings } from '@/settings/schema';
import type { PositionSource } from '@/nodes/mapping/hand_map';

/** A derived, read-only tag: a `sys:*` id, an emoji, and a tooltip label. Shape-
 *  compatible with how custom tags render (emoji + tooltip), differing only in source. */
export interface SystemTag {
  id: string;
  emoji: string;
  label: string;
}

/** Scale-quality tag set (PROPOSAL). Colored circles + the letter cue in the label. */
export const SCALE_QUALITY_TAGS = {
  major: { emoji: '🟢', label: 'Major (M)' },
  minor: { emoji: '🔵', label: 'Minor (m)' },
  pentatonicMajor: { emoji: '🟡', label: 'Pentatonic major (P)' },
  pentatonicMinor: { emoji: '🟣', label: 'Pentatonic minor (p)' },
  blues: { emoji: '🔴', label: 'Blues' },
  chromatic: { emoji: '⚪', label: 'Chromatic' },
} as const satisfies Record<ScaleQuality, { emoji: string; label: string }>;

/** Face-mode tag set (PROPOSAL); `none` yields no tag. */
export const FACE_MODE_TAGS = {
  expression: { emoji: '😀', label: 'Face expression → timbre' },
  chord: { emoji: '🎭', label: 'Face emotion → chord' },
  pose: { emoji: '🧭', label: 'Head/face pose control' },
} as const satisfies Record<Exclude<FaceMode, 'none'>, { emoji: string; label: string }>;

/** Note-control-source tag set (PROPOSAL). */
export const NOTE_SOURCE_TAGS = {
  index: { emoji: '👆', label: 'Index-controlled notes' },
  wrist: { emoji: '🤚', label: 'Wrist-controlled notes' },
} as const satisfies Record<PositionSource, { emoji: string; label: string }>;

/** Standalone flags (PROPOSAL): independent (unsynced) voices + any active finger routing.
 *  The tag fires on `!syncHands` (independent scale/root/octaves per hand), so the label
 *  names that — sounds can differ per hand even when synced, so "different sound" would
 *  mislabel the condition. */
export const SPLIT_VOICES_TAG = { emoji: '🎚️', label: 'Independent voices (hands unsynced)' } as const;
export const FINGER_FX_TAG = { emoji: '🎛️', label: 'Finger FX routing active' } as const;

/**
 * Derive the ordered system tags for an instrument summary. Order is deterministic —
 * scale quality, note source, face mode, split voices, finger FX — so the column reads
 * consistently across rows.
 */
export function deriveSystemTags(sum: InstrumentSummary): SystemTag[] {
  const tags: SystemTag[] = [];

  const scale = SCALE_QUALITY_TAGS[sum.scaleQuality];
  tags.push({ id: `${SYSTEM_TAG_PREFIX}scale:${sum.scaleQuality}`, ...scale });

  const note = NOTE_SOURCE_TAGS[sum.noteSource];
  tags.push({ id: `${SYSTEM_TAG_PREFIX}note:${sum.noteSource}`, ...note });

  if (sum.faceMode !== 'none') {
    const face = FACE_MODE_TAGS[sum.faceMode];
    tags.push({ id: `${SYSTEM_TAG_PREFIX}face:${sum.faceMode}`, ...face });
  }

  if (!sum.syncHands) {
    tags.push({ id: `${SYSTEM_TAG_PREFIX}voices:split`, ...SPLIT_VOICES_TAG });
  }

  if (sum.fingerFx.length > 0) {
    tags.push({ id: `${SYSTEM_TAG_PREFIX}fingerfx`, ...FINGER_FX_TAG });
  }

  return tags;
}

/** Convenience: summarize + derive in one call, for a raw {@link Settings}. */
export function systemTagsForSettings(s: Settings): SystemTag[] {
  return deriveSystemTags(summarizeInstrument(s));
}
