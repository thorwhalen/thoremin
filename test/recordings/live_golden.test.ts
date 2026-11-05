/**
 * The player's real sessions replayed through today's feature nodes must compute what the app
 * computed live when the session was recorded.
 *
 * Each recording (the private `thoremin-recordings` dataset, `test/helpers/recordings.ts`) keeps
 * the camera's hand and face frames AND every port the app computed from them, logged change-only
 * per engine tick. Replaying the frames tick by tick (each tick sees the newest camera frame at or
 * before it, as live) through `hand-features`, `gesture-classifier` and `face-features` must give
 * the logged values back, so a change to those nodes that moves what a real player's hands or face
 * produce fails here with the tick and the take, on real bodies rather than synthetic ones.
 *
 * Skipped when the dataset is not checked out (this repository is public; the landmarks are not).
 */
import { describe, expect, it } from 'vitest';
import type { NodeContext, StreamRecord } from '@thoremin/dag';
import { faceFeaturesNode, gestureClassifierNode, handFeaturesNode } from '@/nodes';
import { HAS_RECORDINGS, liveValuesAt, recordingIds, recordingMeta, recordingSettings, recordingStream } from '../helpers/recordings';

const ctx = (tick: number, dt: number): NodeContext => ({ tick, time: tick * dt, dt, resources: {} });

/** The camera frame each engine tick saw: the newest frame whose app tick is at or before it. */
function framesByTick(frames: readonly StreamRecord[]): { ticks: number[]; frame: unknown[] } {
  const appTick = (r: StreamRecord) => (r as unknown as { appTick: number }).appTick;
  const last = appTick(frames[frames.length - 1]!);
  const ticks: number[] = [];
  const frame: unknown[] = [];
  let j = -1;
  for (let tk = appTick(frames[0]!); tk <= last; tk++) {
    while (j + 1 < frames.length && appTick(frames[j + 1]!) <= tk) j++;
    ticks.push(tk);
    frame.push(frames[j]!.value);
  }
  return { ticks, frame };
}

function maxAbsDiff(a: unknown, b: unknown, path = ''): { d: number; at: string } {
  if (typeof a === 'number' && typeof b === 'number') return { d: Math.abs(a - b), at: path };
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    let worst = { d: 0, at: path };
    for (const k of Object.keys(a as object)) {
      const w = maxAbsDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
      if (w.d > worst.d) worst = w;
    }
    return worst;
  }
  return { d: a === b ? 0 : Infinity, at: path };
}

const handTakes = HAS_RECORDINGS ? recordingIds().filter((id) => recordingMeta(id).streams.app?.keys?.includes('feat.features')) : [];
const faceTakes = HAS_RECORDINGS ? recordingIds().filter((id) => recordingMeta(id).streams.app?.keys?.includes('faceFeat.features')) : [];

describe.runIf(HAS_RECORDINGS)('real sessions replay to what the app computed live', () => {
  it('has takes to replay', () => {
    expect(handTakes.length).toBeGreaterThanOrEqual(10);
    expect(faceTakes.length).toBeGreaterThanOrEqual(2);
  });

  for (const id of handTakes) {
    it(`hand-features and gesture-classifier, ${recordingMeta(id).instrument.label} (${id})`, () => {
      const settings = recordingSettings(id);
      const dwell = settings.handednessDwell as number | undefined;
      // Per camera frame, at the tick it arrived: the hand nodes run on each new frame.
      const frames = recordingStream(id, 'hands');
      const ticks = frames.map((r) => (r as unknown as { appTick: number }).appTick);
      const frame = frames.map((r) => r.value);
      const feat = handFeaturesNode.make(handFeaturesNode.params.parse({ mirrorX: true, mirrorHandedness: true }));
      const gesture = gestureClassifierNode.make(gestureClassifierNode.params.parse({}));
      const liveFeat = liveValuesAt(id, 'feat.features', ticks);
      const livePoses = liveValuesAt(id, 'gesture.poses', ticks);
      const dt = recordingMeta(id).durationS / ticks.length;
      let worst = { d: 0, at: '', tick: -1 };
      const diffs: number[] = [];
      let poseAgree = 0;
      let compared = 0;
      ticks.forEach((tk, i) => {
        const c = ctx(tk, dt);
        const { features } = feat.process({ hands: frame[i], handednessDwell: dwell }, c) as { features: unknown };
        const { poses } = gesture.process({ features }, c) as { poses: unknown };
        if (liveFeat[i] === undefined) return;
        compared++;
        const w = maxAbsDiff(liveFeat[i], features);
        diffs.push(w.d);
        if (w.d > worst.d) worst = { ...w, tick: tk };
        if (JSON.stringify(livePoses[i]) === JSON.stringify(poses)) poseAgree++;
      });
      expect(compared).toBeGreaterThan(ticks.length * 0.9);
      // The landmarks are kept to 0.1 px and the logged features to 1e-4, so a value can move by a
      // few thousandths where a feature divides two short distances (a pinch, a finger's
      // closeness); a code change moves far more, and on far more ticks.
      diffs.sort((a, b) => a - b);
      const p99 = diffs[Math.floor(diffs.length * 0.99)]!;
      expect(p99, 'the 99th percentile frame').toBeLessThan(2e-3);
      expect(worst.d, `worst at tick ${worst.tick}${worst.at}`).toBeLessThan(1e-2);
      expect(poseAgree / compared).toBeGreaterThan(0.99);
    });
  }

  for (const id of faceTakes) {
    it(`face-features, ${recordingMeta(id).instrument.label} (${id})`, () => {
      const { ticks, frame } = framesByTick(recordingStream(id, 'face'));
      const node = faceFeaturesNode.make(faceFeaturesNode.params.parse({ smoothing: 0.3 }));
      const live = liveValuesAt(id, 'faceFeat.features', ticks);
      // The smoothing carries state from before the recorder started; it has forgotten it
      // (0.3 per tick) well within the first 45 ticks.
      const WARMUP = 45;
      let worst = { d: 0, at: '', tick: -1 };
      ticks.forEach((tk, i) => {
        const { features } = node.process({ face: frame[i] }, ctx(tk, 1 / 45)) as { features: unknown };
        if (live[i] === undefined || i < WARMUP) return;
        const w = maxAbsDiff(live[i], features);
        if (w.d > worst.d) worst = { ...w, tick: tk };
      });
      expect(worst.d, `worst at tick ${worst.tick}${worst.at}`).toBeLessThan(2e-3);
    });
  }
});
