/**
 * `replay-source-timed` (#215) — replay by timestamp, and the guarantee that the
 * index-by-tick `replay-source` did not move.
 *
 * The load-bearing requirements, each pinned here against the real 24 fps video fixture
 * (`video_hand_sweep`, whose `t` values are rounded to 6 decimals as the recorder writes
 * them):
 *
 * - `replay-source` is byte-identical to what it was before this node existed.
 * - Timed replay resamples with **hold-last**, never interpolating.
 * - It honours `Clock.timeScale`: at 2x through a real `Applier` + `RealtimeClock` the
 *   take plays twice as fast in wall time — and not four times, which is what applying
 *   the scale on top of the already-scaled engine time would give.
 * - At the recording's own rate it agrees with index replay exactly, looping included.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { Applier, Engine, RealtimeClock, runHeadless, type GraphSpec, type StreamRecord } from '@/dag';
import { createCoreRegistry, replaySourceTimedNode } from '@/nodes';
import { loadRecords, loadStream } from './helpers/fixtures';

const SC = 'video_hand_sweep';
const KEY = 'src.hands';
/** The fixture was decoded from a 24 fps clip. */
const REC_DT = 1 / 24;

const one = (type: string, params: unknown): GraphSpec => ({ nodes: [{ id: 'src', type, params }], edges: [] });

async function batch(type: string, params: unknown, ticks: number, nominalDt: number): Promise<unknown[]> {
  const { recorder } = await runHeadless(one(type, params), createCoreRegistry(), { ticks, nominalDt });
  return recorder.values('src.value');
}

/** Which recorded frame (by index) each emitted value is — by identity-free JSON match. */
function frameIndices(emitted: unknown[], records: StreamRecord[]): number[] {
  const index = new Map(records.map((r, i) => [JSON.stringify(r.value), i]));
  return emitted.map((v) => {
    const i = index.get(JSON.stringify(v));
    if (i === undefined) throw new Error('emitted a value that is not in the recording (interpolated?)');
    return i;
  });
}

describe('replay-source (index-by-tick) is unchanged', () => {
  // Captured from `replay-source` on main BEFORE this node was added (and re-checked
  // against the pristine tree while building it). Do not re-baseline: if these move,
  // every committed fixture's replay semantics moved with them.
  const GOLDEN = {
    once: '61b8cef0f82cb342b5618f939f359435ebb38de859ce61a110110f890d3817c1',
    loop: '305c7214ddf5a7e28bd8139ffb3ed53e39655e1cad2acbc3a417e5709f3278c7',
  };

  it.each([
    ['once', false],
    ['loop', true],
  ] as const)('reproduces its pre-#215 recorded stream byte for byte (%s)', async (name, loop) => {
    const values = loadStream(SC, KEY);
    const { recorder } = await runHeadless(one('replay-source', { values, loop }), createCoreRegistry(), {
      ticks: 300,
      nominalDt: 1 / 60,
    });
    const text = recorder.toFiles()['src.value.ndjson'];
    expect(createHash('sha256').update(text).digest('hex')).toBe(GOLDEN[name]);
  });

  it('still ignores time: one value per tick whatever the tick rate', async () => {
    const values = loadStream(SC, KEY);
    const at60 = await batch('replay-source', { values }, 10, 1 / 60);
    const at5 = await batch('replay-source', { values }, 10, 1 / 5);
    expect(at60).toEqual(values.slice(0, 10));
    expect(at5).toEqual(values.slice(0, 10));
  });
});

describe('replay-source-timed: resampling by timestamp', () => {
  const records = loadRecords(SC, KEY);

  it('the fixture is what these tests assume (24 fps, rounded t)', () => {
    expect(records.length).toBe(121);
    expect(records[1].t).toBe(0.041667); // rounded, and a hair AFTER 1/24
    expect(records[1].t).toBeGreaterThan(REC_DT);
  });

  it('at the recording rate it agrees with index replay exactly (the tolerance absorbs t rounding)', async () => {
    const timed = await batch('replay-source-timed', { records }, records.length, REC_DT);
    const indexed = await batch('replay-source', { values: records.map((r) => r.value) }, records.length, REC_DT);
    expect(timed).toEqual(indexed);
  });

  it('without the tolerance the rounded fixture would DROP a frame — why the default is not 0', async () => {
    // Frame 1's t rounds UP past tick 1, frame 2's rounds DOWN under tick 2: a strict
    // comparison never shows frame 1 at all.
    const strict = await batch('replay-source-timed', { records, toleranceSec: 0 }, 3, REC_DT);
    expect(frameIndices(strict, records)).toEqual([0, 0, 2]);
  });

  it('upsampling (60 fps engine) HOLDS each frame — every tick shows the last frame due, nothing invented', async () => {
    const dt = 1 / 60;
    const ticks = 301; // 0 .. 5.0 s
    const out = await batch('replay-source-timed', { records }, ticks, dt);
    const got = frameIndices(out, records);
    const expected = Array.from({ length: ticks }, (_, k) => {
      const time = k * dt;
      let i = 0;
      while (i + 1 < records.length && records[i + 1].t <= time + 1e-6) i++;
      return i;
    });
    expect(got).toEqual(expected);
    // Monotone, each frame shown for 2 or 3 ticks, and the take ends on its last frame.
    expect(got.every((v, k) => k === 0 || v >= got[k - 1])).toBe(true);
    expect(new Set(got).size).toBe(records.length);
    expect(got[ticks - 1]).toBe(records.length - 1);
  });

  it('downsampling (12 fps engine) skips frames rather than slowing the take down', async () => {
    const out = await batch('replay-source-timed', { records }, 61, 1 / 12);
    expect(frameIndices(out, records)).toEqual(Array.from({ length: 61 }, (_, k) => 2 * k));
  });

  it('holds a NOMINAL stream as-is — the case interpolation would get wrong', async () => {
    const chords: StreamRecord[] = [
      { tick: 0, t: 0, value: 'C' },
      { tick: 1, t: 0.1, value: 'F' },
      { tick: 2, t: 0.25, value: 'G' },
    ];
    expect(await batch('replay-source-timed', { records: chords }, 8, 0.05)).toEqual(['C', 'C', 'F', 'F', 'F', 'G', 'G', 'G']);
  });

  it('loops seamlessly: at the recording rate the loop matches index replay\'s loop', async () => {
    const timed = await batch('replay-source-timed', { records, loop: true }, 300, REC_DT);
    const indexed = await batch('replay-source', { values: records.map((r) => r.value), loop: true }, 300, REC_DT);
    expect(timed).toEqual(indexed);
  });

  it('holds the last value after the take ends when not looping', async () => {
    const out = await batch('replay-source-timed', { records }, 20, 1);
    expect(frameIndices(out, records)).toEqual([0, 24, 48, 72, 96, 120, ...Array(14).fill(120)]);
  });

  it('anchors on its own first tick: a replay swapped into a RUNNING graph opens on record 0', async () => {
    const reg = createCoreRegistry();
    const small: StreamRecord[] = [
      { tick: 0, t: 10, value: 'a' },
      { tick: 1, t: 10.5, value: 'b' },
      { tick: 2, t: 11, value: 'c' },
    ];
    const engine = new Engine(one('replay-source', { values: ['x'] }), reg, { nominalDt: 0.25 });
    await engine.init();
    for (let i = 0; i < 40; i++) engine.tick(); // engine time is now ~10 s
    await engine.applyGraph(one('replay-source-timed', { records: small }), reg);
    const seen: unknown[] = [];
    for (let i = 0; i < 6; i++) {
      engine.tick();
      seen.push(engine.getOutput('src', 'value'));
    }
    expect(seen).toEqual(['a', 'a', 'b', 'b', 'c', 'c']);
  });

  it('emits nothing for an empty recording, and rejects out-of-order timestamps at build time', async () => {
    expect(await batch('replay-source-timed', {}, 3, 1 / 60)).toEqual([]);
    expect(() =>
      replaySourceTimedNode.params.parse({ records: [{ t: 1, value: 0 }, { t: 0.5, value: 1 }] }),
    ).toThrow(/non-decreasing/);
  });
});

describe('replay-source-timed honours Clock.timeScale (through a real Applier)', () => {
  const records = loadRecords(SC, KEY);

  /** Run the node under a RealtimeClock whose wall clock advances one recorded frame
   *  (1/24 s) per scheduled frame, starting at an arbitrary wall time. */
  async function paced(speed: number, frames: number): Promise<number[]> {
    const reg = createCoreRegistry();
    const engine = new Engine(one('replay-source-timed', { records }), reg);
    await engine.init();
    let wall = 5000; // live engine time starts at a wall value, not 0
    const clock = new RealtimeClock({
      speed,
      now: () => wall,
      schedule: (cb) =>
        void setTimeout(() => {
          cb();
          wall += REC_DT;
        }, 0),
    });
    const seen: unknown[] = [];
    const applier = new Applier({
      engine,
      clock,
      sinks: [() => void seen.push(engine.getOutput('src', 'value'))],
      shouldStop: () => seen.length >= frames,
    });
    await applier.run();
    applier.dispose();
    return frameIndices(seen, records);
  }

  it('at 1x the take plays at its own pace in wall time', async () => {
    const got = await paced(1, 20);
    expect(got).toEqual(Array.from({ length: 20 }, (_, k) => k));
  });

  it('at 2x it plays twice as fast — the scale is applied ONCE (via ctx.time), not twice', async () => {
    const got = await paced(2, 20);
    expect(got).toEqual(Array.from({ length: 20 }, (_, k) => 2 * k));
  });

  it('at 0.5x it plays at half speed (frames held two wall frames each)', async () => {
    const got = await paced(0.5, 20);
    expect(got).toEqual(Array.from({ length: 20 }, (_, k) => Math.floor(k / 2)));
  });
});
