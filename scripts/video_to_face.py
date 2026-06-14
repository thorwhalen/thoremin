#!/usr/bin/env python3
"""Decode a video into a face-expression NDJSON stream via the MediaPipe Tasks
**FaceLandmarker** (52 blendshapes — same model family as the JS
`@mediapipe/tasks-vision` FaceLandmarker the M4 `face-features` node will use).

Emits one StreamRecord per frame: ``{present, blendshapes: {name: score 0..1}}``.
This is the durable fixture the M4 facial-expression mapping will replay against
(no camera). Run from the isolated media/.venv.

Usage:
    media/.venv/bin/python scripts/video_to_face.py <video> <out.ndjson>
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
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/1/face_landmarker.task"
)
MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "media", "models", "face_landmarker.task")


def ensure_model() -> str:
    path = os.path.abspath(MODEL_PATH)
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        print(f"downloading face_landmarker model -> {path}", file=sys.stderr)
        urllib.request.urlretrieve(MODEL_URL, path)
    return path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("out")
    args = ap.parse_args()

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        print(f"ERROR: cannot open {args.video}", file=sys.stderr)
        return 1
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

    options = vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=ensure_model()),
        running_mode=vision.RunningMode.VIDEO,
        output_face_blendshapes=True,
        num_faces=1,
    )
    landmarker = vision.FaceLandmarker.create_from_options(options)

    tick = 0
    detected = 0
    records = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        res = landmarker.detect_for_video(mp_image, int(tick / fps * 1000))

        blendshapes = {}
        present = False
        if res.face_blendshapes:
            present = True
            detected += 1
            for cat in res.face_blendshapes[0]:
                blendshapes[cat.category_name] = round(cat.score, 5)

        records.append({
            "tick": tick,
            "t": round(tick / fps, 6),
            "value": {"present": present, "blendshapes": blendshapes},
        })
        tick += 1

    cap.release()
    landmarker.close()

    with open(args.out, "w") as f:
        for r in records:
            f.write(json.dumps(r) + "\n")

    rate = (detected / tick * 100) if tick else 0
    print(f"frames={tick} fps={fps:.1f} face-detected={detected} ({rate:.0f}%) -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
