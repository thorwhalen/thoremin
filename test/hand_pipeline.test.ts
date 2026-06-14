/**
 * Tests the hand pipeline as composable nodes AND as a wired DAG:
 *   synthetic-hands → hand-features → voice-mapping
 *
 * Also demonstrates the record→replay workflow: run the graph once recording
 * the `hand-features` edge, then replay that recording into a fresh mapping
 * node and confirm identical synth params (no source/feature recomputation).
 */
import { describe, it, expect } from 'vitest';
import { runHeadless, replayNode, type GraphSpec } from '@/dag';
import {
  createCoreRegistry,
  handFeaturesNode,
  voiceMappingNode,
  makeHandKeypoints,
  type HandsFrame,
  type HandFeatures,
  type SynthParams,
} from '@/nodes';

const FEAT_PARAMS = {
  mirrorX: false,
  mirrorHandedness: false,
  opennessMin: 1.3,
  opennessMax: 2.3,
  pinchTouch: 0.25,
  pinchApart: 1.2,
};

const MAP_PARAMS = {
  magnetism: 1,
  maxGain: 0.5,
  opennessGatesGain: false,
  right: { scale: { root: 0, type: 'major' as const, octaves: 2, baseOctave: 3 }, instrument: 'sine' as const },
  left: { scale: { root: 0, type: 'major' as const, octaves: 2, baseOctave: 3 }, instrument: 'triangle' as const },
};

function rightHandFrame(spread: number, pinch: number): HandsFrame {
  return {
    width: 640,
    height: 480,
    hands: [
      {
        handedness: 'Right',
        keypoints: makeHandKeypoints({ cx: 320, cy: 300, scale: 80, spread, pinch, handedness: 'Right' }),
      },
    ],
  };
}

describe('hand-features node', () => {
  it('open hand has higher openness than a fist; pinch detects thumb-index contact', async () => {
    const run = (spread: number, pinch: number) =>
      replayNode(handFeaturesNode.make(FEAT_PARAMS), { hands: [rightHandFrame(spread, pinch)] });

    const [fist] = await run(0, 0);
    const [open] = await run(1, 0);
    const [pinched] = await run(0.5, 1);
    const [unpinched] = await run(0.5, 0);

    expect((open.features as HandFeatures).right.openness).toBeGreaterThan(
      (fist.features as HandFeatures).right.openness,
    );
    expect((pinched.features as HandFeatures).right.pinch).toBeGreaterThan(
      (unpinched.features as HandFeatures).right.pinch,
    );
    expect((pinched.features as HandFeatures).right.pinch).toBeGreaterThan(0.5);
  });

  it('reports both hands absent when no hands present', async () => {
    const [out] = await replayNode(handFeaturesNode.make(FEAT_PARAMS), {
      hands: [{ width: 640, height: 480, hands: [] } as HandsFrame],
    });
    const f = out.features as HandFeatures;
    expect(f.right.present).toBe(false);
    expect(f.left.present).toBe(false);
  });
});

describe('synthetic → features → mapping DAG', () => {
  const spec: GraphSpec = {
    nodes: [
      { id: 'src', type: 'synthetic-hands', params: { width: 640, height: 480, sweepPeriod: 4, hands: 'right' } },
      { id: 'feat', type: 'hand-features', params: FEAT_PARAMS },
      { id: 'map', type: 'voice-mapping', params: MAP_PARAMS },
    ],
    edges: [
      { from: { node: 'src', port: 'hands' }, to: { node: 'feat', port: 'hands' } },
      { from: { node: 'feat', port: 'features' }, to: { node: 'map', port: 'features' } },
    ],
  };

  it('produces a present right voice whose pitch rises as the hand sweeps right', async () => {
    const { recorder } = await runHeadless(spec, createCoreRegistry(), { ticks: 60, nominalDt: 1 / 30 });

    const params = recorder.values('map.params') as SynthParams[];
    expect(params.length).toBe(60);
    expect(params.every((p) => p.voices[0].present)).toBe(true);
    expect(params.every((p) => p.voices[0].freq > 0)).toBe(true);

    const featRec = recorder.values('feat.features') as HandFeatures[];
    const xs = featRec.map((f) => f.right.x);
    expect(xs[10]).toBeGreaterThan(xs[0]); // hand sweeps rightward

    expect(params[20].voices[0].freq).toBeGreaterThan(params[2].voices[0].freq); // pitch rises with x
  });

  it('record once, replay the features edge into a fresh mapping node → identical params', async () => {
    const { recorder } = await runHeadless(spec, createCoreRegistry(), { ticks: 30, nominalDt: 1 / 30 });

    const recordedFeatures = recorder.values('feat.features');
    const liveFreqs = (recorder.values('map.params') as SynthParams[]).map((p) => p.voices[0].freq);

    const replayParams = await replayNode(voiceMappingNode.make(MAP_PARAMS), { features: recordedFeatures }, { dt: 1 / 30 });
    const replayedFreqs = replayParams.map((p) => (p.params as SynthParams).voices[0].freq);

    expect(replayedFreqs).toEqual(liveFreqs);
  });
});
