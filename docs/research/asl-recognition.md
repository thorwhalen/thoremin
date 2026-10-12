# ASL recognition in the browser: what was tried, what ships, how good it is

Date: 2026-10-12. Code: `packages/asl` (the recogniser), `packages/ext-asl` (the thoremin extension), `scripts/asl` (the training pipeline). Raw data lives in `~/.local/share/thoremin/asl/` and never in the repo.

## The question

Recognise the ASL fingerspelled alphabet and a few common signs (yes, no, hello, thank you, please, sorry, bye) live, in the browser, next to the MediaPipe hand model thoremin already runs, with a score per class every frame.

## Prior work found

The only earlier note is a general survey in the maintainer's notes (gesture taxonomies; Sign Language MNIST). Nothing ASL-specific existed in thoremin's issues, discussions or docs, and no fleet package does sign recognition.

## Candidates surveyed

| Candidate | Verdict |
|---|---|
| **MediaPipe hand landmarks + a small classifier** (the landmarks thoremin already computes) | **Chosen.** No second vision model, about 0.1 ms a frame for letters, and the classifier is a few kB of JSON. |
| Image classifiers on Hugging Face (ResNet-101, CLIP-vision and YOLO fingerspelling models) | Not adopted, and not benchmarked here. They are a second full-frame CNN per frame beside MediaPipe (tens to hundreds of MB), and trained on single-background photo sets. |
| Siruyy/asl-static-landmarks-v1 (HF) | Not reusable: "86 engineered features" with no code to reproduce them. |
| Sign Language MNIST | Not usable: 28×28 grayscale crops, too small for a hand detector. |
| Kaggle: Google ASL Fingerspelling (2023) and Isolated Sign Language Recognition (2023; 250 signs including yes, no, hello, thankyou, please, bye) | The best route to better motion signs: large MediaPipe-holistic landmark corpora, many signers. Not used yet: they need Kaggle credentials (none on the server) and tens of GB. |
| MediaPipe GestureRecognizer with a custom Model Maker head | The same idea as the chosen route, but it adds a second tasks-vision model. thoremin's HandLandmarker already yields the landmarks. |

## Data

| Corpus | What | Used for |
|---|---|---|
| **Aslense** (HF `ZahidYasinMittha/American-Sign-Language-Dataset`, MIT) | Videos: ~50 per letter (about 12 originals, the rest augmented copies) and 31 to 57 per word | Letters (originals only, landmarks extracted at ~12 fps), the motion signs, grouped CV by source clip |
| **ASLNow!** (HF `sid220/asl-now-fingerspelling`, MIT) | 2,100 MediaPipe-web landmark snapshots from several participants, letters A to Z | Extra letter training data. It has no handedness, which is inferred from geometry by a classifier trained on Aslense (95% grouped CV). |
| **Marxulia v03** (HF `Marxulia/asl_sign_languages_alphabets_v03`) | 10.9K hand photos, A to Z, other signers and cameras | **Cross-source test only**, never trained on: it has no stated licence (60 per letter sampled; a hand found in 1,186 of 1,560). |

YouTube clips were planned as a third test set, but YouTube refuses this server's IP ("confirm you're not a bot") for every yt-dlp client. Downloads there need a cookies file exported once from a signed-in browser.

## Letters: the comparison

Protocol: 24 static letters. 5-fold cross-validation **grouped by source clip** on Aslense, so no clip is in both train and test; "clip" is the majority vote over a clip's held frames. When ASLNow! is used it is in every training fold. "Marxulia" is a model trained on everything else, tested on the photos.

| Features | Extra data | Model | Aslense frame | Aslense clip | Marxulia top-1 | Marxulia top-3 |
|---|---|---|---|---|---|---|
| world landmarks (63) | none | kNN | 0.547 | 0.630 | – | – |
| world landmarks (63) | none | logistic | 0.610 | 0.687 | – | – |
| world landmarks (63) | none | MLP 128-64 | 0.584 | 0.679 | – | – |
| image landmarks (63) | none | logistic | 0.628 | 0.712 | – | – |
| image landmarks (63) | ASLNow! | logistic | 0.634 | 0.749 | 0.427 | 0.590 |
| geo (66) | none | logistic | 0.616 | 0.704 | 0.469 | 0.712 |
| geo (66) | none | kNN | 0.641 | 0.716 | 0.576 | 0.649 |
| geo + image (129) | ASLNow! | logistic | 0.652 | 0.761 | 0.502 | 0.687 |
| geo (66) | ASLNow! | kNN | 0.672 | 0.770 | 0.643 | 0.777 |
| geo (66) | ASLNow! | MLP 96 | 0.639 | 0.749 | 0.555 | 0.746 |
| geo (66) | ASLNow! | MLP 64, strong L2 | 0.657 | 0.770 | 0.627 | 0.825 |
| **geo (66)** | **ASLNow!** | **logistic, C = 0.1** | **0.666** | **0.786** | **0.625** | **0.826** |

**Shipped:** geo features with logistic regression (C = 0.1), trained on the two MIT corpora (Aslense and ASLNow!). Marxulia stays a test set, so the last two columns measure exactly the shipped recipe. It is a 66 × 24 linear softmax, about 34 kB of JSON.

The `geo` features are 66 numbers: finger flexion (cosine at each joint), finger spreads, fingertip distances, thumb-to-knuckle distances, and the hand's orientation to the camera. Raw coordinates overfit the corpus they came from (Marxulia 0.25 to 0.43); geometric features carry across. The extra signers of ASLNow! add about 8 points.

Per letter (grouped CV, clip vote): A 12/12, B 10/10, C 9/9, D 11/13, E 12/13, F 8/8, G 6/8, H 11/13, I 8/10, K 12/13, L 9/11, M 7/10, N 5/12, O 7/9, P 8/9, Q 8/9, R 7/13, S 7/12, T 8/8, U 4/10, V 7/10, W 7/11, X 4/5, Y 4/5.

The hard letters are the closed fists (M, N, S, which differ by where the thumb sits under the fingers, and landmarks see the thumb poorly) and the two-finger family (R, U, H, K, V). The chord letters **A to G are among the most reliable**.

For contrast, an early run on A to H alone reached 0.95 clip accuracy. The drop is the hard pairs, not the pipeline.

## Motion signs

J and Z are drawn in the air, and every one of the words is a movement, so a frame cannot read them. A second small MLP (146 → 64 → 10) reads windows of the signing hand's last 0.6, 0.9, 1.3 and 1.8 s. Its inputs are the letter model's posterior at four times (the handshape over time), the wrist path and the index and pinky tip paths in palm lengths at eight times, the path length and the duration. A "none" class is trained on windows from held-letter clips. Every window length is scored each frame, and the most confident sign wins.

Held-out clips (5-fold, grouped by clip; a sign counts when the right sign is the most confident over the clip and reaches the threshold):

| Threshold | Signs detected | Held-letter clips that ever show a false sign |
|---|---|---|
| 0.6 | 0.885 | 0.230 |
| 0.7 | 0.882 | 0.218 |
| 0.8 | 0.876 | 0.210 |
| **0.9 (shipped)** | **0.861** | **0.160** |

Per sign at 0.8: please 46/46, thank you 26/28, sorry 32/36, no 50/56, bye 42/45, yes 44/53, hello 36/41, J 7/12, **Z 0/6**. Z has only 6 source clips in the corpus and is not learnt. It needs more data: Kaggle ASL Fingerspelling, or a few recorded takes through the trainer.

The false-sign column counts a clip if a false sign appears at any moment, including while the hand rises into view. A recognised motion sign stays on screen for 1 s (the latch).

## Cost

Measured in Node on the (loaded) production server, per frame: **0.08 ms** for the letters alone, **1.24 ms** with the four motion windows. That is 4% of a 30 fps frame. The two models load lazily as separate chunks (about 34 kB and 87 kB).

## What would make it better, in order

1. More signers for the hard letters and for Z, J and the words: the Kaggle corpora above (credentials needed).
2. Location: THANK YOU (chin) and HELLO (forehead) are told apart by movement alone today. The face landmarks thoremin already has would add where the hand is.
3. Personal calibration through the trainer (thoremin already enrols a player's own chord shapes): a few seconds per hard letter would fix a given player's M/N/S.
4. A real live check with a webcam and a signer (`#146`).
