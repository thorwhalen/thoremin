"""Write test/fixtures/asl/parity.json: a few real hands and one real motion window, with the
features and probabilities the TRAINING code computes for them. The TS test recomputes them
with packages/asl and must agree, which pins the two featurisers together.

usage: make_parity_fixture.py <landmarks_dir> <static.json> <motion.json> <out.json>
"""
import json, sys
import numpy as np
from asl_common import load, pick_hand, featurize
from motion_common import load_mlp, mlp_predict, frame_record, window_features

lm, sp, mp_, out = sys.argv[1:5]
static, motion = load_mlp(sp), load_mlp(mp_)

def browser_hand(h, w, hh):
    pts = np.asarray(h[2]).reshape(21, 3); wp = np.asarray(h[3]).reshape(21, 3)
    return {'handedness': h[0],
            'keypoints': [{'x': float(p[0] * w), 'y': float(p[1] * hh), 'z': float(p[2])} for p in pts],
            'worldKeypoints': [{'x': float(p[0]), 'y': float(p[1]), 'z': float(p[2])} for p in wp]}

hands = []
for gloss in ('f', 'h', 'y'):
    for clip in load(lm, gloss):
        fr = [(t, pick_hand(h)) for t, h in clip['frames'] if h]
        if not fr: continue
        t, h = fr[len(fr) // 2]
        if any(x['hand']['handedness'] == h[0] for x in hands) and len(hands) >= 2: continue
        hands.append({'gloss': gloss, 'width': clip['w'], 'height': clip['h'], 'hand': browser_hand(h, clip['w'], clip['h']),
                      'features': featurize(h, clip['w'], clip['h'], static['features']).round(6).tolist(),
                      'post': mlp_predict(static, featurize(h, clip['w'], clip['h'], static['features'])).round(6).tolist()})
        break

clip = load(lm, 'yes')[0]
frames = [(t, pick_hand(h)) for t, h in clip['frames'] if h][:14]
recs = [(t, frame_record(static, h, clip['w'], clip['h'])) for t, h in frames]
wf = window_features(recs)
window = {'width': clip['w'], 'height': clip['h'],
          'frames': [{'t': t, 'hand': browser_hand(h, clip['w'], clip['h'])} for t, h in frames],
          'features': wf.round(6).tolist(), 'probs': mlp_predict(motion, wf).round(6).tolist()}
json.dump({'hands': hands, 'window': window}, open(out, 'w'), indent=1)
print('wrote', out, len(hands), 'hands,', len(frames), 'window frames')
