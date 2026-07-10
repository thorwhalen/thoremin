/**
 * taglog export adapters — the interchange seam (design §2/§4). Proves the resolved
 * interval view round-trips to the standard formats researchers already use, so a
 * tag log opens in Audacity / Praat / a `<track>` / a spreadsheet / an NLE.
 */
import { describe, it, expect } from 'vitest';
import {
  toAudacityLabels,
  toWebVTT,
  toCSV,
  toTextGrid,
  toOTIO,
  formatTimecode,
  getAdapter,
  ADAPTERS,
} from '@/taglog/adapters';
import { TagDefSchema, type ResolvedInterval, type TagDef } from '@/taglog/affordances';

const defs: TagDef[] = [
  TagDefSchema.parse({ id: 'pluck', label: 'Pluck', kind: 'interval' }),
  TagDefSchema.parse({ id: 'boom', label: 'Boom', kind: 'point' }),
];

const intervals: ResolvedInterval[] = [
  {
    tag: 'pluck',
    kind: 'interval',
    start: 5,
    end: 12,
    startCorrected: 7,
    endCorrected: 10,
    degenerate: false,
    openEnded: false,
    openSeq: 0,
    closeSeq: 1,
  },
  {
    tag: 'boom',
    kind: 'point',
    start: 8,
    end: 8,
    startCorrected: 8,
    endCorrected: 8,
    degenerate: false,
    openEnded: false,
    openSeq: 2,
  },
];

describe('formatTimecode', () => {
  it('formats HH:MM:SS.mmm and clamps negatives', () => {
    expect(formatTimecode(0)).toBe('00:00:00.000');
    expect(formatTimecode(3661.5)).toBe('01:01:01.500');
    expect(formatTimecode(-3)).toBe('00:00:00.000');
  });
  it('carries a sub-ms rounding into the next second (never a 4-digit ms field)', () => {
    // 8.9996 rounds to 9.000s, not 08.1000 (an invalid WebVTT timestamp).
    expect(formatTimecode(8.9996)).toBe('00:00:09.000');
    expect(formatTimecode(59.9999)).toBe('00:01:00.000');
  });
});

describe('Audacity labels', () => {
  it('emits start<TAB>end<TAB>label with corrected times by default', () => {
    const out = toAudacityLabels(intervals, { defs });
    const lines = out.trim().split('\n');
    expect(lines[0]).toBe('7.000000\t10.000000\tPluck');
    expect(lines[1]).toBe('8.000000\t8.000000\tBoom'); // point: start==end
  });
  it('uses raw times when asked', () => {
    expect(toAudacityLabels(intervals, { defs, time: 'raw' }).split('\n')[0]).toBe('5.000000\t12.000000\tPluck');
  });
});

describe('WebVTT', () => {
  it('opens with WEBVTT and gives a point a nonzero cue', () => {
    const out = toWebVTT(intervals, { defs });
    expect(out.startsWith('WEBVTT')).toBe(true);
    expect(out).toContain('00:00:07.000 --> 00:00:10.000');
    expect(out).toContain('Pluck');
    // point: 8.000 --> 8.001 (end nudged so a player renders it)
    expect(out).toContain('00:00:08.000 --> 00:00:08.001');
  });
});

describe('CSV', () => {
  it('has a header and one row per interval with raw + corrected times', () => {
    const rows = toCSV(intervals, { defs }).trim().split('\n');
    expect(rows[0]).toBe('tag,label,kind,start,end,startCorrected,endCorrected,degenerate,openEnded');
    expect(rows[1]).toBe('pluck,Pluck,interval,5,12,7,10,false,false');
    expect(rows[2]).toBe('boom,Boom,point,8,8,8,8,false,false');
  });
});

describe('Praat TextGrid', () => {
  it('makes an IntervalTier (gap-filled) for the interval and a TextTier for the point', () => {
    const out = toTextGrid(intervals, { defs, duration: 15 });
    expect(out).toContain('Object class = "TextGrid"');
    expect(out).toContain('class = "IntervalTier"');
    expect(out).toContain('name = "Pluck"');
    expect(out).toContain('class = "TextTier"'); // point tier
    expect(out).toContain('mark = "Boom"');
    // adjacency-complete: an empty lead interval 0..7, the label 7..10, empty 10..15
    expect(out).toContain('text = "Pluck"');
    expect(out).toMatch(/xmax = 15/);
  });
  it('never lets an explicit duration shrink xmax below an interval end (Praat would reject)', () => {
    // Interval ends at corrected 10; a smaller duration:5 must NOT clip xmax to 5.
    const out = toTextGrid(intervals, { defs, duration: 5 });
    const fileXmax = Number(out.match(/^xmax = (\d+)/m)![1]);
    expect(fileXmax).toBeGreaterThanOrEqual(10);
    expect(out).not.toMatch(/xmax = 5\b/); // no tier/file xmax below the content
  });
});

describe('OTIO', () => {
  it('is valid JSON with a marker per interval carrying taglog metadata', () => {
    const doc = JSON.parse(toOTIO(intervals, { defs, rate: 30 }));
    expect(doc.OTIO_SCHEMA).toBe('Timeline.1');
    const markers = doc.tracks.children[0].markers;
    expect(markers).toHaveLength(2);
    expect(markers[0].name).toBe('Pluck');
    expect(markers[0].marked_range.start_time.value).toBe(210); // 7s * 30fps
    expect(markers[0].metadata.taglog.tag).toBe('pluck');
  });
});

describe('label sanitization (structured formats)', () => {
  const dirtyDefs: TagDef[] = [TagDefSchema.parse({ id: 'pluck', label: 'a\tb\nc', kind: 'interval' })];
  const iv: ResolvedInterval[] = [
    { tag: 'pluck', kind: 'interval', start: 1, end: 2, startCorrected: 1, endCorrected: 2, degenerate: false, openEnded: false, openSeq: 0, closeSeq: 1 },
  ];
  it('strips TAB/newline from Audacity + WebVTT labels so they cannot break the row/cue', () => {
    const audacity = toAudacityLabels(iv, { defs: dirtyDefs });
    expect(audacity.split('\n')[0].split('\t')).toHaveLength(3); // start, end, label — label has no stray TAB
    expect(audacity).toContain('a b c');
    expect(toWebVTT(iv, { defs: dirtyDefs })).toContain('a b c');
  });
});

describe('adapter registry', () => {
  it('exposes each format with an ext/mime and a render fn', () => {
    expect(Object.keys(ADAPTERS).sort()).toEqual(['audacity', 'csv', 'otio', 'textgrid', 'webvtt']);
    expect(getAdapter('csv')?.ext).toBe('csv');
    expect(getAdapter('nope')).toBeUndefined();
    expect(getAdapter('webvtt')!.render(intervals, { defs }).startsWith('WEBVTT')).toBe(true);
  });
});
