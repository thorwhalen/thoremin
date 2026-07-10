/**
 * Emoji pool + search + auto-assign (issue #113). Locks the two invariants the tags
 * column depends on — the curated pool has no duplicate glyphs and shares no glyph with
 * the system-tag set (so a custom emoji can never be confused for a derived one) — and
 * pins the search/auto-assign behaviour (name match preferred, random-unused fallback,
 * deterministic under an injected rng).
 */
import { describe, it, expect } from 'vitest';
import {
  EMOJI_POOL,
  POOL_CHARS,
  searchEmoji,
  suggestEmojiForLabel,
  autoAssignEmoji,
} from '@/app/library/emoji';
import {
  SCALE_QUALITY_TAGS,
  FACE_MODE_TAGS,
  NOTE_SOURCE_TAGS,
  SPLIT_VOICES_TAG,
  FINGER_FX_TAG,
} from '@/app/library/systemTags';

const SYSTEM_GLYPHS = new Set<string>([
  ...Object.values(SCALE_QUALITY_TAGS).map((t) => t.emoji),
  ...Object.values(FACE_MODE_TAGS).map((t) => t.emoji),
  ...Object.values(NOTE_SOURCE_TAGS).map((t) => t.emoji),
  SPLIT_VOICES_TAG.emoji,
  FINGER_FX_TAG.emoji,
]);

describe('emoji pool', () => {
  it('is a decent-sized, de-duplicated set', () => {
    expect(EMOJI_POOL.length).toBeGreaterThanOrEqual(100);
    expect(new Set(POOL_CHARS).size).toBe(POOL_CHARS.length);
  });

  it('shares no glyph with the system-tag set (no column collisions)', () => {
    for (const c of POOL_CHARS) expect(SYSTEM_GLYPHS.has(c)).toBe(false);
  });

  it('every entry has at least one keyword', () => {
    for (const e of EMOJI_POOL) expect(e.keywords.length).toBeGreaterThan(0);
  });
});

describe('searchEmoji', () => {
  it('ranks a whole-keyword hit first', () => {
    expect(searchEmoji('cat')[0].char).toBe('🐱');
    expect(searchEmoji('lemon')[0].char).toBe('🍋');
  });

  it('returns the whole pool for an empty query', () => {
    expect(searchEmoji('  ').length).toBe(EMOJI_POOL.length);
  });

  it('returns nothing for an unmatched query', () => {
    expect(searchEmoji('qwxyz')).toEqual([]);
  });
});

describe('suggestEmojiForLabel', () => {
  it('matches an exact keyword', () => {
    expect(suggestEmojiForLabel('cat')).toBe('🐱');
    expect(suggestEmojiForLabel('Fire')).toBe('🔥');
  });

  it('matches a prefix ("cats" -> cat)', () => {
    expect(suggestEmojiForLabel('cats')).toBe('🐱');
  });

  it('returns null when nothing confidently matches', () => {
    expect(suggestEmojiForLabel('zzznope')).toBeNull();
    expect(suggestEmojiForLabel('')).toBeNull();
  });
});

describe('autoAssignEmoji', () => {
  it('prefers a confident name match when it is unused', () => {
    expect(autoAssignEmoji('cat', [], () => 0)).toBe('🐱');
  });

  it('falls back to a random unused glyph when the match is taken', () => {
    const picked = autoAssignEmoji('cat', ['🐱'], () => 0);
    expect(picked).not.toBe('🐱');
    expect(POOL_CHARS).toContain(picked);
  });

  it('is deterministic under an injected rng and avoids used glyphs', () => {
    const used = new Set<string>();
    for (let i = 0; i < 20; i++) {
      // A label with no name match forces the random path; a fixed fractional rng
      // walks distinct free slots as `used` grows.
      const e = autoAssignEmoji('zzznomatch', used, () => 0.5);
      expect(used.has(e)).toBe(false);
      used.add(e);
    }
    expect(used.size).toBe(20);
  });
});
