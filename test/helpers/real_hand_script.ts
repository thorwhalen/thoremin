/**
 * A scripted take played by a REAL hand (#837): the same timeline as the synthetic hand
 * (`SYNTHETIC_HAND_TIMELINE`: the opening rest, then each shape held with the relaxed hand
 * between), but every frame is a recorded one from the committed `real_hands_signs` signer
 * (SignAlphaSet, CC BY 4.0), so a categorizer carved from it has met a real hand's jitter,
 * size and shape.
 *
 * Which sign stands for which shape: the open palm is B, the fist A, the pointing hand D, the
 * pinch F, and the relaxed hand C (a loose cup, the nearest thing to "doing nothing" in the
 * alphabet).
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import type { SyntheticScript } from '@thoremin/ext-faces/app/sources';
import { SYNTHETIC_HAND_SHAPES, syntheticHandPhase, syntheticHandShapeAt } from '@thoremin/ext-faces/lib/synthetic_hand';
import { handsFrameVector } from '@thoremin/sdk/features/modalities/hand';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import type { HandsFrame } from '@thoremin/sdk/nodes/domain';
import { stillestRun } from '../../scripts/stability/lib_streams';

/** The sign (the dataset's folder name) standing for each scripted shape. */
export const SIGN_OF_SHAPE: Readonly<Record<string, string>> = { rest: 'c', open: 'b', fist: 'a', point: 'g', pinch: 'o' };

/** A hold: this many consecutive frames of a sign (one second at the live rate). */
const HOLD_FRAMES = 30;

const FIXTURE = join(__dirname, '..', 'fixtures', 'real_hands_signs');

/** Each sign's recorded frames that have a hand, from the gaps performance. */
function framesBySign(): Map<string, HandsFrame[]> {
  const meta = JSON.parse(readFileSync(join(FIXTURE, 'meta.json'), 'utf8')) as { performances: { gaps: { segments: { from: number; to: number; sign: string | null }[] } } };
  const frames = gunzipSync(readFileSync(join(FIXTURE, 'gaps.hands.ndjson.gz')))
    .toString()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l).value as HandsFrame);
  const out = new Map<string, HandsFrame[]>();
  for (const s of meta.performances.gaps.segments) {
    if (!s.sign) continue;
    out.set(s.sign, [...(out.get(s.sign) ?? []), ...frames.slice(s.from, s.to).filter((f) => f.hands.length > 0)]);
  }
  return out;
}

export function realHandScript(): SyntheticScript {
  const bySign = framesBySign();
  const vectors = new Map<string, FeatureVector[]>();
  for (const [shape, sign] of Object.entries(SIGN_OF_SHAPE)) {
    const frames = bySign.get(sign);
    if (!frames?.length) throw new Error(`the signer fixture has no frames for ${sign} (${shape})`);
    // The stillest second of the sign (its start and end are the hand arriving and leaving): the
    // carve looks for holds, and a hand sweeping through its sign is not one.
    const size = { width: frames[0]!.width, height: frames[0]!.height };
    const held = stillestRun(frames.map((f) => f.hands[0] ?? null), Math.min(HOLD_FRAMES, frames.length)).flatMap((h) => (h ? [{ ...size, hands: [h] } as HandsFrame] : []));
    vectors.set(shape, held.map((f) => handsFrameVector(f, { mirrorX: true, mirrorHandedness: false })));
  }
  return {
    vectorAt(ms, frame) {
      const p = syntheticHandPhase(ms);
      const shape = SYNTHETIC_HAND_SHAPES[p.mix >= 0.5 ? p.to : p.from]!.name;
      const pool = vectors.get(shape)!;
      // Back and forth, not wrapped: a jump from the last frame to the first would be a movement.
      const period = Math.max(1, 2 * (pool.length - 1));
      const k = frame % period;
      return pool[k < pool.length ? k : period - k]!;
    },
    labelAt: (ms) => {
      const s = syntheticHandShapeAt(ms);
      return { name: s.name, color: s.color };
    },
  };
}
