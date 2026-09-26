/**
 * The `air-drum` node (#233) replayed over a synthetic impact fixture: the stick tip of
 * `subframe_stick_surface_30` stands in for the player's right wrist (the webcam's
 * mirrored 'Left' label), one hands frame per fixture frame, at 30 Hz.
 *
 * What is pinned: nothing sounds while the dial is off; on, every stroke yields
 * exactly one hit — the first as a ghost note on confirmation (no floor yet), every
 * later one PREDICTED, with a sound time within the predictor's bound of the executed
 * impact and committed at a tick before it; hits carry the right hand and the hand's
 * sound; the status says the right hand's floor is learned and counts the hits; a
 * running conductor with magnetism pulls the hits toward its grid; the config input
 * overrides the params live.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { replayNode } from '@/dag';
import { airDrumNode, type DrumHit, type HandsFrame, type AirDrumStatus } from '@/nodes';
import type { MusicalTime } from '@/ictus';
import { FIXTURES } from '../helpers/fixtures';

interface Truth {
  spec: { fps: number };
  clip: { width: number; height: number };
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
    // The mirrored webcam labels the player's RIGHT hand 'Left'.
    frames.push({ width: rec.value.width, height: rec.value.height, hands: [{ handedness: 'Left', keypoints }] });
  }
  return { truth, frames };
}

const { truth, frames } = loadFrames('subframe_stick_surface_30');

describe.each(['subframe_stick_air_30', 'subframe_ball_air_60'])('air-drum node on %s (a stroke that turns in the air)', (name) => {
  const air = loadFrames(name);
  const fps = air.truth.spec.fps;
  it('predicts every stroke after the first, within 25 ms of the turn, ahead of it', async () => {
    const h = airDrumNode.make(airDrumNode.params.parse({ enabled: true, minLead: 0.03 }));
    const outs = await replayNode(h, { hands: air.frames }, { dt: 1 / fps });
    const hits = outs.flatMap((o, i) => (o.hits as DrumHit[]).map((hit) => ({ ...hit, tick: i })));
    expect(hits).toHaveLength(air.truth.events.length);
    for (const hit of hits.slice(1)) {
      expect(hit.predicted).toBe(true);
      const e = air.truth.events.reduce((b, x) => (Math.abs(x.t_impact - hit.t) < Math.abs(b.t_impact - hit.t) ? x : b));
      expect(Math.abs(hit.t - e.t_impact)).toBeLessThan(0.025);
      expect(hit.tick / fps).toBeLessThan(e.t_impact);
    }
  });
});
const FPS = truth.spec.fps;
const nearest = (t: number) => truth.events.reduce((b, e) => (Math.abs(e.t_impact - t) < Math.abs(b.t_impact - t) ? e : b));

async function run(params: Record<string, unknown>, extra: Record<string, unknown[]> = {}) {
  const h = airDrumNode.make(airDrumNode.params.parse(params));
  const outs = await replayNode(h, { hands: frames, ...extra }, { dt: 1 / FPS });
  const hits: (DrumHit & { tick: number })[] = [];
  outs.forEach((o, i) => {
    for (const hit of o.hits as DrumHit[]) hits.push({ ...hit, tick: i });
  });
  return { outs, hits, status: outs[outs.length - 1].status as AirDrumStatus };
}

describe('air-drum node on the synthetic surface fixture', () => {
  it('sounds nothing while off', async () => {
    const { hits, status, outs } = await run({ enabled: false });
    expect(hits).toHaveLength(0);
    expect(status.enabled).toBe(false);
    expect(outs.every((o) => o.enabled === false)).toBe(true);
  });

  it('one hit per stroke: a ghost note first, then predictions committed before the impact', async () => {
    const { hits, status } = await run({ enabled: true, minLead: 0.03 });
    expect(hits).toHaveLength(truth.events.length);
    expect(hits[0].predicted).toBe(false);
    expect(hits[0].hand).toBe('right');
    expect(hits[0].sound).toBe('kick');
    for (const hit of hits.slice(1)) {
      expect(hit.predicted).toBe(true);
      const e = nearest(hit.t);
      expect(Math.abs(hit.t - e.t_impact)).toBeLessThan(0.016);
      // Decided on a tick before the impact, with at least most of the required lead.
      expect(hit.tick / FPS).toBeLessThan(e.t_impact);
      expect(hit.lead).toBeGreaterThanOrEqual(0.025);
      expect(hit.velocity).toBeGreaterThan(0);
      expect(hit.velocity).toBeLessThanOrEqual(0.8);
      expect(hit.pull).toBe(0);
    }
    // The ghost note is quieter than a full stroke and sounds at its confirming sample.
    expect(hits[0].velocity).toBeLessThan(hits[1].velocity);
    expect(hits[0].lead).toBeLessThan(0);
    expect(status.enabled).toBe(true);
    expect(status.hits).toBe(truth.events.length);
    expect(status.predicted).toBe(truth.events.length - 1);
    expect(status.ready.right).toBe(true);
    expect(status.ready.left).toBe(false);
    expect(status.lastHand).toBe('right');
  });

  it('the hand choosers and the sound dials are honoured', async () => {
    // Only the left hand drums: the fixture's hand is the player's right, so nothing.
    const left = await run({ enabled: true, hand: 'left' });
    expect(left.hits).toHaveLength(0);
    // The right hand plays the tom.
    const tom = await run({ enabled: true, hand: 'right', rightSound: 'tom' });
    expect(tom.hits.length).toBe(truth.events.length);
    expect(tom.hits.every((h) => h.sound === 'tom')).toBe(true);
    // A recorded third-person video is not mirrored: the same frames are then the LEFT hand.
    const unmirrored = await run({ enabled: true, mirrorHandedness: false, leftSound: 'hihat' });
    expect(unmirrored.hits.length).toBe(truth.events.length);
    expect(unmirrored.hits.every((h) => h.hand === 'left' && h.sound === 'hihat')).toBe(true);
  });

  it('a running conductor with magnetism pulls the predicted hits toward its grid', async () => {
    // A follower whose expected beats sit 25 ms AFTER each executed impact.
    const offset = 0.025;
    const period = 60 / 100;
    const time: MusicalTime[] = frames.map((_, i) => {
      const t = i / FPS;
      const e = nearest(t + 0.1);
      const beatT = e.t_impact + offset;
      const beat = 4 + (t - beatT) / period;
      return { t, beat, phase: beat - Math.floor(beat), tempo: 100, period, confidence: 1, nextBeatAt: beatT > t ? beatT : beatT + period, beatsPerBar: 4, beatInBar: 0, state: 'running', anchors: 8 };
    });
    const free = await run({ enabled: true, magnetism: 0 }, { time });
    const pulled = await run({ enabled: true, magnetism: 1 }, { time });
    expect(pulled.hits.length).toBe(free.hits.length);
    for (let i = 1; i < free.hits.length; i++) {
      const e = nearest(free.hits[i].t);
      const grid = e.t_impact + offset;
      expect(Math.abs(pulled.hits[i].t - grid)).toBeLessThan(Math.abs(free.hits[i].t - grid));
      expect(pulled.hits[i].pull).not.toBe(0);
    }
  });

  it('a frame older than the tick (a camera pipeline) still gets the required lead from the DECISION, not the capture', async () => {
    // Live at speed 1, every frame stamped 60 ms before the tick that consumes it: the
    // predictor must leave the dial's lead PLUS that age from the sample's time, so a
    // scheduler still gets the lead from now. Leads are reported from now.
    const age = 0.06;
    const origin = performance.timeOrigin;
    const stamped = frames.map((f, i) => ({ ...f, t: i / FPS - age, tSource: 'capture' as const, tOrigin: origin, lag: age }));
    const h = airDrumNode.make(airDrumNode.params.parse({ enabled: true, minLead: 0.03 }));
    const outs = await replayNode(h, { hands: stamped }, { dt: 1 / FPS, resources: { timeScale: 1 } });
    const hits = outs.flatMap((o, i) => (o.hits as DrumHit[]).map((hit) => ({ ...hit, tick: i })));
    const predicted = hits.filter((x) => x.predicted);
    expect(predicted.length).toBeGreaterThanOrEqual(truth.events.length - 2);
    for (const hit of predicted) {
      expect(hit.lead).toBeGreaterThanOrEqual(0.03 - 0.012);
      expect(hit.t - hit.tick / FPS).toBeCloseTo(hit.lead, 9);
      // The strike, in the stamped time base, is `age` behind the tick clock: the sound
      // still lands within the predictor's bound of it.
      const e = nearest(hit.t + age);
      expect(Math.abs(hit.t + age - e.t_impact)).toBeLessThan(0.02);
    }
  });

  it('a changed lead takes effect live, without toggling the dial', async () => {
    const h = airDrumNode.make(airDrumNode.params.parse({ enabled: true, minLead: 0.03 }));
    const config = frames.map((_, i) => ({ enabled: true, minLead: i < 90 ? 0.03 : 0.1 }));
    const outs = await replayNode(h, { hands: frames, config }, { dt: 1 / FPS });
    const late = outs.slice(90).flatMap((o) => o.hits as DrumHit[]).filter((x) => x.predicted);
    expect(late.length).toBeGreaterThan(2);
    for (const hit of late) expect(hit.lead).toBeGreaterThanOrEqual(0.1 - 0.012);
  });

  it('switching the tracked point live with still hands drums nothing, and slow sway drums nothing', async () => {
    const still: HandsFrame[] = frames.map(() => ({
      width: 1280,
      height: 720,
      hands: [{ handedness: 'Left', keypoints: Array.from({ length: 21 }, (_, k) => ({ x: 600, y: k === 8 ? 300 : 400 })) }],
    }));
    const h = airDrumNode.make(airDrumNode.params.parse({ enabled: true }));
    const config = still.map((_, i) => ({ enabled: true, point: Math.floor(i / 20) % 2 ? 'indexTip' : 'wrist' }));
    const outs = await replayNode(h, { hands: still, config }, { dt: 1 / FPS });
    expect(outs.flatMap((o) => o.hits as DrumHit[])).toHaveLength(0);
    // A melodic hand sweeping slowly up and down by a tenth of the frame: not a stroke.
    const sway: HandsFrame[] = Array.from({ length: 600 }, (_, i) => ({
      width: 1280,
      height: 720,
      hands: [{ handedness: 'Left', keypoints: Array.from({ length: 21 }, () => ({ x: 600, y: 400 + 36 * Math.sin((2 * Math.PI * 0.3 * i) / FPS) + 1.5 * Math.sin(i * 7.1) })) }],
    }));
    const h2 = airDrumNode.make(airDrumNode.params.parse({ enabled: true }));
    const outs2 = await replayNode(h2, { hands: sway }, { dt: 1 / FPS });
    expect(outs2.flatMap((o) => o.hits as DrumHit[])).toHaveLength(0);
  });

  it('the config input overrides the params live: enabling mid-stream starts drumming', async () => {
    const h = airDrumNode.make(airDrumNode.params.parse({ enabled: false }));
    const config = frames.map((_, i) => (i < 60 ? { enabled: false } : { enabled: true }));
    const outs = await replayNode(h, { hands: frames, config }, { dt: 1 / FPS });
    const before = outs.slice(0, 60).flatMap((o) => o.hits as DrumHit[]);
    const after = outs.slice(60).flatMap((o) => o.hits as DrumHit[]);
    expect(before).toHaveLength(0);
    expect(after.length).toBeGreaterThan(3);
    expect(outs[30].enabled).toBe(false);
    expect(outs[outs.length - 1].enabled).toBe(true);
  });
});
