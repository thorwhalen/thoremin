/**
 * The head-pose chord on the realization pipeline (H4c of #613) against its predecessor, copied
 * verbatim (`./reference/pose_chord_before_h4c.ts`): random scripts of face controls (yaw sweeping
 * the degrees, pitch shifting octaves, the jaw gating, the brow adding the seventh, smile and
 * frown), every voicing and rendering, several chord sources (a pentatonic and a blues one
 * included), uneven ticks. Equal output, tick for tick.
 */
import { describe, it, expect } from 'vitest';
import { poseChordNode } from '@/nodes/music/pose_chord';
import { poseChordNode as referenceNode } from './reference/pose_chord_before_h4c';
import { RENDERINGS, VOICINGS } from '@thoremin/sdk/music/voicing';
import type { ScaleSpec } from '@thoremin/sdk/music/theory';
import type { FaceControls } from '@thoremin/sdk/nodes/domain';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SPECS: ScaleSpec[] = [
  { root: 0, type: 'major', octaves: 2, baseOctave: 3 },
  { root: 9, type: 'minorHarmonic', octaves: 2, baseOctave: 3 },
  { root: 2, type: 'pentatonic', octaves: 1, baseOctave: 4 },
  { root: 7, type: 'blues', octaves: 2, baseOctave: 2 },
];
const IDIOMS = VOICINGS.filter((v) => v !== 'voiceLed');

describe('the head-pose chord equals its predecessor', () => {
  it('on 300 random face-control scripts of 120 ticks', () => {
    const r = rng(76);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
    for (let n = 0; n < 300; n++) {
      const params = poseChordNode.params.parse({});
      const a = poseChordNode.make(params);
      const b = referenceNode.make(referenceNode.params.parse({}));
      const spec = pick(SPECS);
      let controls: FaceControls = { present: true, headYaw: 0, headPitch: 0, mouthOpen: 0.5, browRaise: 0, smileFrown: 0 } as FaceControls;
      for (let tick = 0; tick < 120; tick++) {
        if (r() < 0.15) {
          controls = {
            ...controls,
            present: r() > 0.05,
            headYaw: pick([-1.2, -0.7, -0.3, 0, 0.2, 0.55, 0.9, 1.4]),
            headPitch: pick([-1, -0.4, 0, 0.3, 0.8, 1.5]),
            mouthOpen: pick([0, 0.05, 0.12, 0.3, 0.9]),
            browRaise: pick([0, 0.4, 0.5, 0.9]),
            smileFrown: pick([-1, -0.3, 0, 0.6, 1]),
          };
        }
        const inputs = {
          controls,
          spec,
          faceMapping: tick % 50 < 45 ? 'controls' : 'chord',
          octaveShift: pick([0, 0, 1, -1]),
          chordConfig: tick % 30 < 25 ? { voicing: IDIOMS[n % IDIOMS.length], rendering: RENDERINGS[(n + tick) % RENDERINGS.length], bpm: pick([60, 100, 160]), gain: 0.3, sound: 'warmPad' } : undefined,
        };
        const ctx = { time: tick / 30, dt: pick([1 / 30, 1 / 60, 0.05, Number.NaN]), tick, resources: {} } as never;
        expect(a.process(inputs, ctx), `script ${n}, tick ${tick}`).toEqual(b.process(inputs, ctx));
      }
    }
  });
});
