/**
 * Tests built from *real video* fixtures — the "from-video" tier of the test
 * strategy, made durable. The raw clips (AI-generated via falaw, gitignored
 * under media/) were decoded once with MediaPipe (scripts/video_to_landmarks.py
 * / video_to_face.py); only the derived NDJSON is committed and replayed here,
 * so CI needs no camera/GPU.
 *
 * To regenerate: scripts/gen_test_videos.py → video_to_landmarks.py →
 * build_video_fixture.ts (hands) / video_to_face.py (face — the blendshape
 * stream plus, via --landmarks-out, the full 478-point mesh + transform-matrix
 * stream, committed gzipped). See docs/TESTING.md.
 */
import { describe, it, expect } from 'vitest';
import { replayNode } from '@/dag';
import { loadStream } from './helpers/fixtures';
import {
  voiceMappingNode,
  faceFeaturesNode,
  faceFeatureVectorNode,
  matrixToHeadPose,
  ABSENT_HAND,
  type HandFeatures,
  type FaceFeatures,
  type FaceFrame,
  type SynthParams,
} from '@/nodes';
import { FACE_FEATURES } from '@/features/catalog';

const presentSide = (f: HandFeatures) => (f.right.present ? f.right : f.left.present ? f.left : null);
// Loop, not Math.max(...xs): the face-mesh z guard feeds ~58k values, and a
// spread that size sits close to V8's argument limit — a longer replacement
// clip would crash with a RangeError instead of failing the fixture assertion.
const span = (xs: number[]) => {
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of xs) {
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  return hi - lo;
};

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

describe('video face landmark fixture (478-pt mesh + head pose — geom/gaze/head replay, #144)', () => {
  // The offline decoder ships the raw COLUMN-MAJOR transformation matrix rather
  // than a Python re-implementation of the Euler decomposition, so head pose is
  // decoded here by the production `matrixToHeadPose` — exactly as the live
  // `webcam-face` node does it, and with the decode logic single-sourced in TS.
  type FaceLandmarkRec = FaceFrame & { transformMatrix?: number[] };
  const recs = loadStream('video_face_expressions', 'face.landmarks') as FaceLandmarkRec[];
  const frames: FaceFrame[] = recs.map(({ transformMatrix, ...f }) => ({
    ...f,
    ...(transformMatrix ? { headPose: matrixToHeadPose(transformMatrix) } : {}),
  }));
  const present = frames.filter((f) => f.present);

  /** Catalog feature ids under a group prefix — derived from the catalog itself,
   *  so these tests automatically cover features added to a group later. */
  const groupIds = (prefix: string) =>
    FACE_FEATURES.filter((f) => f.group.startsWith(prefix)).map((f) => f.id);

  /** Replay the fixture through the real face-feature-vector node; one vector
   *  per PRESENT frame (memoized — several tests read the same replay). */
  let vecsP: Promise<Record<string, number>[]> | null = null;
  const presentVectors = () =>
    (vecsP ??= (async () => {
      const parsed = faceFeatureVectorNode.params.parse({});
      const outs = await replayNode(faceFeatureVectorNode.make(parsed), { face: frames });
      return outs
        .map((o) => o.vector as Record<string, number>)
        .filter((_, i) => frames[i].present);
    })());

  const values = (vecs: Record<string, number>[], id: string) => vecs.map((v) => v[id]);

  it('decodes the full mesh: 478 landmarks per frame, depth (z) preserved, matrix column-major', () => {
    expect(frames.length).toBeGreaterThan(100);
    expect(present.length / frames.length).toBeGreaterThan(0.9); // tracked at ~100%
    for (const f of present) {
      // All 478 points (irises are 468..477) — the geometric catalog needs every one.
      expect(f.landmarks).toHaveLength(478);
      expect(Object.keys(f.blendshapes).length).toBeGreaterThan(0);
      expect(f.headPose).toBeDefined();
    }
    // The rigid transform: 16 entries, bottom row [0,0,0,1] at the COLUMN-MAJOR
    // positions and the camera-distance translation in the z slot — this fails
    // loudly if a regeneration flattens the numpy matrix row-major instead.
    const matrices = recs.filter((r) => r.present).map((r) => r.transformMatrix!);
    for (const m of matrices) {
      expect(m).toHaveLength(16);
      expect([m[3], m[7], m[11], m[15]]).toEqual([0, 0, 0, 1]);
      expect(Math.abs(m[14])).toBeGreaterThan(5); // translation z (cm from camera)
    }
    // z is real depth, not zeroed — the regression this fixture exists to prevent
    // (the hand decoder once dropped z and silently flattened every 3-D feature).
    const zs = present.flatMap((f) => f.landmarks!.map((p) => p.z!));
    expect(zs.every(Number.isFinite)).toBe(true);
    expect(span(zs)).toBeGreaterThan(0.05);
  });

  it('face.geom.*: every catalog feature computes finite on every tracked frame; expressions move mouth/brow/eyes', async () => {
    const vecs = await presentVectors();
    const ids = groupIds('face.geom');
    expect(ids.length).toBeGreaterThanOrEqual(20);
    // The node emits only FINITE values, so presence of the key IS finiteness —
    // this covers the NaN-guard / iris-fallback machinery on real mesh data.
    for (const v of vecs) for (const id of ids) expect(v, `missing ${id}`).toHaveProperty(id);
    // The expressions clip opens the jaw, raises the brows and squints/blinks
    // (thresholds ≈ half the measured spans on the committed decode).
    expect(span(values(vecs, 'face.geom.mouth.aspectRatio'))).toBeGreaterThan(0.35);
    expect(span(values(vecs, 'face.geom.mouth.openness'))).toBeGreaterThan(0.2);
    expect(span(values(vecs, 'face.geom.brow.raiseAvg'))).toBeGreaterThan(0.06);
    expect(span(values(vecs, 'face.geom.eye.earAvg'))).toBeGreaterThan(0.05);
  });

  it('face.gaze.*: iris-dependent features all compute on real irises; vertical gaze moves', async () => {
    const vecs = await presentVectors();
    const ids = groupIds('face.gaze');
    expect(ids.length).toBeGreaterThanOrEqual(7);
    for (const v of vecs) for (const id of ids) expect(v, `missing ${id}`).toHaveProperty(id);
    // Iris offsets are normalized by the eye half-span → bounded near [-1, 1].
    for (const id of ['face.gaze.x', 'face.gaze.y', 'face.gaze.xLeft', 'face.gaze.yLeft']) {
      expect(values(vecs, id).every((x) => Math.abs(x) <= 1.5)).toBe(true);
    }
    expect(span(values(vecs, 'face.gaze.y'))).toBeGreaterThan(0.25); // eyes track the expressions
  });

  it('face.head.*: pose decodes to plausible frontal angles; position and scale are in range', async () => {
    const vecs = await presentVectors();
    const ids = groupIds('face.head');
    expect(ids.length).toBeGreaterThanOrEqual(7);
    for (const v of vecs) for (const id of ids) expect(v, `missing ${id}`).toHaveProperty(id);
    // A face-the-camera clip: all pose angles stay well inside ±45°.
    for (const id of ['face.head.yaw', 'face.head.pitch', 'face.head.roll']) {
      expect(values(vecs, id).every((x) => Math.abs(x) < 45)).toBe(true);
    }
    expect(values(vecs, 'face.head.x').every((x) => x > 0 && x < 1)).toBe(true);
    expect(values(vecs, 'face.head.y').every((y) => y > 0 && y < 1)).toBe(true);
    expect(values(vecs, 'face.head.scale').every((s) => s > 0.02 && s < 0.5)).toBe(true);
    expect(values(vecs, 'face.head.distanceProxy').every((d) => d > 0 && Number.isFinite(d))).toBe(true);
    expect(span(values(vecs, 'face.head.y'))).toBeGreaterThan(0.2); // the head moves in the clip
  });
});
