# `real_hands_signs`: a real signer fingerspelling

Real MediaPipe hand landmarks (no pixels) of one signer from **SignAlphaSet** (B. Garg, M. Kasar, A. Kashyap, A. Vats, G. Sharma, A. Hange, Mendeley Data, 2025, [doi:10.17632/8fmvr9m98w.3](https://doi.org/10.17632/8fmvr9m98w.3)), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Changes: landmarks extracted from the videos at 30 fps (`scripts/video_to_landmarks.py`, MediaPipe HandLandmarker in VIDEO mode), clips joined end to end with frames of no hand between them, coordinates rounded (0.1 px, 1e-4).

No thoremin-asl model is trained on SignAlphaSet, so the sign reader meets this signer for the first time.

- `gaps.hands.ndjson.gz`: each clip, then 0.8 s with no hand: the hand comes in and leaves every time.
- `flow.hands.ndjson.gz`: the clips with a 0.2 s dropout between them: one letter after the next.
- `meta.json`: each performance's segments (frames, sign, clip id).

Built by `npx vite-node scripts/stability/build_fixtures.ts` from the landmark streams kept in the app-data dir. Used by the stability harness (`docs/testing/stability.md`).
