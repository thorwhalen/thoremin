"""Render an air-instrument recognition demo: footage + hands + the recognised label, with sound.

Reads a timeline written by ``chord_shape_timeline.ts`` (per-frame prediction and the
audio label), the source video and its hand landmarks, and writes an mp4 in which:

- the fretting hand's skeleton is drawn on the footage;
- the big label is the chord the model reads off the HAND SHAPE (green when it agrees
  with the chord heard in the audio, red when not, grey when the audio has no chord);
- the soundtrack is a synthesised strum of the recognised chord (Karplus-Strong), with
  the original recording mixed underneath at ``--original-gain`` so the two can be
  compared by ear. ``--voice bass`` or ``--voice flute`` plays the recognised PITCH
  CLASS as a single note instead (a plucked bass, a breathy flute tone), for the
  pitch timelines of ``air_pitch_timeline.ts``.

Everything it reads and writes lives under the local data dir; YouTube-derived output
never goes in the repository.

Usage::

    python3 scripts/demos/render_chord_demo.py --timeline T.json --video V.mp4 \
        --landmarks L.ndjson --start 110 --duration 25 --out OUT.mp4
"""

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np

SR = 44100
HAND_EDGES = [
    (0, 1), (1, 2), (2, 3), (3, 4), (0, 5), (5, 6), (6, 7), (7, 8), (5, 9), (9, 10),
    (10, 11), (11, 12), (9, 13), (13, 14), (14, 15), (15, 16), (13, 17), (17, 18),
    (18, 19), (19, 20), (0, 17),
]
NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
QUALITY = {'': (0, 4, 7), 'm': (0, 3, 7), '7': (0, 4, 7, 10), 'm7': (0, 3, 7, 10)}


def chord_midis(symbol):
    """A guitar-ish voicing: the root low, then the chord tones an octave up."""
    root = NOTE[symbol[0]]
    rest = symbol[1:]
    if rest[:1] in ('#', 'b'):
        root += 1 if rest[0] == '#' else -1
        rest = rest[1:]
    ivs = QUALITY[rest]
    base = 40 + (root - 4) % 12  # E2..D#3
    return [base] + [base + 12 + i for i in ivs] + [base + 24]


def note_midi(label, voice):
    """The MIDI note a pitch-class label sounds as in ``voice`` ('D5'/'D#5' keep their octave)."""
    pc = NOTE[label[0]] + (1 if label[1:2] == '#' else -1 if label[1:2] == 'b' else 0)
    octave = int(label[-1]) if label[-1].isdigit() else None
    if voice == 'bass':
        return 28 + (pc - 4) % 12  # E1..D#2
    # Flute: a bare class is the first octave (C4..B4); 'D5' / 'D#5' are their own
    # classes an octave up, so they must sound an octave up.
    return 12 * (octave + 1) + pc if octave else 60 + pc % 12


def flute_tone(freq, dur, *, rng):
    """A soft sine with a little second harmonic and breath noise, gentle attack and release."""
    n = int(SR * dur)
    t = np.arange(n) / SR
    env = np.minimum(1, t / 0.04) * np.minimum(1, (dur - t) / 0.06).clip(0, 1)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5 * t)
    tone = np.sin(2 * np.pi * freq * t * vib) + 0.25 * np.sin(4 * np.pi * freq * t * vib)
    return env * (tone + 0.05 * rng.normal(0, 1, n))


def pluck(freq, dur, *, rng, decay=0.996):
    """One Karplus-Strong string."""
    n = int(SR * dur)
    period = max(2, int(round(SR / freq)))
    buf = rng.uniform(-1, 1, period)
    out = np.empty(n)
    for i in range(n):
        out[i] = buf[i % period]
        buf[i % period] = decay * 0.5 * (buf[i % period] + buf[(i + 1) % period])
    return out


def synth_track(events, duration, *, strum_gap=0.018, ring=1.6, seed=0, voice='chord'):
    """``events``: (time, label or None). A chord strums (or a note sounds) at each event; None mutes."""
    rng = np.random.default_rng(seed)
    track = np.zeros(int(SR * (duration + ring)) + 1)
    cache = {}
    for k, (t, chord) in enumerate(events):
        if chord is None:
            continue
        end = events[k + 1][0] if k + 1 < len(events) else duration
        if voice != 'chord':
            freq = 440 * 2 ** ((note_midi(chord, voice) - 69) / 12)
            dur = min(ring, end - t + 0.05) if voice == 'bass' else max(0.08, end - t)
            s = pluck(freq, dur, rng=rng, decay=0.998) if voice == 'bass' else flute_tone(freq, dur, rng=rng)
            i0 = int(SR * t)
            seg = s[: len(track) - i0]
            track[i0 : i0 + len(seg)] += seg * (0.5 if voice == 'bass' else 0.25)
            continue
        dur = min(ring, end - t + 0.25)
        for j, m in enumerate(chord_midis(chord)):
            key = (m, round(dur, 2))
            if key not in cache:
                cache[key] = pluck(440 * 2 ** ((m - 69) / 12), dur, rng=rng)
            s = cache[key]
            fade = np.minimum(1, np.linspace(dur / 0.08, 0, len(s)))  # damp at the next strum
            i0 = int(SR * (t + j * strum_gap))
            seg = (s * fade)[: len(track) - i0]
            track[i0 : i0 + len(seg)] += seg * 0.18
    return track[: int(SR * duration)]


def strum_events(frames, start, duration, *, restrum=1.0, max_gap=0.5):
    """Strum on every change of the predicted chord, and every ``restrum`` s while held."""
    events, last, last_t, prev_t = [], None, -1e9, None
    for f in frames:
        t = f['t'] - start
        if t < 0 or t >= duration:
            continue
        chord = f['pred'] if f['pred'] != 'N' else None
        gap = prev_t is not None and t - prev_t > max_gap
        if gap and last is not None:
            events.append((prev_t + 0.05, None))
            last = None
        if chord != last or (chord and t - last_t >= restrum):
            events.append((t, chord))
            last, last_t = chord, t
        prev_t = t
    return events


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--timeline', required=True)
    ap.add_argument('--video', required=True)
    ap.add_argument('--landmarks', required=True)
    ap.add_argument('--start', type=float, required=True)
    ap.add_argument('--duration', type=float, default=25)
    ap.add_argument('--width', type=int, default=960)
    ap.add_argument('--original-gain', type=float, default=0.25)
    ap.add_argument('--out', required=True)
    ap.add_argument('--voice', default='chord', choices=['chord', 'bass', 'flute'])
    ap.add_argument('--says', default='hand says', help='the label in front of the prediction')
    ap.add_argument('--restrum', type=float, default=1.0, help='re-sound a held label every N s')
    a = ap.parse_args()

    tl = json.loads(Path(a.timeline).read_text())
    frames = tl['frames']
    by_t = {round(f['t'], 3): f for f in frames}
    hands = {}
    for line in Path(a.landmarks).read_text().splitlines():
        r = json.loads(line)
        if a.start - 1 <= r['t'] <= a.start + a.duration + 1:
            hands[round(r['t'], 3)] = r['value']['hands']

    cap = cv2.VideoCapture(a.video)
    fps = cap.get(cv2.CAP_PROP_FPS)
    W0, H0 = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    scale = a.width / W0
    W, H = a.width, int(round(H0 * scale / 2) * 2)
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(round(a.start * fps)))
    tmp = Path(tempfile.mkdtemp())
    silent = tmp / 'v.mp4'
    enc = subprocess.Popen(
        ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H}',
         '-r', str(fps), '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', str(silent)],
        stdin=subprocess.PIPE,
    )
    times = sorted(by_t)
    n = int(a.duration * fps)
    shown = None
    for i in range(n):
        ok, img = cap.read()
        if not ok:
            break
        t = a.start + i / fps
        img = cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA)
        key = min(times, key=lambda x: abs(x - t)) if times else None
        f = by_t[key] if key is not None and abs(key - t) < 0.06 else None
        hk = min(hands, key=lambda x: abs(x - t)) if hands else None
        for h in (hands.get(hk, []) if hk is not None and abs(hk - t) < 0.06 else []):
            pts = [(int(p['x'] * scale), int(p['y'] * scale)) for p in h['keypoints']]
            for u, v in HAND_EDGES:
                cv2.line(img, pts[u], pts[v], (255, 255, 255), 2, cv2.LINE_AA)
            for p in pts:
                cv2.circle(img, p, 3, (0, 180, 255), -1, cv2.LINE_AA)
        if f is not None:
            shown = f
        if shown is not None and abs(shown['t'] - t) < 0.5:
            pred, truth = shown['pred'], shown['truth']
            color = (150, 150, 150) if truth in (None, 'N') else ((80, 200, 80) if truth == pred else (60, 60, 230))
            cv2.rectangle(img, (0, 0), (W, 70), (20, 20, 20), -1)
            cv2.putText(img, f'{a.says}: {pred}', (16, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.4, color, 3, cv2.LINE_AA)
            cv2.putText(img, f'audio says: {truth or "-"}', (W - 300, 45), cv2.FONT_HERSHEY_SIMPLEX, 0.9,
                        (220, 220, 220), 2, cv2.LINE_AA)
        enc.stdin.write(img.tobytes())
    enc.stdin.close()
    enc.wait()

    track = synth_track(strum_events(frames, a.start, a.duration, restrum=a.restrum), a.duration, voice=a.voice)
    orig = tmp / 'orig.f32'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', str(a.start), '-t', str(a.duration), '-i', a.video,
                    '-vn', '-ac', '1', '-ar', str(SR), '-f', 'f32le', str(orig)], check=True)
    o = np.fromfile(orig, dtype=np.float32)[: len(track)]
    o = o / (np.abs(o).max() + 1e-9)
    mix = track.copy()
    mix[: len(o)] += a.original_gain * o
    mix = mix / (np.abs(mix).max() + 1e-9) * 0.9
    wav = tmp / 'mix.f32'
    mix.astype(np.float32).tofile(wav)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(silent), '-f', 'f32le', '-ar', str(SR), '-ac', '1',
                    '-i', str(wav), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', a.out], check=True)
    print(f'wrote {a.out}')


if __name__ == '__main__':
    main()
