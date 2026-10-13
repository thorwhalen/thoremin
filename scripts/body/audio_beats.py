#!/usr/bin/env python3
"""The reference beat grid of a body clip (#373): beats tracked from the clip's own
audio, offline, in the excerpt's seconds.

The body channel measurement (`scripts/body/measure_channels.ts`) scores anchors
against a grid. A clip with music carries its grid in its soundtrack, so the grid is
tracked from the audio with librosa's dynamic-programming beat tracker (Ellis 2007),
and the result is written into the fixture's ``meta.json`` (``grid.beats``) so the
measurement replays in CI without the audio. The audio itself stays in the app-data
dir with the video, never in the repo.

Usage:
    <venv>/bin/python scripts/body/audio_beats.py <excerpt.(mp4|wav)> [--bpm-hint N] [--tightness T]

Prints JSON: ``{"source": ..., "bpm": ..., "beats": [...]}``. ``--bpm-hint`` centres
the tempo prior (librosa's ``start_bpm``) when the piece's tempo is known from its
score or its notes; the tracked beats are still the audio's own.
Requires librosa (and ffmpeg for a video container).
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

import librosa
import numpy as np


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--bpm-hint", type=float, default=120.0)
    ap.add_argument("--tightness", type=float, default=100.0)
    ap.add_argument("--sr", type=int, default=22050)
    args = ap.parse_args()

    # librosa reads only what libsndfile reads; a video container goes through ffmpeg.
    with tempfile.TemporaryDirectory() as tmp:
        wav = args.audio
        if not args.audio.lower().endswith(".wav"):
            wav = os.path.join(tmp, "audio.wav")
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", args.audio, "-vn", "-ac", "1", "-ar", str(args.sr), wav], check=True)
        y, sr = librosa.load(wav, sr=args.sr, mono=True)
    hop = 512
    env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    tempo, frames = librosa.beat.beat_track(
        onset_envelope=env, sr=sr, hop_length=hop, start_bpm=args.bpm_hint, tightness=args.tightness, units="frames"
    )
    beats = librosa.frames_to_time(frames, sr=sr, hop_length=hop)
    ibi = np.diff(beats)
    out = {
        "source": f"librosa {librosa.__version__} beat_track (Ellis 2007 DP; start_bpm {args.bpm_hint:g}, tightness {args.tightness:g})",
        "bpm": round(float(np.atleast_1d(tempo)[0]), 2),
        "ibiMedianS": round(float(np.median(ibi)), 4) if len(ibi) else None,
        "ibiCv": round(float(np.std(ibi) / np.mean(ibi)), 4) if len(ibi) else None,
        "beats": [round(float(b), 4) for b in beats],
    }
    json.dump(out, sys.stdout)
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
