# `real_hands_choir`: a choir conductor's two hands

Real MediaPipe hand landmarks (no pixels), 20 s (40 s to 60 s) of [Conducting choir - Bortniansky Cherubic Hymn](https://commons.wikimedia.org/wiki/File:Conducting_choir_-_Bortniansky_Cherubic_Hymn.webm) by OrthodoxMusicOnline on Wikimedia Commons, licensed [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Changes: landmarks extracted from the video (`scripts/video_to_landmarks.py`), an excerpt at the video's own 29.97 fps, coordinates rounded (0.1 px, 1e-4), keypoint names dropped. The raw handedness labels are kept: two hands labelled the same side happen here, as they do live.

Real hands that are not playing the instrument: the stability harness (`docs/testing/stability.md`) reads from them how often an instrument plays a chord nobody asked for, and how it copes with real hands moving. Built by `npx vite-node scripts/stability/build_fixtures.ts`.
