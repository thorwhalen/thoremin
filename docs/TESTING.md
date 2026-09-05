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
npm test            # vitest — 108 test files, 1384 tests
npm run build       # vite build (this is what verifies the React layer)
npm run catalog     # regenerate docs/CATALOG.md + public/manual.html + public/catalog.json
```

`npm run catalog` belongs in the gate because those three files are **generated from
the node registry** and must never be hand-edited: add or rename a node, or change a
port/param, and they go stale silently. Run it and commit the result.

### What is enforced, and where

Be precise about this, because for a long time this document was not: the sentence
above ("Tiers 1–3 are the CI gate") was an *aspiration* committed as documentation.
Until `.github/workflows/ci.yml` was added, `.github/workflows/` contained exactly one
workflow — `deploy.yml` — and no test workflow had ever existed in this repo's history.
The three commands were local conventions, enforced by whoever remembered to run them,
while main auto-deployed to production.

| Command | Enforced by CI? | Where |
|---|---|---|
| `npm run typecheck` | **yes** | `.github/workflows/ci.yml`, on every pull request and every push to main |
| `npm test` | **yes** | same |
| `npm run build` | **yes** | same |
| `npm run catalog` | **no** — still yours to run | run it locally after adding/renaming a node or changing a port/param, and commit the result |
| `npm run lint` | **no**, deliberately | `tsc --noEmit` over the *whole* tree, including the React layer the repo ships no `@types/react` for. It is red (19 errors as of 2026-08-17) and has been for a long time. Adding a known-red check would train everyone to ignore the X, which is worse than not having it. `npm run typecheck` (strict, `tsconfig.dag.json`) plus `npm run build` (which is what actually verifies the React layer) is the honest pair. |

The CI job is *advisory to the deploy*, not a precondition for it: `deploy.yml` still
fires on its own push trigger and does not `needs:` the gate. So a red X and a live
deploy can coexist on the same commit. Wiring the deploy behind the gate is a change to
the deploy path and a separate decision; what exists today is the signal — a visible
verdict on the PR, before merge.

## The test families

The suite grew from ~33 files to 108 across the 2026-06 → 2026-09 tracks. Roughly:

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
A large stream may be committed gzipped (`<key>.ndjson.gz`); `loadStream` in
`test/helpers/fixtures.ts` decompresses transparently, so tests always address a
stream by its logical key and never see the envelope.

> **`meta.json` is written, never read.** This section used to claim
> `graphSpecHash` was "the staleness key… the fixture is flagged for re-recording
> rather than letting a stale stream silently pass". **Nothing enforces that.**
> Three scripts emit `meta.json` (`record_stream.ts`, `build_video_fixture.ts` and the
> trainer-take converter) and no code in `test/` or `src/` opens it — and the
> two face fixtures ship without one at all. Treat it as provenance for a human
> reading the directory, which is genuinely useful, and not as a guard. Making it
> a real staleness key would mean a test that loads it and compares, which does
> not exist.

## Fixtures from a trainer take

A recorded training take is the cheapest ground truth this repo can produce, because
the cue states what the player was *asked* to do in their own words. That is the frame
of reference a video clip cannot supply: `test/fixtures/video_head_pose/README.md`
records why yaw and roll stayed open after #161 — nothing in a file says whether the
recording was mirrored, so "the person turned to *their* left" is unrecoverable from
the pixels.

```bash
# unzip the take first: a 'downloads' take is a .zip
npx vite-node scripts/trainer_take_to_fixture.ts -- <take-dir> <scenario> [--dry-run]
```

It resolves the cue intervals through taglog's own `resolveIntervals` (the same one the
Audacity/WebVTT/CSV exporters use, so the boundaries agree), keeps only the records
inside a cue, and writes `test/fixtures/<scenario>/` with the per-edge streams, a
`cues.json` index, `meta.json` and a generated `README.md`.

Two behaviours worth knowing:

- **No image-space geometry reaches a fixture**, by two mechanisms, because they are two
  different problems:
  - A face mesh or hand keypoint **array** makes it reject the take outright rather than
    trim it — a converter that silently drops a field is one nobody checks.
    `trainerTakeSession` also pins `featureEdges` so neither reaches the take: before that
    pin the field was always empty, and **empty means every edge**, so takes were
    recording `camFace.face` and its full 478-point mesh.
  - Individual landmark **coordinates flattened into the vector as scalars** are invisible
    to any check on a container's shape, so they are stripped by feature id and the removal
    is **reported** in `meta.json` and the generated README. `face.head.x`/`face.head.y`
    are the nose tip's normalized coordinates — over a take, a nose trajectory.

  Stripping costs nothing: `FACE_OMIT` (`src/app/enroll/starterCues.ts`) is the trainer's
  own declaration that the learner does not use those features. They are recorded only
  because `routineGroups` unions a routine's demanded groups without applying each cue's
  `omit`, so the engine computes a superset of what the learner consumes.

- **It refuses to overwrite an existing fixture** without `--force`. Every committed
  fixture name matches the scenario regex, so `video_head_pose` is a reachable typo — and
  its ground-truth table was established by reading traces against video frames, so it is
  not regenerable.
- **A cue the take stopped during extends to the end of the recording**, not to a point.
  `resolveIntervals` returns `end === start` for an unclosed open unless told when
  recording stopped; taking that literally would discard every sample of the one cue an
  abandoned take still has.

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

# faces: video → 52 blendshapes + (via --landmarks-out) the full FaceFrame stream —
# all 478 mesh landmarks (x/y/z, irises included) and the facial transformation
# matrix (column-major, decoded to head pose in TS by `matrixToHeadPose`). The
# .gz suffix gzips the large mesh stream deterministically; `loadStream`
# decompresses it transparently.
media/.venv/bin/python scripts/video_to_face.py media/videos/face_expressions.mp4 \
  test/fixtures/video_face_expressions/face.blendshapes.ndjson \
  --landmarks-out test/fixtures/video_face_expressions/face.landmarks.ndjson.gz
```

Raw `.mp4`s stay gitignored under `media/`; only the derived NDJSON is committed
(`test/fixtures/video_*/`) and replayed by `test/video_fixtures.test.ts` — no
camera/GPU in CI. Current committed video fixtures: `video_hand_sweep`,
`video_hand_open_close`, `video_hand_pinch` (full hand pipeline) and
`video_face_expressions` (blendshapes for the `face-features` node, plus the
gzipped `face.landmarks` mesh stream replay-testing the `face.geom.*` /
`face.gaze.*` / `face.head.*` catalog groups through `face-feature-vector`).
All tracked at ~100% detection on the generated clips.

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
