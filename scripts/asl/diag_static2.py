"""Per-letter accuracy of the shipped letter model's recipe (geo + logreg C=0.1, Aslense +
ASLNow! in training): grouped CV on Aslense (clip vote) and the Marxulia cross test. JSON out."""
import json, sys, subprocess
import numpy as np
from collections import Counter, defaultdict
sys.argv = [sys.argv[0], sys.argv[1], sys.argv[2], sys.argv[3], '--kinds', 'none', '--models', 'logreg_c0.1']
exec(open('train_static2.py').read().split("for kind in a.kinds.split(','):")[0])
kind = 'geo'
XA, yA = XY(A_items, kind); gA = np.array([i[4] for i in A_items]); XN, yN = XY(N_items, kind); XM, yM = XY(M_items, kind)
clip_res = defaultdict(lambda: [0, 0]); conf = Counter()
for tr, te in GroupKFold(5).split(XA, yA, gA):
    clf = MODELS['logreg_c0.1']().fit(np.vstack([XA[tr], XN]), np.concatenate([yA[tr], yN])); p = clf.predict(XA[te])
    for clip in set(gA[te]):
        idx = np.where(gA[te] == clip)[0]; v = Counter(p[idx]).most_common(1)[0][0]; t = yA[te][idx[0]]
        clip_res[int(t)][0] += int(v == t); clip_res[int(t)][1] += 1
        if v != t: conf[(STATIC_LETTERS[t].upper(), STATIC_LETTERS[v].upper())] += 1
clf = MODELS['logreg_c0.1']().fit(np.vstack([XA, XN]), np.concatenate([yA, yN])); pm = clf.predict(XM)
marx = {STATIC_LETTERS[l].upper(): round(float((pm[yM == l] == l).mean()), 3) for l in sorted(set(yM))}
out = {'clip_cv': {STATIC_LETTERS[k].upper(): v for k, v in sorted(clip_res.items())}, 'marxulia': marx,
       'confusions': [[a, b, n] for (a, b), n in conf.most_common(12)]}
json.dump(out, open(sys.argv[0].replace('diag_static2.py', '../static_per_letter.json'), 'w'), indent=1)
print(json.dumps(out))
