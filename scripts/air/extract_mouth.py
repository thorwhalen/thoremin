#!/usr/bin/env python3
"""The MOUTH stream of a flute video: blendshapes plus the lip and reference landmarks,
streamed one frame per line.

``scripts/video_to_face.py`` emits the blendshapes only, or, with ``--landmarks-out``,
all 478 mesh points held in memory until the end, which a 36,000-frame lesson does not
fit. The embouchure-onset measurement (#248) needs two things from the face at every
frame: the mouth blendshapes (``mouthPucker``, ``mouthFunnel``, ``jawOpen``, ...) and
the lip GEOMETRY (the inner-lip aperture, the lip-corner width, the jaw drop), so that
a blendshape's smoothing is not mistaken for the mouth's own timing. This script runs
the same FaceLandmarker with the same model and options, and writes, per frame,
``{tick, t, value: {present, blendshapes, points: {"<index>": [x, y, z]}}}`` where the
points are the outer and inner lip contours and a few reference points (nose tip,
chin, eye corners, cheeks) that make the lip distances scale- and position-invariant.
The output is written as it goes, gzipped.

Times are ``tick / fps`` of the video the landmarker reads, exactly as the hand and
face streams, so the three line up with the audio labels of the same clip.

Usage:
    python3 scripts/air/extract_mouth.py flute [--only ID ...] [--file <clip.mp4> ...]
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(REPO / "scripts"))

# MediaPipe face-mesh indices of the lips (the canonical FACEMESH_LIPS contour) and the
# reference points the analysis normalises by.
OUTER_LIPS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185]
INNER_LIPS = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191]
REFERENCE = {
    "nose_tip": 1,
    "chin": 152,
    "left_eye_outer": 33,
    "right_eye_outer": 263,
    "left_cheek": 234,
    "right_cheek": 454,
    "upper_lip_top": 0,
    "lower_lip_bottom": 17,
}
POINTS = sorted(set(OUTER_LIPS) | set(INNER_LIPS) | set(REFERENCE.values()))


def data_root() -> Path:
    return Path(os.environ.get("THOREMIN_DATA_DIR", Path.home() / ".local" / "share" / "thoremin"))


def run(video: Path, out: Path) -> None:
    import cv2
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions
    from mediapipe.tasks.python import vision

    from video_to_face import ensure_model

    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        sys.exit(f"cannot open {video}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    options = vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=ensure_model()),
        running_mode=vision.RunningMode.VIDEO,
        output_face_blendshapes=True,
        output_facial_transformation_matrixes=False,
        num_faces=1,
    )
    landmarker = vision.FaceLandmarker.create_from_options(options)
    part = out.with_suffix(out.suffix + ".part")
    tick = detected = 0
    with gzip.open(part, "wt") as f:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            res = landmarker.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), int(tick / fps * 1000))
            present = bool(res.face_blendshapes)
            value: dict = {"present": present, "blendshapes": {}}
            if present:
                detected += 1
                value["blendshapes"] = {c.category_name: round(c.score, 5) for c in res.face_blendshapes[0]}
                lm = res.face_landmarks[0]
                value["points"] = {str(i): [round(lm[i].x, 5), round(lm[i].y, 5), round(lm[i].z, 5)] for i in POINTS}
            f.write(json.dumps({"tick": tick, "t": round(tick / fps, 6), "value": value}) + "\n")
            tick += 1
    cap.release()
    landmarker.close()
    part.rename(out)
    rate = detected / tick * 100 if tick else 0
    print(f"frames={tick} fps={fps:.1f} face-detected={detected} ({rate:.0f}%) -> {out}", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("instrument")
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--file", nargs="*", default=None, help="local clips (stem is the id)")
    ap.add_argument("--force", action="store_true", help="redo a source whose output (or a stale .part of a crashed run) exists")
    args = ap.parse_args()
    root = data_root()
    vid_dir = root / "videos" / "air" / args.instrument
    out_dir = root / "landmarks" / "air" / args.instrument
    out_dir.mkdir(parents=True, exist_ok=True)
    sources = json.loads((HERE / "sources" / f"{args.instrument}.json").read_text())["sources"]
    jobs: list[tuple[str, Path]] = []
    for src in sources:
        if args.only and src["id"] not in args.only:
            continue
        excerpt = vid_dir / f"{src['id']}.excerpt.mp4"
        jobs.append((src["id"], excerpt if excerpt.exists() else vid_dir / f"{src['id']}.mp4"))
    for f in args.file or []:
        p = Path(f).expanduser()
        jobs.append((p.stem, p))
    for vid, video in jobs:
        out = out_dir / f"{vid}.mouth.ndjson.gz"
        part = out.with_suffix(out.suffix + ".part")
        if args.force:
            out.unlink(missing_ok=True)
            part.unlink(missing_ok=True)
        if out.exists():
            print(f"skip {vid} (present)")
            continue
        if part.exists():
            # Another run is on it (several may run in parallel, one source list each);
            # a crashed run's leftover needs --force.
            print(f"skip {vid} (in progress; --force to redo)")
            continue
        if not video.exists():
            print(f"skip {vid} (no video)")
            continue
        print(f"=== {vid}", flush=True)
        run(video, out)


if __name__ == "__main__":
    main()
