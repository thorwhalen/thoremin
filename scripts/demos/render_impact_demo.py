"""Render an ``an.impacts`` clip with its ground truth drawn on, optionally sonified.

The picture is the rendered clip (``clip.mp4``) plus:

- the contact plane (surface clips) or the turn level (air clips), and a ring at the
  exact impact point on the frame nearest each impact;
- a scrolling time strip under the picture, one second wide, centred on "now": grey
  ticks are the instants the camera captured a frame, white bars the true impacts
  (``t_impact``), blue ticks the intended beat (``t_grid``), and, when a strategy is
  given, its sounded onsets in that strategy's colour. The distance between a white
  bar and a coloured tick is the timing error you hear.

The soundtrack, when ``--strategy`` is given, is a synthesised drum hit at each onset
of that strategy (``impact_onsets.ts`` output); ``--strategy truth`` sounds the exact
impacts, the ideal. ``--speed 0.25`` renders slow motion: each camera frame is held
while the strip and the playhead keep moving, and the hits are re-timed (not
stretched), so a 30 ms error becomes 120 ms and is easy to hear and see.

Usage::

    python3 scripts/demos/render_impact_demo.py --clip DIR --onsets ON.json \
        --strategy predicted --out OUT.mp4 [--speed 1] [--start 0] [--duration 0] [--gif OUT.gif]
"""

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np

SR = 44100
OUT_FPS = 30
STRIP_H = 90
STRIP_SPAN = 1.0  # seconds across the strip
COLORS = {  # BGR
    'truth': (255, 255, 255),
    'frameSnapped': (60, 90, 235),
    'predicted': (90, 200, 90),
    'magnet': (230, 170, 60),
}
LABELS = {
    'truth': 'exact impacts (ideal)',
    'frameSnapped': 'frame-snapped (baseline)',
    'predicted': 'predicted',
    'magnet': 'predicted + pulled to grid',
}


def drum(seed=0):
    """A short, dry, woody hit: a pitched decay plus a noise click."""
    rng = np.random.default_rng(seed)
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    body = np.sin(2 * np.pi * 180 * t * (1 - 0.3 * t)) * np.exp(-t / 0.03)
    click = rng.normal(0, 1, n) * np.exp(-t / 0.004)
    return 0.6 * body + 0.25 * click


def audio_for(onsets, t0, duration, speed):
    track = np.zeros(int(SR * duration / speed) + SR)
    hit = drum()
    for t in onsets:
        if t0 <= t < t0 + duration:
            i = int(SR * (t - t0) / speed)
            track[i : i + len(hit)] += hit[: len(track) - i]
    return track[: int(SR * duration / speed)]


def draw_strip(img, now, *, frames_t, impacts, grids, onsets, color):
    h, w = img.shape[:2]
    y0 = h - STRIP_H
    cv2.rectangle(img, (0, y0), (w, h), (25, 25, 25), -1)
    x_of = lambda t: int(w / 2 + (t - now) / STRIP_SPAN * w)
    visible = lambda t: abs(t - now) < STRIP_SPAN / 2 + 0.05
    for t in frames_t:
        if visible(t):
            cv2.line(img, (x_of(t), y0 + 55), (x_of(t), y0 + 75), (120, 120, 120), 1)
    for t in grids:
        if visible(t):
            cv2.line(img, (x_of(t), y0 + 8), (x_of(t), y0 + 20), (230, 120, 40), 3)
    for t in impacts:
        if visible(t):
            cv2.line(img, (x_of(t), y0 + 22), (x_of(t), y0 + 52), (255, 255, 255), 3)
    for t in onsets or []:
        if visible(t):
            x = x_of(t)
            cv2.drawMarker(img, (x, y0 + 40), color, cv2.MARKER_TRIANGLE_UP, 16, 3)
    cv2.line(img, (w // 2, y0), (w // 2, h), (0, 220, 255), 1)
    font = cv2.FONT_HERSHEY_SIMPLEX
    cv2.rectangle(img, (0, y0), (92, h), (25, 25, 25), -1)
    cv2.putText(img, 'camera frames', (6, y0 + 86), font, 0.38, (150, 150, 150), 1, cv2.LINE_AA)
    cv2.putText(img, 'beat grid', (6, y0 + 16), font, 0.38, (230, 120, 40), 1, cv2.LINE_AA)
    cv2.putText(img, 'true impact', (6, y0 + 38), font, 0.38, (255, 255, 255), 1, cv2.LINE_AA)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--clip', required=True)
    ap.add_argument('--onsets', required=True)
    ap.add_argument('--strategy', default=None, choices=[None, *COLORS])
    ap.add_argument('--speed', type=float, default=1.0)
    ap.add_argument('--start', type=float, default=0.0)
    ap.add_argument('--duration', type=float, default=0.0, help='0 = to the end')
    ap.add_argument('--out', required=True)
    ap.add_argument('--gif', default=None)
    a = ap.parse_args()

    clip = Path(a.clip)
    truth = json.loads((clip / 'truth.json').read_text())
    on = json.loads(Path(a.onsets).read_text())
    obj = truth['objects'][0]
    frames = truth['frames']
    frames_t = [f['t_reported'] for f in frames]
    impacts = [e['t_impact'] for e in truth['events']]
    grids = [e['t_grid'] for e in truth['events']]
    impact_xy = {round(e['t_impact'], 6): e['impact_xy'] for e in truth['events']}
    if a.strategy == 'truth':
        onsets = impacts
    elif a.strategy:
        onsets = [o['t'] for o in on['onsets'][a.strategy]]
    else:
        onsets = None
    color = COLORS.get(a.strategy or 'truth')

    cap = cv2.VideoCapture(str(clip / 'clip.mp4'))
    imgs = []
    while True:
        ok, img = cap.read()
        if not ok:
            break
        imgs.append(img)
    W, H0 = imgs[0].shape[1], imgs[0].shape[0]
    fps = truth['clip']['fps']
    duration = a.duration or (len(imgs) / fps - a.start)
    n_out = int(duration / a.speed * OUT_FPS)

    tmp = Path(tempfile.mkdtemp())
    silent = tmp / 'v.mp4'
    enc = subprocess.Popen(
        ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H0 + STRIP_H}',
         '-r', str(OUT_FPS), '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', str(silent)],
        stdin=subprocess.PIPE,
    )
    surface = obj.get('surface_xy')
    level_y = int(truth['events'][0]['impact_xy'][1]) if truth['events'] else None
    for k in range(n_out):
        now = a.start + k * a.speed / OUT_FPS
        # The frame the camera has shown by `now` (the last one reported at or before it).
        idx = max(0, min(len(imgs) - 1, int(np.searchsorted(frames_t, now, side='right')) - 1))
        img = np.zeros((H0 + STRIP_H, W, 3), np.uint8)
        img[:H0] = imgs[idx]
        # The plane the stroke hits (surface) or turns at (air).
        if level_y is not None:
            dash = 1 if truth['spec']['kind'] == 'surface' else 3
            for x in range(0, W, 12 * dash):
                cv2.line(img, (x, level_y), (x + 6 * dash, level_y), (170, 170, 170), 1)
        # A ring on the frame nearest each impact, at the exact contact point.
        for e in truth['events']:
            near = e['frames']['nearest']
            if near == idx:
                x, y = map(int, e['impact_xy'])
                cv2.circle(img, (x, y), 14, (40, 40, 220), 2, cv2.LINE_AA)
        # Flash when a hit sounds, and say how far it is from the true contact.
        if onsets:
            for t in onsets:
                if 0 <= now - t < max(0.06 * a.speed, a.speed / OUT_FPS):
                    cv2.rectangle(img, (0, 0), (W - 1, H0 - 1), color, 6)
                if a.strategy != 'truth' and 0 <= now - t < 0.35 * max(1, a.speed * 2):
                    err = 1000 * (t - min(impacts, key=lambda x: abs(x - t)))
                    txt = f'{abs(err):.0f} ms ' + ('late' if err > 0 else 'early')
                    cv2.putText(img, txt, (10, H0 - 16), cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2, cv2.LINE_AA)
        draw_strip(img, now, frames_t=frames_t, impacts=impacts, grids=grids, onsets=onsets, color=color)
        title = LABELS.get(a.strategy, 'ground truth') + (f'   x{a.speed:g} speed' if a.speed != 1 else '')
        cv2.putText(img, title, (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (30, 30, 30), 2, cv2.LINE_AA)
        cv2.putText(img, f't = {now:6.3f} s', (W - 130, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (60, 60, 60), 1, cv2.LINE_AA)
        enc.stdin.write(img.tobytes())
    enc.stdin.close()
    enc.wait()

    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    if onsets is not None:
        track = audio_for(onsets, a.start, duration, a.speed)
        track = track / (np.abs(track).max() + 1e-9) * 0.9
        wav = tmp / 'a.f32'
        track.astype(np.float32).tofile(wav)
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(silent), '-f', 'f32le', '-ar', str(SR), '-ac', '1',
                        '-i', str(wav), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-shortest', a.out], check=True)
    else:
        subprocess.run(['cp', str(silent), a.out], check=True)
    if a.gif:
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(silent), '-vf',
                        'fps=15,scale=560:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse=dither=bayer',
                        a.gif], check=True)
    print(f'wrote {a.out}' + (f' and {a.gif}' if a.gif else ''))


if __name__ == '__main__':
    main()
