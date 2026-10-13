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
 *
 * Step 0 of the timing plan (#239): `predicted` means the sound can land at its intended
 * time, i.e. the lead from the decision covers the OUTPUT STAGE read from the `timing`
 * resource. The runs that pin the predictor pass a known stage of 0 (a headless replay
 * has no loudspeaker); the honest-timing tests below pass a real one, or none, and read
 * `impactT`, `lateBy` and the three-valued `onTime`.
 *
 * Every hand here is ONE point (all 21 keypoints on it) standing in for the wrist, so
 * these tests pin `point: 'wrist'`: a single point has no grip for a stick tip to lever
 * (#246 made the stick tip the default; its geometry, its lever-scaled gates and its
 * behaviour on real recorded hands are `drum_anchor.test.ts`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { replayNode } from '@thoremin/dag';
import { type HandsFrame } from '@/nodes';
import { airDrumNode, magnetStanding, standing, type DrumHit, type AirDrumStatus } from '@thoremin/ext-air/nodes/air_drum';
import { LAG_MIN_STROKES, LAG_STROKES, type MusicalTime } from '@thoremin/ictus';
import { FIXTURES } from '../helpers/fixtures';
import { NO_OUTPUT_STAGE, knownOutputStage } from '../helpers/timing';

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
    const h = airDrumNode.make(airDrumNode.params.parse({ point: 'wrist', enabled: true, minLead: 0.03 }));
    const outs = await replayNode(h, { hands: air.frames }, { dt: 1 / fps, resources: NO_OUTPUT_STAGE });
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
  const h = airDrumNode.make(airDrumNode.params.parse({ point: 'wrist', ...params }));
  const outs = await replayNode(h, { hands: frames, ...extra }, { dt: 1 / FPS, resources: NO_OUTPUT_STAGE });
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

  /** A running follower whose expected beat for event `i` sits `offset(i)` after its impact,
   *  on the frames' own timeline (stamped `age` before the clip's, as the aged frames are). */
  const gridAt = (offset: (i: number) => number, age = 0): MusicalTime[] => {
    const period = 60 / 100;
    return frames.map((_, k) => {
      const e = nearest(k / FPS + 0.1);
      const t = k / FPS - age;
      const beatT = e.t_impact - age + offset(truth.events.indexOf(e));
      const beat = 4 + (t - beatT) / period;
      return { t, beat, phase: beat - Math.floor(beat), tempo: 100, period, confidence: 1, nextBeatAt: beatT > t ? beatT : beatT + period, beatsPerBar: 4, beatInBar: 0, state: 'running', anchors: 8 };
    });
  };

  describe('the lag-gated magnet (#239, timing plan step 3)', () => {
    it('a grid the strokes straddle earns the pull: once the lag is measured, hits move toward it', async () => {
      // Expected beats alternately 25 ms after and before each impact: no bias, real scatter.
      const offset = (i: number) => (i % 2 ? 0.025 : -0.025);
      const time = gridAt(offset);
      const free = await run({ enabled: true, magnetism: 0 }, { time });
      const pulled = await run({ enabled: true, magnetism: 1 }, { time });
      expect(pulled.hits.length).toBe(free.hits.length);
      let moved = 0;
      for (let i = 1; i < free.hits.length; i++) {
        const e = nearest(free.hits[i].impactT);
        const grid = e.t_impact + offset(truth.events.indexOf(e));
        // Before LAG_MIN_STROKES confirmations there is no evidence the grid is unbiased.
        if (i <= LAG_MIN_STROKES) {
          expect(pulled.hits[i].pull).toBe(0);
          continue;
        }
        expect(Math.abs(pulled.hits[i].t - grid)).toBeLessThan(Math.abs(free.hits[i].t - grid));
        expect(pulled.hits[i].pull).not.toBe(0);
        moved++;
      }
      expect(moved).toBeGreaterThanOrEqual(2);
      expect(pulled.status.magnetGate).toBeGreaterThan(0.5);
      expect(pulled.status.magnet).toBe('on');
    });

    it('a grid sitting a steady 25 ms off the strokes is a lagging grid: it pulls nothing, and the status says so', async () => {
      const time = gridAt(() => 0.025);
      const free = await run({ enabled: true, magnetism: 0 }, { time });
      const pulled = await run({ enabled: true, magnetism: 1 }, { time });
      expect(pulled.hits.map((x) => x.t)).toEqual(free.hits.map((x) => x.t));
      expect(pulled.hits.every((x) => x.pull === 0)).toBe(true);
      // The confirmed impact sits a few ms from the true one: the lag is about -25 ms.
      expect(pulled.status.magnetLag).toBeGreaterThan(-0.035);
      expect(pulled.status.magnetLag).toBeLessThan(-0.02);
      expect(pulled.status.magnetGate).toBe(0);
      expect(free.status.magnet).toBe('off');
      // Eight strokes are mostly warm-up (a ghost, then four before the lag is measured):
      // too little to call. Played twice over, the run is the gate's alone.
      expect(pulled.status.magnet).toBe('on');
      const span = frames.length / FPS;
      const twice = [...frames, ...frames.map((f) => ({ ...f }))];
      const time2 = [...time, ...time.map((m) => ({ ...m, t: m.t + span }))];
      const h = airDrumNode.make(airDrumNode.params.parse({ point: 'wrist', enabled: true, magnetism: 1 }));
      const outs = await replayNode(h, { hands: twice, time: time2 }, { dt: 1 / FPS, resources: NO_OUTPUT_STAGE });
      expect(outs.flatMap((o) => o.hits as DrumHit[]).every((x) => x.pull === 0)).toBe(true);
      expect((outs[outs.length - 1].status as AirDrumStatus).magnet).toBe('grid-lag');
    });

    it('rule (c): the lag is measured on the confirmed impacts, never on what was sounded, so the pull cannot feed itself', async () => {
      const time = gridAt((i) => (i % 2 ? 0.03 : -0.02));
      const free = await run({ enabled: true, magnetism: 0 }, { time });
      const pulled = await run({ enabled: true, magnetism: 1 }, { time });
      expect(pulled.hits.some((x) => x.pull !== 0)).toBe(true);
      expect(pulled.status.magnetLag).toBe(free.status.magnetLag);
      expect(Number.isFinite(free.status.magnetLag)).toBe(true);
    });

    it('rule (b): a pull toward a beat behind the earliest sound is truncated to decision + output stage, and reported as the move made', async () => {
      // Beats alternately 120 ms before and after each impact: unbiased, so the gate is
      // open, and the early ones pull behind the decision.
      const stage = 0.02;
      const time = gridAt((i) => (i % 2 ? -0.12 : 0.12));
      const h = airDrumNode.make(airDrumNode.params.parse({ point: 'wrist', enabled: true, magnetism: 1, minLead: 0.03 }));
      const outs = await replayNode(h, { hands: frames, time }, { dt: 1 / FPS, resources: knownOutputStage(stage) });
      const hits = outs.flatMap((o, tick) => (o.hits as DrumHit[]).map((hit) => ({ ...hit, decision: tick / FPS })));
      const truncated = hits.filter((x) => x.lead < stage && x.pull !== 0);
      expect(truncated.length).toBeGreaterThanOrEqual(1);
      for (const hit of truncated) {
        // Truncated to the earliest sound, never to "now".
        expect(hit.t).toBeCloseTo(hit.decision + stage, 9);
        expect(hit.predicted).toBe(false);
        expect(hit.onTime).toBe('late');
        expect(hit.lateBy).toBeCloseTo(stage - hit.lead, 9);
        // The move actually made: from where the unpulled impact would have sounded.
        expect(hit.pull).toBeCloseTo(hit.t - Math.max(hit.decision + stage, hit.impactT), 9);
      }
      for (const hit of hits) expect(hit.t).toBeGreaterThanOrEqual(hit.decision);
    });

    it('magnetStanding: blocked only when a full run had no pull, and named by what blocked it', () => {
      expect(magnetStanding([])).toBe('off');
      expect(magnetStanding(Array(LAG_STROKES - 1).fill('pipeline'))).toBe('on');
      expect(magnetStanding([...Array(LAG_STROKES - 1).fill('pipeline'), 'pulled'])).toBe('on');
      expect(magnetStanding(Array(LAG_STROKES).fill('warming'))).toBe('on');
      expect(magnetStanding(Array(LAG_STROKES).fill('quiet'))).toBe('on');
      expect(magnetStanding([...Array(5).fill('pipeline'), ...Array(3).fill('gated')])).toBe('too-slow');
      expect(magnetStanding([...Array(3).fill('pipeline'), ...Array(5).fill('gated')])).toBe('grid-lag');
      expect(magnetStanding([...Array(3).fill('warming'), ...Array(5).fill('gated')])).toBe('grid-lag');
      // A warm-up ghost among strokes with nothing to pull is not evidence of anything.
      expect(magnetStanding(['pipeline', ...Array(4).fill('warming'), ...Array(3).fill('quiet')])).toBe('on');
      expect(magnetStanding(['pipeline', ...Array(7).fill('quiet')])).toBe('on');
      expect(magnetStanding([...Array(4).fill('warming'), ...Array(4).fill('gated')])).toBe('on');
    });

    it('a pipeline too slow to predict reads as too-slow, not as a lagging grid', async () => {
      // Every frame 250 ms old: no stroke is predicted in time, so no pull can be made.
      const age = 0.25;
      const aged = frames.map((f, i) => ({ ...f, t: i / FPS - age, tSource: 'capture' as const, tOrigin: performance.timeOrigin, lag: age }));
      const time = gridAt((i) => (i % 2 ? 0.02 : -0.02), age);
      const h = airDrumNode.make(airDrumNode.params.parse({ point: 'wrist', enabled: true, magnetism: 0.5, minLead: 0.05 }));
      const outs = await replayNode(h, { hands: aged, time }, { dt: 1 / FPS, resources: { timeScale: 1, ...NO_OUTPUT_STAGE } });
      const hits = outs.flatMap((o) => o.hits as DrumHit[]);
      expect(hits.length).toBeGreaterThanOrEqual(LAG_STROKES);
      expect(hits.every((x) => x.pull === 0)).toBe(true);
      expect((outs[outs.length - 1].status as AirDrumStatus).magnet).toBe('too-slow');
    });
  });

  it('a frame older than the tick (a camera pipeline) still gets the required lead from the DECISION, not the capture', async () => {
    // Live at speed 1, every frame stamped 60 ms before the tick that consumes it: the
    // predictor must leave the dial's lead PLUS that age from the sample's time, so a
    // scheduler still gets the lead from now. Leads are reported from now.
    const age = 0.06;
    const origin = performance.timeOrigin;
    const stamped = frames.map((f, i) => ({ ...f, t: i / FPS - age, tSource: 'capture' as const, tOrigin: origin, lag: age }));
    const h = airDrumNode.make(airDrumNode.params.parse({ point: 'wrist', enabled: true, minLead: 0.03 }));
    const outs = await replayNode(h, { hands: stamped }, { dt: 1 / FPS, resources: { timeScale: 1, ...NO_OUTPUT_STAGE } });
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

  it('a pipeline older than the fall leaves no lead: such hits are honest (not "predicted") and still land on the strike', async () => {
    // 60 Hz ticks over the 30 fps frames, each frame's age varying 60-110 ms.
    const origin = performance.timeOrigin;
    const doubled: HandsFrame[] = [];
    frames.forEach((f, i) => {
      const age = 0.06 + 0.05 * ((i * 7) % 11) / 10;
      const stamped = { ...f, t: i / FPS - age, tSource: 'capture' as const, tOrigin: origin, lag: age };
      doubled.push(stamped, stamped);
    });
    const h = airDrumNode.make(airDrumNode.params.parse({ point: 'wrist', enabled: true, minLead: 0.05 }));
    const outs = await replayNode(h, { hands: doubled }, { dt: 1 / (2 * FPS), resources: { timeScale: 1, ...NO_OUTPUT_STAGE } });
    const hits = outs.flatMap((o, i) => (o.hits as DrumHit[]).map((hit) => ({ ...hit, tick: i })));
    expect(hits.length).toBe(truth.events.length);
    for (const hit of hits) {
      // Never labelled predicted with no lead; never scheduled behind the decision.
      expect(hit.predicted).toBe(hit.lead >= 0);
      expect(hit.onTime).toBe(hit.lead >= 0 ? 'yes' : 'late');
      expect(hit.t).toBeGreaterThanOrEqual(hit.tick / (2 * FPS) - 1e-9);
      // A predicted hit still lands near the strike (in the stamped base the strike is
      // `age` behind the tick clock; compare in the stamped base); a late one sounds as
      // soon as it can, which is at most the pipeline's age after the strike.
      const i = Math.floor(hit.tick / 2);
      const age = 0.06 + 0.05 * ((i * 7) % 11) / 10;
      const e = nearest(hit.t + age);
      if (hit.predicted) expect(Math.abs(hit.t + age - e.t_impact)).toBeLessThan(0.05);
      // (a ghost note is confirmed one frame after the bottom, on a tick up to a frame
      // later, and the pipeline's age on top of that)
      else expect(hit.t + age - e.t_impact).toBeLessThan(age + 2 / FPS + 0.02);
    }
    // The point of the test: some hits ARE late in this pipeline, and say so.
    expect(hits.some((x) => !x.predicted)).toBe(true);
  });

  it('a changed lead takes effect live, without toggling the dial', async () => {
    const h = airDrumNode.make(airDrumNode.params.parse({ point: 'wrist', enabled: true, minLead: 0.03 }));
    const config = frames.map((_, i) => ({ enabled: true, minLead: i < 90 ? 0.03 : 0.1 }));
    const outs = await replayNode(h, { hands: frames, config }, { dt: 1 / FPS, resources: NO_OUTPUT_STAGE });
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
    const h = airDrumNode.make(airDrumNode.params.parse({ point: 'wrist', enabled: true }));
    const config = still.map((_, i) => ({ enabled: true, point: Math.floor(i / 20) % 2 ? 'indexTip' : 'wrist' }));
    const outs = await replayNode(h, { hands: still, config }, { dt: 1 / FPS });
    expect(outs.flatMap((o) => o.hits as DrumHit[])).toHaveLength(0);
    // A soft stroke that BRAKES into its bottom (a cosine dip of 8 % of the height over
    // 200 ms) is still a stroke: the gate is on the stroke's peak speed, not its speed
    // at the bottom.
    const soft: HandsFrame[] = [];
    for (let i = 0; i < 300; i++) {
      const t = i / FPS;
      const phase = (t % 1) / 0.2;
      const dip = phase < 1 ? 0.5 * (1 - Math.cos(2 * Math.PI * phase)) : 0;
      soft.push({ width: 1280, height: 720, hands: [{ handedness: 'Left', keypoints: Array.from({ length: 21 }, () => ({ x: 600, y: 400 + 0.08 * 720 * dip })) }] });
    }
    const h3 = airDrumNode.make(airDrumNode.params.parse({ point: 'wrist', enabled: true }));
    const outs3 = await replayNode(h3, { hands: soft }, { dt: 1 / FPS });
    expect(outs3.flatMap((o) => o.hits as DrumHit[]).length).toBeGreaterThanOrEqual(8);
    // A melodic hand sweeping slowly up and down by a tenth of the frame: not a stroke.
    const sway: HandsFrame[] = Array.from({ length: 600 }, (_, i) => ({
      width: 1280,
      height: 720,
      hands: [{ handedness: 'Left', keypoints: Array.from({ length: 21 }, () => ({ x: 600, y: 400 + 36 * Math.sin((2 * Math.PI * 0.3 * i) / FPS) + 1.5 * Math.sin(i * 7.1) })) }],
    }));
    const h2 = airDrumNode.make(airDrumNode.params.parse({ point: 'wrist', enabled: true }));
    const outs2 = await replayNode(h2, { hands: sway }, { dt: 1 / FPS });
    expect(outs2.flatMap((o) => o.hits as DrumHit[])).toHaveLength(0);
  });

  describe('honest timing against the output stage (step 0, #239)', () => {
    it('every hit carries the impact it is heading for, and a ghost note the one it confirmed', async () => {
      const { hits } = await run({ enabled: true, minLead: 0.03 });
      for (const hit of hits) {
        const e = nearest(hit.impactT);
        expect(Math.abs(hit.impactT - e.t_impact)).toBeLessThan(0.02);
        // A ghost note's `t` is the sounding time (now), its `impactT` the confirmed impact.
        if (!hit.predicted) expect(hit.impactT).toBeLessThan(hit.t);
        else expect(hit.t).toBeCloseTo(hit.impactT, 9);
      }
    });

    it('predicted means the lead covers the output stage: a 60 ms stage turns short leads into late hits that say by how much', async () => {
      const h = airDrumNode.make(airDrumNode.params.parse({ point: 'wrist', enabled: true, minLead: 0.03 }));
      const stage = 0.06;
      const outs = await replayNode(h, { hands: frames }, { dt: 1 / FPS, resources: knownOutputStage(stage) });
      const hits = outs.flatMap((o) => o.hits as DrumHit[]);
      expect(hits).toHaveLength(truth.events.length);
      const late = hits.filter((x) => x.onTime === 'late');
      expect(late.length).toBeGreaterThan(1);
      for (const hit of hits) {
        expect(hit.predicted).toBe(hit.lead >= stage);
        expect(hit.onTime).toBe(hit.lead >= stage ? 'yes' : 'late');
        expect(hit.lateBy).toBeCloseTo(Math.max(0, stage - hit.lead), 9);
        // The sound is still scheduled no earlier than the decision, pull untouched by the stage.
        expect(hit.lead <= 0 || hit.t - hit.impactT === hit.pull).toBe(true);
      }
      const last = outs[outs.length - 1].status as AirDrumStatus;
      expect(last.lastOnTime).toBe(hits[hits.length - 1].onTime);
      expect(last.lastLateBy).toBeCloseTo(hits[hits.length - 1].lateBy, 9);
    });

    it('a predicted impact already past at the decision is clamped to now, and that clamp is not a pull', async () => {
      // Stamped frames 100 ms old (a slow pipeline, sampled at the stamp in real time):
      // the predictor's last-chance commits land behind the decision and the sound is
      // truncated to now. With no conductor and no pattern the move is the clamp alone,
      // which `pull` must not report (it used to report `t - impactT`, a pull from nowhere).
      const age = 0.1;
      const aged = frames.map((f, i) => ({ ...f, t: i / FPS - age, tSource: 'capture' as const, tOrigin: performance.timeOrigin, lag: age }));
      const h = airDrumNode.make(airDrumNode.params.parse({ point: 'wrist', enabled: true, minLead: 0.03 }));
      const outs = await replayNode(h, { hands: aged }, { dt: 1 / FPS, resources: { timeScale: 1, ...NO_OUTPUT_STAGE } });
      const hits = outs.flatMap((o) => o.hits as DrumHit[]);
      expect(hits).toHaveLength(truth.events.length);
      const behind = hits.slice(1).filter((x) => x.lead < 0);
      expect(behind.length).toBeGreaterThan(1);
      for (const hit of hits) {
        expect(hit.pull).toBe(0);
        expect(hit.t).toBeGreaterThanOrEqual(hit.impactT);
      }
    });

    it('under the prior, standing() says only what is certain: unknown-output for any lead at or above 0, late by its own size below', () => {
      const prior = { value: 0.02, source: 'prior' };
      // A lead under the prior is NOT a definite late with a lateBy read off a guess.
      expect(standing(0.01, 0, prior)).toEqual({ lead: 0.01, lateBy: 0, predicted: true, onTime: 'unknown-output' });
      expect(standing(0, 0, prior)).toEqual({ lead: 0, lateBy: 0, predicted: true, onTime: 'unknown-output' });
      expect(standing(0.05, 0, prior)).toEqual({ lead: 0.05, lateBy: 0, predicted: true, onTime: 'unknown-output' });
      expect(standing(-0.01, 0, prior)).toEqual({ lead: -0.01, lateBy: 0.01, predicted: false, onTime: 'late' });
      // A measured stage is a measurement: late by the shortfall.
      expect(standing(0.01, 0, { value: 0.02, source: 'measured' })).toEqual({ lead: 0.01, lateBy: 0.01, predicted: false, onTime: 'late' });
      expect(standing(0.02, 0, { value: 0.02, source: 'measured' })).toEqual({ lead: 0.02, lateBy: 0, predicted: true, onTime: 'yes' });
    });

    it('with no timing resource the stage is the stated prior and a predicted hit says unknown-output, never yes', async () => {
      const h = airDrumNode.make(airDrumNode.params.parse({ point: 'wrist', enabled: true, minLead: 0.03 }));
      const outs = await replayNode(h, { hands: frames }, { dt: 1 / FPS });
      const hits = outs.flatMap((o) => o.hits as DrumHit[]);
      expect(hits.some((x) => x.onTime === 'unknown-output')).toBe(true);
      expect(hits.every((x) => x.onTime !== 'yes')).toBe(true);
      for (const hit of hits) expect(hit.predicted).toBe(hit.onTime !== 'late');
    });

  });

  it('the config input overrides the params live: enabling mid-stream starts drumming', async () => {
    const h = airDrumNode.make(airDrumNode.params.parse({ point: 'wrist', enabled: false }));
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
