/**
 * Nothing plays before the conductor's first stroke. With conducting on and no stroke yet (nobody
 * in front of the camera, or a hand held still), the beat waits at 0, and a score whose first note
 * starts on beat 0 would hold that note for as long as nobody conducts: the browser behaviour
 * test heard Conduct the Chords hum its first violin note with no hand in view. The conductor
 * says it does not lead the score until a stroke has been seen (as the body's transport already
 * did), so the score and the chart stay silent until the downbeat, and then play.
 */
import { describe, expect, it } from 'vitest';
import { replayNode } from '@thoremin/dag';
import { syntheticHandsNode } from '@/nodes/sources/synthetic_hands';
import { conductorNode } from '@/slices/conductor/nodes/conductor';
import { scoreNode, DEMO_SCALE_NOTES } from '@/nodes/music/score';
import type { HandsFrame } from '@/nodes';
import type { SynthParams } from '@thoremin/sdk/nodes/domain';
import { CONDUCTOR } from '../helpers/extensions';

const FPS = 30;
const EMPTY: HandsFrame = { width: 640, height: 480, hands: [] };

function conductingFrames(seconds: number): HandsFrame[] {
  const h = syntheticHandsNode.make(syntheticHandsNode.params.parse({ conduct: true }));
  return Array.from({ length: FPS * seconds }, (_, i) => (h.process({}, { tick: i, time: i / FPS, dt: 1 / FPS, resources: {} } as never) as { hands: HandsFrame }).hands);
}

/** One still hand: present, never moving. */
function stillFrames(seconds: number): HandsFrame[] {
  const first = conductingFrames(1)[0];
  return Array.from({ length: FPS * seconds }, () => first);
}

type Out = { leadsScore: boolean; beat: number; velocityScale: number; time: { anchors: number } };

/** The conductor's outputs over `frames`, then the score node driven by them, tick by tick. */
async function conductAndScore(frames: HandsFrame[]) {
  const conductor = conductorNode.make(conductorNode.params.parse({ enabled: true }));
  const outs = (await replayNode(conductor, { hands: frames }, { dt: 1 / FPS })) as Out[];
  const score = scoreNode.make(scoreNode.params.parse({ notes: DEMO_SCALE_NOTES }));
  const sounding = outs.map((o, i) => {
    const r = score.process({ beat: o.beat, velocityScale: o.velocityScale, enabled: o.leadsScore }, { tick: i, time: i / FPS, dt: 1 / FPS, resources: {} } as never) as { params: SynthParams };
    return r.params.voices.filter((v) => v.present && v.gain > 0).length;
  });
  return { outs, sounding };
}

describe.runIf(CONDUCTOR)('the conductor waits in silence for the first stroke', () => {
  it('with nobody in view, it does not lead the score and the score plays nothing', async () => {
    const { outs, sounding } = await conductAndScore(Array.from({ length: FPS * 5 }, () => EMPTY));
    expect(outs.every((o) => o.leadsScore === false)).toBe(true);
    expect(sounding.every((n) => n === 0)).toBe(true);
  });

  it('with a hand held still, the same', async () => {
    const { outs, sounding } = await conductAndScore(stillFrames(5));
    expect(outs.every((o) => o.time.anchors === 0)).toBe(true);
    expect(outs.every((o) => o.leadsScore === false)).toBe(true);
    expect(sounding.every((n) => n === 0)).toBe(true);
  });

  it('once the hand beats, it leads the score from its first stroke and the score sounds', async () => {
    const { outs, sounding } = await conductAndScore([...stillFrames(2), ...conductingFrames(6)]);
    const first = outs.findIndex((o) => o.leadsScore);
    expect(first).toBeGreaterThan(FPS * 2);
    expect(outs[first].time.anchors).toBeGreaterThan(0);
    expect(sounding.slice(first).some((n) => n > 0)).toBe(true);
    expect(sounding.slice(0, first).every((n) => n === 0)).toBe(true);
  });
});
