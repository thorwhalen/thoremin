/**
 * Tests the gesture-expression mapping added to voice-mapping: hand openness
 * shapes a live `brightness` (0..1) on each voice, which the synth turns into a
 * per-voice low-pass cutoff. Pure/headless — the audio realization is verified
 * in the browser; here we check the control value the synth consumes.
 */
import { describe, it, expect } from 'vitest';
import { replayNode } from '@/dag';
import { voiceMappingNode, ABSENT_HAND, type HandFeatures, type SynthParams } from '@/nodes';

function feats(openness: number, pinch = 0, x = 0.5): HandFeatures {
  return {
    left: { ...ABSENT_HAND },
    right: { ...ABSENT_HAND, present: true, x, y: 0.3, openness, pinch },
  };
}

async function rightVoice(
  feature: HandFeatures,
  params: Record<string, unknown> = {},
): Promise<SynthParams['voices'][number]> {
  const node = voiceMappingNode.make(voiceMappingNode.params.parse(params));
  const out = await replayNode(node, { features: [feature] });
  return (out[0].params as SynthParams).voices[0];
}

async function rightBrightness(openness: number, params: Record<string, unknown> = {}): Promise<number> {
  return (await rightVoice(feats(openness), params)).brightness!;
}

describe('openness → brightness expression', () => {
  it('an open hand is brighter than a fist (default on)', async () => {
    const open = await rightBrightness(1);
    const fist = await rightBrightness(0);
    expect(open).toBeGreaterThan(fist);
    expect(open).toBeCloseTo(1, 5); // fully open → fully present
    expect(fist).toBeCloseTo(0.3, 5); // closed stays mellow, never fully muffled
  });

  it('maps monotonically across the openness range', async () => {
    const lo = await rightBrightness(0.25);
    const hi = await rightBrightness(0.75);
    expect(hi).toBeGreaterThan(lo);
  });

  it('is neutral (1) when opennessControlsBrightness is off', async () => {
    expect(await rightBrightness(0, { opennessControlsBrightness: false })).toBe(1);
    expect(await rightBrightness(1, { opennessControlsBrightness: false })).toBe(1);
  });
});

describe('pinch → vibrato expression', () => {
  it('pinching adds vibrato; an open pinch adds none (default on)', async () => {
    expect((await rightVoice(feats(0.5, 1))).vibrato).toBeCloseTo(1, 5);
    expect((await rightVoice(feats(0.5, 0))).vibrato).toBeCloseTo(0, 5);
  });

  it('clamps to 0..1 and is 0 when pinchControlsVibrato is off', async () => {
    expect(await (async () => (await rightVoice(feats(0.5, 5))).vibrato)()).toBeLessThanOrEqual(1);
    expect((await rightVoice(feats(0.5, 1), { pinchControlsVibrato: false })).vibrato).toBe(0);
  });
});

describe('hand x → stereo pan', () => {
  it('centres at x=0.5 and spreads to ±panSpread at the frame edges', async () => {
    expect((await rightVoice(feats(0.3, 0, 0.5))).pan).toBeCloseTo(0, 5);
    expect((await rightVoice(feats(0.3, 0, 0.0))).pan).toBeCloseTo(-0.5, 5); // default panSpread 0.5
    expect((await rightVoice(feats(0.3, 0, 1.0))).pan).toBeCloseTo(0.5, 5);
  });

  it('respects panSpread and clamps to [-1, 1]', async () => {
    expect((await rightVoice(feats(0.3, 0, 1.0), { panSpread: 1 })).pan).toBeCloseTo(1, 5);
    expect((await rightVoice(feats(0.3, 0, 0.0), { panSpread: 1 })).pan).toBeCloseTo(-1, 5);
  });

  it('is centred (0) when panByPosition is off', async () => {
    expect((await rightVoice(feats(0.3, 0, 0.0), { panByPosition: false })).pan).toBe(0);
  });
});
