/**
 * Library model helpers (issue #113): stable-id derivation, label normalization, the
 * comma-input parse, and the schema guard that keeps a custom tag from stealing a
 * system-tag id.
 */
import { describe, it, expect } from 'vitest';
import {
  tagIdForLabel,
  normalizeLabel,
  parseTagLabels,
  TagSchema,
  SYSTEM_TAG_PREFIX,
} from '@/app/library/model';

describe('tagIdForLabel', () => {
  it('slugs to a stable, lowercase, hyphenated id', () => {
    expect(tagIdForLabel('Jazz')).toBe('jazz');
    expect(tagIdForLabel('  Lo-Fi Beats! ')).toBe('lo-fi-beats');
    expect(tagIdForLabel('Jazz')).toBe(tagIdForLabel(' jazz ')); // casing/space irrelevant
  });
  it('never yields an empty id', () => {
    expect(tagIdForLabel('!!!')).toBe('tag');
  });
});

describe('normalizeLabel', () => {
  it('collapses case + whitespace', () => {
    expect(normalizeLabel('  Warm   Pad ')).toBe('warm pad');
  });
});

describe('parseTagLabels', () => {
  it('splits, trims, drops empties, de-dupes case-insensitively, keeps order', () => {
    expect(parseTagLabels('Jazz, ambient ,, Jazz , Lead')).toEqual(['Jazz', 'ambient', 'Lead']);
  });
  it('returns [] for a blank input', () => {
    expect(parseTagLabels('  , ,')).toEqual([]);
  });
});

describe('TagSchema', () => {
  it('rejects a custom tag id that steals the system-tag prefix', () => {
    expect(TagSchema.safeParse({ id: `${SYSTEM_TAG_PREFIX}x`, label: 'x', emoji: '🐱' }).success).toBe(false);
    expect(TagSchema.safeParse({ id: 'jazz', label: 'Jazz', emoji: '🎷' }).success).toBe(true);
  });
});
