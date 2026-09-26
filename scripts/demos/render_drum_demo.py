"""Render a drums demo: footage + the pose model's arms + the wrist strokes, with sound.

Reads a ``drum_strokes_timeline.ts`` output, the source video and its pose stream, and
writes an mp4 in which:

- both arms (shoulder, elbow, wrist) are drawn, and a wrist flashes a ring the moment
  the ictus detector calls a stroke on it (the ring's colour is the drum its landing
  point was assigned to);
- a scrolling strip under the picture, two seconds wide, shows the audio's hit onsets
  (white) against the strokes of each wrist (coloured), so a hit with no stroke under
  it is one the wrists did not see.

The soundtrack depends on ``--mode``:

- ``real`` (a real drummer, with audio onsets): STEREO, the original recording in the
  left ear and a click at every detected stroke in the right, so the missed hits are
  heard as recording without a click.
- ``air`` (an air drummer): a synthesised kit, one sound per assigned drum, at every
  stroke, with the original audio mixed underneath at ``--original-gain``.

Usage::

    python3 scripts/demos/render_drum_demo.py --strokes S.json --video V.mp4 --pose P.ndjson.gz \
        --start 258 --duration 12 --mode real --out OUT.mp4
"""

import argparse
import gzip
import json
import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np

SR = 44100
STRIP_H = 80
STRIP_SPAN = 2.0
ARM = {'left': (11, 13, 15), 'right': (12, 14, 16)}  # MediaPipe pose: shoulder, elbow, wrist
WRIST_COLOR = {'left': (40, 160, 255), 'right': (255, 200, 60)}  # BGR
DRUM_COLORS = [(40, 160, 255), (80, 220, 120), (230, 90, 200), (60, 60, 230), (255, 200, 60)]
KIT = ['kick', 'snare', 'hat', 'tom_hi', 'tom_lo', 'crash']


def kit_sound(name, *, seed=0):
    """Small synthetic drum kit; each piece is a pitched decay and/or filtered noise."""
    rng = np.random.default_rng(seed)
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    noise = rng.normal(0, 1, n)
    if name == 'kick':
        return np.sin(2 * np.pi * 55 * t * (1 + 1.5 * np.exp(-t / 0.03))) * np.exp(-t / 0.15)
    if name == 'snare':
        return 0.5 * np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.05) + 0.6 * noise * np.exp(-t / 0.07)
    if name == 'hat':
        hp = np.diff(noise, prepend=0)
        return 0.5 * hp * np.exp(-t / 0.03)
    if name in ('tom_hi', 'tom_lo'):
        f = 160 if name == 'tom_hi' else 105
        return np.sin(2 * np.pi * f * t * (1 + 0.3 * np.exp(-t / 0.05))) * np.exp(-t / 0.2)
    hp = np.diff(noise, prepend=0)
    return 0.35 * hp * np.exp(-t / 0.4)  # crash


def click():
    n = int(0.03 * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * 2000 * t) * np.exp(-t / 0.004)


def load_pose(path, t0, t1):
    opener = gzip.open if str(path).endswith('.gz') else open
    out = {}
    with opener(path, 'rt') as f:
        for line in f:
            r = json.loads(line)
            if t0 - 1 <= r['t'] <= t1 + 1 and r['value'].get('present'):
                out[round(r['t'], 4)] = r['value']['landmarks']
            elif r['t'] > t1 + 1:
                break
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--strokes', required=True)
    ap.add_argument('--video', required=True)
    ap.add_argument('--pose', required=True)
    ap.add_argument('--start', type=float, required=True)
    ap.add_argument('--duration', type=float, default=12)
    ap.add_argument('--mode', choices=['real', 'air'], default='real')
    ap.add_argument('--width', type=int, default=960)
    ap.add_argument('--original-gain', type=float, default=0.3)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()

    doc = json.loads(Path(a.strokes).read_text())
    t0, t1 = a.start, a.start + a.duration
    strokes = [s for s in doc['strokes'] if t0 - STRIP_SPAN <= s['t'] <= t1 + STRIP_SPAN]
    onsets = [o for o in doc.get('onsets', []) if t0 - STRIP_SPAN <= o <= t1 + STRIP_SPAN]
    pose = load_pose(a.pose, t0, t1)
    ptimes = np.array(sorted(pose))
    # Each wrist's drums, ordered left to right, index into the colour table.
    n_left = len([c for c in doc['clusters'] if c['wrist'] == 'left'])

    def drum_color(s):
        if s['drum'] is None:
            return WRIST_COLOR[s['wrist']]
        k = s['drum'] + (n_left if s['wrist'] == 'right' else 0)
        return DRUM_COLORS[k % len(DRUM_COLORS)]

    cap = cv2.VideoCapture(a.video)
    fps = cap.get(cv2.CAP_PROP_FPS)
    W0, H0 = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    scale = a.width / W0
    W, H = a.width, int(round(H0 * scale / 2) * 2)
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(round(t0 * fps)))
    tmp = Path(tempfile.mkdtemp())
    silent = tmp / 'v.mp4'
    enc = subprocess.Popen(
        ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H + STRIP_H}',
         '-r', str(fps), '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', str(silent)],
        stdin=subprocess.PIPE,
    )
    font = cv2.FONT_HERSHEY_SIMPLEX
    for i in range(int(a.duration * fps)):
        ok, frame = cap.read()
        if not ok:
            break
        now = t0 + i / fps
        img = np.zeros((H + STRIP_H, W, 3), np.uint8)
        img[:H] = cv2.resize(frame, (W, H), interpolation=cv2.INTER_AREA)
        if len(ptimes):
            k = int(np.abs(ptimes - now).argmin())
            if abs(ptimes[k] - now) < 0.05:
                lms = pose[ptimes[k]]
                for wrist, (sh, el, wr) in ARM.items():
                    pts = [(int(lms[j]['x'] * scale), int(lms[j]['y'] * scale)) for j in (sh, el, wr)]
                    cv2.line(img, pts[0], pts[1], (240, 240, 240), 2, cv2.LINE_AA)
                    cv2.line(img, pts[1], pts[2], (240, 240, 240), 2, cv2.LINE_AA)
                    cv2.circle(img, pts[2], 6, WRIST_COLOR[wrist], -1, cv2.LINE_AA)
                    for s in strokes:
                        if s['wrist'] == wrist and 0 <= now - s['t'] < 0.12:
                            cv2.circle(img, pts[2], 26, drum_color(s), 4, cv2.LINE_AA)
        # The strip.
        y0 = H
        cv2.rectangle(img, (0, y0), (W, H + STRIP_H), (25, 25, 25), -1)
        x_of = lambda t: int(W / 2 + (t - now) / STRIP_SPAN * W)
        vis = lambda t: abs(t - now) < STRIP_SPAN / 2 + 0.05
        for o in onsets:
            if vis(o):
                cv2.line(img, (x_of(o), y0 + 8), (x_of(o), y0 + 30), (255, 255, 255), 2)
        for s in strokes:
            if vis(s['t']):
                yy = y0 + 42 if s['wrist'] == 'left' else y0 + 62
                cv2.drawMarker(img, (x_of(s['t']), yy), drum_color(s), cv2.MARKER_TRIANGLE_UP, 12, 2)
        cv2.line(img, (W // 2, y0), (W // 2, H + STRIP_H), (0, 220, 255), 1)
        cv2.rectangle(img, (0, y0), (108, H + STRIP_H), (25, 25, 25), -1)
        if onsets:
            cv2.putText(img, 'audio hits', (6, y0 + 24), font, 0.42, (255, 255, 255), 1, cv2.LINE_AA)
        cv2.putText(img, 'left wrist', (6, y0 + 46), font, 0.42, WRIST_COLOR['left'], 1, cv2.LINE_AA)
        cv2.putText(img, 'right wrist', (6, y0 + 66), font, 0.42, WRIST_COLOR['right'], 1, cv2.LINE_AA)
        if onsets:
            heard = sum(1 for o in onsets if t0 <= o <= now)
            seen = sum(1 for s in strokes if t0 <= s['t'] <= now)
            cv2.rectangle(img, (0, 0), (W, 44), (20, 20, 20), -1)
            cv2.putText(img, f'audio hits so far: {heard}    wrist strokes: {seen}', (14, 30), font, 0.8, (235, 235, 235), 2, cv2.LINE_AA)
        enc.stdin.write(img.tobytes())
    enc.stdin.close()
    enc.wait()

    # Sound.
    n = int(SR * a.duration)
    orig = tmp / 'o.f32'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', str(t0), '-t', str(a.duration), '-i', a.video,
                    '-vn', '-ac', '1', '-ar', str(SR), '-f', 'f32le', str(orig)], check=True)
    o = np.zeros(n)
    raw = np.fromfile(orig, dtype=np.float32)[:n]
    o[: len(raw)] = raw / (np.abs(raw).max() + 1e-9)
    hits = np.zeros(n + SR)
    if a.mode == 'real':
        c = click()
        for s in strokes:
            i = int(SR * (s['t'] - t0))
            if 0 <= i < n:
                hits[i : i + len(c)] += c
        right = hits[:n] / (np.abs(hits).max() + 1e-9) * 0.8
        stereo = np.stack([0.9 * o, right], axis=1)
        channels = 2
    else:
        sounds = {}
        for s in strokes:
            i = int(SR * (s['t'] - t0))
            if not 0 <= i < n:
                continue
            k = 0 if s['drum'] is None else s['drum'] + (n_left if s['wrist'] == 'right' else 0)
            name = KIT[k % len(KIT)]
            if name not in sounds:
                sounds[name] = kit_sound(name)
            hits[i : i + len(sounds[name])] += sounds[name]
        mix = hits[:n] / (np.abs(hits).max() + 1e-9) * 0.85 + a.original_gain * o
        stereo = (mix / (np.abs(mix).max() + 1e-9) * 0.9)[:, None]
        channels = 1
    wav = tmp / 'a.f32'
    stereo.astype(np.float32).tofile(wav)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(silent), '-f', 'f32le', '-ar', str(SR), '-ac', str(channels),
                    '-i', str(wav), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', a.out], check=True)
    print(f'wrote {a.out}')


if __name__ == '__main__':
    main()
