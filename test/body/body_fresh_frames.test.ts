/**
 * `body-pulse` and `body-feature-vector` read a per-tick recording as the camera frames it holds
 * (#973). A recording written on every tick holds each camera frame on two lines, parsed into
 * two objects with one capture stamp; decided by object, every copy was a new sample. Measured
 * before the fix on the stamped fixtures under 60 Hz ticks: every speed in the body vector read
 * double (the frame's motion over one tick) and every acceleration about eight times over, the
 * Laban flow about seventeen; the pulse kept its trusted ticks on Que Calor (410 of 420) but its
 * confidence moved by up to 0.04 there and 0.32 on `video_body_conducting_44` under `auto`. Read
 * through `isFreshFrame`, the duplicated replay is the de-duplicated one, tick for tick.
 */
import { describe, expect, it } from 'vitest';
import { replayNode, type NodeHandlers } from '@thoremin/dag';
import type { PulseState } from '@thoremin/ictus';
import type { BodyFrame } from '@/nodes';
import { bodyPulseNode } from '@/slices/body/nodes/body_pulse';
import { bodyFeatureVectorNode } from '@/slices/body/nodes/body_feature_vector';
import type { FeatureVector } from '@thoremin/sdk/features/catalog';
import { loadStream } from '../helpers/fixtures';
import { firstLines, perTickLines, stampFrames } from '../helpers/per_tick';
import { BODY } from '../helpers/extensions';

const FPS = 30;
const CLIPS = ['video_body_que_calor', 'video_body_conducting_44'] as const;

describe.runIf(BODY)('a per-tick recording of a body is the camera frames it holds (#973)', () => {
  for (const clip of CLIPS) {
    const frames = stampFrames(loadStream(clip, 'camBody.body') as BodyFrame[], FPS);
    const lines = perTickLines(frames);
    /** The de-duplicated run at the camera rate, and the per-tick run at twice it. */
    const both = async <T>(make: () => NodeHandlers, port: string) => {
      const once = (await replayNode(make(), { body: frames }, { dt: 1 / FPS })).map((o) => o[port] as T);
      const ticks = (await replayNode(make(), { body: lines }, { dt: 1 / (2 * FPS) })).map((o) => o[port] as T);
      return { once, ticks };
    };

    it(`${clip}: the pulse (the stride, and auto) is the de-duplicated replay's on every frame`, async () => {
      for (const channel of ['stride', 'auto']) {
        const { once, ticks } = await both<PulseState>(() => bodyPulseNode.make(bodyPulseNode.params.parse({ channel })), 'pulse');
        expect(firstLines(ticks), channel).toEqual(once);
        // The copy is no sample: it holds what its frame said.
        for (let i = 1; i < ticks.length; i += 2) expect(ticks[i]).toBe(ticks[i - 1]);
      }
    });

    it(`${clip}: the body vector, its speeds and Laban effort included, is the de-duplicated replay's`, async () => {
      const params = bodyFeatureVectorNode.params.parse({ mirrorX: false });
      const { once, ticks } = await both<FeatureVector>(() => bodyFeatureVectorNode.make(params), 'vector');
      expect(Object.keys(once[60]).some((id) => id.startsWith('body.kin.speed.'))).toBe(true);
      expect(firstLines(ticks)).toEqual(once);
    });
  }
});
