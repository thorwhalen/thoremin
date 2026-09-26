/**
 * The landmark-to-label join on self-made records: a synthetic hand stream whose
 * shape follows a known chord timeline, joined with the segments the audio labeller
 * would have written for it, through the two seams (`featurize`, `labelOf`).
 */
import { describe, expect, it } from 'vitest';
import type { StreamRecord } from '@/dag';
import {
  PROBE_LABEL,
  joinLabelledFrames,
  joinUnlabelledFrames,
  labelAt,
  samplesFromNdjson,
  samplesToNdjson,
  segmentLabeller,
  type ChordSegment,
} from '../../scripts/air/lib_chord_shape_dataset';
import { chordShapeFeaturizer } from '../../scripts/air/lib_chord_shape_features';
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
    expect(segmentLabeller(SEGMENTS)(1.0)).toBe('C');
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
    // Fretting hand on the viewer's right (labelled "Right" on unmirrored video), the
    // strumming hand always in frame on the left holding an E-like shape.
    const hands = k
      ? [syntheticHand(SHAPES[k], { cx: 400, cy: 240, scale: 100 }, 'Right'), syntheticHand(SHAPES.E, { cx: 120, cy: 240, scale: 100 }, 'Left')]
      : [syntheticHand(SHAPES.E, { cx: 120, cy: 240, scale: 100 }, 'Left')];
    out.push({ tick: i, t, value: frameOf(hands) });
  }
  return out;
}

describe('joinLabelledFrames', () => {
  const recs = records(30, 4, (t) => (t < 2 ? 'C' : t < 2.5 ? null : 'G'));
  const featurize = chordShapeFeaturizer({ by: 'x', side: 'max' });

  it('labels the fretting hand frames and drops the rest, with honest stats', () => {
    const { samples, stats } = joinLabelledFrames(recs, { group: 'vid', featurize, labelOf: segmentLabeller(SEGMENTS, 0.25) });
    expect(stats.frames).toBe(120);
    // The 15 no-chord frames show only the strumming hand, on the wrong side: not a hand frame.
    expect(stats.handFrames).toBe(120 - 15);
    expect(stats.samples).toBe(samples.length);
    expect(stats.perLabel.C).toBe(Math.round(30 * 1.5));
    expect(stats.perLabel.G).toBe(Math.round(30 * 1.0));
    expect(samples.every((s) => s.group === 'vid' && typeof s.t === 'number')).toBe(true);
    const c = samples.find((s) => s.label === 'C')!;
    const g = samples.find((s) => s.label === 'G')!;
    expect(c.vector['ring.curl']).toBeGreaterThan(g.vector['ring.curl']);
  });

  it('honours windows and vocabulary', () => {
    const win = joinLabelledFrames(recs, { group: 'v', featurize, labelOf: segmentLabeller(SEGMENTS), windows: [[0, 2]] });
    expect(win.stats.perLabel.G).toBeUndefined();
    const voc = joinLabelledFrames(recs, { group: 'v', featurize, labelOf: segmentLabeller(SEGMENTS), vocabulary: new Set(['G']) });
    expect(voc.stats.perLabel.C).toBeUndefined();
    expect(voc.stats.perLabel.G).toBeGreaterThan(0);
  });

  it('takes any label lookup through the seam', () => {
    const { stats } = joinLabelledFrames(recs, { group: 'v', featurize, labelOf: (t) => (t < 1 ? 'X' : null) });
    expect(Object.keys(stats.perLabel)).toEqual(['X']);
    expect(stats.perLabel.X).toBe(30);
  });

  it('stamps probe frames with the probe label and never consults segments', () => {
    const { samples, stats } = joinUnlabelledFrames(recs, { group: 'probe', featurize });
    expect(stats.samples).toBe(stats.handFrames);
    expect(samples.every((s) => s.label === PROBE_LABEL)).toBe(true);
  });

  it('round-trips through NDJSON, NaN included', () => {
    const { samples } = joinLabelledFrames(recs.slice(0, 40), { group: 'v', featurize, labelOf: segmentLabeller(SEGMENTS) });
    samples[0].vector['index.curl'] = NaN;
    const back = samplesFromNdjson(samplesToNdjson(samples));
    expect(back.length).toBe(samples.length);
    expect(back[0].label).toBe(samples[0].label);
    expect(Number.isFinite(back[0].vector['index.curl'])).toBe(false);
    expect(back[1].vector['index.curl']).toBeCloseTo(samples[1].vector['index.curl'], 9);
  });
});
