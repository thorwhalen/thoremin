#!/usr/bin/env python3
"""Decode a video into a hand-landmark NDJSON stream (the rare "from-video" tier
of the DAG test strategy).

Runs the MediaPipe Tasks **HandLandmarker** (same model family as the JS
`@mediapipe/tasks-vision` the app uses) over each frame and emits one
StreamRecord per frame in the exact shape the TS `hand-features` node consumes (a
``HandsFrame`` with keypoints in pixel coordinates), so the output drops straight
into ``test/fixtures/<scenario>/src.hands.ndjson`` and replays through the
existing pipeline with no camera.

``--crop-from-pose <pose stream>`` is for hands too small for the detector (a body in a
wide shot: the Haikou and Hanoi fitness classes give 0 % of frames whole-frame). Each frame's
frame is read whole as before, and then, for each wrist the pose sees that no whole-frame
hand covers, the model also runs on a square around the wrist, index, pinky and thumb points
(``--crop-scale`` times their spread, or half the forearm if that is more, at least ``--crop-min``
px), resized to ``--crop-size`` and read for one hand (at most two crops per frame); keypoints are mapped back to the whole frame (``z`` scales with ``x``, MediaPipe's
convention; ``worldKeypoints`` are metres and unchanged) and each hand record carries its
``crop`` (``[x0, y0, side]`` in pixels) and ``poseSide`` (the pose wrist it was cut around,
``left`` / ``right`` as the pose names them). ``handedness`` stays the model's raw label, which
on a single-hand crop may differ from the whole-frame reading. A whole-frame hand has no
``crop``; a wrist whose crop would fill the frame is left to the whole-frame reading.

Usage:
    media/.venv/bin/python scripts/video_to_landmarks.py <video> <out.ndjson> [--max-hands N]
        [--crop-from-pose <pose.ndjson.gz>]

Requires: mediapipe (Tasks API), opencv-python. Run from the isolated media/.venv
so it doesn't perturb the shared pyenv env.
"""
import argparse
import gzip
import json
import math
import os
import sys
import urllib.request

import cv2
import mediapipe as mp
from mediapipe.tasks.python import vision
from mediapipe.tasks.python.core.base_options import BaseOptions

from pose_crop import cut_square, read_pose_points

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/1/hand_landmarker.task"
)
MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "media", "models", "hand_landmarker.task")

# Tasks HandLandmarker emits 21 landmarks in this canonical order (matches packages/sdk/src/nodes/domain.ts LM).
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


# BlazePose wrist, pinky, index, thumb, then the elbow (left subject side, then right): the
# points that bound a hand, and the elbow that sizes it when they huddle on a hand a few
# pixels across (the pose places them from the wrist alone).
_HAND_POINTS = {"left": (15, 17, 19, 21, 13), "right": (16, 18, 20, 22, 14)}
# A hand's length over its forearm's (wrist to elbow): the floor of the crop's unit.
HAND_PER_FOREARM = 0.5


def hand_crop(pts: dict, idx: tuple, shape, scale: float, min_side: float):
    """``(x0, y0, side)`` in pixels around one side's hand, or None. ``pts`` is the pose's
    visible points by index, ``idx`` that side's tuple of ``_HAND_POINTS`` (wrist first,
    elbow last). The side is ``scale`` times the hand points' spread, or half the forearm if
    that is more, at least ``min_side``. None: the wrist unseen, or the square would fill the
    frame (then the whole frame is as good)."""
    *hand_idx, elbow_idx = idx
    hand = [pts[j] for j in hand_idx if j in pts]
    if idx[0] not in pts or len(hand) < 2:
        return None
    xs, ys = [p[0] for p in hand], [p[1] for p in hand]
    unit = max(max(xs) - min(xs), max(ys) - min(ys))
    if elbow_idx in pts:
        unit = max(unit, HAND_PER_FOREARM * math.dist(pts[idx[0]], pts[elbow_idx]))
    side = max(min_side, scale * unit)
    if side >= max(shape[0], shape[1]):
        return None
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    return (cx - side / 2, cy - side / 2, side)


def hand_record(lms, world, label, score, width, height, crop=None):
    """One hand in the stream's shape. Mirrors the live source (webcam_hands.ts
    `toHandsFrame`) EXACTLY: pixel x/y but the RAW (unscaled) z, so a replayed fixture and a
    live frame are the same shape. Dropping z here would silently flatten every 3-D feature
    to a plane. With a ``crop`` the landmarks are crop-normalised: mapped back to the whole
    frame (z scales with x, so it is in the whole frame's units too)."""
    if crop is None:
        kx, ky, kz, ox, oy = width, height, 1.0, 0.0, 0.0
    else:
        x0, y0, side = (int(round(v)) for v in crop)
        kx = ky = side
        kz, ox, oy = side / width, x0, y0
    hand = {
        "handedness": label,
        "keypoints": [
            {"x": ox + lm.x * kx, "y": oy + lm.y * ky, "z": lm.z * kz, "name": LM_NAMES[j]} for j, lm in enumerate(lms)
        ],
        "score": score,
    }
    # World landmarks stay in METRES (unscaled), origin at the hand centre.
    # The palm-orientation / angle / distance features read this pose-invariant
    # set "when present, else image" — so without it they degenerate silently.
    if world:
        hand["worldKeypoints"] = [{"x": wl.x, "y": wl.y, "z": wl.z, "name": LM_NAMES[j]} for j, wl in enumerate(world)]
    return hand


def hands_of(res, width, height, crop=None):
    """The hand records of one detection result."""
    out = []
    world = getattr(res, "hand_world_landmarks", None)
    for i, lms in enumerate(res.hand_landmarks or []):
        label, score = "Right", None
        if res.handedness and i < len(res.handedness) and res.handedness[i]:
            label = res.handedness[i][0].category_name
            score = res.handedness[i][0].score
        out.append(hand_record(lms, world[i] if world and i < len(world) else None, label, score, width, height, crop))
    return out


def covered(hands: list, crop) -> bool:
    """Whether a hand already read has its wrist inside ``crop``."""
    x0, y0, side = crop
    return any(
        x0 <= h["keypoints"][0]["x"] <= x0 + side and y0 <= h["keypoints"][0]["y"] <= y0 + side for h in hands
    )


def dedupe(hands: list) -> list:
    """Two crops can find the same hand: keep one whose wrist is not within a fifth of its
    crop of an earlier crop's. (A whole-frame hand is never dropped, nor does it drop one.)"""
    kept = []
    for h in hands:
        w = h["keypoints"][0]
        if "crop" not in h or not any(
            "crop" in k and abs(w["x"] - k["keypoints"][0]["x"]) + abs(w["y"] - k["keypoints"][0]["y"]) < 0.2 * h["crop"][2]
            for k in kept
        ):
            kept.append(h)
    return kept


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("out", help="output .ndjson (or .ndjson.gz to gzip)")
    ap.add_argument("--max-hands", type=int, default=2)
    ap.add_argument("--min-confidence", type=float, default=0.4)
    ap.add_argument("--crop-from-pose", help="a pose stream (.ndjson[.gz]): run the model on a square around each wrist")
    ap.add_argument("--crop-scale", type=float, default=3.0, help="crop side over the hand points' spread")
    ap.add_argument("--crop-min", type=float, default=64.0, help="smallest crop side, px")
    ap.add_argument("--crop-size", type=int, default=256, help="the crop is resized to this square for the model")
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
    crop_landmarker = None
    wrists = None
    if args.crop_from_pose:
        wrists = read_pose_points(args.crop_from_pose, [j for g in _HAND_POINTS.values() for j in g])
        # Crops are unrelated images, so IMAGE mode (detect every time): the tracker of VIDEO
        # mode would carry one wrist's hand into the other's crop.
        crop_landmarker = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=ensure_model()),
            running_mode=vision.RunningMode.IMAGE,
            num_hands=1,
            min_hand_detection_confidence=args.min_confidence,
            min_tracking_confidence=args.min_confidence,
        ))

    tick = 0
    detected = 0
    records = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        # The whole frame first: it is the reading the live app makes, and the better one when a
        # hand is big. Then a crop for each pose wrist no whole-frame hand covers.
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        ts_ms = int(tick / fps * 1000)
        hand_objs = hands_of(landmarker.detect_for_video(mp_image, ts_ms), width, height)
        if wrists is not None:
            for side, idx in _HAND_POINTS.items():
                crop = hand_crop(wrists.get(tick, {}), idx, rgb.shape, args.crop_scale, args.crop_min)
                if crop is None or covered(hand_objs, crop):
                    continue
                img = mp.Image(image_format=mp.ImageFormat.SRGB, data=cut_square(rgb, crop, args.crop_size))
                for h in hands_of(crop_landmarker.detect(img), width, height, crop):
                    h["crop"] = [int(round(v)) for v in crop]
                    h["poseSide"] = side
                    hand_objs.append(h)
            hand_objs = dedupe(hand_objs)
        if hand_objs:
            detected += 1

        records.append({
            "tick": tick,
            "t": round(tick / fps, 6),
            "value": {"width": width, "height": height, "hands": hand_objs},
        })
        tick += 1

    cap.release()
    landmarker.close()
    if crop_landmarker:
        crop_landmarker.close()

    # A `.gz` path gzips with mtime=0 (byte-identical on a rerun), like video_to_pose.py
    # and video_to_face.py: the kept form of a stream (the thoremin-dev-video-data skill).
    payload = "".join(json.dumps(r) + "\n" for r in records).encode()
    if args.out.endswith(".gz"):
        with open(args.out, "wb") as f:
            with gzip.GzipFile(filename="", mode="wb", fileobj=f, mtime=0) as gz:
                gz.write(payload)
    else:
        with open(args.out, "wb") as f:
            f.write(payload)

    rate = (detected / tick * 100) if tick else 0
    print(f"frames={tick} fps={fps:.1f} {width}x{height} hand-detected={detected} ({rate:.0f}%) -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
