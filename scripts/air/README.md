# `scripts/air/` — the air-instruments footage pipeline

Air guitar, flute, bass and drums: learn what a player's hands, mouth and body do on the real instrument, from public video, so the same shapes can drive a synthesized one with no instrument in hand. The research map is [`docs/research/air-instruments.md`](../../docs/research/air-instruments.md).

## What is committed, what is not

This repository is **public**. The footage is standard-YouTube-licence material. So:

| committed | local only (`~/.local/share/thoremin/<kind>/air/<instrument>/`) |
|---|---|
| `sources/<instrument>.json` — the curated URL list (id, why, licence, chord vocabulary, fretting-hand pick) | `videos/` — the mp4 files and yt-dlp `.info.json` |
| the scripts and their tests (`test/air/`, on self-made synthetic hands only) | `landmarks/` — MediaPipe hand / pose / face NDJSON streams |
| the research doc with the held-out **numbers** | `labels/` — audio-derived chord segments |
| | `datasets/`, `models/`, `results/` — joined samples, trained weights, fold-by-fold evaluations |

Override the root with `THOREMIN_DATA_DIR`. Nothing under it is ever a fixture: the tests build their own hands (`test/air/synthetic_hand.ts`).

## The guitar chord-shape pipeline, end to end

```bash
# 1. Footage (yb / yt-dlp, 1080p cap). Skips what is present.
python3 scripts/air/fetch.py guitar

# 2. Hand landmarks with the decoder the fixtures already use (mediapipe lives in media/.venv).
THOREMIN_MEDIA_PYTHON=media/.venv/bin/python python3 scripts/air/extract.py guitar --streams hands

# 3. Chord labels from the AUDIO (librosa chroma templates + Viterbi, vocabulary per source).
python3 scripts/air/label_chords.py guitar          # --self-test runs it on synthetic chords

# 4. Join landmarks + labels -> samples (one FeatureVector + label + video id per frame).
npx vite-node scripts/air/build_chord_shape_dataset.ts

# 5. Train, evaluate leave-one-player-out, write the numbers and the model (all local).
npx vite-node scripts/air/train_chord_shape.ts

# 6. The enrolment experiment: seconds of the player's own footage vs everyone else's.
npx vite-node scripts/air/enrol_chord_shape.ts
```

Each step is idempotent and skips outputs that exist; `--only <id>` restricts any step to some sources.

## The result, in one sentence

On 31,000 labelled frames from three players, chord shapes are 96% separable within a player and 24% across players (a chord is not a shape: players finger G differently), while two seconds of a player's own footage per chord gives 90 to 98%; so the air guitar's chord vocabulary is enrolled per player through the trainer, and the numbers are in the research doc §6.3.

## Design in three sentences

The **featurizer is the existing hand catalog** (`src/features/hand_catalog.ts`): the chord model eats the per-finger joint angles, curls, spreads, thumb opposition, pinch distances and openness that the Lab and the trainer already compute, selected by their *declared invariance* (scale, position, yaw, pitch, roll), so a trained model can later run in the app as one more consumer of the `hand-feature-vector` node. The **labels come from the sound**: real-instrument footage is self-labelling (a strummed G is a G), air footage is not, which is why the model is learned on real playing and probed on air. The **held-out number is leave-one-player-out** (two channels contribute several videos each, so the unit is the player, not the video), because a per-frame random split lets adjacent frames leak and reports an accuracy no new player would see. The air-guitar probe is never labelled from its audio and never trained on; it is reported as what the model predicts, not as an accuracy.

## The other instruments

Same five steps, different label source and tracker. `label_pitch.py` (pyin, range per instrument) labels flute and bass; `label_onsets.py` labels drum hits; `extract.py --streams hands face` for flute, `hands` for bass, `pose hands` for drums (the pose says whose hand it is and normalises by the shoulders; the hands give the point the air drum tracks; `--file` adds a local clip such as a self-recorded take). Then:

```bash
npx vite-node scripts/air/build_pitch_dataset.ts flute      # both hands + embouchure blendshapes -> pitch class
npx vite-node scripts/air/build_pitch_dataset.ts bass       # fretting hand shape + neck position -> pitch class
npx vite-node scripts/air/train_air_model.ts flute pitch_class
npx vite-node scripts/air/train_air_model.ts bass pitch_class
npx vite-node scripts/air/eval_drum_strokes.ts --file <stem of a local clip>   # strokes vs audio onsets per tracked point, drums by clustering
npx vite-node scripts/air/eval_drum_anchors.ts    # which point to track, on the an.impacts stick clips (exact truth)
```

Results per instrument are in the research doc §6.3 (guitar) and §7 (bass, flute, drums).

## The embouchure onset (flute, #248)

Does the mouth signal a note before the sound does? Three more steps on the flute sources, all local:

```bash
python3 scripts/air/extract_mouth.py flute            # blendshapes + lip/reference landmarks, streamed (.mouth.ndjson.gz)
python3 scripts/air/label_note_onsets.py flute        # each note's onset refined to 2.9 ms from the pitch-band power (--self-test)
npx vite-node scripts/air/eval_embouchure_onset.ts    # profile + causal detector, per source / player / pooled -> results/air/flute/embouchure_onset.*
```

The face stream `video_to_face.py` writes carries blendshapes only; `extract_mouth.py` runs the same landmarker and adds the lip contours and a few reference points (eyes, nose, chin), written one frame per line so a 36,000-frame lesson does not have to fit in memory. `label_note_onsets.py` starts from `label_pitch.py`'s segments (23 ms hops, late by a few hops) and reads, for each note, the power in a quarter-tone band around *its* fundamental at a 2.9 ms hop; the onset is the 50 % crossing between the silence's floor and the note's plateau, which sits on a step onset under the symmetric analysis window (the self-test lands inside a 10 ms attack). Onsets are tagged with the silence before them (`rest`, a phrase from nothing; `breath`; `short`, inside a phrase) or as a note `change` under one breath, because the mouth's job differs by case. `lib_embouchure_onset.ts` then reads each mouth signal (twenty embouchure blendshapes; the inner-lip aperture, lip width, lip height, jaw drop and lip protrusion from the mesh, normalised by the inter-ocular distance) two ways: the oracle *profile* (around each known onset: did it move, and when did it cross 10 / 50 / 90 % of its rest-to-play change) and the causal *detector* (departure from a resting baseline, or speed of change, in noise units; emits `packages/ictus/src` `Anchor`s; scored one-to-one inside an asymmetric window for hit / miss / false-alarm rates and the lead distribution). The numbers and the recommendation are in the research doc §7.2.

## Modules

| file | role |
|---|---|
| `lib_air_paths.ts` | the app-data layout, and the `THOREMIN_DATA_DIR` override |
| `lib_sources.ts` | Zod schema of a source list; rejects local paths and unknown chord names |
| `lib_chord_shape_features.ts` | fretting-hand pick + catalog-backed featurizer |
| `lib_chord_shape_dataset.ts` | the landmark ↔ label join behind two seams, `featurize` (frame → vector) and `labelOf` (time → label); margin around chord changes, no-chord spans dropped; an unlabelled probe join |
| `lib_chord_shape_model.ts` | softmax regression (Adam, L2, class-balanced), the trainer's nearest-centroid baseline, metrics, leave-one-group-out, gap-aware vote smoothing, the enrolment split |
| `lib_air_train.ts` | the held-out harness every instrument's CLI runs (three numbers + probe report + markdown) |
| `lib_wind_string_features.ts` | flute (both hands + embouchure) and bass (shape + neck position) featurizers on a frame bundle |
| `lib_drum_strokes.ts` | wrist tracks from the pose stream, hand-point tracks (a hands stream joined to the pose by tick), frame-level stroke detection in noise units, k-means drum assignment |
| `lib_synthetic_grip.ts` | a synthetic hand gripping an `an.impacts` stick (wrist stroke plus a chosen arm share, seeded landmark noise) |
| `label_pitch.py`, `label_onsets.py`, `label_note_onsets.py` | audio → note segments (pyin); audio → hit onsets; note segments → onsets at 2.9 ms from the pitch band; all with `--self-test` |
| `label_chords.py` | audio → chord segments; `--self-test` recovers a synthetic progression |
| `fetch.py`, `extract.py`, `extract_mouth.py` | download; run `video_to_landmarks.py` / `video_to_pose.py` / `video_to_face.py` per source; the streamed mouth stream (blendshapes + lip landmarks) |
| `lib_embouchure_onset.ts`, `eval_embouchure_onset.ts` | mouth signals (blendshapes + lip geometry), the oracle onset profile, the causal embouchure detector (ictus anchors), one-to-one matching and lead statistics; the flute CLI that scores them |
| `build_chord_shape_dataset.ts`, `train_chord_shape.ts`, `enrol_chord_shape.ts` | the guitar CLIs: join, held-out training, enrolment budget |
| `build_pitch_dataset.ts`, `train_air_model.ts`, `eval_drum_strokes.ts`, `eval_drum_anchors.ts` | flute/bass join, the generic held-out trainer, the drum stroke evaluation on footage, the tracked-point comparison on synthetic strokes |

## Adding a source

Append to `sources/guitar.json`: the 11-character id, title, channel, `player` (the held-out unit; two videos of one player share it), one sentence on why, `license` as yt-dlp reports it (`null` = standard licence), the chords the labeller may emit, and how to pick the fretting hand (`{"by":"x","side":"max"}` for a right-handed player facing the camera; `"min"` for a left-handed one; `{"by":"handedness","label":...}` when the label is reliable, remembering that MediaPipe's "Left" on unmirrored video is the physical right hand). `windows` (seconds) trims a long lesson to its drill; `holdout: true` marks a probe that is never labelled and never trained on. `npm test` validates the file. Other instruments get their own `<instrument>.json`; the schema (`lib_sources.ts`) is a discriminated union on the instrument, so their label-specific fields are added there.
