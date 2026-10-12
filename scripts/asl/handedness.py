"""A geometry -> MediaPipe-handedness classifier (trained on Aslense, whose frames carry the
label), for sources that have landmarks but no handedness (ASLNow!)."""
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
from asl_common import LETTERS, WORDS, load, geo_features

def raw_points(img_flat, w, h):
    p = np.asarray(img_flat, dtype=np.float64).reshape(21, 3).copy()
    p[:, 0] *= w; p[:, 1] *= h; p[:, 2] *= w
    return p

def dataset(lm):
    X, y, g = [], [], []
    for gl in LETTERS + WORDS:
        for c in load(lm, gl):
            for t, hands in c['frames'][::3]:
                for hd in hands:
                    X.append(geo_features(raw_points(hd[2], c['w'], c['h']))); y.append(hd[0] == 'Left'); g.append(gl + c['video'])
    return np.array(X), np.array(y), np.array(g)

def fit(lm):
    X, y, _ = dataset(lm)
    return make_pipeline(StandardScaler(), LogisticRegression(max_iter=3000)).fit(X, y)

if __name__ == '__main__':
    import sys
    from sklearn.model_selection import GroupKFold, cross_val_score
    X, y, g = dataset(sys.argv[1])
    print(len(X), 'hands, Left share', y.mean().round(3))
    print('grouped CV acc', cross_val_score(make_pipeline(StandardScaler(), LogisticRegression(max_iter=3000)), X, y, groups=g, cv=GroupKFold(5)).round(3))
