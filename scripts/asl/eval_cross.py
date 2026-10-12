"""Train on the Aslense letter clips, test on an independent image dataset (Marxulia v03,
other signers and cameras). usage: eval_cross.py <landmarks_dir> <images_lm.jsonl> [kinds] [models]"""
import sys, json, time
import numpy as np
from collections import Counter
from train_static import MODELS, samples_for  # noqa
from asl_common import STATIC_LETTERS, pick_hand, featurize

lm, imgs = sys.argv[1], sys.argv[2]
kinds = (sys.argv[3] if len(sys.argv) > 3 else 'world,image,both').split(',')
models = (sys.argv[4] if len(sys.argv) > 4 else 'knn,logreg,mlp').split(',')
rows = [json.loads(l) for l in open(imgs)]
for kind in kinds:
    X, y, g = samples_for(lm, kind)
    Xt, yt, miss = [], [], 0
    for r in rows:
        L = chr(ord('a') + r['label'])
        if L not in STATIC_LETTERS: continue
        h = pick_hand(r['hands'])
        if h is None: miss += 1; continue
        Xt.append(featurize(h, r['w'], r['h'], kind)); yt.append(STATIC_LETTERS.index(L))
    Xt, yt = np.array(Xt, np.float32), np.array(yt)
    for m in models:
        t0 = time.time(); clf = MODELS[m]().fit(X, y); p = clf.predict(Xt)
        P = clf.predict_proba(Xt); top3 = (np.argsort(-P, 1)[:, :3] == yt[:, None]).any(1).mean()
        conf = Counter((STATIC_LETTERS[a].upper() + '->' + STATIC_LETTERS[b].upper()) for a, b in zip(yt, p) if a != b).most_common(6)
        print(f'[{kind}] {m:7s} cross acc {(p == yt).mean():.3f} top3 {top3:.3f}  n={len(yt)} (no hand {miss})  confusions {conf}  ({time.time()-t0:.0f}s)', flush=True)
