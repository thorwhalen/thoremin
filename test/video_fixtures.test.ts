/**
 * Tests built from *real video* fixtures — the "from-video" tier of the test
 * strategy, made durable. The raw clips (AI-generated via falaw, gitignored
 * under media/) were decoded once with MediaPipe (scripts/video_to_landmarks.py
 * / video_to_face.py); only the derived NDJSON is committed and replayed here,
 * so CI needs no camera/GPU.
 *
 * To regenerate: scripts/gen_test_videos.py → video_to_landmarks.py →
 * build_video_fixture.ts (hands) / video_to_face.py (face). See docs/TESTING.md.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { valuesFromNDJSON, replayNode } from '@/dag';
import { voiceMappingNode, type HandFeatures, type SynthParams } from '@/nodes';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function load(scenario: string, key: string): unknown[] {
  const path = join(FIXTURES, scenario, `${key}.ndjson`);
  if (!existsSync(path)) throw new Error(`missing ${path} — regenerate video fixtures (see docs/TESTING.md)`);
  return valuesFromNDJSON(readFileSync(path, 'utf8'));
}

const presentSide = (f: HandFeatures) => (f.right.present ? f.right : f.left.present ? f.left : null);
const span = (xs: number[]) => Math.max(...xs) - Math.min(...xs);

describe('video hand fixtures (real MediaPipe tracking)', () => {
  const HAND_SCENARIOS: Array<{ dir: string; feature: 'x' | 'openness' | 'pinch'; minSpan: number }> = [
    { dir: 'video_hand_sweep', feature: 'x', minSpan: 0.25 },
    { dir: 'video_hand_open_close', feature: 'openness', minSpan: 0.3 },
    { dir: 'video_hand_pinch', feature: 'pinch', minSpan: 0.4 },
  ];

  for (const { dir, feature, minSpan } of HAND_SCENARIOS) {
    it(`${dir}: tracks a hand and the ${feature} feature varies; pitch follows`, async () => {
      const feats = load(dir, 'feat.features') as HandFeatures[];
      const sel = feats.map(presentSide).filter((s): s is NonNullable<typeof s> => !!s);
      // High detection rate on the generated clip.
      expect(sel.length / feats.length).toBeGreaterThan(0.8);
      // The targeted feature has meaningful range.
      expect(span(sel.map((s) => s[feature]))).toBeGreaterThan(minSpan);
      // All features are real numbers (guards the params-parse bug class).
      expect(sel.every((s) => Number.isFinite(s.openness) && Number.isFinite(s.pinch) && Number.isFinite(s.x))).toBe(true);

      // Replaying the recorded features through voice-mapping yields a voiced,
      // varying pitch — the full feature→synth chain works on tracked data.
      const parsed = voiceMappingNode.params.parse({ magnetism: 1 });
      const out = (await replayNode(voiceMappingNode.make(parsed), { features: feats })).map((o) => o.params as SynthParams);
      const freqs = out.flatMap((p) => p.voices.filter((v) => v.present).map((v) => v.freq));
      expect(freqs.length).toBeGreaterThan(feats.length * 0.5);
      expect(freqs.every((f) => f > 0)).toBe(true);
    });
  }
});

describe('video face fixture (MediaPipe blendshapes — M4 prep)', () => {
  it('detects a face and key expression blendshapes vary', () => {
    type FaceFrame = { present: boolean; blendshapes: Record<string, number> };
    const frames = load('video_face_expressions', 'face.blendshapes') as FaceFrame[];
    const present = frames.filter((f) => f.present);
    expect(present.length / frames.length).toBeGreaterThan(0.8);
    for (const key of ['mouthSmileLeft', 'jawOpen', 'browInnerUp']) {
      const vals = present.map((f) => f.blendshapes[key] ?? 0);
      expect(span(vals)).toBeGreaterThan(0.3); // the expression actually moves
    }
  });
});
