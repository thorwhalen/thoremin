---
name: thoremin-dev-video-data
description: >-
  The standing rule for every video thoremin downloads to train, test, measure or build a
  fixture from: extract and KEEP the compressed landmark streams (body pose, hands, face)
  with rich metadata, so the clip can be reused for any later feature without the heavy
  video. Use whenever you fetch a video (yb, yt-dlp, Wikimedia Commons, a dataset zip),
  run scripts/video_to_pose.py / video_to_landmarks.py / video_to_face.py or
  scripts/air/extract.py, build a fixture from footage, add a corpus of clips, or are
  about to delete a downloaded video. Triggers on "download a video", "from YouTube",
  "from Commons", "footage", "clip", "dataset of videos", "extract landmarks", "pose
  stream", "build a fixture from a video", "train on video", "test on real video".
metadata:
  audience: developers
---

# Downloaded video: keep the landmark streams, with metadata

**The rule (maintainer, 2026-10-14).** A video thoremin downloads is decoded into ALL its raw landmark streams, compressed, and kept, with metadata good enough to find the video again and to know what it shows. The video itself may be deleted afterwards; the streams may not. Landmarks are small and reusable in many ways (a new feature, a new instrument, a new detector, a regression replay); the video is heavy and can be fetched again from its URL.

This applies to every purpose: training, testing, measuring, fixtures, demos. Extract the streams even when the task at hand needs only one of them (a pose study still extracts hands and face if they are in frame).

## The tool

`scripts/video_streams.py <video> <out_dir> --id <clip> [--source-url URL | --info-json FILE] [--purpose "#N"]` does all of the below for one clip: it runs the three extractors (pose first, then hands, then the face on a pose-guided head crop, since the face detector misses a face much under a tenth of the frame), writes each stream's provenance into `<clip>.meta.json` as it finishes, and fills the source's title, author, licence and description from Wikimedia Commons' API or a yt-dlp `.info.json`. A corpus driver imports it (`scripts/body/keep_streams.py`); it still needs you for the `labels` and the `purpose`, and prints what the meta lacks.

## What to keep, per clip

1. **Every stream the clip supports**, each as `.ndjson.gz` (one StreamRecord per frame, the shape the live nodes consume, so it replays through the DAG):
   - body: `scripts/video_to_pose.py` (`BodyFrame`: 33 pixel landmarks, world landmarks, visibility),
   - hands: `scripts/video_to_landmarks.py` (`HandsFrame`: pixel keypoints with the RAW `z`, `worldKeypoints`, `handedness` as the model reported it),
   - face: `scripts/video_to_face.py` with `--landmarks-out` (blendshapes, all 478 landmarks with `z`, the transform matrix), and `--crop-from-pose <pose stream>` when the face is small in the frame (a body in a wide shot: a conductor's face 60 px across a 1280 px frame is found in 1 frame of 1166 whole-frame and 96 % of frames cropped).
   Name each output `.ndjson.gz`: all three scripts gzip by that suffix. Never drop `z`, world coordinates, visibility or the raw handedness label (where the model gives none the hands script writes `Right`; say so in the meta if it matters): each has been needed later (the palm's sign in #457 was measured from kept ASL landmarks). Keep the extractors' rounding; do not round further.
2. **`<clip>.meta.json`** beside the streams:
   - `sourceUrl` (the page) and `mediaUrl` (the file, if different); the platform id;
   - `title`, `author`, `licence` (as stated at the source, with its URL), `description` (the source's own text, verbatim);
   - `labels`: what the clip shows and **where each label came from** (the filename or folder, on-screen text, subtitles, the description, a human); copy any on-screen text that names the label, and the subtitles: keep the `.vtt` / `.srt` (yt-dlp `--write-subs --write-auto-subs`) next to the meta, and the yt-dlp `.info.json` when there is one;
   - `fetchedAt` (date), `sha256` of the video file, `durationS`, `fps`, `width`, `height`, and whether the frames were mirrored;
   - per stream: the extractor script, the model (and its variant: lite / full / heavy), the mediapipe version, the confidence thresholds, and any excerpt window (`fromS`, `toS`) in the video's own time;
   - the purpose it was fetched for (an issue number) and anything learned about it (a dancer switch, a cut, a bad stretch).
3. The video, optionally: delete it when disk matters. Never delete the streams or the meta.

## Where it goes

Under the app-data root, never in the repository: `<root>/<kind>/<corpus>/`, where `<root>` is `THOREMIN_DATA_DIR` or `~/.local/share/thoremin` and `<kind>` is `videos` (deletable), `landmarks` (the streams and the meta) or what the corpus derives (`labels`, `datasets`, `models`, `results`); for example `<root>/landmarks/air/guitar/`. `scripts/air/` shows the layout and the steps (fetch, extract, label, join; `scripts/air/README.md`); its `extract.py` keeps every stream and the meta through `scripts/video_streams.py` (#513). The body corpus of #373 now follows it (`<root>/landmarks/body/`, backfilled by `scripts/body/keep_streams.py` from `scripts/body/sources.json`, #510; its videos stay in the older `<root>/body/src/`). To merge provenance into a fixture's meta, `scripts/body/excerpt.ts --provenance` exists. The ASL corpus lives with its own repository (`thoremin-asl`, `~/.local/share/thoremin-asl/landmarks/`, one JSONL record per clip with source, id, label and frames).

## What may be committed

The repository is public. A stream goes into `test/fixtures/` only when its source licence permits redistribution (CC0, CC BY, CC BY-SA, MIT, ...), with the attribution and licence in the fixture's `meta.json` or `README.md`. Streams from standard-YouTube-licence or research-only sources stay local, however small (the ecosystem's provenance rule). Numbers measured on them may be committed.

## Checklist before you finish a task that fetched video

- every clip has its streams (`pose`, `hands`, `face`, as present) as `.ndjson.gz` and a `meta.json` with the fields above;
- the labels say where they came from;
- the video can be found again from `sourceUrl` alone;
- nothing non-redistributable entered the repository.
