/**
 * taglog affordance core — the pure heart of live tagging (#92, design #81).
 * Tested hard because it is the reusable, extraction-ready layer and the one place
 * mislabeled training data would originate.
 */
import { describe, it, expect } from 'vitest';
import {
  applyToggle,
  closeAll,
  correctedTime,
  isDegenerate,
  resolveIntervals,
  emptyTagState,
  getCodec,
  statusEnumCodec,
  pointPairCodec,
  kindFieldCodec,
  TagDefSchema,
  TaggingConfigSchema,
  type TagDef,
  type TaggingConfig,
  type EdgeEvent,
  type TagState,
} from '@/taglog/affordances';

/** A tag def from a partial (schema fills defaults). */
function def(over: Partial<TagDef> & { id: string }): TagDef {
  return TagDefSchema.parse({ label: over.id, ...over });
}
const cfg = (over: Partial<TaggingConfig> = {}): TaggingConfig => TaggingConfigSchema.parse(over);

const PLUCK = def({ id: 'pluck', number: 1, kind: 'interval', group: 'hands' });
const STRUM = def({ id: 'strum', number: 2, kind: 'interval', group: 'hands' });
const BOOM = def({ id: 'boom', number: 3, kind: 'point' });

describe('lead-in correction (§6)', () => {
  it('open shifts later, close shifts earlier, point is the instant', () => {
    expect(correctedTime('open', 10, 2)).toBe(12);
    expect(correctedTime('close', 10, 2)).toBe(8);
    expect(correctedTime('point', 10, 2)).toBe(10);
  });
  it('flags a degenerate (inverted) interval', () => {
    expect(isDegenerate(12, 8)).toBe(true);
    expect(isDegenerate(8, 12)).toBe(false);
  });
});

describe('applyToggle — intervals & points', () => {
  const defs = [PLUCK, STRUM, BOOM];

  it('opens then closes an interval, stamping raw + corrected times', () => {
    const p2 = def({ id: 'pluck', number: 1, kind: 'interval', leadIn: 2 });
    let s = emptyTagState();
    const r1 = applyToggle(s, [p2], { tagId: 'pluck', t: 5, src: 'key' }, cfg());
    expect(r1.edges).toHaveLength(1);
    expect(r1.edges[0]).toMatchObject({ status: 'open', t: 5, tCorrected: 7, seq: 0, src: 'key' });
    s = r1.state;
    const r2 = applyToggle(s, [p2], { tagId: 'pluck', t: 20, src: 'click' }, cfg());
    expect(r2.edges[0]).toMatchObject({ status: 'close', t: 20, tCorrected: 18, seq: 1 });
    expect(r2.state.open.pluck).toBeUndefined();
  });

  it('emits a single point edge, unaffected by open-state', () => {
    const r = applyToggle(emptyTagState(), defs, { tagId: 'boom', t: 3, src: 'click' }, cfg());
    expect(r.edges).toEqual([
      expect.objectContaining({ status: 'point', kind: 'point', t: 3, tCorrected: 3, seq: 0 }),
    ]);
    expect(Object.keys(r.state.open)).toHaveLength(0);
  });

  it('is a no-op for an unknown tag (returns the same state, no edges)', () => {
    const s = emptyTagState();
    const r = applyToggle(s, defs, { tagId: 'nope', t: 1, src: 'key' }, cfg());
    expect(r.edges).toEqual([]);
    expect(r.state).toBe(s);
  });

  it('does not mutate the input state', () => {
    const s = emptyTagState();
    applyToggle(s, defs, { tagId: 'pluck', t: 1, src: 'key' }, cfg());
    expect(s.open).toEqual({});
    expect(s.seq).toBe(0);
  });
});

describe('mutual exclusivity (§7)', () => {
  it('single mode: opening a tag auto-closes the open sibling with a LOWER seq', () => {
    const defs = [PLUCK, STRUM];
    let s = emptyTagState();
    s = applyToggle(s, defs, { tagId: 'pluck', t: 5, src: 'key' }, cfg({ exclusivity: 'single' })).state;
    const r = applyToggle(s, defs, { tagId: 'strum', t: 10, src: 'key' }, cfg({ exclusivity: 'single' }));
    // Two edges: the auto-close of pluck (seq 1) BEFORE the open of strum (seq 2).
    const autoClose = r.edges.find((e) => e.tag === 'pluck');
    const open = r.edges.find((e) => e.tag === 'strum');
    expect(autoClose).toMatchObject({ status: 'close', src: 'auto', t: 10 });
    expect(open).toMatchObject({ status: 'open', src: 'key', t: 10 });
    expect(autoClose!.seq).toBeLessThan(open!.seq);
    expect(Object.keys(r.state.open)).toEqual(['strum']);
  });

  it('group mode: only same-group tags exclude each other', () => {
    const hands1 = def({ id: 'h1', kind: 'interval', group: 'hands' });
    const hands2 = def({ id: 'h2', kind: 'interval', group: 'hands' });
    const feet = def({ id: 'f1', kind: 'interval', group: 'feet' });
    const defs = [hands1, hands2, feet];
    let s = emptyTagState();
    s = applyToggle(s, defs, { tagId: 'h1', t: 1, src: 'key' }, cfg({ exclusivity: 'group' })).state;
    s = applyToggle(s, defs, { tagId: 'f1', t: 2, src: 'key' }, cfg({ exclusivity: 'group' })).state;
    expect(Object.keys(s.open).sort()).toEqual(['f1', 'h1']); // different groups coexist
    const r = applyToggle(s, defs, { tagId: 'h2', t: 3, src: 'key' }, cfg({ exclusivity: 'group' }));
    expect(r.edges.some((e) => e.tag === 'h1' && e.status === 'close' && e.src === 'auto')).toBe(true);
    expect(Object.keys(r.state.open).sort()).toEqual(['f1', 'h2']); // feet untouched
  });

  it('off mode: multiple tags stay open at once', () => {
    const defs = [PLUCK, STRUM];
    let s = emptyTagState();
    s = applyToggle(s, defs, { tagId: 'pluck', t: 1, src: 'key' }, cfg()).state;
    s = applyToggle(s, defs, { tagId: 'strum', t: 2, src: 'key' }, cfg()).state;
    expect(Object.keys(s.open).sort()).toEqual(['pluck', 'strum']);
  });
});

describe('closeAll (0 key / take-end sweep)', () => {
  it('closes every open interval in open-seq order', () => {
    const defs = [PLUCK, STRUM];
    let s = emptyTagState();
    s = applyToggle(s, defs, { tagId: 'pluck', t: 1, src: 'key' }, cfg()).state;
    s = applyToggle(s, defs, { tagId: 'strum', t: 2, src: 'key' }, cfg()).state;
    const r = closeAll(s, defs, 9, cfg(), 'key');
    expect(r.edges.map((e) => e.tag)).toEqual(['pluck', 'strum']);
    expect(r.edges.every((e) => e.status === 'close' && e.t === 9)).toBe(true);
    expect(Object.keys(r.state.open)).toHaveLength(0);
  });
});

describe('resolveIntervals', () => {
  const defs = [PLUCK, STRUM, BOOM];
  function log(actions: [string, number][], config = cfg()): EdgeEvent[] {
    let s: TagState = emptyTagState();
    const edges: EdgeEvent[] = [];
    for (const [tagId, t] of actions) {
      const r = applyToggle(s, defs, { tagId, t, src: 'key' }, config);
      s = r.state;
      edges.push(...r.edges);
    }
    return edges;
  }

  it('pairs open/close into an interval and resolves a point', () => {
    const edges = log([['pluck', 5], ['pluck', 12], ['boom', 8]]);
    const out = resolveIntervals(edges);
    expect(out).toHaveLength(2);
    const iv = out.find((i) => i.tag === 'pluck')!;
    expect(iv).toMatchObject({ kind: 'interval', start: 5, end: 12, openEnded: false });
    const pt = out.find((i) => i.tag === 'boom')!;
    expect(pt).toMatchObject({ kind: 'point', start: 8, end: 8 });
  });

  it('reports still-open intervals as open-ended, closing at endT when given', () => {
    const edges = log([['pluck', 5]]);
    expect(resolveIntervals(edges)[0]).toMatchObject({ openEnded: true, start: 5, end: 5 });
    expect(resolveIntervals(edges, { endT: 30 })[0]).toMatchObject({ openEnded: true, end: 30, endCorrected: 30 });
  });

  it('applies the lead-in degeneracy guard to an open-ended interval whose take end falls inside the lead-in', () => {
    const p = def({ id: 'pluck', kind: 'interval', leadIn: 5 });
    const e = applyToggle(emptyTagState(), [p], { tagId: 'pluck', t: 10, src: 'key' }, cfg()); // open, tCorrected 15
    // Take stopped at t=12, INSIDE the 5s lead-in (corrected open 15 > end 12).
    const iv = resolveIntervals(e.edges, { endT: 12 })[0];
    expect(iv.openEnded).toBe(true);
    expect(iv.degenerate).toBe(true);
    expect(iv.startCorrected).toBe(10); // fell back to raw, NOT 15
    expect(iv.endCorrected).toBe(12); //  ... not an inverted [15,12]
  });

  it('falls back to raw times on a degenerate (lead-in-inverted) interval', () => {
    const p = def({ id: 'pluck', kind: 'interval', leadIn: 5 });
    let s = emptyTagState();
    const e1 = applyToggle(s, [p], { tagId: 'pluck', t: 10, src: 'key' }, cfg());
    s = e1.state;
    const e2 = applyToggle(s, [p], { tagId: 'pluck', t: 12, src: 'key' }, cfg()); // interval 10..12, leadIn 5
    const out = resolveIntervals([...e1.edges, ...e2.edges]);
    expect(out[0].degenerate).toBe(true);
    expect(out[0].startCorrected).toBe(10); // fell back to raw, not 15
    expect(out[0].endCorrected).toBe(12); //  ... not 7
  });

  it('ignores a stray close with no matching open', () => {
    const close: EdgeEvent = { tag: 'pluck', kind: 'interval', status: 'close', t: 5, tCorrected: 5, seq: 0, clock: 'media', src: 'key' };
    expect(resolveIntervals([close])).toEqual([]);
  });
});

describe('event codecs (§4c)', () => {
  const edge: EdgeEvent = { tag: 'pluck', kind: 'interval', status: 'open', t: 5, tCorrected: 7, seq: 0, clock: 'media', src: 'key' };
  const point: EdgeEvent = { tag: 'boom', kind: 'point', status: 'point', t: 3, tCorrected: 3, seq: 1, clock: 'media', src: 'click' };

  it('statusEnum: 1:1 row round-trip', () => {
    const rows = statusEnumCodec.encode(edge);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'open', t: 5, tCorrected: 7, tag: 'pluck' });
    expect(statusEnumCodec.decode(rows)[0]).toMatchObject({ status: 'open', kind: 'interval', t: 5 });
  });

  it('pointPair: a point becomes open+close rows and folds back to a point', () => {
    const rows = pointPairCodec.encode(point);
    expect(rows.map((r) => r.status)).toEqual(['open', 'close']);
    const back = pointPairCodec.decode(rows);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ status: 'point', kind: 'point', t: 3 });
  });

  it('kindField: carries a redundant kind column', () => {
    expect(kindFieldCodec.encode(edge)[0].kind).toBe('interval');
    expect(kindFieldCodec.decode(kindFieldCodec.encode(point))[0].kind).toBe('point');
  });

  it('getCodec falls back to statusEnum for an unknown name', () => {
    expect(getCodec('nope')).toBe(statusEnumCodec);
    expect(getCodec('pointPair')).toBe(pointPairCodec);
  });
});
