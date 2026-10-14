/**
 * Where the bar lines are (#438): `beatInBar` and the bar-level strokes count from the same
 * bar line, after a meter change, with a pickup, and in an odd meter whose bar is a
 * fractional number of quarter beats.
 *
 * `barStartAt` is the one function; the node tests replay the 70 bpm hand fixture under
 * scores whose bar lines the old `wholeBeat % beatsPerBar` put in the wrong place.
 */
import { describe, expect, it } from 'vitest';
import { replayNode } from '@thoremin/dag';
import { barStartAt, ScoreDocSchema, type ScoreDoc } from '@thoremin/sdk/score/schema';
import { conductorNode, type HandsFrame } from '@/nodes';
import { loadStream } from './helpers/fixtures';

const FPS = 30;
const frames = loadStream('conducting_44', 'src.hands') as HandsFrame[];
const RECORDED = { mirrorX: false, mirrorHandedness: false };

const doc = (over: Partial<ScoreDoc>): ScoreDoc =>
  ScoreDocSchema.parse({ title: 't', source: 'builtin', parts: [], tempoMap: [], timeSignatures: [], dynamics: [], fermatas: [], lengthBeats: 64, ...over });

const THREE_THEN_FOUR = doc({ timeSignatures: [{ beat: 0, numerator: 3, denominator: 4 }, { beat: 6, numerator: 4, denominator: 4 }] });

describe('barStartAt', () => {
  it('is the signature in force, so 3/4 for two bars then 4/4 puts the bar line on beat 6', () => {
    expect([0, 2.9, 3, 5.9].map((b) => barStartAt(THREE_THEN_FOUR, b))).toEqual([0, 0, 0, 0]);
    expect([6, 9.5, 12].map((b) => barStartAt(THREE_THEN_FOUR, b))).toEqual([6, 6, 6]);
  });

  it('a pickup moves the first bar line to where the first full bar starts, and no later signature', () => {
    const d = doc({ pickup: 1, timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }, { beat: 9, numerator: 3, denominator: 4 }] });
    expect(barStartAt(d, 0)).toBe(-3); // bar lines at 1, 5, 9
    expect(barStartAt(d, 8.9)).toBe(-3);
    expect(barStartAt(d, 9)).toBe(9);
  });

  it('no pickup, a pickup as long as the bar, or none stated is the signature start', () => {
    expect(barStartAt(doc({}), 3)).toBe(0);
    expect(barStartAt(doc({ pickup: 0 }), 3)).toBe(0);
    expect(barStartAt(doc({ pickup: 4 }), 3)).toBe(0);
  });
});

/** The conductor's `beatInBar` against its beat, for a score. */
async function run(d: ScoreDoc) {
  const h = conductorNode.make(conductorNode.params.parse({ enabled: true, ...RECORDED }));
  const outs = await replayNode(h, { hands: frames, doc: frames.map(() => d) }, { dt: 1 / FPS });
  return outs.map((o) => ({ beat: o.beat as number, bar: (o.time as { beatInBar: number; beatsPerBar: number }).beatInBar, bpb: (o.time as { beatsPerBar: number }).beatsPerBar }));
}
/** The `beatInBar` values seen while the beat was in `[lo, hi)`. */
const seen = (rows: { beat: number; bar: number }[], lo: number, hi: number) => new Set(rows.filter((r) => r.beat >= lo && r.beat < hi).map((r) => r.bar));

describe('beatInBar counts from the bar line in force', () => {
  it('after a meter change that is not a multiple of the new bar: beat 6 is beat 0 of the 4/4 bar', async () => {
    const rows = await run(THREE_THEN_FOUR);
    expect(rows.at(-1)!.beat).toBeGreaterThan(10); // the clip reaches the second 4/4 bar
    expect(seen(rows, 6, 7)).toEqual(new Set([0]));
    expect(seen(rows, 7, 8)).toEqual(new Set([1]));
    expect(seen(rows, 9, 10)).toEqual(new Set([3]));
    expect(seen(rows, 10, 11)).toEqual(new Set([0]));
    expect(seen(rows, 3, 4)).toEqual(new Set([0])); // 3/4: the second bar starts on beat 3
  });

  it('with a pickup: the pickup beats are the last of the bar, the first full bar starts at its length', async () => {
    const rows = await run(doc({ pickup: 1 }));
    expect(seen(rows, 0, 1)).toEqual(new Set([3]));
    expect(seen(rows, 1, 2)).toEqual(new Set([0]));
    expect(seen(rows, 4, 5)).toEqual(new Set([3]));
    expect(seen(rows, 5, 6)).toEqual(new Set([0]));
  });

  it('in 5/8 (2.5 quarter beats a bar) beatInBar stays a whole beat and wraps on the bar line', async () => {
    const rows = await run(doc({ timeSignatures: [{ beat: 0, numerator: 5, denominator: 8 }] }));
    expect(rows.every((r) => r.bpb === 2.5 && Number.isInteger(r.bar))).toBe(true);
    expect(seen(rows, 2.5, 3)).toEqual(new Set([0]));
    expect(seen(rows, 2, 2.5)).toEqual(new Set([2]));
    expect(seen(rows, 5, 5.5)).toEqual(new Set([0]));
  });
});
