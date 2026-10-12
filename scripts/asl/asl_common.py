"""Shared featurisation for the ASL models. MUST match packages/asl/src/features.ts."""
import json, os, re
import numpy as np

LETTERS = [chr(c) for c in range(ord('a'), ord('z') + 1)]
STATIC_LETTERS = [l for l in LETTERS if l not in ('j', 'z')]
WORDS = ['yes', 'no', 'hello', 'thankyou', 'please', 'sorry', 'bye']

def base_clip(name):
    """Group key: strip the dataset's augmentation suffix so a clip and its copies share a fold."""
    return re.sub(r'_[a-z]+_aug_\d+', '', os.path.splitext(name)[0])

def load(lm_dir, gloss):
    p = os.path.join(lm_dir, gloss + '.jsonl')
    if not os.path.exists(p): return []
    return [json.loads(l) for l in open(p)]

def pick_hand(hands):
    """The signing hand: the one whose wrist is highest in the image (smallest y)."""
    if not hands: return None
    return min(hands, key=lambda h: h[2][1])

def canon_world(hand):
    """World landmarks, wrist-relative, scaled by wrist->middle-MCP length, mirrored for Left."""
    w = np.asarray(hand[3], dtype=np.float32).reshape(21, 3)
    w = w - w[0]
    s = np.linalg.norm(w[9]) or 1.0
    w = w / s
    if hand[0] == 'Left': w[:, 0] = -w[:, 0]
    return w.reshape(-1)

def canon_image(hand, width, height):
    """Image landmarks in pixels (z scaled like x), wrist-relative, scaled, mirrored for Left."""
    p = np.asarray(hand[2], dtype=np.float32).reshape(21, 3).copy()
    p[:, 0] *= width; p[:, 1] *= height; p[:, 2] *= width
    p = p - p[0]
    s = np.linalg.norm(p[9, :2]) or 1.0
    p = p / s
    if hand[0] == 'Left': p[:, 0] = -p[:, 0]
    return p.reshape(-1)

def featurize(hand, width, height, kind='both'):
    if kind == 'world': return canon_world(hand)
    if kind == 'image': return canon_image(hand, width, height)
    return np.concatenate([canon_world(hand), canon_image(hand, width, height)])

# ---- geometric features (kind 'geo'): angles, distances, orientation ------------------
FINGERS = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [0, 9, 10, 11, 12], [0, 13, 14, 15, 16], [0, 17, 18, 19, 20]]
TIPS = [4, 8, 12, 16, 20]

def _unit(v):
    n = np.linalg.norm(v); return v / n if n > 1e-9 else v * 0

def image_points(hand, width, height):
    """Image landmarks as 3D points in pixels (z scaled like x), mirrored for a Left hand."""
    p = np.asarray(hand[2], dtype=np.float64).reshape(21, 3).copy()
    p[:, 0] *= width; p[:, 1] *= height; p[:, 2] *= width
    if hand[0] == 'Left': p[:, 0] = -p[:, 0]
    return p

def geo_features(P):
    """P: 21x3 canonical (mirrored) points in any consistent unit. Scale/position invariant."""
    P = P - P[0]; s = np.linalg.norm(P[9]) or 1.0; P = P / s
    f = []
    for ch in FINGERS:  # flexion: cos of the angle at each of the 3 inner joints
        for j in range(1, 4):
            f.append(float(np.dot(_unit(P[ch[j]] - P[ch[j - 1]]), _unit(P[ch[j + 1]] - P[ch[j]]))))
    for a, b in [(1, 2), (2, 3), (3, 4)]:  # spread between adjacent fingers' proximal bones
        f.append(float(np.dot(_unit(P[FINGERS[a][2]] - P[FINGERS[a][1]]), _unit(P[FINGERS[b][2]] - P[FINGERS[b][1]]))))
    f.append(float(np.dot(_unit(P[3] - P[2]), _unit(P[6] - P[5]))))  # thumb vs index
    for i in range(5):
        for j in range(i + 1, 5): f.append(float(np.linalg.norm(P[TIPS[i]] - P[TIPS[j]])))
    for t in TIPS: f.append(float(np.linalg.norm(P[t])))
    for k in (5, 6, 9, 10, 13, 14, 17, 18): f.append(float(np.linalg.norm(P[4] - P[k])))  # thumb tip to knuckles
    up = _unit(P[9]); across = _unit(P[5] - P[17]); normal = _unit(np.cross(P[5], P[17]))
    f += up.tolist() + across.tolist() + normal.tolist()
    for t in TIPS: f += _unit(P[t] - P[t - 3]).tolist()  # each finger's pointing direction (camera frame)
    return np.asarray(f, dtype=np.float32)

_featurize_v1 = featurize
def featurize(hand, width, height, kind='both'):
    if kind == 'geo': return geo_features(image_points(hand, width, height))
    if kind == 'geo+image': return np.concatenate([geo_features(image_points(hand, width, height)), canon_image(hand, width, height)])
    return _featurize_v1(hand, width, height, kind)
