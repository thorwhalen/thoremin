"""Pose-guided crops, shared by the face and hand extractors.

A face or a hand much under a tenth of the frame is missed by the whole-frame detector
(a body in a wide shot). The pose stream says where the head and the wrists are, so the
extractors cut a square around them and run the model on that, resized up. This module
holds the parts both share: reading chosen pose landmarks per frame, and cutting the
square. A crop is ``(x0, y0, side)`` in whole-frame pixels.
"""
import gzip
import json

import cv2


def read_pose_points(path: str, indices, *, min_visibility: float = 0.3) -> dict:
    """``{tick: {index: (x, y)}}``: the pixel position of each of ``indices`` that the pose
    stream saw (visibility at least ``min_visibility``) in each present frame."""
    opener = gzip.open if path.endswith(".gz") else open
    out = {}
    with opener(path, "rt") as f:
        for line in f:
            if not line.strip():
                continue
            rec = json.loads(line)
            v = rec["value"]
            if not v.get("present"):
                continue
            vis = v.get("visibility") or [1.0] * len(v["landmarks"])
            out[rec["tick"]] = {
                j: (v["landmarks"][j]["x"], v["landmarks"][j]["y"]) for j in indices if vis[j] >= min_visibility
            }
    return out


def cut_square(rgb, crop, size: int):
    """The crop (zero-padded where it leaves the frame), resized to ``size``."""
    import numpy as np

    x0, y0, side = (int(round(v)) for v in crop)
    out = np.zeros((side, side, 3), dtype=rgb.dtype)
    h, w = rgb.shape[:2]
    sx0, sy0, sx1, sy1 = max(0, x0), max(0, y0), min(w, x0 + side), min(h, y0 + side)
    if sx1 > sx0 and sy1 > sy0:
        out[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = rgb[sy0:sy1, sx0:sx1]
    return np.ascontiguousarray(cv2.resize(out, (size, size), interpolation=cv2.INTER_CUBIC))
