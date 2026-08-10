#!/usr/bin/env python3
"""Decode a video into face NDJSON streams via the MediaPipe Tasks
**FaceLandmarker** (same model family as the JS `@mediapipe/tasks-vision`
FaceLandmarker the `webcam-face` node uses).

Two output streams:

1. ``<out>`` (always): one StreamRecord per frame,
   ``{present, blendshapes: {name: score 0..1}}`` — the blendshape-only fixture
   the expression nodes replay against.
2. ``--landmarks-out <path>`` (optional): one StreamRecord per frame shaped as a
   full ``FaceFrame`` superset —
   ``{present, blendshapes, landmarks: [{x, y, z} x 478], transformMatrix: [16]}``.
   Landmarks are image-normalized (x, y in 0..1) with MediaPipe's relative ``z``
   PRESERVED, all 478 points including the irises (468..477) — dropping z here
   would starve the `face.geom.*` / `face.gaze.*` catalog features exactly the
   way the hand decoder once flattened 3-D hand features (see
   `video_to_landmarks.py`). ``transformMatrix`` is the facial transformation
   matrix (canonical face -> detected face) flattened COLUMN-MAJOR — the same
   layout as the JS `FaceLandmarkerResultLike.facialTransformationMatrixes[].data`
   — so the TS side decodes head pose with the production `matrixToHeadPose`
   (the Euler decomposition stays single-sourced in TS; no Python twin to drift).
   A ``.gz`` suffix gzips the stream deterministically (mtime=0) — the committed
   fixture form (test/helpers/fixtures.ts `loadStream` decompresses on load).

Both streams replay headlessly (no camera). Run from the isolated media/.venv.

Usage:
    media/.venv/bin/python scripts/video_to_face.py <video> <out.ndjson> \
        [--landmarks-out <out.landmarks.ndjson[.gz]>]
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


def write_ndjson(path: str, records: list) -> None:
    """Write one JSON record per line; a `.gz` path gzips with mtime=0 so
    regenerating an unchanged stream yields byte-identical output (diff-stable
    fixtures)."""
    payload = "".join(json.dumps(r) + "\n" for r in records).encode()
    if path.endswith(".gz"):
        with open(path, "wb") as f:
            with gzip.GzipFile(filename="", mode="wb", fileobj=f, mtime=0) as gz:
                gz.write(payload)
    else:
        with open(path, "wb") as f:
            f.write(payload)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("out")
    ap.add_argument(
        "--landmarks-out",
        default=None,
        help="also emit the full FaceFrame stream (478 landmarks + transform matrix); "
        "a .gz suffix gzips it (the committed-fixture form)",
    )
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
        # The matrix output head is only enabled when the landmark stream is
        # requested, keeping the blendshape-only invocation byte-identical to
        # what produced the committed face.blendshapes fixture.
        output_facial_transformation_matrixes=args.landmarks_out is not None,
        num_faces=1,
    )
    landmarker = vision.FaceLandmarker.create_from_options(options)

    tick = 0
    detected = 0
    records = []
    landmark_records = []
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

        if args.landmarks_out is not None:
            value = {"present": present, "blendshapes": blendshapes}
            if res.face_landmarks:
                # All 478 normalized points, x/y/z each preserved (z included).
                value["landmarks"] = [
                    {"x": round(p.x, 5), "y": round(p.y, 5), "z": round(p.z, 5)}
                    for p in res.face_landmarks[0]
                ]
            matrixes = getattr(res, "facial_transformation_matrixes", None)
            if matrixes is not None and len(matrixes) > 0:
                # numpy gives M[row][col] (translation in the last column);
                # flatten column-major to match the JS `data` layout that
                # `matrixToHeadPose` indexes as data[col*4 + row].
                value["transformMatrix"] = [
                    round(float(v), 6) for v in matrixes[0].flatten(order="F")
                ]
            landmark_records.append({
                "tick": tick,
                "t": round(tick / fps, 6),
                "value": value,
            })
        tick += 1

    cap.release()
    landmarker.close()

    write_ndjson(args.out, records)
    if args.landmarks_out is not None:
        write_ndjson(args.landmarks_out, landmark_records)

    rate = (detected / tick * 100) if tick else 0
    extra = f" + {args.landmarks_out}" if args.landmarks_out is not None else ""
    print(f"frames={tick} fps={fps:.1f} face-detected={detected} ({rate:.0f}%) -> {args.out}{extra}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
