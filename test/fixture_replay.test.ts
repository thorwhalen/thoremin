/**
 * Disk-backed replay tests — the heart of the DAG-aware test strategy.
 *
 * Loads a recorded per-edge NDJSON fixture and replays it into a downstream
 * node, with NO source/feature recomputation (no camera, no GPU). Two roles:
 *  1. Demonstrates testing a stage purely from a recording of its input edge.
 *  2. Acts as a regression + staleness gate: if voice-mapping's logic changes,
 *     replaying recorded features no longer matches the recorded params, and
 *     this fails until the fixtures are re-recorded (`npm run record`).
 *
 * If you change a node and these fail intentionally, re-record the fixtures.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { valuesFromNDJSON, replayNode } from '@/dag';
import { voiceMappingNode, type HandFeatures, type SynthParams } from '@/nodes';
import { SCENARIOS } from '../scripts/scenarios';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadStream(scenario: string, key: string): unknown[] {
  const path = join(FIXTURES, scenario, `${key}.ndjson`);
  if (!existsSync(path)) throw new Error(`missing fixture ${path} — run \`npm run record\``);
  return valuesFromNDJSON(readFileSync(path, 'utf8'));
}

describe('fixture replay (sweep_right)', () => {
  const SC = 'sweep_right';
  const features = loadStream(SC, 'feat.features') as HandFeatures[];
  const recordedParams = loadStream(SC, 'map.params') as SynthParams[];

  it('fixtures are present and aligned in length', () => {
    expect(features.length).toBeGreaterThan(50);
    expect(recordedParams.length).toBe(features.length);
  });

  it('replaying the recorded features reproduces the recorded synth params', async () => {
    // Use the EXACT params the recorder used (shared scenario module → no drift).
    const mapParamsRaw = SCENARIOS[SC].graph.nodes.find((n) => n.id === 'map')!.params;
    const parsed = voiceMappingNode.params.parse(mapParamsRaw);

    const replayed = (await replayNode(voiceMappingNode.make(parsed), { features }, { dt: 1 / 30 })).map(
      (o) => o.params as SynthParams,
    );

    const freq = (p: SynthParams) => p.voices.map((v) => Math.round(v.freq * 1000) / 1000);
    expect(replayed.map(freq)).toEqual(recordedParams.map(freq));
  });

  it('right voice is present throughout the sweep and pitch is non-trivial', () => {
    expect(recordedParams.every((p) => p.voices[0].present)).toBe(true);
    const freqs = recordedParams.map((p) => p.voices[0].freq);
    expect(Math.max(...freqs)).toBeGreaterThan(Math.min(...freqs)); // pitch moved
  });
});
