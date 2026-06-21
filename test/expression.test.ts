/**
 * Tests the gesture-expression mapping added to voice-mapping: hand openness
 * shapes a live `brightness` (0..1) on each voice, which the synth turns into a
 * per-voice low-pass cutoff. Pure/headless — the audio realization is verified
 * in the browser; here we check the control value the synth consumes.
 */
import { describe, it, expect } from 'vitest';
import { replayNode } from '@/dag';
import { voiceMappingNode, ABSENT_HAND, type HandFeatures, type SynthParams } from '@/nodes';

function feats(openness: number): HandFeatures {
  return {
    left: { ...ABSENT_HAND },
    right: { ...ABSENT_HAND, present: true, x: 0.5, y: 0.3, openness, pinch: 0 },
  };
}

async function rightBrightness(openness: number, params: Record<string, unknown> = {}): Promise<number> {
  const node = voiceMappingNode.make(voiceMappingNode.params.parse(params));
  const out = await replayNode(node, { features: [feats(openness)] });
  return (out[0].params as SynthParams).voices[0].brightness!;
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
