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

**From video (headless toolchain).** Real (or AI-generated) video is decoded
into fixtures entirely headlessly with the MediaPipe Tasks models (same family as
the JS `@mediapipe/tasks-vision`), run from an isolated venv so the shared pyenv
env is never perturbed:

```bash
python3 -m venv media/.venv && media/.venv/bin/pip install mediapipe opencv-python

# 1. (optional) generate targeted clips via falaw — needs FAL_KEY
python scripts/gen_test_videos.py hand_sweep hand_open_close hand_pinch face_expressions

# 2. video → hand landmarks (HandsFrame NDJSON)
media/.venv/bin/python scripts/video_to_landmarks.py media/videos/hand_sweep.mp4 /tmp/hand_sweep.hands.ndjson

# 3. landmarks → committed fixture (src.hands + feat.features + map.params + meta.json)
vite-node scripts/build_video_fixture.ts video_hand_sweep /tmp/hand_sweep.hands.ndjson

# faces (M4 prep): video → 52 blendshapes
media/.venv/bin/python scripts/video_to_face.py media/videos/face_expressions.mp4 \
  test/fixtures/video_face_expressions/face.blendshapes.ndjson
```

Raw `.mp4`s stay gitignored under `media/`; only the derived NDJSON is committed
(`test/fixtures/video_*/`) and replayed by `test/video_fixtures.test.ts` — no
camera/GPU in CI. Current committed video fixtures: `video_hand_sweep`,
`video_hand_open_close`, `video_hand_pinch` (full hand pipeline) and
`video_face_expressions` (blendshapes, for the M4 `face-features` node). All
tracked at ~100% detection on the generated clips. A live in-app "record this
edge → download NDJSON" affordance is still a nice-to-have (ROADMAP).

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
