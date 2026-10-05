/**
 * The air drum's pattern mode (#269) on a committed synthetic clip: a stick striking a
 * surface once a beat through an accelerando (96 to 112 bpm, 12 ms of jitter). With a
 * one-drum "every beat" pattern in play, every predicted hit is snapped onto the
 * pattern's grid at the player's running tempo (within a frame of the intended grid
 * through the accelerando) and sounds as the pattern's drum. Without a pattern the node
 * is what it was.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { replayNode } from '@thoremin/dag';
import { type HandsFrame } from '@/nodes';
import { airDrumNode, type DrumHit } from '@/extensions/air/nodes/air_drum';
import { compilePattern } from '@/extensions/air/lib/drum_patterns';
import type { PatternModel } from '@/extensions/air/lib/pattern_fit';
import type { PatternPlay } from '@/extensions/air/lib/pattern_play';
import { FIXTURES } from '../helpers/fixtures';

interface Truth {
  spec: { fps: number };
  objects: { name: string; impact_keypoint: string }[];
  events: { t_impact: number; t_grid: number }[];
}

function loadFrames(name: string): { truth: Truth; frames: HandsFrame[] } {
  const dir = join(FIXTURES, name);
  const truth = JSON.parse(readFileSync(join(dir, 'truth.json'), 'utf8')) as Truth;
  const obj = truth.objects[0];
  const frames: HandsFrame[] = [];
  for (const line of readFileSync(join(dir, 'keypoints.ndjson'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line) as { value: { width: number; height: number; keypoints: { object: string; name: string; x: number; y: number }[] } };
    const p = rec.value.keypoints.find((k) => k.object === obj.name && k.name === obj.impact_keypoint)!;
    const keypoints = Array.from({ length: 21 }, () => ({ x: p.x, y: p.y }));
    frames.push({ width: rec.value.width, height: rec.value.height, hands: [{ handedness: 'Left', keypoints }] });
  }
  return { truth, frames };
}

const { truth, frames } = loadFrames('subframe_stick_surface_30');
const FPS = truth.spec.fps;
const EVERY_BEAT = compilePattern({ id: 'every-beat', name: 'Every beat', bpm: 96, rows: { kick: 'x... x... x... x...' } });
const MODEL: PatternModel = {
  v: 1,
  patternId: 'every-beat',
  bpm: 96,
  statedBpm: 96,
  passes: 2,
  feel: {},
  positions: { kick: { pad: null, centre: null, n: 8 } },
  recall: 1,
  precision: 1,
  takenAt: 0,
};

async function run(play: PatternPlay | null) {
  const h = airDrumNode.make(airDrumNode.params.parse({ point: 'wrist', enabled: true, minLead: 0.03, rightSound: 'snare' }));
  const outs = await replayNode(h, { hands: frames, pattern: frames.map(() => play) }, { dt: 1 / FPS });
  return outs.flatMap((o) => o.hits as DrumHit[]);
}

describe('the pattern mode', () => {
  it('snaps every predicted hit onto the grid at the running tempo, as the pattern drum', async () => {
    const hits = await run({ pattern: EVERY_BEAT, model: MODEL, startAt: truth.events[0].t_grid });
    expect(hits.length).toBe(truth.events.length);
    const nearestGrid = (t: number) => truth.events.reduce((b, e) => (Math.abs(e.t_grid - t) < Math.abs(b.t_grid - t) ? e : b));
    let snappedErr = 0;
    let n = 0;
    for (const hit of hits.slice(1)) {
      expect(hit.predicted).toBe(true);
      expect(hit.sound).toBe('kick');
      // Snapped: moved toward the follower's grid, not left where the stroke landed.
      expect(hit.pull).not.toBe(0);
      const e = nearestGrid(hit.t);
      snappedErr += Math.abs(hit.t - e.t_grid);
      n += 1;
      expect(Math.abs(hit.t - e.t_grid)).toBeLessThan(0.04);
    }
    // The follower's grid, seeded at 96 and fed one anchor a beat, lags an accelerando
    // of 16 bpm over eight beats by about a frame: what the mode buys on this clip is
    // the quantising (every hit on the follower's grid), not accuracy against the
    // intended grid, which the strokes themselves already hit within their 12 ms jitter.
    expect(snappedErr / n).toBeLessThan(0.015);
  });

  it('without a pattern, sounds the stroke where it lands with the hand sound', async () => {
    const hits = await run(null);
    expect(hits.length).toBe(truth.events.length);
    for (const hit of hits.slice(1)) {
      expect(hit.sound).toBe('snare');
      expect(hit.pull).toBe(0);
    }
  });
});
