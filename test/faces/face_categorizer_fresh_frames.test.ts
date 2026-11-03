/**
 * `face-categorizer` reads a per-tick recording as the camera frames it holds (#973). Its
 * tracker's hysteresis counts camera frames (`enterFrames`, `exitFrames`), so a recording that
 * holds each frame on two lines, parsed into two objects with one capture stamp, counted every
 * copy when a new frame was decided by its object: on `video_face_expressions` under 60 Hz ticks
 * the smile and the open smile were entered a frame early and let go five frames early (7 of 121
 * readings off). Read through `isFreshFrame`, the duplicated replay is the de-duplicated one.
 */
import { describe, expect, it } from 'vitest';
import { replayNode } from '@thoremin/dag';
import type { FaceFrame } from '@thoremin/sdk/nodes/domain';
import type { ExpressionScores } from '@thoremin/sdk/music/expression';
import { categorizerPlay } from '@thoremin/ext-faces/lib/play';
import { faceCategorizerNode } from '@thoremin/ext-faces/nodes/face_categorizer';
import { DEFAULT_FACE_CATEGORIZER, type FaceCategorizerDial } from '@thoremin/ext-faces/schema';
import { RECORDING_FPS, recordedCategorizer, recordedFrames } from '../helpers/faceRecording';
import { firstLines, perTickLines, stampFrames } from '../helpers/per_tick';
import { FACES } from '../helpers/extensions';

describe.runIf(FACES)('a per-tick recording of a face is the camera frames it holds (#973)', () => {
  const recorded = recordedFrames();
  const play = categorizerPlay({ id: 'mine', name: 'Mine', categorizer: recordedCategorizer(recorded) });
  const config: FaceCategorizerDial = { ...DEFAULT_FACE_CATEGORIZER, id: 'mine' };
  const frames = stampFrames(recorded, RECORDING_FPS);

  const read = async (face: FaceFrame[], dt: number) => {
    const node = faceCategorizerNode.make(faceCategorizerNode.params.parse({}));
    const out = await replayNode(node, { face, model: face.map(() => play), config: face.map(() => config) }, { dt });
    return out.map((o) => o.expression as ExpressionScores);
  };

  it('the categories are entered and let go on the same camera frames as the de-duplicated replay', async () => {
    const once = await read(frames, 1 / RECORDING_FPS);
    const ticks = await read(perTickLines(frames), 1 / (2 * RECORDING_FPS));
    // The recording reaches both categories, and lets the last one go.
    const ids = once.map((r) => r.personal?.id ?? null);
    expect(new Set(ids.filter((id) => id !== null)).size).toBe(2);
    expect(ids.at(-1)).toBeNull();
    expect(firstLines(ticks)).toEqual(once);
  });
});
