"""Motion signs (J, Z and the words): windows of the signing hand's recent frames, classified
by a small MLP against 'none' (held letters, a hand moving into place). Cross-validated by
source clip, then (with --export) fit on everything.

usage: train_motion.py <landmarks_dir> <static_model.json> [--export out.json] [--thresh 0.6]
"""
import argparse, json, random, time
import numpy as np
from collections import Counter, defaultdict
from sklearn.model_selection import GroupKFold
from sklearn.neural_network import MLPClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
from asl_common import STATIC_LETTERS, load, base_clip, pick_hand
from motion_common import MOTION_SIGNS, WINDOWS, load_mlp, frame_record, window_features

ap = argparse.ArgumentParser()
ap.add_argument('lm'); ap.add_argument('static'); ap.add_argument('--export')
ap.add_argument('--thresh', type=float, default=0.6); ap.add_argument('--step', type=float, default=1 / 6)
ap.add_argument('--none-per-clip', type=int, default=12)
ap.add_argument('--sweep', default='0.6,0.7,0.8,0.9')
a = ap.parse_args()
static = load_mlp(a.static)
LABELS = MOTION_SIGNS + ['none']
random.seed(0)

def clip_records(clip):
    out = []
    for t, hands in clip['frames']:
        h = pick_hand(hands)
        if h is not None: out.append((t, frame_record(static, h, clip['w'], clip['h'])))
    return out

def windows(recs, min_frames=4):
    """Every (D, end) window over a clip, as in the browser: frames in (end - D, end]."""
    if len(recs) < min_frames: return
    ts = np.array([t for t, _ in recs])
    for D in WINDOWS:
        e = ts[0] + D * 0.5
        while e <= ts[-1] + 1e-6:
            idx = np.where((ts > e - D) & (ts <= e))[0]
            if len(idx) >= min_frames: yield D, e, [recs[i] for i in idx]
            e += a.step

t0 = time.time()
clips = []  # (label, group, recs, span)
for L in MOTION_SIGNS:
    for c in load(a.lm, L):
        r = clip_records(c)
        if len(r) >= 4: clips.append((L, L + '/' + base_clip(c['video']), r))
for L in STATIC_LETTERS:
    for c in load(a.lm, L):
        r = clip_records(c)
        if len(r) >= 4: clips.append(('none', L + '/' + base_clip(c['video']), r))
print('clips', Counter(c[0] for c in clips), f'({time.time()-t0:.0f}s)', flush=True)

X, y, g = [], [], []
for lab, grp, recs in clips:
    span0, span1 = recs[0][0], recs[-1][0]; span = max(span1 - span0, 1e-3)
    ws = list(windows(recs))
    if lab == 'none':
        ws = random.sample(ws, min(len(ws), a.none_per_clip))
    for D, e, fr in ws:
        cover = (fr[-1][0] - fr[0][0]) / span
        if lab != 'none' and cover < 0.6: continue
        X.append(window_features(fr)); y.append(LABELS.index(lab)); g.append(grp)
X, y, g = np.array(X), np.array(y), np.array(g)
print('windows', X.shape, Counter(LABELS[i] for i in y), flush=True)

def make(): return make_pipeline(StandardScaler(), MLPClassifier((64,), alpha=1e-2, max_iter=800, random_state=0))

# Cross-validation: window accuracy, and the clip-level behaviour the app sees.
pw, pc, fp = [], [], []
per_class = defaultdict(list)
clip_best = []  # (true label, best sign label, best sign prob) per held-out clip
gkf = GroupKFold(5)
for tr, te in gkf.split(X, y, g):
    clf = make().fit(X[tr], y[tr]); pw.append((clf.predict(X[te]) == y[te]).mean())
    test_groups = set(g[te])
    for lab, grp, recs in clips:
        if grp not in test_groups: continue
        F = [window_features(fr) for _, _, fr in windows(recs)]
        if not F: continue
        P = clf.predict_proba(np.array(F))
        none = LABELS.index('none')
        sign = P.copy(); sign[:, none] = 0
        best = np.unravel_index(sign.argmax(), sign.shape)
        clip_best.append((lab, LABELS[best[1]], float(sign.max())))
        detected = LABELS[best[1]] if sign.max() >= a.thresh else 'none'
        if lab == 'none':
            fp.append(detected != 'none')
        else:
            pc.append(detected == lab); per_class[lab].append(detected)
print(f'window acc {np.mean(pw):.3f} | sign clips detected correctly {np.mean(pc):.3f} | static clips with a false motion sign {np.mean(fp):.3f} (thresh {a.thresh})')
for th in map(float, a.sweep.split(',')):
    sig = [(l, b, p) for l, b, p in clip_best if l != 'none']; non = [(l, b, p) for l, b, p in clip_best if l == 'none']
    print(f'  threshold {th:.2f}: signs detected {np.mean([b == l and p >= th for l, b, p in sig]):.3f}, held letters with a false sign {np.mean([p >= th for _, _, p in non]):.3f}')
for lab in MOTION_SIGNS:
    c = Counter(per_class[lab]); n = len(per_class[lab])
    print(f'  {lab:9s} {c[lab]}/{n}  confused with {[(k, v) for k, v in c.most_common() if k != lab][:3]}')

if a.export:
    clf = make().fit(X, y)
    sc, mlp = clf.steps[0][1], clf.steps[1][1]
    json.dump({
        'format': 'thoremin-asl-mlp/1', 'features': 'asl-motion/1', 'labels': [l.upper() if len(l) == 1 else l for l in LABELS],
        'mean': sc.mean_.round(5).tolist(), 'scale': sc.scale_.round(5).tolist(),
        'layers': [{'W': W.T.round(5).tolist(), 'b': b.round(5).tolist()} for W, b in zip(mlp.coefs_, mlp.intercepts_)],
        'meta': {'windows': list(WINDOWS), 'tPost': 4, 'tPath': 8, 'minFrames': 4, 'threshold': a.thresh},
    }, open(a.export, 'w'), separators=(',', ':'))
    print('exported', a.export)
