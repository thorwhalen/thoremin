# scripts/asl — the ASL training pipeline

Trains the two models `@thoremin/asl` ships (`packages/asl/models/static.json`, `motion.json`) from public corpora, and writes the test fixtures that pin the TS featurisation to this code. The numbers and the reasoning behind every choice are in [`docs/research/asl-recognition.md`](../../docs/research/asl-recognition.md).

Data stays out of the repo, under the app-data dir (`~/.local/share/thoremin/asl/`). Python because extraction needs MediaPipe's Python tasks API; `pip install -r requirements.txt` in a venv (mediapipe 0.10.21 runs headless; 1.x needs GL).

```bash
A=~/.local/share/thoremin/asl
# 1. Aslense (HF, MIT): index the repo, fetch the original clips (skip the _aug_ copies)
python index_aslense.py $A/raw/aslense_index.tsv                    # also needs raw/aslense.csv from the repo root
SKIP_AUG=1 python fetch_aslense.py $A/raw $A/videos a,b,...,z,yes,no,hello,thankyou,please,sorry,bye
# 2. Hand landmarks with the browser's own model (hand_landmarker.task, float16), ~12 fps
SKIP_AUG=1 python extract_landmarks.py $A/videos $A/landmarks $A/models/hand_landmarker.task 12
# 3. The cross-source test set (Marxulia v03 photos): 60 per letter
python extract_images.py $A/raw/marxulia_v03.parquet $A/marxulia_lm.jsonl $A/models/hand_landmarker.task 60
# 4. ASLNow! (HF, MIT): huggingface_hub snapshot_download('sid220/asl-now-fingerspelling') into $A/raw/aslnow
# 5. Letters: compare, then export (geo features, logistic C=0.1, Aslense + ASLNow!)
python train_static2.py $A/landmarks $A/raw/aslnow $A/marxulia_lm.jsonl --kinds geo --models logreg_c0.1 \
  --export ../../packages/asl/models/static.json --export-kind geo --export-model logreg_c0.1
# 6. Movement signs (on top of the exported letter model)
python train_motion.py $A/landmarks ../../packages/asl/models/static.json --none-per-clip 40 --thresh 0.9 \
  --export ../../packages/asl/models/motion.json
# 7. Fixtures the TS tests read
python make_parity_fixture.py $A/landmarks ../../packages/asl/models/static.json ../../packages/asl/models/motion.json ../../test/fixtures/asl/parity.json
python make_replay_fixture.py $A/landmarks ../../test/fixtures/asl/clips.json b:0 l:0 y:0 yes:0 please:0 thankyou:0
```

| File | Does |
|---|---|
| `asl_common.py` | The letter featurisers (`geo` is shipped; `world`, `image`, `both` for comparison). Mirrors `packages/asl/src/features.ts`. |
| `motion_common.py` | The motion-window featuriser. Mirrors `packages/asl/src/motion.ts`. |
| `handedness.py` | Geometry → MediaPipe handedness, for ASLNow! (which has none). |
| `train_static.py`, `eval_cross.py` | The first comparison (world / image / both, Aslense only). |
| `train_static2.py`, `diag_static2.py` | The second (geo, plus ASLNow!), the export, and the per-letter breakdown. |
| `train_motion.py` | The motion model: grouped CV, the threshold sweep, the export. |

After re-exporting a model, re-run step 7 and `npx vitest run test/asl/`: the parity test fails when the two featurisers drift apart.
