# Testing strategy (DAG-aware record & replay)

The pipeline is multi-stage: `video → landmarks → features → mapping →
synth-params → audio`. Re-running from video is slow (camera + ML inference)
and non-deterministic. So we **tap every edge, persist what flows on it, and
test downstream stages by replaying the recording** — fast, deterministic, no
camera/GPU/audio. The mechanism (`StreamRecorder` tap, NDJSON, `replayNode`,
`runHeadless`) lives in `src/dag/` and works in plain Node.

## The four tiers (fastest/most-frequent first)

1. **Pure-function unit tests** (CI, every push, ms) — e.g. `magneticPitch`,
   scale generation, range maps. No fixtures. (`test/music_theory.test.ts`)
2. **Node-from-replay tests** (CI) — feed a recorded input stream into one node
   via `replayNode` and assert its output stream. e.g. `voice-mapping` from a
   recorded `hand-features` stream. (`test/hand_pipeline.test.ts`,
   `test/fixture_replay.test.ts`)
3. **Headless subgraph / graph tests** (CI) — wire a real graph (incl. the
   production app graph) and `runHeadless` / `tick` with synthetic or replayed
   sources; assert recorded edges. Catches wiring errors (bad ports, fan-in,
   cycles) with no browser. (`test/dag_core.test.ts`, `test/app_graph.test.ts`)
4. **End-to-end-from-video** (rare / manual / nightly) — decode a real gesture
   clip through `webcam-hands` in a browser. Non-deterministic; used to *produce*
   the durable landmark fixtures that tiers 2–3 then replay forever.

Tiers 1–3 are the CI gate: `npm test` (vitest, Node env, no camera/GPU/audio).

## On-disk fixture layout

```
test/fixtures/<scenario>/
  meta.json                  # provenance: scenario, source, graphSpecHash, ticks, fps, recordedKeys, recorderVersion
  <nodeId>.<port>.ndjson     # one per recorded edge, e.g. feat.features.ndjson, map.params.ndjson, src.hands.ndjson
  source.mp4                 # (optional) only for the rare end-to-end tier
```

Each NDJSON line is one `StreamRecord`: `{"tick":N,"t":seconds,"value":...}`.
`meta.json`'s `graphSpecHash` is the **staleness key**: if a node's params or
the upstream graph change, the hash mismatches and the fixture is flagged for
re-recording rather than letting a stale stream silently pass.

## Recording fixtures

```bash
npm run record            # record all scenarios (synthetic, deterministic)
npm run record sweep_right
```

`scripts/record_stream.ts` runs scenario graphs (defined in
`scripts/scenarios.ts`, shared with the tests so params never drift) headlessly
and writes per-edge NDJSON + `meta.json`. Synthetic scenarios are camera-free,
so committed fixtures are fully reproducible and diff-stable.

**From a real webcam video:** decoding video → landmarks needs a browser, so it
is a browser-side job — the live app can tap the `webcam-hands → hand-features`
edges and download the NDJSON, which then drops into the same `test/fixtures/`
layout and becomes a durable fixture. (Planned UI affordance; see ROADMAP M2/M4.)

## Replaying in tests

```ts
import { valuesFromNDJSON, replayNode } from '@/dag';
const features = valuesFromNDJSON(readFileSync('test/fixtures/sweep_right/feat.features.ndjson','utf8'));
const out = await replayNode(voiceMappingNode.make(params), { features });
```

Or drop a `replay-source` node loaded with a recorded stream in front of a
downstream subgraph and drive it with `runHeadless` to test multi-node segments
deterministically.

`test/fixture_replay.test.ts` doubles as a **regression gate**: replaying recorded
features must reproduce the recorded synth params; if `voice-mapping` logic
changes intentionally, re-record (`npm run record`) to update the baseline.
