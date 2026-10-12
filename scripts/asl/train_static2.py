"""Static letters, v2: Aslense clips + ASLNow! samples (another MediaPipe-web corpus, several
signers) for training; grouped CV on the Aslense clips (ASLNow! always in the training
folds); an untouched cross-source test on Marxulia. Optionally exports the chosen model.

usage: train_static2.py <landmarks_dir> <aslnow_dir> <marxulia_lm.jsonl> [--kinds geo,geo+image] [--models logreg,mlp] [--export out.json --export-kind K --export-model M]
"""
import argparse, glob, json, os, time
import numpy as np
from collections import Counter
from sklearn.model_selection import GroupKFold
from sklearn.neighbors import KNeighborsClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
from asl_common import STATIC_LETTERS, load, base_clip, pick_hand, featurize
import handedness as H

ap = argparse.ArgumentParser()
ap.add_argument('lm'); ap.add_argument('aslnow'); ap.add_argument('marx')
ap.add_argument('--kinds', default='geo,geo+image,image'); ap.add_argument('--models', default='logreg,mlp')
ap.add_argument('--no-aslnow', action='store_true'); ap.add_argument('--aspect', default='640x480')
ap.add_argument('--export'); ap.add_argument('--export-kind', default='geo+image'); ap.add_argument('--export-model', default='mlp')
a = ap.parse_args()
AW, AH = map(int, a.aspect.split('x'))

MODELS = {
    'knn': lambda: make_pipeline(StandardScaler(), KNeighborsClassifier(7)),
    'logreg': lambda: make_pipeline(StandardScaler(), LogisticRegression(max_iter=3000, C=0.5)),
    'mlp': lambda: make_pipeline(StandardScaler(), MLPClassifier((96,), alpha=3e-3, max_iter=500, random_state=0)),
    'logreg_c0.1': lambda: make_pipeline(StandardScaler(), LogisticRegression(max_iter=3000, C=0.1)),
    'logreg_c3': lambda: make_pipeline(StandardScaler(), LogisticRegression(max_iter=3000, C=3)),
    'mlp64_reg': lambda: make_pipeline(StandardScaler(), MLPClassifier((64,), alpha=3e-2, max_iter=500, random_state=0)),
    'mlp64_reg1': lambda: make_pipeline(StandardScaler(), MLPClassifier((64,), alpha=1.0, max_iter=800, random_state=0)),
}

# --- the hands, once (as [handedness, score, img, world] tuples + frame size) ---------------
t0 = time.time()
A_items = []  # (hand, w, h, label, group)
for li, L in enumerate(STATIC_LETTERS):
    for clip in load(a.lm, L):
        fr = [pick_hand(h) for t, h in clip['frames'] if h]
        n = len(fr)
        if n < 2: continue
        for hand in fr[int(n * 0.3):max(int(n * 0.3) + 1, int(n * 0.85))]:
            A_items.append((hand, clip['w'], clip['h'], li, L + '/' + base_clip(clip['video'])))
N_items = []
if not a.no_aslnow:
    hclf = H.fit(a.lm)
    for li, L in enumerate(STATIC_LETTERS):
        for f in sorted(glob.glob(os.path.join(a.aslnow, L.upper(), '*.json'))):
            pts = json.load(open(f))
            if len(pts) != 21: continue
            img = [c for p in pts for c in (p['x'], p['y'], p['z'])]
            left = bool(hclf.predict([H.geo_features(H.raw_points(img, AW, AH))])[0])
            N_items.append((['Left' if left else 'Right', 1.0, img, None], AW, AH, li, 'aslnow'))
M_items = []
for r in (json.loads(l) for l in open(a.marx)):
    L = chr(ord('a') + r['label'])
    h = pick_hand(r['hands'])
    if L in STATIC_LETTERS and h is not None: M_items.append((h, r['w'], r['h'], STATIC_LETTERS.index(L), 'marx'))
print(f'aslense {len(A_items)} frames / {len(set(i[4] for i in A_items))} clips; aslnow {len(N_items)}; marxulia {len(M_items)} ({time.time()-t0:.0f}s)', flush=True)

def XY(items, kind):
    return np.array([featurize(h, w, hh, kind) for h, w, hh, _, _ in items], np.float32), np.array([i[3] for i in items])

for kind in a.kinds.split(','):
    if kind in ('world', 'both') and N_items: print(f'[{kind}] needs world landmarks; ASLNow! has none, skipped'); continue
    XA, yA = XY(A_items, kind); gA = np.array([i[4] for i in A_items])
    XN, yN = XY(N_items, kind) if N_items else (np.zeros((0, XA.shape[1]), np.float32), np.zeros(0, int))
    XM, yM = XY(M_items, kind)
    for m in a.models.split(','):
        t0 = time.time(); fa, ca = [], []
        for tr, te in GroupKFold(5).split(XA, yA, gA):
            clf = MODELS[m]().fit(np.vstack([XA[tr], XN]), np.concatenate([yA[tr], yN]))
            p = clf.predict(XA[te]); fa.append((p == yA[te]).mean())
            for clip in set(gA[te]):
                idx = np.where(gA[te] == clip)[0]
                ca.append(Counter(p[idx]).most_common(1)[0][0] == yA[te][idx[0]])
        clf = MODELS[m]().fit(np.vstack([XA, XN]), np.concatenate([yA, yN]))
        pm = clf.predict(XM); P = clf.predict_proba(XM)
        top3 = (np.argsort(-P, 1)[:, :3] == yM[:, None]).any(1).mean()
        print(f'[{kind}] {m:6s} aslense-CV frame {np.mean(fa):.3f} clip {np.mean(ca):.3f} | marxulia {(pm == yM).mean():.3f} (top3 {top3:.3f}) ({time.time()-t0:.0f}s)', flush=True)

if a.export:
    kind = a.export_kind
    XA, yA = XY(A_items, kind); XN, yN = XY(N_items, kind) if N_items else (np.zeros((0, XA.shape[1])), np.zeros(0, int))
    XM, yM = XY(M_items, kind)
    # The shipped model is trained on the two MIT-licensed corpora only; Marxulia (no stated
    # licence) stays a test set, so the cross-source number above measures exactly this recipe.
    clf = MODELS[a.export_model]().fit(np.vstack([XA, XN]), np.concatenate([yA, yN]))
    sc, est = clf.steps[0][1], clf.steps[1][1]
    # A logistic regression is the zero-hidden-layer case of the same format.
    layers = ([{'W': est.coef_.round(5).tolist(), 'b': est.intercept_.round(5).tolist()}] if hasattr(est, 'coef_')
              else [{'W': W.T.round(5).tolist(), 'b': b.round(5).tolist()} for W, b in zip(est.coefs_, est.intercepts_)])
    json.dump({'format': 'thoremin-asl-mlp/1', 'features': kind, 'labels': [l.upper() for l in STATIC_LETTERS],
               'mean': sc.mean_.round(5).tolist(), 'scale': sc.scale_.round(5).tolist(), 'layers': layers,
               'meta': {'trainedOn': 'Aslense (HF ZahidYasinMittha/American-Sign-Language-Dataset, MIT) + ASLNow! (HF sid220/asl-now-fingerspelling, MIT)', 'model': a.export_model}},
              open(a.export, 'w'), separators=(',', ':'))
    print('exported', a.export)
