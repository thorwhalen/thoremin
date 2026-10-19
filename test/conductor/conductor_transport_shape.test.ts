/**
 * The upbeat read by SHAPE (D15, #461, #485; `transport.upbeat: 'shape'`): a rise of the beating arm above
 * where it was held ready, then a quick fall, in torso lengths. Noise units (the `speed` rule) are a
 * signal-to-noise ratio, so a very clean tracker starts early on a slow adjustment and a noisy one never
 * starts; the shape is the same on every camera. Measured here on the scripted conductor at the noise
 * levels of #461 and #485, and on A1's three real conducting clips.
 */
import { describe, expect, it } from 'vitest';
import { replayNode } from '@thoremin/dag';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type BodyFrame } from '@/nodes';
import { conductorNode } from '@/slices/conductor/nodes/conductor';
import { conduct, type Gesture } from '../helpers/body_conduct';
import { loadStream } from '../helpers/fixtures';
import { CONDUCTOR } from '../helpers/extensions';

const FPS = 30;
const BPM = 90;
const P = 60 / BPM;
const BODY = { enabled: true, source: 'body', hand: 'right', mirrorX: false, mirrorHandedness: false } as const;
const SHAPE = { transport: { upbeat: 'shape' } } as const;

type Out = Record<string, unknown> & { beat: number; transport: string };

async function play(gestures: Gesture[], params: Record<string, unknown>, script: Parameters<typeof conduct>[1] = {}) {
  const sc = conduct(gestures, { fps: FPS, ...script });
  const h = conductorNode.make(conductorNode.params.parse({ ...BODY, ...params }));
  const outs = (await replayNode(h, { body: sc.frames }, { dt: 1 / FPS })) as Out[];
  return { sc, outs };
}
const firstStart = (outs: Out[]) => outs.findIndex((o) => o.beat > 0);
const phases = (outs: Out[]) => outs.map((o) => o.transport).filter((p, i, a) => i === 0 || p !== a[i - 1]);

const START: Gesture[] = [{ kind: 'rest', s: 1.5 }, { kind: 'ready', s: 1.2 }, { kind: 'upbeat', s: P }];

describe.runIf(CONDUCTOR)('upbeat: shape, the scripted conductor at every noise level', () => {
  // The cases #461 failed at (1 and 2 px, fixed and jointed) and #485's clean cameras (0.05 and 0.1 px).
  const levels = [0.05, 0.1, 0.25, 0.5, 1, 2];
  const arms = ['fixed', 'jointed'] as const;
  it.each(levels.flatMap((noisePx) => arms.map((arm) => ({ noisePx, arm }))))('$noisePx px, $arm arm: ready, upbeat, then beat 0 on the downbeat', async ({ noisePx, arm }) => {
    const { sc, outs } = await play([...START, { kind: 'beat', bpm: BPM, beats: 8 }], SHAPE, { noisePx, arm });
    const first = firstStart(outs);
    expect(first / FPS - sc.ictus[0]).toBeGreaterThanOrEqual(0);
    expect(first / FPS - sc.ictus[0]).toBeLessThanOrEqual(2 / FPS + 1e-9);
    expect(phases(outs.slice(0, first + 1))).toEqual(['idle', 'armed', 'prepared', 'running']);
  });
});

describe.runIf(CONDUCTOR)('upbeat: shape, a slow adjustment of the ready arm is no upbeat (#485)', () => {
  const slow: [string, Gesture][] = [
    ['repositioned up 0.2 torso over 0.6 s', { kind: 'drift', s: 0.6, by: 0.2 }],
    ['repositioned down 0.15 torso over 1 s', { kind: 'drift', s: 1, by: -0.15 }],
    ['a slight sway, 0.05 torso at 0.7 Hz', { kind: 'sway', s: 1.3, amp: 0.05, hz: 0.7 }],
    ['a sway, 0.08 torso at 1.2 Hz', { kind: 'sway', s: 1.3, amp: 0.08, hz: 1.2 }],
  ];
  const cases = [0.05, 0.1, 0.25, 1].flatMap((noisePx) => (['fixed', 'jointed'] as const).flatMap((arm) => slow.map(([name, g]) => ({ noisePx, arm, name, g }))));
  it.each(cases)('$noisePx px, $arm arm, $name: the piece starts on the downbeat, not before', async ({ noisePx, arm, g }) => {
    const { sc, outs } = await play([{ kind: 'rest', s: 1.5 }, { kind: 'ready', s: 1.2 }, g, { kind: 'ready', s: 0.6 }, { kind: 'upbeat', s: P }, { kind: 'beat', bpm: BPM, beats: 6 }], SHAPE, { noisePx, arm });
    const start = firstStart(outs);
    expect(start / FPS - sc.ictus[0]).toBeGreaterThanOrEqual(0);
    expect(start / FPS - sc.ictus[0]).toBeLessThanOrEqual(2 / FPS + 1e-9);
  });

  it('a drift up and a slow settle back is no upbeat either (the fall is not quick)', async () => {
    const { sc, outs } = await play(
      [{ kind: 'rest', s: 1.5 }, { kind: 'ready', s: 1.2 }, { kind: 'drift', s: 0.5, by: 0.25 }, { kind: 'drift', s: 1.2, by: -0.25 }, { kind: 'ready', s: 0.6 }, { kind: 'upbeat', s: P }, { kind: 'beat', bpm: BPM, beats: 6 }],
      SHAPE,
      { noisePx: 0.05 },
    );
    expect(firstStart(outs) / FPS - sc.ictus[0]).toBeGreaterThanOrEqual(0);
    expect(firstStart(outs) / FPS - sc.ictus[0]).toBeLessThanOrEqual(2 / FPS + 1e-9);
  });
});

describe.runIf(CONDUCTOR)('upbeat: shape, the default rule is unchanged', () => {
  it('speed is the default', () => {
    expect(conductorNode.params.parse({}).transport.upbeat).toBe('speed');
  });
});

describe.runIf(CONDUCTOR)("upbeat: shape, A1's real conductors", () => {
  // The three clips start mid-conducting (a ready pose that sags, a first stroke that is the downbeat itself), so
  // they are a check of the shape rule on real arms, not a ground truth for every beat: it must start from a real
  // preparatory movement, never before the clip's first downbeat, and no later than the second beat after it.
  for (const clip of ['video_body_conducting_44', 'video_body_conducting_34', 'video_body_conducting_24']) {
    it(`${clip}: starts from the real preparatory movement, on one of the first two beats`, async () => {
      const body = loadStream(clip, 'camBody.body') as BodyFrame[];
      const grid = (JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', clip, 'meta.json'), 'utf8')) as { grid: { beats: number[] } }).grid.beats;
      const outs = (await replayNode(conductorNode.make(conductorNode.params.parse({ ...BODY, hand: 'auto', ...SHAPE })), { body }, { dt: 1 / FPS })) as Out[];
      const s = firstStart(outs) / FPS;
      expect(s, `${clip}: the shape rule never started`).toBeGreaterThan(0);
      expect(s - grid[0]).toBeGreaterThanOrEqual(-1e-9);
      expect(s).toBeLessThanOrEqual(grid[2] + 2 / FPS);
    });
  }

  it('video_body_conducting_44 (A1\'s start clip): the downward first stroke is the upbeat, and it starts on its first downbeat as the speed rule does', async () => {
    const body = loadStream('video_body_conducting_44', 'camBody.body') as BodyFrame[];
    const grid = (JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'video_body_conducting_44', 'meta.json'), 'utf8')) as { grid: { beats: number[] } }).grid.beats;
    const outs = (await replayNode(conductorNode.make(conductorNode.params.parse({ ...BODY, hand: 'auto', ...SHAPE })), { body }, { dt: 1 / FPS })) as Out[];
    expect(firstStart(outs) / FPS - grid[0]).toBeGreaterThanOrEqual(0);
    expect(firstStart(outs) / FPS - grid[0]).toBeLessThanOrEqual(2 / FPS + 1e-9);
  });
});
