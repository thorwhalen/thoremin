/**
 * Drum pads (#245): the pad geometry (`drum_pads.ts`), the `air-drum` node striking pads
 * on a synthetic hand gripping the committed `an.impacts` stick fixtures, and the drum
 * voice a hit is shaped into (`drumVoice` in `drum_out.ts`).
 *
 * What is pinned: a landing point picks the pad under it (the later slot on top), its
 * centre-to-rim position, and what a miss plays (`offPad`); with no pad on, the air
 * drum is the per-hand instrument it was; a stroke landing in a pad sounds THAT pad's
 * drum and a stroke moved to another pad sounds the other one; how hard the stroke was
 * (the clip's accent pattern, 1 / 0.6 / 0.8 / 0.6) orders the velocities; a centre hit
 * and a rim hit on the same pad differ by their `radial`; and the voice is louder and
 * brighter for a harder hit, higher and shorter at the rim.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { replayNode } from '@/dag';
import { airDrumNode, type DrumHit, type HandsFrame } from '@/nodes';
import { DEFAULT_PADS_SET, PAD_IDS, STARTER_KIT, hitPad, padDistance, toDisplay, type Pad, type Pads } from '@/nodes/music/drum_pads';
import { fallingSegment, landingAt, velocityOf, SOFTEST_HIT } from '@/nodes/music/air_drum';
import { drumVoice } from '@/nodes/output/drum_out';
import { TRUE_STICK_LENGTH, gripFrames, parseStickClip } from '../../scripts/air/lib_synthetic_grip';
import { FIXTURES } from '../helpers/fixtures';

interface Truth {
  spec: { fps: number };
  clip: { width: number; height: number };
  events: { t_impact: number; amplitude: number; impact_xy: [number, number] }[];
}

function load(name: string) {
  const dir = join(FIXTURES, name);
  const truth = JSON.parse(readFileSync(join(dir, 'truth.json'), 'utf8')) as Truth;
  const poses = parseStickClip(readFileSync(join(dir, 'keypoints.ndjson'), 'utf8'));
  return { truth, poses };
}

const pad = (over: Partial<Pad>): Pad => ({ on: true, shape: 'circle', x: 0.5, y: 0.5, w: 0.2, h: 0.2, color: '#ff0000', sound: 'snare', ...over });
const only = (entries: Partial<Record<(typeof PAD_IDS)[number], Pad>>): Pads => {
  const off = Object.fromEntries(PAD_IDS.map((id) => [id, { ...DEFAULT_PADS_SET[id], on: false }])) as Pads;
  return { ...off, ...entries };
};

describe('pad geometry', () => {
  it('maps a source pixel into the mirrored display', () => {
    expect(toDisplay(160, 90, 640, 360)).toEqual({ x: 0.75, y: 0.25 });
  });

  it('measures centre-to-rim in the pad own half-sizes, ellipse or box', () => {
    const c = pad({ shape: 'circle' });
    expect(padDistance(c, { x: 0.5, y: 0.5 })).toBe(0);
    expect(padDistance(c, { x: 0.6, y: 0.5 })).toBeCloseTo(1, 9);
    expect(padDistance(c, { x: 0.58, y: 0.58 })).toBeGreaterThan(1); // outside the ellipse's diagonal
    expect(padDistance(pad({ shape: 'rect' }), { x: 0.59, y: 0.59 })).toBeCloseTo(0.9, 9); // inside the box's corner
  });

  it('picks the pad under the point, the later slot on top, and resolves a miss by offPad', () => {
    const pads = only({ p1: pad({ sound: 'snare' }), p2: pad({ x: 0.55, sound: 'tom' }), p3: pad({ x: 0.9, sound: 'crash' }) });
    expect(hitPad(pads, { x: 0.5, y: 0.5 })?.id).toBe('p2'); // inside both p1 and p2
    expect(hitPad(pads, { x: 0.42, y: 0.5 })?.id).toBe('p1');
    expect(hitPad(pads, { x: 0.9, y: 0.52 })?.pad.sound).toBe('crash');
    expect(hitPad(pads, { x: 0.75, y: 0.1 })).toBeNull();
    expect(hitPad(pads, { x: 0.75, y: 0.1 }, 'silent')).toBeNull();
    const near = hitPad(pads, { x: 0.95, y: 0.9 }, 'nearest');
    expect(near?.id).toBe('p3');
    expect(near?.radial).toBe(1);
  });

  it('ships every slot off, and a starter kit of distinct drums', () => {
    expect(PAD_IDS.every((id) => !DEFAULT_PADS_SET[id].on)).toBe(true);
    expect(new Set(STARTER_KIT.map((id) => DEFAULT_PADS_SET[id].sound)).size).toBe(STARTER_KIT.length);
  });
});

describe('where and how hard', () => {
  // A stick held up, then falling with constant acceleration: y = 0.2 + 3 (t - 0.2)^2
  // from t = 0.2, drifting right at 0.5 widths / s while it falls.
  const fall = (t: number) => (t < 0.2 ? { t, x: 0.3, y: 0.2 } : { t, x: 0.3 + 0.5 * (t - 0.2), y: 0.2 + 3 * (t - 0.2) ** 2 });
  const samples = Array.from({ length: 13 }, (_, i) => fall(i / 30));

  it('reads only the fall, not the held top of the swing', () => {
    const seg = fallingSegment(samples, 12 / 30, 0.005);
    expect(seg[0].t).toBeGreaterThanOrEqual(0.2 - 1 / 30 - 1e-9);
    expect(seg[seg.length - 1].t).toBeCloseTo(12 / 30, 9);
  });

  it('extrapolates the landing point and the arriving speed to the predicted impact', () => {
    const tImpact = 0.45;
    const land = landingAt(samples, tImpact, 0.005);
    expect(land.x).toBeCloseTo(fall(tImpact).x, 3);
    expect(land.y).toBeCloseTo(fall(tImpact).y, 3);
    expect(land.speed).toBeCloseTo(6 * (tImpact - 0.2), 2); // dy/dt at the impact, not at the decision
  });

  it('maps the speed ratio (over the slowest stroke) to a velocity with a floor', () => {
    expect(velocityOf(0, 3)).toBe(SOFTEST_HIT);
    expect(velocityOf(3, 3)).toBe(1);
    expect(velocityOf(30, 3)).toBe(1);
    // A ratio of 2 is halfway from the slowest stroke (1) to the full-velocity one (3).
    expect(velocityOf(2, 3)).toBeCloseTo(SOFTEST_HIT + (1 - SOFTEST_HIT) / 2, 9);
  });
});

/** The gripped stick, translated sideways by `dx(strokeIndex)` pixels per stroke (the hand
 *  moves between strokes, at the top of the swing, halfway between two impacts). */
function movingGrip(name: string, dx: (k: number) => number): { truth: Truth; frames: HandsFrame[] } {
  const { truth, poses } = load(name);
  const fps = truth.spec.fps;
  const impacts = truth.events.map((e) => e.t_impact);
  const frames = gripFrames(poses).map((f, i) => {
    const t = i / fps;
    let k = 0;
    while (k + 1 < impacts.length && t > (impacts[k] + impacts[k + 1]) / 2) k++;
    const off = dx(k);
    return { ...f, hands: f.hands.map((h) => ({ ...h, keypoints: h.keypoints.map((p) => ({ ...p, x: p.x + off })) })) };
  });
  return { truth, frames };
}

async function strike(frames: HandsFrame[], fps: number, params: Record<string, unknown>) {
  // The synthetic grip's stick reaches TRUE_STICK_LENGTH past the fulcrum: tracking that
  // length puts the tracked point on the clip's own tip, whose landing is the truth.
  const h = airDrumNode.make(airDrumNode.params.parse({ enabled: true, point: 'stickTip', stickLength: TRUE_STICK_LENGTH, minLead: 0.03, ...params }));
  const outs = await replayNode(h, { hands: frames }, { dt: 1 / fps });
  return outs.flatMap((o) => o.hits as DrumHit[]);
}

describe.each(['subframe_stick_air_30', 'subframe_stick_surface_30'])('the air drum on pads, %s', (name) => {
  const { truth } = load(name);
  const fps = truth.spec.fps;
  const [ix, iy] = truth.events[0].impact_xy;
  const land = toDisplay(ix, iy, truth.clip.width, truth.clip.height);
  const SHIFT = 120; // pixels: 0.19 of the frame width

  it('with no pad on, every hit is the hand sound (the per-hand instrument is unchanged)', async () => {
    const { frames } = movingGrip(name, () => 0);
    const hits = await strike(frames, fps, {});
    expect(hits).toHaveLength(truth.events.length);
    expect(hits.every((h) => h.sound === 'kick' && h.pad === null)).toBe(true);
  });

  it('each pad sounds its own drum: strokes alternating between two pads alternate their drums', async () => {
    const { frames } = movingGrip(name, (k) => (k % 2 ? SHIFT : 0));
    // The hand moving RIGHT in the source image moves LEFT in the mirrored display.
    const left = { x: land.x - SHIFT / truth.clip.width, y: land.y };
    const pads = only({
      p1: pad({ x: land.x, y: land.y, w: 0.14, h: 0.25, sound: 'snare' }),
      p2: pad({ x: left.x, y: left.y, w: 0.14, h: 0.25, sound: 'tom' }),
      p3: pad({ x: 0.9, y: 0.1, w: 0.1, h: 0.1, sound: 'crash' }),
    });
    const hits = await strike(frames, fps, { pads });
    expect(hits).toHaveLength(truth.events.length);
    hits.forEach((h, k) => {
      expect(h.pad, `stroke ${k}`).toBe(k % 2 ? 'p2' : 'p1');
      expect(h.sound).toBe(k % 2 ? 'tom' : 'snare');
    });
  });

  it('a miss plays the hand sound, the nearest pad, or nothing, per offPad', async () => {
    const { frames } = movingGrip(name, () => 0);
    const pads = only({ p1: pad({ x: 0.9, y: 0.1, w: 0.1, h: 0.1, sound: 'crash' }) });
    expect((await strike(frames, fps, { pads })).every((h) => h.sound === 'kick' && h.pad === null)).toBe(true);
    const nearest = await strike(frames, fps, { pads, offPad: 'nearest' });
    expect(nearest.every((h) => h.sound === 'crash' && h.radial === 1)).toBe(true);
    expect(await strike(frames, fps, { pads, offPad: 'silent' })).toHaveLength(0);
  });

  it('a centre hit and a rim hit on the same pad differ by where they landed', async () => {
    const { frames } = movingGrip(name, (k) => (k % 2 ? 0.07 * truth.clip.width : 0));
    const pads = only({ p1: pad({ x: land.x - 0.02, y: land.y, w: 0.2, h: 0.3 }) });
    const hits = await strike(frames, fps, { pads });
    const centre = hits.filter((_, k) => k % 2 === 0).map((h) => h.radial!);
    const rim = hits.filter((_, k) => k % 2 === 1).map((h) => h.radial!);
    expect(Math.max(...centre)).toBeLessThan(0.35);
    expect(Math.min(...rim)).toBeGreaterThan(0.6);
    expect(hits.every((h) => h.pad === 'p1')).toBe(true);
  });

  it('how hard the stroke was orders the velocities (accents 1 > 0.8 > 0.6)', async () => {
    const { frames } = movingGrip(name, () => 0);
    // A full-velocity ratio above the clip's fastest stroke, so none is clipped to full.
    const hits = await strike(frames, fps, { hardHit: 20, volume: 1 });
    expect(hits).toHaveLength(truth.events.length);
    const byAmp = (a: number) => hits.slice(1).filter((_, k) => truth.events[k + 1].amplitude === a).map((h) => h.velocity);
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean(byAmp(1))).toBeGreaterThan(mean(byAmp(0.8)));
    expect(mean(byAmp(0.8))).toBeGreaterThan(mean(byAmp(0.6)));
    // And the speed is the clip's own: the accent peaks near its truth, in frame heights / s.
    const accent = hits.find((_, k) => k > 0 && truth.events[k].amplitude === 1)!;
    expect(accent.speed! * truth.clip.height).toBeGreaterThan(0.5 * 2111);
  });
});

describe('the drum voice', () => {
  it('is louder and brighter for a harder hit', () => {
    const soft = drumVoice('snare', 0.3);
    const hard = drumVoice('snare', 1);
    expect(hard.noises[0].gain).toBeGreaterThan(soft.noises[0].gain);
    expect(hard.noises[0].freq).toBeGreaterThan(soft.noises[0].freq);
    expect(hard.tones[0].from).toBeGreaterThan(soft.tones[0].from);
  });

  it('is higher and shorter at the rim than at the centre', () => {
    const centre = drumVoice('tom', 0.8, { radial: 0 });
    const rim = drumVoice('tom', 0.8, { radial: 1 });
    expect(rim.tones[0].to).toBeGreaterThan(centre.tones[0].to);
    expect(rim.tones[0].decay).toBeLessThan(centre.tones[0].decay);
  });

  it('has a voice for every drum a pad can sound, silent at zero velocity', () => {
    for (const s of ['kick', 'snare', 'hihat', 'tom', 'crash', 'ride'] as const) {
      const v = drumVoice(s, 1);
      expect(v.tones.length + v.noises.length, s).toBeGreaterThan(0);
      const quiet = drumVoice(s, 0);
      expect([...quiet.tones.map((x) => x.gain), ...quiet.noises.map((x) => x.gain)].every((g) => g === 0), s).toBe(true);
    }
  });
});
