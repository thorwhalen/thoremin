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

## The gate

```bash
npm run typecheck   # strict DAG typecheck (tsconfig.dag.json)
npm test            # vitest — 75+ test files
npm run build       # vite build (this is what verifies the React layer)
npm run catalog     # regenerate docs/CATALOG.md + public/manual.html + public/catalog.json
```

`npm run catalog` belongs in the gate because those three files are **generated from
the node registry** and must never be hand-edited: add or rename a node, or change a
port/param, and they go stale silently. Run it and commit the result.

## The test families

The suite grew from ~33 files to 75+ across the 2026-06/07 tracks. Roughly:

| Family | Files | Covers |
|--------|-------|--------|
| **Engine + nodes** | `dag_core`, `app_graph`, `slots`, `node_roles`, `clock`, `recorder`, `synth_merge`, `one_euro`, `pick`, `webcam_*` | The DAG itself, the production graph's wiring, roles/slots, pacing. |
| **Features + music** | `hand_*`, `face_*`, `head_pose`, `gesture_classifier`, `expression*`, `music_theory`, `music_logic`, `voicing`, `sounds`, `pose_chord` | The pure signal + tonal layers. |
| **Commands** (#87) | `commands_dispatch`, `commands_perdial`, `commands_instruments`, `commands_confirmation`, **`commands_firewall`**, `keyboard_shortcuts` | The registry, generation from the dials SSOT, the AI confirmation gate, and the **import firewall** that keeps commands out of the hot path. |
| **Feature Lab** (#119) | `feature_catalog`, `feature_formula`, `feature_normalizer`, `feature_vector_nodes`, `feature_lab_overlay`, `lab_views` | The catalog, the no-eval formula compiler (incl. its rejection cases), the online normalizer. |
| **Library** (#113–#115) | `library_model`, `library_store`, `library_summarize`, `library_systemtags`, `library_derive`, `library_emoji` | Tag identity invariants, both persistence shapes, the derived views. |
| **Recording** (#88) | `recording`, `recording_plan`, `recording_naming`, `recording_manifest`, `recording_schema`, `recording_caps`, `recording_feature_tap` | The pure half of the recorder (see below). |
| **Annotations** (#92) | `taglog_affordances`, `taglog_adapters`, `taglog_provider`, `taglog_presentation`, `tagging_store`, `tagging_export`, `tag_hud_overlay` | The extraction-ready `src/taglog/` core + the thoremin glue + the exporters. |
| **Assistant** (#87 P3) | `assistant_session`, `assistant_tools` | Tool exposure and the session/confirmation flow, against a mock model. |
| **Output** | `midi_out`, `overlay_elements`, `render_audio` | The MIDI sink, the overlay elements, the offline synth DSP. |
| **Fixtures** | `fixture_replay`, `video_fixtures`, `hand_pipeline` | The record/replay regression gates. |

### What is *not* covered headlessly

The browser capture paths (`MediaRecorder` wiring, sink I/O, the alpha canvas,
IndexedDB handle reuse), the live rAF/AudioContext effect in `useEngine`, and Web MIDI
device I/O need a real browser + camera. They are build-checked and structured with
feature detection + graceful fallback, but their end-to-end behaviour is verified by
hand. This is a known gap — the Applier's M-D milestone is explicitly gated on a
browser smoke test for exactly this reason.

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
`video_face_expressions` (blendshapes, for the `face-features` node). All
tracked at ~100% detection on the generated clips.

**Live capture, in the app.** Recording v2 (#88) ships the feature-JSONL stream: a
`FeatureJsonlTap` attached via `engine.addTap` writes `{tick,t,key,value}` per edge
into the take folder. So "record what is actually flowing, from a live session" is a
product feature now, not a testing wish — and its output is the same NDJSON shape the
fixtures use. See [design/recording-v2.md](design/recording-v2.md).

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

## Audible spot-check (offline render)

`scripts/render_audio.ts` turns any `SynthParams` stream into a WAV with a tiny
no-deps offline synth — so the audio output can be *heard* headlessly (no
browser):

```bash
vite-node scripts/render_audio.ts test/fixtures/video_hand_sweep/map.params.ndjson media/audio/sweep.wav
vite-node scripts/gen_chord_demo.ts media/chord_demo.params.ndjson   # I–IV–V–vi in C
vite-node scripts/render_audio.ts media/chord_demo.params.ndjson media/audio/chords.wav
```

`test/render_audio.test.ts` covers the DSP (non-silent tone, silence→silence,
chord louder than single voice). WAVs land in gitignored `media/audio/`.
