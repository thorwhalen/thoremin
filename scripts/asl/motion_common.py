"""Motion-sign window features. MUST match packages/asl/src/motion.ts.

A window is the signing hand's frames over the last D seconds. Features:
  - the static model's letter posterior, resampled at T_POST times  (handshape over time)
  - the wrist path, relative to the window's first wrist, in palm lengths, at T_PATH times
  - the index and pinky tips, relative to that first wrist, in palm lengths, at T_PATH times
  - the wrist path length (palm lengths) and the window's duration (s)
x is mirrored for a left hand, as in the static features.
"""
import json
import numpy as np
from asl_common import featurize

T_POST, T_PATH = 4, 8
WINDOWS = (0.6, 0.9, 1.3, 1.8)
MOTION_SIGNS = ['j', 'z', 'yes', 'no', 'hello', 'thankyou', 'please', 'sorry', 'bye']

def load_mlp(path):
    m = json.load(open(path))
    return m

def mlp_predict(m, x):
    a = (np.asarray(x, np.float64) - np.asarray(m['mean'])) / np.where(np.asarray(m['scale']) == 0, 1, np.asarray(m['scale']))
    for i, L in enumerate(m['layers']):
        a = np.asarray(L['W']) @ a + np.asarray(L['b'])
        if i < len(m['layers']) - 1: a = np.maximum(a, 0)
    e = np.exp(a - a.max()); return e / e.sum()

def frame_record(static, hand, w, h):
    """Per-frame quantities the window featuriser needs (also what the TS buffer stores)."""
    pts = np.asarray(hand[2], np.float64).reshape(21, 3)
    px = pts[:, 0] * w; py = pts[:, 1] * h
    if hand[0] == 'Left': px = -px
    palm = float(np.hypot(px[9] - px[0], py[9] - py[0])) or 1.0
    post = mlp_predict(static, featurize(hand, w, h, static['features']))
    return {'post': post, 'wrist': (px[0], py[0]), 'index': (px[8], py[8]), 'pinky': (px[20], py[20]), 'palm': palm}

def _resample(ts, vals, n):
    ts = np.asarray(ts); vals = np.asarray(vals, np.float64)
    tt = np.linspace(ts[0], ts[-1], n) if ts[-1] > ts[0] else np.full(n, ts[0])
    return np.stack([np.interp(tt, ts, vals[:, j]) for j in range(vals.shape[1])], 1)

def window_features(frames):
    """frames: list of (t, record), time-ascending, >= 2 entries."""
    ts = [t for t, _ in frames]; R = [r for _, r in frames]
    palm = float(np.mean([r['palm'] for r in R])) or 1.0
    w0 = np.asarray(R[0]['wrist'])
    rel = lambda key: [(np.asarray(r[key]) - w0) / palm for r in R]
    post = _resample(ts, [r['post'] for r in R], T_POST).reshape(-1)
    wrist = _resample(ts, rel('wrist'), T_PATH).reshape(-1)
    tips = np.concatenate([_resample(ts, rel('index'), T_PATH), _resample(ts, rel('pinky'), T_PATH)], 1).reshape(-1)
    W = np.asarray([r['wrist'] for r in R])
    path = float(np.sum(np.hypot(*np.diff(W, axis=0).T))) / palm if len(W) > 1 else 0.0
    return np.concatenate([post, wrist, tips, [path, ts[-1] - ts[0]]])
