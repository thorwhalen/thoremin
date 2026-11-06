/**
 * The air guitar's shipped chord shapes against the take they were measured on: the author
 * names each chord aloud, then holds it with the left hand and strums with the right
 * (`thoremin-recordings`, take 2026-11-05T12-27-17).
 *
 * - the shipped numbers are what the derivation makes from the take today (a change to the
 *   shape features, the labelling or the take shows up here, not as a silent drift);
 * - the left hand is the one holding still (the fretting hand of a right-handed player);
 * - held out within the take, the shapes name the right chord on at least 90% of frames (95%
 *   measured);
 * - played through the `air-guitar` node as shipped (default dial, the recorded vocabulary),
 *   the chord it holds during each named stretch is that chord on at least 90% of frames.
 *
 * The landmarks are the player's body, read at run time from the private dataset; skipped
 * without a checkout (`test/helpers/recordings.ts`).
 */
import { describe, expect, it } from 'vitest';
import type { HandsFrame } from '@thoremin/sdk/nodes/domain';
import { airGuitarNode, type AirGuitarStatus } from '@thoremin/ext-air/nodes/air_guitar';
import { chordOfLabel, RECORDED_CHORDS, recordedChordVocabulary } from '@thoremin/ext-air/lib/recorded_chords';
import { trainVocabulary } from '@thoremin/ext-air/lib/vocabulary';
import { HAS_RECORDINGS, recordingStream } from '../helpers/recordings';
import { heldOutScore, RECORDED_TAKE, recordedSegments, summarise } from '../../scripts/air/lib_recorded_chords';

describe.runIf(HAS_RECORDINGS)("the air guitar's recorded chord shapes, on their take", () => {
  let cached: ReturnType<typeof recordedSegments> | null = null;
  const take = () => (cached ??= recordedSegments());

  it('the shipped numbers are what the take gives today', () => {
    const made = summarise(take().segments, RECORDED_CHORDS.source, RECORDED_CHORDS.heldOut);
    expect(made).toEqual(RECORDED_CHORDS);
  });

  it('every spoken name fits the progression of fourths, so none was changed', () => {
    expect(take().decisions.every((d) => d.label === d.heard)).toBe(true);
  });

  it('the left hand holds still and the right strums', () => {
    const travel = (label: string) => {
      let sum = 0;
      let n = 0;
      let prev: { x: number; y: number } | null = null;
      for (const r of recordingStream(RECORDED_TAKE, 'hands')) {
        const f = r.value as HandsFrame | null;
        const w = f?.hands.find((h) => h.handedness === label)?.keypoints[0];
        if (w && prev) {
          sum += Math.hypot(w.x - prev.x, w.y - prev.y) / f!.height;
          n++;
        }
        prev = w ? { x: w.x, y: w.y } : null;
      }
      return sum / n;
    };
    expect(travel('Right')).toBeGreaterThan(3 * travel('Left'));
  });

  it('held out within the take, at least 90% of frames are named the right chord', () => {
    const score = heldOutScore(take().segments);
    expect(score.chordAccuracy).toBeGreaterThan(0.9);
    expect(Math.round(1000 * score.chordAccuracy) / 1000).toBe(RECORDED_CHORDS.heldOut.chordAccuracy);
  });

  it('played through the node as shipped, it holds the named chord', () => {
    const h = airGuitarNode.make(airGuitarNode.params.parse({}));
    const model = trainVocabulary(recordedChordVocabulary());
    const segments = take().segments;
    let right = 0;
    let counted = 0;
    for (const r of recordingStream(RECORDED_TAKE, 'hands')) {
      const f = r.value as HandsFrame | null;
      if (!f) continue;
      const out = h.process({ hands: f, config: { enabled: true }, model, octaveShift: 0 }, { time: r.t, dt: 1 / 30, tick: r.tick, resources: {} } as never) as { status: AirGuitarStatus };
      const seg = segments.find((s) => r.t >= s.start && r.t < s.end);
      if (!seg) continue;
      counted++;
      if (out.status.chord !== null && chordOfLabel(out.status.chord) === chordOfLabel(seg.label)) right++;
    }
    expect(counted).toBeGreaterThan(1200);
    expect(right / counted).toBeGreaterThan(0.9);
  });
});
