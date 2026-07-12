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
import { describe, it, expect } from 'vitest';
import { replayNode } from '@/dag';
import { loadStream } from './helpers/fixtures';
import {
  voiceMappingNode,
  faceFeaturesNode,
  ABSENT_HAND,
  type HandFeatures,
  type FaceFeatures,
  type FaceFrame,
  type SynthParams,
} from '@/nodes';

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
      const feats = loadStream(dir, 'feat.features') as HandFeatures[];
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

describe('video fixtures drive gesture expression (real tracking)', () => {
  // Per present frame, pair the hand feature with the voice the synth receives
  // (voice 0 = right, 1 = left), so we confirm a real gesture moves the
  // expression value the synth actually consumes.
  it('hand_open_close: openness drives a varying, correlated brightness', async () => {
    const feats = loadStream('video_hand_open_close', 'feat.features') as HandFeatures[];
    const parsed = voiceMappingNode.params.parse({ magnetism: 1 });
    const out = (await replayNode(voiceMappingNode.make(parsed), { features: feats })).map((o) => o.params as SynthParams);
    const pairs = feats
      .map((f, i) => {
        const side = f.right.present ? 'right' : f.left.present ? 'left' : null;
        if (!side) return null;
        const v = out[i].voices[side === 'right' ? 0 : 1];
        return { openness: f[side].openness, brightness: v.brightness ?? 1 };
      })
      .filter((r): r is { openness: number; brightness: number } => !!r);

    expect(pairs.length).toBeGreaterThan(feats.length * 0.5);
    const brights = pairs.map((p) => p.brightness);
    expect(span(brights)).toBeGreaterThan(0.2); // brightness actually moves
    const atMaxOpen = pairs.reduce((a, b) => (b.openness > a.openness ? b : a));
    const atMinOpen = pairs.reduce((a, b) => (b.openness < a.openness ? b : a));
    expect(atMaxOpen.brightness).toBeGreaterThan(atMinOpen.brightness); // open → brighter
  });

  it('hand_sweep: the sweeping hand pans across the stereo field', async () => {
    const feats = loadStream('video_hand_sweep', 'feat.features') as HandFeatures[];
    const parsed = voiceMappingNode.params.parse({ magnetism: 1 });
    const out = (await replayNode(voiceMappingNode.make(parsed), { features: feats })).map((o) => o.params as SynthParams);
    const pairs = feats
      .map((f, i) => {
        const side = f.right.present ? 'right' : f.left.present ? 'left' : null;
        if (!side) return null;
        return { x: f[side].x, pan: out[i].voices[side === 'right' ? 0 : 1].pan ?? 0 };
      })
      .filter((r): r is { x: number; pan: number } => !!r);

    expect(span(pairs.map((p) => p.pan))).toBeGreaterThan(0.2); // pan actually moves
    const atMaxX = pairs.reduce((a, b) => (b.x > a.x ? b : a));
    const atMinX = pairs.reduce((a, b) => (b.x < a.x ? b : a));
    expect(atMaxX.pan).toBeGreaterThan(atMinX.pan); // hand right → pan right
  });

  it('hand_pinch: pinch drives a varying, correlated vibrato', async () => {
    const feats = loadStream('video_hand_pinch', 'feat.features') as HandFeatures[];
    const parsed = voiceMappingNode.params.parse({ magnetism: 1 });
    const out = (await replayNode(voiceMappingNode.make(parsed), { features: feats })).map((o) => o.params as SynthParams);
    const pairs = feats
      .map((f, i) => {
        const side = f.right.present ? 'right' : f.left.present ? 'left' : null;
        if (!side) return null;
        const v = out[i].voices[side === 'right' ? 0 : 1];
        return { pinch: f[side].pinch, vibrato: v.vibrato ?? 0 };
      })
      .filter((r): r is { pinch: number; vibrato: number } => !!r);

    expect(pairs.length).toBeGreaterThan(feats.length * 0.5);
    expect(span(pairs.map((p) => p.vibrato))).toBeGreaterThan(0.4); // vibrato moves
    const atMaxPinch = pairs.reduce((a, b) => (b.pinch > a.pinch ? b : a));
    const atMinPinch = pairs.reduce((a, b) => (b.pinch < a.pinch ? b : a));
    expect(atMaxPinch.vibrato).toBeGreaterThan(atMinPinch.vibrato); // pinch → more wobble
  });
});

describe('video face fixture drives expression (smile→brightness, mouth→vibrato)', () => {
  it('a smile brightens and an open mouth adds vibrato, on real face tracking', async () => {
    const faceFrames = loadStream('video_face_expressions', 'face.blendshapes') as FaceFrame[];
    // Real blendshapes → normalized face features, via the actual node.
    const faceFeats = (
      await replayNode(faceFeaturesNode.make(faceFeaturesNode.params.parse({})), { face: faceFrames })
    ).map((o) => o.features as FaceFeatures);

    // A constant, lightly-open / low-pinch right hand so the FACE is the only
    // thing varying frame to frame — isolating its contribution.
    const hand: HandFeatures = {
      left: { ...ABSENT_HAND },
      right: { ...ABSENT_HAND, present: true, x: 0.5, y: 0.3, openness: 0.3, pinch: 0.1 },
    };
    const hands = faceFeats.map(() => hand);
    const parsed = voiceMappingNode.params.parse({});
    const out = (
      await replayNode(voiceMappingNode.make(parsed), { features: hands, face: faceFeats })
    ).map((o) => o.params as SynthParams);

    const rows = out.map((p, i) => ({
      smile: faceFeats[i].smile,
      mouthOpen: faceFeats[i].mouthOpen,
      brightness: p.voices[0].brightness!,
      vibrato: p.voices[0].vibrato!,
    }));
    expect(span(rows.map((r) => r.brightness))).toBeGreaterThan(0.05);
    expect(span(rows.map((r) => r.vibrato))).toBeGreaterThan(0.05);
    const by = (k: 'smile' | 'mouthOpen', dir: 1 | -1) =>
      rows.reduce((a, b) => (dir * (b[k] - a[k]) > 0 ? b : a));
    expect(by('smile', 1).brightness).toBeGreaterThan(by('smile', -1).brightness);
    expect(by('mouthOpen', 1).vibrato).toBeGreaterThan(by('mouthOpen', -1).vibrato);
  });
});

describe('video face fixture (MediaPipe blendshapes — M4 prep)', () => {
  it('detects a face and key expression blendshapes vary', () => {
    type FaceFrame = { present: boolean; blendshapes: Record<string, number> };
    const frames = loadStream('video_face_expressions', 'face.blendshapes') as FaceFrame[];
    const present = frames.filter((f) => f.present);
    expect(present.length / frames.length).toBeGreaterThan(0.8);
    for (const key of ['mouthSmileLeft', 'jawOpen', 'browInnerUp']) {
      const vals = present.map((f) => f.blendshapes[key] ?? 0);
      expect(span(vals)).toBeGreaterThan(0.3); // the expression actually moves
    }
  });
});
