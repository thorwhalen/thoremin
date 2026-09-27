/**
 * The library's metadata helpers must keep every spec field (the review of PR 4's first cut
 * found `pruneEmpty` keeping a record only when starred or tagged, so starring one instrument
 * wiped every other instrument's explicit branches, training link and image).
 */
import { describe, expect, it } from 'vitest';
import { metaHasInformation, withStarred, withTagIds, stripTagIdEverywhere } from '@/app/library/store';
import type { InstrumentMetaMap } from '@/app/library/model';

const rich = { starred: false, tagIds: [], branches: ['air-drum'], training: { route: 'x' }, image: 'i.png', class: 'field', emoji: '🥁' };
const map: InstrumentMetaMap = { A: { ...rich }, B: { starred: false, tagIds: ['t1'] } };

describe('metaHasInformation', () => {
  it('a default record has none; any spec field counts', () => {
    expect(metaHasInformation({ starred: false, tagIds: [] })).toBe(false);
    for (const field of [{ class: 'air' }, { branches: [] }, { training: { route: 'r' } }, { image: 'i' }, { emoji: 'e' }, { starred: true }, { tagIds: ['t'] }]) {
      expect(metaHasInformation({ starred: false, tagIds: [], ...field })).toBe(true);
    }
  });
});

describe('the helpers keep the spec fields of every record', () => {
  it('starring B keeps A whole', () => {
    expect(withStarred(map, 'B', true).A).toEqual(rich);
  });
  it('removing A\'s last tag keeps its branches, training and image', () => {
    const tagged: InstrumentMetaMap = { A: { ...rich, tagIds: ['t1'] } };
    expect(withTagIds(tagged, 'A', []).A).toEqual({ ...rich, tagIds: [] });
  });
  it('deleting a tag everywhere keeps the other fields', () => {
    const tagged: InstrumentMetaMap = { A: { ...rich, tagIds: ['t1'] }, B: { starred: false, tagIds: ['t1'] } };
    const out = stripTagIdEverywhere(tagged, 't1');
    expect(out.A).toEqual({ ...rich, tagIds: [] });
    expect(out.B).toBeUndefined(); // B now says nothing a default record does not
  });
});
