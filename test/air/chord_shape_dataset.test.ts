/**
 * The landmark-to-label join on self-made records: a synthetic hand stream whose
 * shape follows a known chord timeline, joined with the segments the audio labeller
 * would have written for it.
 */
import { describe, expect, it } from 'vitest';
import type { StreamRecord } from '@/dag';
import {
  joinLabelledFrames,
  labelAt,
  samplesFromNdjson,
  samplesToNdjson,
  type ChordSegment,
} from '../../scripts/air/lib_chord_shape_dataset';
import { SHAPES, frameOf, syntheticHand } from './synthetic_hand';

const SEGMENTS: ChordSegment[] = [
  { start: 0, end: 2, label: 'C' },
  { start: 2, end: 2.5, label: 'N' },
  { start: 2.5, end: 4, label: 'G' },
];

describe('labelAt', () => {
  it('returns the chord inside a segment, away from its edges', () => {
    expect(labelAt(SEGMENTS, 1.0, 0.25)).toBe('C');
    expect(labelAt(SEGMENTS, 3.2, 0.25)).toBe('G');
  });
  it('drops the margin around a change, the no-chord spans and out-of-range times', () => {
    expect(labelAt(SEGMENTS, 0.1, 0.25)).toBeNull();
    expect(labelAt(SEGMENTS, 1.9, 0.25)).toBeNull();
    expect(labelAt(SEGMENTS, 2.2, 0.25)).toBeNull();
    expect(labelAt(SEGMENTS, 9, 0.25)).toBeNull();
    expect(labelAt(SEGMENTS, 1.9, 0)).toBe('C');
  });
});

function records(fps: number, seconds: number, shapeAt: (t: number) => keyof typeof SHAPES | null): StreamRecord[] {
  const out: StreamRecord[] = [];
  const n = Math.round(fps * seconds);
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    const k = shapeAt(t);
    const hands = k ? [syntheticHand(SHAPES[k], { cx: 400, cy: 240, scale: 100 }, 'Left'), syntheticHand(SHAPES.E, { cx: 120, cy: 240, scale: 100 }, 'Right')] : [];
    out.push({ tick: i, t, value: frameOf(hands) });
  }
  return out;
}

describe('joinLabelledFrames', () => {
  const recs = records(30, 4, (t) => (t < 2 ? 'C' : t < 2.5 ? null : 'G'));

  it('labels the fretting hand frames and drops the rest, with honest stats', () => {
    const { samples, stats } = joinLabelledFrames(recs, SEGMENTS, { group: 'vid', pick: { by: 'x', side: 'max' }, marginSeconds: 0.25 });
    expect(stats.frames).toBe(120);
    expect(stats.handFrames).toBe(120 - 15);
    expect(stats.samples).toBe(samples.length);
    expect(stats.perLabel.C).toBe(Math.round(30 * 1.5));
    expect(stats.perLabel.G).toBe(Math.round(30 * 1.0));
    expect(samples.every((s) => s.group === 'vid' && typeof s.t === 'number')).toBe(true);
    // The fretting hand (viewer's right, x max) carries the chord shape, not the E of the other hand.
    const c = samples.find((s) => s.label === 'C')!;
    const g = samples.find((s) => s.label === 'G')!;
    expect(c.vector['ring.curl']).toBeGreaterThan(g.vector['ring.curl']);
  });

  it('honours windows, vocabulary and the score floor', () => {
    const win = joinLabelledFrames(recs, SEGMENTS, { group: 'v', pick: { by: 'x', side: 'max' }, windows: [[0, 2]] });
    expect(win.stats.perLabel.G).toBeUndefined();
    const voc = joinLabelledFrames(recs, SEGMENTS, { group: 'v', pick: { by: 'x', side: 'max' }, vocabulary: new Set(['G']) });
    expect(voc.stats.perLabel.C).toBeUndefined();
    expect(voc.stats.perLabel.G).toBeGreaterThan(0);
    const strict = joinLabelledFrames(recs, SEGMENTS, { group: 'v', pick: { by: 'x', side: 'max' }, minScore: 0.99 });
    expect(strict.samples.length).toBe(0);
  });

  it('round-trips through NDJSON, NaN included', () => {
    const { samples } = joinLabelledFrames(recs.slice(0, 40), SEGMENTS, { group: 'v', pick: { by: 'x', side: 'max' } });
    samples[0].vector['index.curl'] = NaN;
    const back = samplesFromNdjson(samplesToNdjson(samples));
    expect(back.length).toBe(samples.length);
    expect(back[0].label).toBe(samples[0].label);
    expect(Number.isFinite(back[0].vector['index.curl'])).toBe(false);
    expect(back[1].vector['index.curl']).toBeCloseTo(samples[1].vector['index.curl'], 9);
  });
});
