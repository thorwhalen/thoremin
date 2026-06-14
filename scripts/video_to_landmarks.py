#!/usr/bin/env python3
"""Decode a video into a hand-landmark NDJSON stream (the rare "from-video" tier
of the DAG test strategy).

Runs the MediaPipe Tasks **HandLandmarker** (same model family as the JS
`@mediapipe/tasks-vision` the app uses) over each frame and emits one
StreamRecord per frame in the exact shape the TS `hand-features` node consumes (a
``HandsFrame`` with keypoints in pixel coordinates), so the output drops straight
into ``test/fixtures/<scenario>/src.hands.ndjson`` and replays through the
existing pipeline with no camera.

Usage:
    media/.venv/bin/python scripts/video_to_landmarks.py <video> <out.ndjson> [--max-hands N]

Requires: mediapipe (Tasks API), opencv-python. Run from the isolated media/.venv
so it doesn't perturb the shared pyenv env.
"""
import argparse
import json
import os
import sys
import urllib.request

import cv2
import mediapipe as mp
from mediapipe.tasks.python import vision
from mediapipe.tasks.python.core.base_options import BaseOptions

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/1/hand_landmarker.task"
)
MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "media", "models", "hand_landmarker.task")

# Tasks HandLandmarker emits 21 landmarks in this canonical order (matches src/nodes/domain.ts LM).
LM_NAMES = [
    "wrist",
    "thumb_cmc", "thumb_mcp", "thumb_ip", "thumb_tip",
    "index_finger_mcp", "index_finger_pip", "index_finger_dip", "index_finger_tip",
    "middle_finger_mcp", "middle_finger_pip", "middle_finger_dip", "middle_finger_tip",
    "ring_finger_mcp", "ring_finger_pip", "ring_finger_dip", "ring_finger_tip",
    "pinky_finger_mcp", "pinky_finger_pip", "pinky_finger_dip", "pinky_finger_tip",
]


def ensure_model() -> str:
    path = os.path.abspath(MODEL_PATH)
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        print(f"downloading hand_landmarker model -> {path}", file=sys.stderr)
        urllib.request.urlretrieve(MODEL_URL, path)
    return path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("out")
    ap.add_argument("--max-hands", type=int, default=2)
    ap.add_argument("--min-confidence", type=float, default=0.4)
    args = ap.parse_args()

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        print(f"ERROR: cannot open {args.video}", file=sys.stderr)
        return 1
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

    options = vision.HandLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=ensure_model()),
        running_mode=vision.RunningMode.VIDEO,
        num_hands=args.max_hands,
        min_hand_detection_confidence=args.min_confidence,
        min_tracking_confidence=args.min_confidence,
    )
    landmarker = vision.HandLandmarker.create_from_options(options)

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

        hand_objs = []
        if res.hand_landmarks:
            for i, lms in enumerate(res.hand_landmarks):
                label, score = "Right", None
                if res.handedness and i < len(res.handedness) and res.handedness[i]:
                    label = res.handedness[i][0].category_name
                    score = res.handedness[i][0].score
                keypoints = [
                    {"x": lm.x * width, "y": lm.y * height, "name": LM_NAMES[j]}
                    for j, lm in enumerate(lms)
                ]
                hand_objs.append({"handedness": label, "keypoints": keypoints, "score": score})
            detected += 1

        records.append({
            "tick": tick,
            "t": round(tick / fps, 6),
            "value": {"width": width, "height": height, "hands": hand_objs},
        })
        tick += 1

    cap.release()
    landmarker.close()

    with open(args.out, "w") as f:
        for r in records:
            f.write(json.dumps(r) + "\n")

    rate = (detected / tick * 100) if tick else 0
    print(f"frames={tick} fps={fps:.1f} {width}x{height} hand-detected={detected} ({rate:.0f}%) -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
