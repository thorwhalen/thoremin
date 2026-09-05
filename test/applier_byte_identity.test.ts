/**
 * The byte-identity gate for `runHeadless` (#101 M-D).
 *
 * The Stream Applier design says the recorded goldens depend on `BatchClock` calling
 * `engine.tick()` **with no argument**, so the engine synthesizes `tickIndex * nominalDt`
 * rather than being handed a wall-clock time. Every fixture in `test/fixtures/` was
 * recorded through that path, and the replay assertions are calibrated against it.
 *
 * Until now that was an **unenforced promise**. This repo has no snapshot tests, no
 * `.snap` files, and nothing reads a fixture's `meta.json`, so a refactor could have
 * shifted the batch time base and every existing test would still have passed — they
 * assert *relations* between recorded values ("this freq is greater than that one"),
 * never the values themselves. A uniform time shift preserves every such relation.
 *
 * These digests were generated from `runHeadless` as it stood **before** the Applier
 * refactor in this PR. They are what make the refactor checkable rather than merely
 * plausible.
 *
 * If you are here because this failed: do not re-baseline to make it pass. Work out
 * whether the batch time base moved or the recorder's serialization changed — both are
 * breaking, and neither should happen quietly.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { runHeadless, type GraphSpec } from '@/dag';
import { createCoreRegistry } from '@/nodes';
import { loadStream } from './helpers/fixtures';

/** sha256 of each recorded stream, captured from the pre-Applier `runHeadless`. */
const GOLDEN: Record<string, string> = {
  'feat.features.ndjson': '02e5f35fdfc3369e95d5d8a2820e081be5d3cad780c5d23c4770719bc1158527',
  'map.params.ndjson': '4cc5a8d8e2a4bed20cc1b21e038dc09b3436c66632d799b7f7799d315fbd4329',
  'src.value.ndjson': '386274e074a0041b005ee3d7e75709323bdbcaf255c2b5c29804ca621a9b39ef',
};

function sweepSpec(): GraphSpec {
  const hands = loadStream('video_hand_sweep', 'src.hands');
  return {
    nodes: [
      { id: 'src', type: 'replay-source', params: { values: hands } },
      { id: 'feat', type: 'hand-features', params: {} },
      { id: 'map', type: 'voice-mapping', params: {} },
    ],
    edges: [
      { from: { node: 'src', port: 'value' }, to: { node: 'feat', port: 'hands' } },
      { from: { node: 'feat', port: 'features' }, to: { node: 'map', port: 'features' } },
    ],
  };
}

function digests(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, text] of Object.entries(files)) out[name] = createHash('sha256').update(text).digest('hex');
  return out;
}

describe('runHeadless is byte-identical to its pre-Applier self', () => {
  it('reproduces every recorded stream exactly, byte for byte', async () => {
    const { recorder } = await runHeadless(sweepSpec(), createCoreRegistry(), { ticks: 60, nominalDt: 1 / 30 });
    expect(digests(recorder.toFiles())).toEqual(GOLDEN);
  });

  it('pins the SYNTHESIZED time base — a wall-clock one would pass every other test', async () => {
    // The failure this gate exists for, demonstrated rather than asserted in prose.
    // `runEngineLoop` substitutes the wall clock when a clock passes no time
    // (src/app/engineLoop.ts: `const seconds = t ?? now()`) — correct for the live loop,
    // wrong for batch. Building the Applier on that path would shift every `t` uniformly:
    // the digests move, and nothing that compares recorded values to each other notices.
    const { recorder } = await runHeadless(sweepSpec(), createCoreRegistry(), { ticks: 60, nominalDt: 1 / 30 });
    const real = recorder.toFiles()['feat.features.ndjson'];
    const shifted = real.replace(/"t":(-?[0-9.e+-]+)/g, (_m, t: string) => `"t":${Number(t) + 1000}`);
    expect(shifted).not.toBe(real);
    expect(createHash('sha256').update(shifted).digest('hex')).not.toBe(GOLDEN['feat.features.ndjson']);
  });

  it('records exactly `ticks` samples — the contract callers rely on', async () => {
    const { recorder } = await runHeadless(sweepSpec(), createCoreRegistry(), { ticks: 60, nominalDt: 1 / 30 });
    expect(recorder.values('map.params')).toHaveLength(60);
  });
});
