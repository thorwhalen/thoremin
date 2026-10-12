"""Write test/fixtures/asl/clips.json: a few real clips (training data: this is a regression
replay of the whole recogniser, not an accuracy measure) as browser-shaped hand frames.
usage: make_replay_fixture.py <landmarks_dir> <out.json> gloss:index ..."""
import json, sys
import numpy as np
from asl_common import load

lm, out = sys.argv[1], sys.argv[2]
clips = []
for spec in sys.argv[3:]:
    gloss, i = spec.split(':'); c = load(lm, gloss)[int(i)]
    frames = []
    for t, hands in c['frames']:
        hs = []
        for h in hands:
            pts = np.asarray(h[2]).reshape(21, 3); wp = np.asarray(h[3]).reshape(21, 3)
            hs.append({'handedness': h[0],
                       'keypoints': [{'x': round(float(p[0] * c['w']), 1), 'y': round(float(p[1] * c['h']), 1), 'z': round(float(p[2]), 4)} for p in pts],
                       'worldKeypoints': [{'x': round(float(p[0]), 4), 'y': round(float(p[1]), 4), 'z': round(float(p[2]), 4)} for p in wp]})
        frames.append({'t': t, 'hands': hs})
    clips.append({'gloss': gloss, 'video': c['video'], 'width': c['w'], 'height': c['h'], 'frames': frames})
json.dump({'source': 'Aslense (HF ZahidYasinMittha/American-Sign-Language-Dataset, MIT), MediaPipe hand landmarks', 'clips': clips}, open(out, 'w'), separators=(',', ':'))
print('wrote', out, [(c['gloss'], len(c['frames'])) for c in clips])
