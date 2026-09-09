#!/usr/bin/env python3
"""Decode a video into a full-body pose NDJSON stream (#186) — the "from-video"
tier of the DAG test strategy, for the body branch.

Runs the MediaPipe Tasks **PoseLandmarker** (same model family as the JS
`@mediapipe/tasks-vision` the `webcam-body` node uses) over each frame and emits
one StreamRecord per frame in the exact shape the TS `body-feature-vector` node
consumes (a ``BodyFrame``: 33 landmarks in pixel coordinates + the metric world
landmarks + per-point visibility), so the output drops straight into
``test/fixtures/<scenario>/camBody.body.ndjson.gz`` and replays through the
existing pipeline with no camera.

Values are rounded (pixels 1 dp, world metres 4 dp, visibility 3 dp) so a
20-second clip gzips to a few hundred kilobytes; the live source is not rounded,
so a fixture and a live frame are shape-identical but not bit-identical.

Usage:
    media/.venv/bin/python scripts/video_to_pose.py <video> <out.ndjson> [--model lite|full|heavy]

The default model is ``full`` (the live node defaults to ``lite`` for frame rate);
a fixture recorded with ``full`` is a cleaner reference than a live session will be.

The raw video lives OUTSIDE the repo (the app-data dir, fetched with `yb`); only
the derived NDJSON is committed. Requires: mediapipe (Tasks API), opencv-python.
Run from the isolated media/.venv so it doesn't perturb the shared pyenv env.
"""
import argparse
import gzip
import json
import os
import sys
import urllib.request

import cv2
import mediapipe as mp
from mediapipe.tasks.python import vision
from mediapipe.tasks.python.core.base_options import BaseOptions

MODEL_BASE = "https://storage.googleapis.com/mediapipe-models/pose_landmarker"
MODELS_DIR = os.path.join(os.path.dirname(__file__), "..", "media", "models")

# The 33 BlazePose landmarks, MediaPipe's order — mirrors `BLM` in src/nodes/domain.ts.
LM_NAMES = [
    "nose",
    "left_eye_inner", "left_eye", "left_eye_outer",
    "right_eye_inner", "right_eye", "right_eye_outer",
    "left_ear", "right_ear",
    "mouth_left", "mouth_right",
    "left_shoulder", "right_shoulder",
    "left_elbow", "right_elbow",
    "left_wrist", "right_wrist",
    "left_pinky", "right_pinky",
    "left_index", "right_index",
    "left_thumb", "right_thumb",
    "left_hip", "right_hip",
    "left_knee", "right_knee",
    "left_ankle", "right_ankle",
    "left_heel", "right_heel",
    "left_foot_index", "right_foot_index",
]


def ensure_model(variant: str) -> str:
    path = os.path.abspath(os.path.join(MODELS_DIR, f"pose_landmarker_{variant}.task"))
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        url = f"{MODEL_BASE}/pose_landmarker_{variant}/float16/latest/pose_landmarker_{variant}.task"
        print(f"downloading pose_landmarker_{variant} model -> {path}", file=sys.stderr)
        urllib.request.urlretrieve(url, path)
    return path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("out", help="output .ndjson (or .ndjson.gz to gzip)")
    ap.add_argument("--model", choices=["lite", "full", "heavy"], default="full")
    ap.add_argument("--min-confidence", type=float, default=0.5)
    args = ap.parse_args()

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        print(f"ERROR: cannot open {args.video}", file=sys.stderr)
        return 1
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

    options = vision.PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=ensure_model(args.model)),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=args.min_confidence,
        min_tracking_confidence=args.min_confidence,
    )
    landmarker = vision.PoseLandmarker.create_from_options(options)

    tick = 0
    detected = 0
    records = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        ts_ms = int(tick / fps * 1000)
        res = landmarker.detect_for_video(mp_image, ts_ms)

        value = {"width": width, "height": height, "present": False, "landmarks": [], "visibility": []}
        if res.pose_landmarks:
            lms = res.pose_landmarks[0]
            # Mirror the live source (webcam_body.ts `resultToBodyFrame`): pixel x/y, the
            # RAW relative z, and the visibility per landmark.
            value["present"] = True
            value["landmarks"] = [
                {"x": round(lm.x * width, 1), "y": round(lm.y * height, 1), "z": round(lm.z, 4)}
                for lm in lms
            ]
            value["visibility"] = [round(lm.visibility, 3) for lm in lms]
            world = getattr(res, "pose_world_landmarks", None)
            if world and world[0]:
                # Metres, hip-midpoint origin — the set the angle/velocity features prefer.
                value["world"] = [
                    {"x": round(wl.x, 4), "y": round(wl.y, 4), "z": round(wl.z, 4)} for wl in world[0]
                ]
            detected += 1

        records.append({"tick": tick, "t": round(tick / fps, 6), "value": value})
        tick += 1

    cap.release()
    landmarker.close()

    opener = gzip.open if args.out.endswith(".gz") else open
    with opener(args.out, "wt") as f:
        for r in records:
            f.write(json.dumps(r, separators=(",", ":")) + "\n")

    rate = (detected / tick * 100) if tick else 0
    print(f"frames={tick} fps={fps:.1f} {width}x{height} model={args.model} body-detected={detected} ({rate:.0f}%) -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
