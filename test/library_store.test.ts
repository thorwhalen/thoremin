/**
 * Library store (issue #112/#113): the tags DataProvider ops + the instrument-meta blob
 * seam + the pure map helpers. Runs against the in-memory provider the store falls back
 * to in the Node runtime (no localStorage), so it exercises the real code path without a
 * browser. Tags are cleared before each case since the provider is a module singleton.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  tagsProvider,
  listTags,
  resolveOrCreateTag,
  renameTag,
  setTagEmoji,
  deleteTag,
  readInstrumentMeta,
  writeInstrumentMeta,
  healInstrumentMetaMap,
  metaFor,
  withStarred,
  withTagIds,
  stripTagIdEverywhere,
  instrumentsUsingTag,
  __resetMemoryMeta,
} from '@/app/library/store';
import { EMPTY_INSTRUMENT_META, type InstrumentMetaMap } from '@/app/library/model';

beforeEach(async () => {
  for (const t of await listTags()) await tagsProvider.delete(t.id);
  __resetMemoryMeta();
});

describe('tags collection', () => {
  it('resolveOrCreateTag creates a tag with a stable slug id + an emoji', async () => {
    const tag = await resolveOrCreateTag('Jazz', { rng: () => 0 });
    expect(tag.id).toBe('jazz');
    expect(tag.label).toBe('Jazz');
    expect(tag.emoji.length).toBeGreaterThan(0);
    expect(await listTags()).toHaveLength(1);
  });

  it('resolving the same label (any casing) returns the existing tag, no duplicate', async () => {
    const a = await resolveOrCreateTag('Jazz', { rng: () => 0 });
    const b = await resolveOrCreateTag('  jazz ', { rng: () => 0 });
    expect(b.id).toBe(a.id);
    expect(await listTags()).toHaveLength(1);
  });

  it('renameTag changes the label but keeps the id (associations survive)', async () => {
    const tag = await resolveOrCreateTag('Ambient', { rng: () => 0 });
    const renamed = await renameTag(tag.id, 'Chill');
    expect(renamed.id).toBe(tag.id);
    expect(renamed.label).toBe('Chill');
  });

  it('setTagEmoji changes only the emoji', async () => {
    const tag = await resolveOrCreateTag('Ambient', { rng: () => 0 });
    const updated = await setTagEmoji(tag.id, '🌙');
    expect(updated.id).toBe(tag.id);
    expect(updated.emoji).toBe('🌙');
  });

  it('auto-assigned emojis stay distinct across several new tags', async () => {
    const labels = ['zzza', 'zzzb', 'zzzc', 'zzzd', 'zzze'];
    let n = 0;
    const emojis: string[] = [];
    for (const l of labels) {
      const t = await resolveOrCreateTag(l, { rng: () => (n++ % 7) / 7 });
      emojis.push(t.emoji);
    }
    expect(new Set(emojis).size).toBe(labels.length);
  });

  it('deleteTag removes the tag and strips it from every instrument', async () => {
    const tag = await resolveOrCreateTag('Lead', { rng: () => 0 });
    await writeInstrumentMeta(withTagIds({}, 'Wrist Theremin', [tag.id]));
    const map = await deleteTag(tag.id);
    expect(await listTags()).toHaveLength(0);
    expect(instrumentsUsingTag(map, tag.id)).toEqual([]);
    expect(await readInstrumentMeta()).toEqual({});
  });

  it('deleteTag is idempotent — a second delete of an absent id does not throw', async () => {
    const tag = await resolveOrCreateTag('Lead', { rng: () => 0 });
    await deleteTag(tag.id);
    await expect(deleteTag(tag.id)).resolves.toBeDefined();
  });

  it('retyping a RENAMED tag original label creates a fresh tag, not the renamed one', async () => {
    const rock = await resolveOrCreateTag('rock', { rng: () => 0 }); // id 'rock', label 'rock'
    await renameTag(rock.id, 'Metal'); // id stays 'rock', label -> 'Metal'
    const retyped = await resolveOrCreateTag('rock', { rng: () => 0.3 });
    expect(retyped.id).not.toBe(rock.id); // no id-slug match to the renamed tag
    expect(retyped.label).toBe('rock');
    expect((await listTags()).map((t) => t.label).sort()).toEqual(['Metal', 'rock']);
  });

  it('renameTag rejects a label already used by another tag', async () => {
    await resolveOrCreateTag('warm', { rng: () => 0 });
    const b = await resolveOrCreateTag('warmth', { rng: () => 0.3 });
    await expect(renameTag(b.id, 'warm')).rejects.toThrow(/already exists/);
    await expect(renameTag(b.id, 'Warmth')).resolves.toBeTruthy(); // not a collision with itself
  });
});

describe('healInstrumentMetaMap', () => {
  it('keeps valid records, heals blanks, drops malformed ones', () => {
    const healed = healInstrumentMetaMap({
      Piano: { starred: true, tagIds: ['jazz'] },
      Bad: { starred: 'yes' }, // wrong type -> dropped (not the whole map)
      Blank: {}, // healed by per-field defaults
    });
    expect(healed.Piano).toEqual({ starred: true, tagIds: ['jazz'] });
    expect(healed.Bad).toBeUndefined();
    expect(healed.Blank).toEqual({ starred: false, tagIds: [] });
  });

  it('returns empty for non-object input', () => {
    expect(healInstrumentMetaMap(null)).toEqual({});
    expect(healInstrumentMetaMap('nope')).toEqual({});
  });
});

describe('instrument-meta blob', () => {
  it('round-trips through the in-memory fallback', async () => {
    const map = withStarred({}, 'Bell & Strings', true);
    await writeInstrumentMeta(map);
    expect(await readInstrumentMeta()).toEqual(map);
  });

  it('empty (never-touched) instruments have the empty default', () => {
    expect(metaFor({}, 'Anything')).toEqual(EMPTY_INSTRUMENT_META);
  });
});

describe('pure map helpers', () => {
  it('withStarred / withTagIds prune a record back to nothing when empty', () => {
    let map: InstrumentMetaMap = withStarred({}, 'X', true);
    expect(map.X.starred).toBe(true);
    map = withStarred(map, 'X', false); // now default-everything -> pruned
    expect(map.X).toBeUndefined();
  });

  it('withTagIds de-duplicates while preserving order', () => {
    const map = withTagIds({}, 'X', ['a', 'b', 'a', 'c']);
    expect(map.X.tagIds).toEqual(['a', 'b', 'c']);
  });

  it('stripTagIdEverywhere removes an id across all instruments', () => {
    let map: InstrumentMetaMap = withTagIds({}, 'X', ['a', 'b']);
    map = withTagIds(map, 'Y', ['b', 'c']);
    const stripped = stripTagIdEverywhere(map, 'b');
    expect(stripped.X.tagIds).toEqual(['a']);
    expect(stripped.Y.tagIds).toEqual(['c']);
  });

  it('instrumentsUsingTag lists the instruments carrying a tag', () => {
    let map: InstrumentMetaMap = withTagIds({}, 'X', ['a']);
    map = withTagIds(map, 'Y', ['a', 'b']);
    expect(instrumentsUsingTag(map, 'a').sort()).toEqual(['X', 'Y']);
    expect(instrumentsUsingTag(map, 'b')).toEqual(['Y']);
  });
});
