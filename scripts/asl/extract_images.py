"""Landmarks for an image-classification parquet (image bytes + int label 0..25 = A..Z).
Pads each crop (tight hand crops defeat the palm detector), IMAGE mode, writes jsonl rows
{i, label, w, h, hands}. usage: extract_images.py <parquet> <out.jsonl> <model> [per_label]"""
import io, json, sys, random
import numpy as np, pyarrow.parquet as pq, mediapipe as mp
from PIL import Image, ImageOps
from mediapipe.tasks.python import BaseOptions, vision
src, out, model = sys.argv[1:4]; per = int(sys.argv[4]) if len(sys.argv) > 4 else 60
t = pq.read_table(src); labels = t.column('label').to_pylist()
random.seed(0); by = {}
for i, l in enumerate(labels): by.setdefault(l, []).append(i)
pick = sorted(i for l, ix in by.items() for i in random.sample(ix, min(per, len(ix))))
lm = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
    base_options=BaseOptions(model_asset_path=model), running_mode=vision.RunningMode.IMAGE, num_hands=2,
    min_hand_detection_confidence=0.3))
r3 = lambda v: round(v, 4); found = 0
with open(out, 'w') as f:
    for i in pick:
        im = Image.open(io.BytesIO(t.column('image')[i].as_py()['bytes'])).convert('RGB')
        pad = int(0.35 * max(im.size)); im = ImageOps.expand(im, border=pad, fill=(128, 128, 128))
        res = lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.asarray(im)))
        hands = [[res.handedness[k][0].category_name, r3(res.handedness[k][0].score),
                  [r3(c) for p in pts for c in (p.x, p.y, p.z)],
                  [r3(c) for p in res.hand_world_landmarks[k] for c in (p.x, p.y, p.z)]]
                 for k, pts in enumerate(res.hand_landmarks)]
        found += bool(hands)
        f.write(json.dumps({'i': i, 'label': labels[i], 'w': im.size[0], 'h': im.size[1], 'hands': hands}) + '\n')
print('images', len(pick), 'with hands', found)
