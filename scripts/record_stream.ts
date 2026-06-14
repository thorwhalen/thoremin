/**
 * Fixture recorder (run with `npm run record` → vite-node).
 *
 * Runs canonical scenario graphs headlessly and persists every edge as NDJSON
 * under tests/fixtures/<scenario>/, plus a meta.json carrying provenance (graph
 * hash, tick count, fps) for staleness detection. These committed fixtures let
 * downstream nodes be tested deterministically with no camera/GPU — the core of
 * the DAG-aware test strategy.
 *
 * Scenarios here are camera-free (synthetic-hands), so fixtures are fully
 * reproducible and diff-stable. Recording from a real webcam video is a
 * browser-side job (the live app can tap + download the landmark stream); that
 * derived NDJSON then drops into the same layout. See docs/TESTING.md.
 *
 * Usage:
 *   npm run record            # record all scenarios
 *   npm run record sweep_right
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { runHeadless, type GraphSpec } from '@/dag';
import { createCoreRegistry } from '@/nodes';
import { SCENARIOS, type Scenario } from './scenarios';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(HERE, '..', 'test', 'fixtures');
const RECORDER_VERSION = 1;

function hashGraph(g: GraphSpec): string {
  return createHash('sha256').update(JSON.stringify(g)).digest('hex').slice(0, 12);
}

async function record(name: string, scenario: Scenario): Promise<void> {
  const dir = join(FIXTURES_DIR, name);
  mkdirSync(dir, { recursive: true });
  const { recorder } = await runHeadless(scenario.graph, createCoreRegistry(), {
    ticks: scenario.ticks,
    nominalDt: 1 / scenario.fps,
  });

  const files = recorder.toFiles();
  for (const [filename, ndjson] of Object.entries(files)) {
    writeFileSync(join(dir, filename), ndjson);
  }
  const meta = {
    scenario: name,
    source: 'synthetic',
    graphSpecHash: hashGraph(scenario.graph),
    ticks: scenario.ticks,
    fps: scenario.fps,
    recordedKeys: recorder.keys().sort(),
    recorderVersion: RECORDER_VERSION,
  };
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  console.log(`recorded ${name}: ${recorder.keys().length} edges, ${scenario.ticks} ticks -> ${dir}`);
}

async function main(): Promise<void> {
  const which = process.argv[2];
  const names = which ? [which] : Object.keys(SCENARIOS);
  for (const name of names) {
    const scenario = SCENARIOS[name];
    if (!scenario) {
      console.error(`unknown scenario "${name}". Available: ${Object.keys(SCENARIOS).join(', ')}`);
      process.exit(1);
    }
    await record(name, scenario);
  }
}

void main();
