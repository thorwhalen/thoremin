"""Static ASL letters: build frame samples from the letter clips, compare classifiers with
cross-validation GROUPED BY SOURCE CLIP, then (with --export) fit the chosen MLP on everything
and write its weights as JSON for packages/asl.

usage: train_static.py <landmarks_dir> [--export out.json] [--kinds world,image,both]
"""
import argparse, json, sys, time
import numpy as np
from collections import Counter
from sklearn.model_selection import GroupKFold
from sklearn.neighbors import KNeighborsClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
from asl_common import STATIC_LETTERS, load, base_clip, pick_hand, featurize


def samples_for(lm, kind, lo=0.3, hi=0.85):
    X, y, g = [], [], []
    for li, L in enumerate(STATIC_LETTERS):
        for clip in load(lm, L):
            fr = [(t, pick_hand(h)) for t, h in clip['frames'] if h]
            if len(fr) < 2: continue
            n = len(fr); i0, i1 = int(n * lo), max(int(n * lo) + 1, int(n * hi))
            for t, hand in fr[i0:i1]:
                X.append(featurize(hand, clip['w'], clip['h'], kind)); y.append(li); g.append(L + '/' + base_clip(clip['video']))
    return np.array(X, np.float32), np.array(y), np.array(g)

samples = lambda kind: samples_for(a.lm, kind, a.lo, a.hi)

MODELS = {
    'knn': lambda: make_pipeline(StandardScaler(), KNeighborsClassifier(5)),
    'logreg': lambda: make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, C=1.0)),
    'mlp': lambda: make_pipeline(StandardScaler(), MLPClassifier((128, 64), alpha=1e-3, max_iter=600, early_stopping=False, random_state=0)),
}
if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('lm'); ap.add_argument('--export'); ap.add_argument('--kinds', default='world,image,both')
    ap.add_argument('--lo', type=float, default=0.3); ap.add_argument('--hi', type=float, default=0.85)
    ap.add_argument('--models', default='knn,logreg,mlp')
    a = ap.parse_args()

    results = {}
    for kind in a.kinds.split(','):
        X, y, g = samples(kind)
        print(f'[{kind}] {len(X)} frames, {len(set(g))} clips, dims {X.shape[1]}', flush=True)
        for m in a.models.split(','):
            t0 = time.time(); fa, ca = [], []
            for tr, te in GroupKFold(5).split(X, y, g):
                clf = MODELS[m]().fit(X[tr], y[tr]); p = clf.predict(X[te])
                fa.append((p == y[te]).mean())
                # clip vote
                for clip in set(g[te]):
                    idx = np.where(g[te] == clip)[0]
                    ca.append(Counter(p[idx]).most_common(1)[0][0] == y[te][idx[0]])
            results[(kind, m)] = (np.mean(fa), np.mean(ca))
            print(f'  {m:7s} frame acc {np.mean(fa):.3f}  clip-vote acc {np.mean(ca):.3f}  ({time.time()-t0:.0f}s)', flush=True)

    if a.export:
        kind = 'both' if 'both' in a.kinds else a.kinds.split(',')[0]
        X, y, g = samples(kind)
        clf = MODELS['mlp']().fit(X, y)
        sc, mlp = clf.steps[0][1], clf.steps[1][1]
        out = {
            'format': 'thoremin-asl-mlp/1', 'features': kind, 'labels': [l.upper() for l in STATIC_LETTERS],
            'mean': sc.mean_.round(5).tolist(), 'scale': sc.scale_.round(5).tolist(),
            'layers': [{'W': W.T.round(5).tolist(), 'b': b.round(5).tolist()} for W, b in zip(mlp.coefs_, mlp.intercepts_)],
            'activation': 'relu', 'output': 'softmax',
        }
        json.dump(out, open(a.export, 'w'), separators=(',', ':'))
        print('exported', a.export)
