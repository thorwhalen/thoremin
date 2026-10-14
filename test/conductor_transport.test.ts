/**
 * The body's transport in the conductor node (#377, body-movement A5): scripted conducting
 * gestures (test/helpers/body_conduct.ts) drive the prior's `ready` / `running` / `hold`
 * states and the score's fermata, and a replay of A1's conductor fixture starts on its first
 * downbeat.
 *
 * What each gesture must do:
 * - rest, then ready (raised, still), then the upbeat: nothing plays until the downbeat, and
 *   the beat is 0 there; the score is silent (`leadsScore` false) until then;
 * - strokes before any ready pose (walking in) start nothing;
 * - a held fermata (raised, still): `hold`, with the beat short of the next stroke's beat (the
 *   note the conductor gave sustains), released by the next stroke;
 * - a written fermata: the beat stops exactly on it and the body's stroke releases it;
 * - a cut-off (dropped, still): the prior back to `ready`, the score silent, and the next start
 *   after a ready pose and an upbeat plays the next whole beat (or the top, past the last note);
 * - a stated pose on `transportPose` replaces a rule (the override seam).
 */
import { describe, expect, it } from 'vitest';
import { replayNode } from '@thoremin/dag';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { conductorNode, type BodyFrame } from '@/nodes';
import { conduct, type Gesture } from './helpers/body_conduct';
import { loadStream } from './helpers/fixtures';

const FPS = 30;
const BPM = 90;
const P = 60 / BPM;
const BODY = { enabled: true, source: 'body', hand: 'right', mirrorX: false, mirrorHandedness: false } as const;

type Out = Record<string, unknown> & { beat: number; time: { state: string; anchors: number }; transport: string; leadsScore: boolean; bpm: number };

async function play(gestures: Gesture[], params: Record<string, unknown> = {}, extra: Record<string, unknown[]> = {}, script: Parameters<typeof conduct>[1] = {}) {
  const sc = conduct(gestures, { fps: FPS, ...script });
  const h = conductorNode.make(conductorNode.params.parse({ ...BODY, ...params }));
  const outs = (await replayNode(h, { body: sc.frames, ...extra }, { dt: 1 / FPS })) as Out[];
  const at = (t: number) => outs[Math.min(outs.length - 1, Math.round(t * FPS))];
  return { sc, outs, at };
}
const firstIndex = (outs: Out[], pred: (o: Out) => boolean) => outs.findIndex(pred);
const phases = (outs: Out[]) => outs.map((o) => o.transport).filter((p, i, a) => i === 0 || p !== a[i - 1]);

const START: Gesture[] = [
  { kind: 'rest', s: 1.5 },
  { kind: 'ready', s: 1.2 },
  { kind: 'upbeat', s: P },
];

describe('the body transport: start', () => {
  it('rest, ready, upbeat: the prior stays ready and the score silent until the downbeat, which is beat 0', async () => {
    const { sc, outs, at } = await play([...START, { kind: 'beat', bpm: BPM, beats: 8 }]);
    const downbeat = sc.ictus[0];
    const before = outs.slice(0, Math.floor(downbeat * FPS));
    expect(before.every((o) => o.beat === 0 && o.bpm === 0 && o.time.state === 'ready' && o.time.anchors === 0 && !o.leadsScore)).toBe(true);
    const start = firstIndex(outs, (o) => o.beat > 0);
    // Within two frames of the downbeat (its anchor is confirmed a frame after it).
    expect(start / FPS - downbeat).toBeGreaterThanOrEqual(0);
    expect(start / FPS - downbeat).toBeLessThanOrEqual(2 / FPS + 1e-9);
    expect(outs[start].leadsScore).toBe(true);
    expect(phases(outs)).toEqual(['idle', 'armed', 'prepared', 'running']);
    // Then it counts the strokes, and the prior runs.
    sc.ictus.forEach((t, i) => expect(Math.abs(at(t).beat - i)).toBeLessThan(0.25));
    expect(at(sc.ictus[3]).time.state).toBe('running');
  });

  it('strokes before any ready pose start nothing; with the rules off the first stroke starts (the hand transport)', async () => {
    const walkIn: Gesture[] = [{ kind: 'fidget', s: 3 }, { kind: 'rest', s: 0.5 }];
    const ruled = await play([...walkIn, ...START, { kind: 'beat', bpm: BPM, beats: 4 }]);
    const fidgetEnd = 3 * FPS;
    expect(ruled.outs.slice(0, fidgetEnd).every((o) => o.beat === 0 && !o.leadsScore)).toBe(true);
    expect(firstIndex(ruled.outs, (o) => o.beat > 0) / FPS).toBeGreaterThanOrEqual(ruled.sc.ictus[0]);
    const free = await play([...walkIn, ...START, { kind: 'beat', bpm: BPM, beats: 4 }], { transport: { rules: false } });
    expect(firstIndex(free.outs, (o) => o.beat > 0) / FPS).toBeLessThan(3);
    expect(free.outs.every((o) => o.transport === 'off')).toBe(true);
  });

  it('the downbeat plays beat 0 with the auto side too', async () => {
    const { sc, at } = await play([...START, { kind: 'beat', bpm: BPM, beats: 6 }], { hand: 'auto' });
    sc.ictus.forEach((t, i) => expect(Math.abs(at(t).beat - i)).toBeLessThan(0.25));
  });
});

describe('the body transport at a noisier tracker (#461)', () => {
  // About 1 px of WHITE jitter on a 150 px torso (the scripted noise). The upbeat is read
  // in noise units, a signal-to-noise ratio, so where the scripted upbeat falls under
  // `moveAbove` the piece never starts. Whether a webcam's pose tracking is this noisy is
  // open: its noise is correlated in time (on A1's footage a still arm's displacement over
  // 0.15 s is 3.7 times its per-frame one), which keeps the second-difference jitter small
  // and the motion high. #461 holds the attempts and the live check that decides.
  const start = async (noisePx: number, arm: 'fixed' | 'jointed') => {
    const { sc, outs } = await play([...START, { kind: 'beat', bpm: BPM, beats: 8 }], {}, {}, { noisePx, arm });
    const first = firstIndex(outs, (o) => o.beat > 0);
    expect(first / FPS - sc.ictus[0]).toBeGreaterThanOrEqual(0);
    expect(first / FPS - sc.ictus[0]).toBeLessThanOrEqual(2 / FPS + 1e-9);
    expect(phases(outs.slice(0, first + 1))).toEqual(['idle', 'armed', 'prepared', 'running']);
  };
  it('1 px, jointed arm (its elbow moves with the wrist): ready, upbeat, then beat 0 on the downbeat', () => start(1, 'jointed'));
  // Known failures (#461): these flip to passing when the upbeat is read robustly at this
  // noise; turn them into plain tests then.
  it.fails('1 px, fixed arm: never starts (#461)', () => start(1, 'fixed'));
  it.fails('2 px, fixed arm: never starts (#461)', () => start(2, 'fixed'));
  it.fails('2 px, jointed arm: starts late (#461)', () => start(2, 'jointed'));
});

describe('a slowly moving ready arm is no upbeat (guards for #461 and #485)', () => {
  // A slow adjustment of the raised arm in the ready pose must not count as the upbeat (a
  // fix of #461 that reads the upbeat more sensitively must keep these). Only the cases the
  // current rule passes are here; the seeds and cleaner cameras it does not are #485.
  const slow: [string, Gesture][] = [
    ['repositioned up 0.2 torso over 0.6 s', { kind: 'drift', s: 0.6, by: 0.2 }],
    ['repositioned down 0.15 torso over 1 s', { kind: 'drift', s: 1, by: -0.15 }],
    ['a slight sway, 0.05 torso at 0.7 Hz', { kind: 'sway', s: 1.3, amp: 0.05, hz: 0.7 }],
    ['a sway, 0.08 torso at 1.2 Hz', { kind: 'sway', s: 1.3, amp: 0.08, hz: 1.2 }],
  ];
  const cases = [
    ...slow.map(([name, g]) => ({ noisePx: 0.25, arm: 'fixed' as const, name, g })),
    ...slow.slice(1).map(([name, g]) => ({ noisePx: 0.5, arm: 'jointed' as const, name, g })),
  ];
  it.each(cases)('$noisePx px, $arm arm, $name: the piece starts on the downbeat, not before', async ({ noisePx, arm, g }) => {
    const { sc, outs } = await play([{ kind: 'rest', s: 1.5 }, { kind: 'ready', s: 1.2 }, g, { kind: 'ready', s: 0.6 }, { kind: 'upbeat', s: P }, { kind: 'beat', bpm: BPM, beats: 6 }], {}, {}, { noisePx, arm });
    const start = firstIndex(outs, (o) => o.beat > 0);
    expect(start / FPS - sc.ictus[0]).toBeGreaterThanOrEqual(0);
    expect(start / FPS - sc.ictus[0]).toBeLessThanOrEqual(2 / FPS + 1e-9);
  });
});

describe('the body transport: hold and fermata', () => {
  it('a held fermata: hold within holdAfterPeriods of the last stroke, the given beat sustained, the next stroke releases', async () => {
    const { sc, outs, at } = await play([...START, { kind: 'beat', bpm: BPM, beats: 6 }, { kind: 'hold', s: 3 }, { kind: 'beat', bpm: BPM, beats: 4 }]);
    const last = sc.ictus[6];
    const holdStart = firstIndex(outs, (o) => o.time.state === 'hold');
    expect(holdStart / FPS).toBeGreaterThan(last);
    // 1.5 periods, plus the late confirmation of a stroke that ends in a stop, plus the stillness filter.
    expect(holdStart / FPS - last).toBeLessThan(2.5 * P);
    expect(outs[holdStart].transport).toBe('holding');
    const held = outs.slice(holdStart, Math.round((sc.starts[5] + 0.2) * FPS));
    expect(held.every((o) => o.time.state === 'hold' && o.bpm === 0)).toBe(true);
    // The beat the conductor gave (6) sounds; the next one (7) waits for its stroke.
    expect(held[0].beat).toBeGreaterThanOrEqual(6);
    expect(held[held.length - 1].beat).toBeLessThan(7);
    expect(held[0].leadsScore).toBe(true);
    // The first stroke after the hold plays beat 7, and the counting goes on.
    const release = sc.ictus[7];
    expect(at(release + 2 / FPS).time.state).not.toBe('hold');
    sc.ictus.slice(8).forEach((t, i) => expect(Math.abs(at(t).beat - (8 + i))).toBeLessThan(0.3));
  });

  it("a written fermata: the beat stops exactly on it, the body's hold keeps it, its stroke releases it", async () => {
    const doc = { v: 1, title: 't', source: 'builtin', parts: [], tempoMap: [{ beat: 0, bpm: BPM }], timeSignatures: [], dynamics: [], fermatas: [4], lengthBeats: 64 };
    const sc0 = conduct([...START, { kind: 'beat', bpm: BPM, beats: 4 }, { kind: 'hold', s: 2.5 }, { kind: 'beat', bpm: BPM, beats: 3 }], { fps: FPS });
    const { sc, outs, at } = await play([...START, { kind: 'beat', bpm: BPM, beats: 4 }, { kind: 'hold', s: 2.5 }, { kind: 'beat', bpm: BPM, beats: 3 }], {}, { doc: sc0.frames.map(() => doc) });
    const stop = firstIndex(outs, (o) => o.beat === 4);
    expect(stop).toBeGreaterThan(0);
    const holdEnd = Math.round(sc.ictus[5] * FPS) - 1;
    expect(outs.slice(stop, holdEnd).every((o) => o.beat === 4 && o.time.state === 'hold' && o.bpm === 0)).toBe(true);
    // Released by the stroke, and on from 4.
    expect(at(sc.ictus[5] + 3 / FPS).beat).toBeGreaterThan(4);
    expect(Math.abs(at(sc.ictus[6]).beat - 5)).toBeLessThan(0.35);
  });
});

describe('the body transport: cut-off', () => {
  const CUT: Gesture[] = [...START, { kind: 'beat', bpm: BPM, beats: 6 }, { kind: 'cutoff', s: 2.5 }];

  it('dropped and still for a period: the prior back to ready, the score silent; a new ready and upbeat play the next whole beat', async () => {
    const { sc, outs, at } = await play([...CUT, ...START.slice(1), { kind: 'beat', bpm: BPM, beats: 3 }]);
    const stop = firstIndex(outs, (o) => o.transport === 'stopped');
    const cut = sc.starts[4];
    expect(stop / FPS).toBeGreaterThan(cut + 0.65);
    // The drop lasts until 0.65 s into the cut-off; then a period of stillness, plus the filter.
    expect(stop / FPS - (cut + 0.65)).toBeLessThan(P + 0.5);
    // No beat the conductor did not give: the six strokes after the downbeat, and the flick
    // (a cut-off looks like a beat), and the beat waits short of the next one.
    expect(outs[stop].beat).toBeLessThan(8);
    const stoppedBeat = outs[stop].beat;
    const silent = outs.slice(stop, Math.round(sc.ictus[7] * FPS));
    expect(silent.every((o) => o.time.state === 'ready' && o.time.anchors === 0 && !o.leadsScore && o.bpm === 0 && o.beat === stoppedBeat)).toBe(true);
    expect(phases(outs.slice(stop))).toEqual(['stopped', 'idle', 'armed', 'prepared', 'running']);
    // The restart's downbeat plays the next whole beat after where it stopped.
    const next = Math.ceil(stoppedBeat - 1e-3);
    expect(Math.abs(at(sc.ictus[7] + 2 / FPS).beat - next)).toBeLessThan(0.15);
    expect(Math.abs(at(sc.ictus[9]).beat - (next + 2))).toBeLessThan(0.3);
  });

  it('a cut-off past the last note: the next start is from the top', async () => {
    const doc = { v: 1, title: 't', source: 'builtin', parts: [{ id: 'p', name: 'p', notes: [0, 1, 2, 3, 4].map((b) => ({ midi: 60, start: b, duration: 1 })) }], tempoMap: [{ beat: 0, bpm: BPM }], timeSignatures: [], dynamics: [], fermatas: [], lengthBeats: 5 };
    const gestures: Gesture[] = [...CUT, ...START.slice(1), { kind: 'beat', bpm: BPM, beats: 2 }];
    const n = conduct(gestures, { fps: FPS }).frames.length;
    const { sc, outs, at } = await play(gestures, {}, { doc: new Array(n).fill(doc) });
    const stop = firstIndex(outs, (o) => o.transport === 'stopped');
    expect(outs[stop].beat).toBe(0);
    expect(Math.abs(at(sc.ictus[8]).beat - 1)).toBeLessThan(0.3);
  });
});

describe('the adversarial review (#377)', () => {
  it('a bounce point (trunk, hips, head) keeps the hand transport: a bounce with the arms down starts on its first stroke', async () => {
    for (const bodyPoint of ['com', 'hips'] as const) {
      const { outs } = await play([{ kind: 'rest', s: 1.5 }, { kind: 'bounce', bpm: 100, beats: 16 }], { bodyPoint, hand: 'auto' });
      expect(outs.every((o) => o.transport === 'off')).toBe(true);
      expect(outs[outs.length - 1].beat).toBeGreaterThan(8);
    }
  });

  it('with an arm point, a bounce with the arms hanging starts nothing (the status asks for the ready pose), and footsteps do not start it', async () => {
    const { outs } = await play([{ kind: 'rest', s: 1.5 }, { kind: 'bounce', bpm: 115, beats: 16 }, { kind: 'rest', s: 3 }], { bodyPoint: 'impact', hand: 'auto' });
    expect(outs.every((o) => o.beat === 0 && !o.leadsScore)).toBe(true);
    expect(outs.every((o) => o.transport === 'idle')).toBe(true);
  });

  it('a player settling in (the whole skeleton shaking) during the meter warm-up still starts on the downbeat', async () => {
    for (const px of [2, 8]) {
      const { sc, outs } = await play([{ kind: 'shake', s: 0.4, px }, { kind: 'rest', s: 1.5 }, ...START.slice(1), { kind: 'beat', bpm: BPM, beats: 8 }]);
      const start = firstIndex(outs, (o) => o.beat > 0);
      expect(start / FPS - sc.ictus[0]).toBeLessThanOrEqual(2 / FPS + 1e-9);
      expect(start / FPS - sc.ictus[0]).toBeGreaterThanOrEqual(0);
    }
  });

  it('a cut-off that stops on a written fermata restarts on the beat after it, not on the fermata again', async () => {
    // Held on the fermata, a cut-off stated by a pose category (no flick), the arm down, then a
    // ready pose, the upbeat and strokes.
    const gestures: Gesture[] = [...START, { kind: 'beat', bpm: BPM, beats: 4 }, { kind: 'hold', s: 2 }, { kind: 'hold', s: 2 }, ...START, { kind: 'beat', bpm: BPM, beats: 3 }];
    const sc = conduct(gestures, { fps: FPS });
    const doc = { v: 1, title: 't', source: 'builtin', parts: [], tempoMap: [{ beat: 0, bpm: BPM }], timeSignatures: [], dynamics: [], fermatas: [4], lengthBeats: 64 };
    const cutFrom = Math.round(sc.starts[5] * FPS);
    const cutTo = Math.round(sc.starts[6] * FPS);
    const pose = sc.frames.map((_, i) => (i >= cutFrom && i < cutTo ? { cutoff: true } : undefined));
    const { outs, at } = await play(gestures, {}, { doc: sc.frames.map(() => doc), transportPose: pose });
    const stop = firstIndex(outs, (o) => o.transport === 'stopped');
    expect(outs[stop].beat).toBe(4);
    const restart = at(sc.ictus[5] + 2 / FPS);
    expect(Math.abs(restart.beat - 5)).toBeLessThan(0.15);
    expect(Math.abs(at(sc.ictus[6]).beat - 6)).toBeLessThan(0.3);
  });

  it('turning the rules on while conducting with the body keeps the music going', async () => {
    const gestures: Gesture[] = [...START, { kind: 'beat', bpm: BPM, beats: 12 }];
    const sc = conduct(gestures, { fps: FPS });
    const on = Math.round(sc.ictus[5] * FPS);
    const config = sc.frames.map((_, i) => ({ ...BODY, transport: { rules: i >= on } }));
    const { outs } = await play(gestures, { transport: { rules: false } }, { config });
    expect(outs.slice(on).every((o) => o.leadsScore && o.transport === 'running')).toBe(true);
    expect(outs[outs.length - 1].beat).toBeGreaterThan(11);
  });

  it('marking half bars, the release of a written fermata off the stroke grid goes on from it rather than jumping', async () => {
    const doc = { v: 1, title: 't', source: 'builtin', parts: [], tempoMap: [{ beat: 0, bpm: 2 * BPM }], timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }], dynamics: [], fermatas: [3], lengthBeats: 64 };
    const gestures: Gesture[] = [...START, { kind: 'beat', bpm: BPM, beats: 2 }, { kind: 'hold', s: 3 }, { kind: 'beat', bpm: BPM, beats: 3 }];
    const n = conduct(gestures, { fps: FPS }).frames.length;
    const { outs } = await play(gestures, { markLevel: 'half' }, { doc: new Array(n).fill(doc) });
    const beats = outs.map((o) => o.beat);
    expect(beats.some((b) => b === 3)).toBe(true);
    // No tick advances more than the tempo allows (a jump would skip notes at once).
    const maxStep = Math.max(...beats.slice(1).map((b, i) => b - beats[i]));
    expect(maxStep).toBeLessThan(0.3);
  });

  it('running, the player leaving the frame stops the piece; walking back in does not resume it', async () => {
    const gestures: Gesture[] = [...START, { kind: 'beat', bpm: BPM, beats: 6 }, { kind: 'absent', s: 3 }, { kind: 'fidget', s: 2 }];
    const { sc, outs } = await play(gestures);
    const stop = firstIndex(outs, (o) => o.transport === 'stopped');
    expect(stop / FPS).toBeGreaterThan(sc.starts[4]);
    expect(stop / FPS - sc.starts[4]).toBeLessThan(2.5);
    const back = Math.round(sc.starts[5] * FPS);
    expect(outs.slice(back).every((o) => !o.leadsScore && o.bpm === 0)).toBe(true);
  });
});

describe('the override seam', () => {
  it('a stated cut-off on transportPose stops while the arm is raised and still', async () => {
    const gestures: Gesture[] = [...START, { kind: 'beat', bpm: BPM, beats: 4 }, { kind: 'hold', s: 3 }];
    const sc = conduct(gestures, { fps: FPS });
    const cutFrom = Math.round((sc.starts[4] + 1.5) * FPS);
    const pose = sc.frames.map((_, i) => (i >= cutFrom ? { cutoff: true } : undefined));
    const { outs } = await play(gestures, {}, { transportPose: pose });
    const stop = firstIndex(outs, (o) => o.transport === 'stopped');
    expect(stop).toBeGreaterThanOrEqual(cutFrom);
    expect(stop - cutFrom).toBeLessThanOrEqual(Math.ceil(P * FPS) + 1);
  });

  it('a stated ready arms with the arms down', async () => {
    const gestures: Gesture[] = [{ kind: 'rest', s: 2 }, { kind: 'upbeat', s: P }, { kind: 'beat', bpm: BPM, beats: 3 }];
    const sc = conduct(gestures, { fps: FPS });
    const plain = await play(gestures);
    expect(plain.outs.every((o) => o.beat === 0)).toBe(true);
    const { outs } = await play(gestures, {}, { transportPose: sc.frames.map(() => ({ ready: true })) });
    expect(outs[outs.length - 1].beat).toBeGreaterThan(1.5);
  });
});

describe("A1's conductor fixture (video_body_conducting_44)", () => {
  const CLIP = 'video_body_conducting_44';
  const body = loadStream(CLIP, 'camBody.body') as BodyFrame[];
  const grid = (JSON.parse(readFileSync(join(__dirname, 'fixtures', CLIP, 'meta.json'), 'utf8')) as { grid: { beats: number[] } }).grid.beats;

  it('starts on its first downbeat: ready, upbeat, then beat 0 on the first stroke, and the strokes counted from there', async () => {
    const h = conductorNode.make(conductorNode.params.parse({ ...BODY, hand: 'auto' }));
    const outs = (await replayNode(h, { body }, { dt: 1 / FPS })) as Out[];
    const start = firstIndex(outs, (o) => o.beat > 0);
    expect(start / FPS - grid[0]).toBeGreaterThanOrEqual(0);
    expect(start / FPS - grid[0]).toBeLessThanOrEqual(2 / FPS + 1e-9);
    expect(phases(outs.slice(0, start + 1))).toEqual(['idle', 'armed', 'prepared', 'running']);
    // The first verse's strokes (before the conductor's hold at about 11 s) are the beats.
    grid.filter((t) => t < 10.6).forEach((t, i) => expect(Math.abs(outs[Math.round(t * FPS)].beat - i)).toBeLessThan(0.35));
    // The hold between the verses is a hold.
    expect(outs.slice(Math.round(12 * FPS), Math.round(12.8 * FPS)).every((o) => o.time.state === 'hold')).toBe(true);
  });
});
