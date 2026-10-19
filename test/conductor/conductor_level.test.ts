/**
 * The level a stroke marks (#376, body-movement A4): `markLevel` on the conductor.
 *
 * The body conductor of A1's 4/4 clip beats every beat. Against a score marked at TWICE
 * his tempo he is a body bouncing at half time (each stroke is two of the piece's beats),
 * against one at four times his tempo he marks bars. Stated (`half`, `bar`) the level is
 * held from the start; `auto` relates the strokes to the marked tempo with ictus's level
 * relation and follows the ratio once it has persisted 3 s. Either way the piece's beat
 * advances `k` per stroke, and a stroke lands on a multiple of `k` beats.
 */
import { describe, expect, it } from 'vitest';
import { replayNode } from '@thoremin/dag';
import { wrapPhase } from '@thoremin/ictus';
import { type BodyFrame } from '@/nodes';
import { conductorNode } from '@/slices/conductor/nodes/conductor';
import { loadStream } from '../helpers/fixtures';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONDUCTOR } from '../helpers/extensions';

const FPS = 30;
const CLIP = 'video_body_conducting_44';
const body = loadStream(CLIP, 'camBody.body') as BodyFrame[];
const grid = (JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', CLIP, 'meta.json'), 'utf8')) as { grid: { beats: number[] } }).grid.beats;
const BODY = { enabled: true, source: 'body', mirrorX: false, mirrorHandedness: false } as const;
/** The clip's own tempo, from its grid. */
const clipBpm = 60 / ((grid[grid.length - 1] - grid[0]) / (grid.length - 1));
const score = (bpm: number) => ({ v: 1, title: 't', source: 'builtin', parts: [], tempoMap: [{ beat: 0, bpm }], timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }], dynamics: [], fermatas: [], lengthBeats: 1024 });

async function conduct(markLevel: string, scoreBpm: number) {
  const h = conductorNode.make(conductorNode.params.parse({ ...BODY, markLevel }));
  const doc = score(scoreBpm);
  const outs = await replayNode(h, { body, doc: body.map(() => doc) }, { dt: 1 / FPS });
  const at = (t: number) => outs[Math.min(outs.length - 1, Math.round(t * FPS))];
  return { outs, at, last: outs[outs.length - 1].beat as number };
}

/** The share of the grid's beats (from `from` s on) at which the piece's beat sits within
 *  `tol` strokes of a multiple of `k` (a stroke = `k` beats). */
function onLevel(at: (t: number) => Record<string, unknown>, k: number, from: number, tol = 0.35): number {
  const ts = grid.filter((t) => t >= from);
  const hits = ts.filter((t) => Math.abs(wrapPhase((at(t).beat as number) / k)) < tol).length;
  return hits / ts.length;
}

describe.runIf(CONDUCTOR)(`markLevel on ${CLIP} (${grid.length} beats, ${clipBpm.toFixed(0)} bpm)`, () => {
  it('beat (the default) counts one beat a stroke, whatever the score marks', async () => {
    const r = await conduct('beat', 2 * clipBpm);
    expect(r.last).toBeGreaterThan(grid.length * 0.85);
    expect(r.last).toBeLessThan(grid.length * 1.2);
    expect(r.outs.every((o) => o.level === 1)).toBe(true);
  });

  it('half: a body bouncing at half time against a score, two beats a stroke, a stroke on an even beat', async () => {
    const r = await conduct('half', 2 * clipBpm);
    expect(r.last).toBeGreaterThan(2 * grid.length * 0.85);
    expect(r.last).toBeLessThan(2 * grid.length * 1.2);
    expect(onLevel(r.at, 2, 4)).toBeGreaterThan(0.8);
  });

  it('auto: the same half-time body is related to the score, and the ratio held once it persists', async () => {
    const r = await conduct('auto', 2 * clipBpm);
    const levels = r.outs.map((o) => o.level as number);
    const first = levels.indexOf(2);
    expect(first).toBeGreaterThan(3 * FPS);
    expect(levels.slice(first).every((k) => k === 2)).toBe(true);
    expect(r.last).toBeGreaterThan(2 * grid.length * 0.7);
  });

  it('bar: a bar-level marker, four beats a stroke, every stroke on a downbeat', async () => {
    const r = await conduct('bar', 4 * clipBpm);
    expect(r.last).toBeGreaterThan(4 * grid.length * 0.85);
    expect(r.last).toBeLessThan(4 * grid.length * 1.2);
    expect(onLevel(r.at, 4, 4)).toBeGreaterThan(0.8);
    expect(r.outs.at(-1)!.level).toBe(4);
  });

  it('the level only rescales: once settled, each stroke has the phase, in strokes, it has marking beats', async () => {
    const beat = await conduct('beat', clipBpm);
    for (const [m, k] of [['half', 2], ['bar', 4]] as const) {
      const r = await conduct(m, k * clipBpm);
      for (const t of grid.filter((x) => x >= 8)) {
        expect(wrapPhase((r.at(t).beat as number) / k)).toBeCloseTo(wrapPhase(beat.at(t).beat as number), 1);
      }
    }
  });

  it('auto against a score at his own tempo stays on the beat, and so does one marked 40 % faster than he beats', async () => {
    for (const bpm of [clipBpm, clipBpm * 1.4]) {
      const r = await conduct('auto', bpm);
      expect(r.outs.every((o) => o.level === 1)).toBe(true);
    }
  });

  it('auto leading a recording stays on the beat (the song servo relates the levels), even after a level was found on the score', async () => {
    const h = conductorNode.make(conductorNode.params.parse({ ...BODY, markLevel: 'auto' }));
    const doc = score(2 * clipBpm);
    const half = Math.floor(body.length / 2);
    const levels: number[] = [];
    for (let i = 0; i < body.length; i++) {
      const config = i < half ? undefined : { conducts: 'recording' };
      const o = (await h.process({ body: body[i], doc, config }, { time: i / FPS, dt: 1 / FPS, tick: i, resources: {} } as never)) as { level: number };
      levels.push(o.level);
    }
    expect(levels.slice(0, half)).toContain(2);
    expect(levels.slice(half).every((k) => k === 1)).toBe(true);
  });
});
