"""Run MediaPipe HandLandmarker (the browser's float16 model) over every video in
<videos>/<gloss>/*, writing <out>/<gloss>.jsonl: one line per video with per-frame hands.

Frame record: [t_seconds, [[handedness, score, img(63), world(63)], ...]]
img = normalized x, y (0..1) and z; world = metres. Sampled at ~target fps.
"""
import json, os, sys, cv2, mediapipe as mp
from mediapipe.tasks.python import BaseOptions, vision

videos, out, model = sys.argv[1], sys.argv[2], sys.argv[3]
target_fps = float(sys.argv[4]) if len(sys.argv) > 4 else 15.0
only = set(sys.argv[5].split(',')) if len(sys.argv) > 5 else None
os.makedirs(out, exist_ok=True)

def make():
    return vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=model), running_mode=vision.RunningMode.VIDEO,
        num_hands=2, min_hand_detection_confidence=0.5, min_hand_presence_confidence=0.5,
        min_tracking_confidence=0.5))

r3 = lambda v: round(v, 4)
for gloss in sorted(os.listdir(videos)):
    if only and gloss not in only: continue
    dst = os.path.join(out, gloss + '.jsonl')
    done = set()
    if os.path.exists(dst):
        done = {json.loads(l)['video'] for l in open(dst)}
    with open(dst, 'a') as f:
        for name in sorted(os.listdir(os.path.join(videos, gloss))):
            if name in done: continue
            if os.environ.get('SKIP_AUG') and '_aug_' in name: continue
            cap = cv2.VideoCapture(os.path.join(videos, gloss, name))
            fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            stride = max(1, round(fps / target_fps))
            w, h = int(cap.get(3)), int(cap.get(4))
            lm = make(); frames = []; i = 0
            while True:
                ok, img = cap.read()
                if not ok: break
                if i % stride == 0:
                    t = i / fps
                    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
                    res = lm.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), int(t * 1000))
                    hands = []
                    for k, pts in enumerate(res.hand_landmarks):
                        hd = res.handedness[k][0]
                        wp = res.hand_world_landmarks[k]
                        hands.append([hd.category_name, r3(hd.score),
                                      [r3(c) for p in pts for c in (p.x, p.y, p.z)],
                                      [r3(c) for p in wp for c in (p.x, p.y, p.z)]])
                    frames.append([round(t, 3), hands])
                i += 1
            cap.release(); lm.close()
            f.write(json.dumps({'video': name, 'w': w, 'h': h, 'fps': fps, 'frames': frames}) + '\n'); f.flush()
    print(gloss, flush=True)
