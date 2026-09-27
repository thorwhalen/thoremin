"""Render an ``instrument_take.ts`` take as a video: the synthetic hands on a dark stage,
what the instrument reads, and each sound it makes, with the take's audio.

Drawn in the displayed (mirrored) frame, as the player sees the app:

- ``drums``: the starter kit's pads, the virtual stick, the gripping hand; each hit
  flashes the pad it landed on and names it: drum, centre or rim (the node's radial,
  0 = centre, 1 = rim), soft or hard (its velocity), and whether it was predicted ahead
  of the strike. A hit off every pad says so (it plays the hand's own drum).
- ``bass``: both hands, a ruler for the neck (the fretting hand's distance from the
  plucking hand, in palm spans) and each plucked note's name.
- ``guitar``: both hands, the chord shape the take holds, and each strum's notes.

The audio is a WAV made by ``render_take_audio.mjs`` (the shipped sinks, offline).

Usage::

    python3 scripts/demos/render_take_video.py --take T.json --wav T.wav --out T.mp4 [--gif T.gif]
"""

import argparse
import json
import subprocess
import tempfile
import wave
from pathlib import Path

import cv2
import numpy as np

HAND_EDGES = [
    (0, 1), (1, 2), (2, 3), (3, 4), (0, 5), (5, 6), (6, 7), (7, 8), (5, 9), (9, 10),
    (10, 11), (11, 12), (9, 13), (13, 14), (14, 15), (15, 16), (13, 17), (17, 18),
    (18, 19), (19, 20), (0, 17),
]
NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
BG = (24, 20, 18)
FONT = cv2.FONT_HERSHEY_SIMPLEX
FLASH_S = 0.35


def note_name(m):
    return f'{NAMES[int(m) % 12]}{int(m) // 12 - 1}'


def hex_bgr(h):
    h = h.lstrip('#')
    return (int(h[4:6], 16), int(h[2:4], 16), int(h[0:2], 16))


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--take', required=True)
    ap.add_argument('--wav', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--gif', default=None)
    ap.add_argument('--scale', type=float, default=1.5)
    a = ap.parse_args()

    take = json.loads(Path(a.take).read_text())
    inst, fps, W0, H0 = take['instrument'], take['fps'], take['width'], take['height']
    k = a.scale
    W, H = int(W0 * k), int(H0 * k)
    disp = lambda x, y: (int((W0 - x) * k), int(y * k))  # the mirrored display
    frames, overlay, events = take['frames'], take.get('overlay', []), take['events']
    # As long as the audio: render_take_audio.mjs pads the take by its --tail, and the
    # picture holds its last frame until the sound has rung out.
    with wave.open(a.wav) as w:
        audio_s = w.getnframes() / w.getframerate()
    n = max(len(frames), int(round(audio_s * fps)))

    tmp = Path(tempfile.mkdtemp())
    silent = tmp / 'v.mp4'
    enc = subprocess.Popen(
        ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H}',
         '-r', str(fps), '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', str(silent)],
        stdin=subprocess.PIPE,
    )
    last_label = None
    for i in range(n):
        t = i / fps
        img = np.full((H, W, 3), BG, np.uint8)
        f = frames[min(i, len(frames) - 1)]
        recent = [e for e in events if 0 <= t - e['t'] < FLASH_S]
        if inst == 'drums':
            for pid, pad in take['pads'].items():
                if not pad['on']:
                    continue
                cx, cy = int(pad['x'] * W), int(pad['y'] * H)
                ax, ay = int(pad['w'] * W / 2), int(pad['h'] * H / 2)
                col = hex_bgr(pad['color'])
                hit = [e for e in recent if e.get('pad') == pid]
                fill = img.copy()
                if pad['shape'] == 'circle':
                    cv2.ellipse(fill, (cx, cy), (ax, ay), 0, 0, 360, col, -1, cv2.LINE_AA)
                else:
                    cv2.rectangle(fill, (cx - ax, cy - ay), (cx + ax, cy + ay), col, -1)
                alpha = 0.75 if hit else 0.22
                img = cv2.addWeighted(fill, alpha, img, 1 - alpha, 0)
                if pad['shape'] == 'circle':
                    cv2.ellipse(img, (cx, cy), (ax, ay), 0, 0, 360, col, 2, cv2.LINE_AA)
                    cv2.ellipse(img, (cx, cy), (int(ax * 0.5), int(ay * 0.5)), 0, 0, 360, col, 1, cv2.LINE_AA)
                cv2.putText(img, pad['sound'], (cx - ax + 6, cy - ay - 8), FONT, 0.55, col, 1, cv2.LINE_AA)
            ov = overlay[min(i, len(overlay) - 1)]
            cv2.line(img, disp(ov['pivot']['x'], ov['pivot']['y']), disp(ov['tip']['x'], ov['tip']['y']), (200, 225, 240), 5, cv2.LINE_AA)
            for e in recent:
                if 'x' in e and e['x'] is not None:
                    cv2.circle(img, (int(e['x'] * W), int(e['y'] * H)), 9, (255, 255, 255), 2, cv2.LINE_AA)
            if recent:
                e = recent[-1]
                where = 'off every pad: the hand\'s own drum' if not e.get('pad') else ('rim' if e.get('radial', 0) >= 0.6 else 'centre')
                force = 'hard' if e['velocity'] >= 0.6 else 'soft'
                ahead = 'predicted' if e['predicted'] else 'not ahead (first stroke)'
                last_label = f"{e['sound']}  {where}  {force}  (vel {e['velocity']:.2f}, radial {e.get('radial', 0):.2f}, {ahead})"
        elif inst == 'bass':
            ov = overlay[min(i, len(overlay) - 1)]
            x0, x1, y = int(0.12 * W), int(0.88 * W), int(0.9 * H)
            cv2.line(img, (x0, y), (x1, y), (120, 120, 120), 2)
            for s in range(2, 8):
                xs = x0 + (x1 - x0) * (s - 2) / 5
                cv2.line(img, (int(xs), y - 8), (int(xs), y + 8), (120, 120, 120), 1)
                cv2.putText(img, str(s), (int(xs) - 5, y + 26), FONT, 0.45, (150, 150, 150), 1, cv2.LINE_AA)
            xn = x0 + (x1 - x0) * (min(7, max(2, ov['neck'])) - 2) / 5
            cv2.circle(img, (int(xn), y), 9, (80, 200, 255), -1, cv2.LINE_AA)
            cv2.putText(img, 'neck: fretting hand to plucking hand, palm spans', (x0, y - 18), FONT, 0.5, (170, 170, 170), 1, cv2.LINE_AA)
            if recent:
                e = recent[-1]
                last_label = f"pluck: {note_name(e['midi'])}  ({'predicted' if e['predicted'] else 'not ahead'})"
        else:
            ov = overlay[min(i, len(overlay) - 1)]
            cv2.putText(img, f"chord hand holds: {ov['chord']}", (int(0.05 * W), int(0.92 * H)), FONT, 0.8, (200, 200, 200), 2, cv2.LINE_AA)
            strum = [e for e in recent if e['velocity'] > 0]
            if strum:
                notes = ' '.join(note_name(e['midi']) for e in sorted(strum, key=lambda e: e.get('voice', 0)))
                last_label = f'strum: {notes}'
        for h in f['hands']:
            pts = [disp(p['x'], p['y']) for p in h['keypoints']]
            for u, v in HAND_EDGES:
                cv2.line(img, pts[u], pts[v], (235, 235, 235), 2, cv2.LINE_AA)
            for p in pts:
                cv2.circle(img, p, 3, (0, 180, 255), -1, cv2.LINE_AA)
        cv2.rectangle(img, (0, 0), (W, 46), (12, 10, 9), -1)
        if last_label:
            col = (120, 230, 140) if recent else (150, 150, 150)
            cv2.putText(img, last_label, (14, 31), FONT, 0.68, col, 2, cv2.LINE_AA)
        if recent:
            cv2.rectangle(img, (0, 0), (W - 1, H - 1), (120, 230, 140), 4)
        enc.stdin.write(img.tobytes())
    enc.stdin.close()
    enc.wait()
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(silent), '-i', a.wav, '-c:v', 'copy', '-c:a', 'aac',
                    '-b:a', '160k', '-shortest', a.out], check=True)
    if a.gif:
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(silent), '-vf',
                        'fps=12,scale=560:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse=dither=bayer',
                        a.gif], check=True)
    print(f'wrote {a.out}')


if __name__ == '__main__':
    main()
