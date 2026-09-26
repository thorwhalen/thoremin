#!/usr/bin/env python3
"""Hit onsets from the AUDIO of a drum video: the label source for the stroke detector.

A drum recording gives one label for free, when each hit happened. Method: percussive
component (HPSS) -> spectral-flux onset strength -> ``librosa.onset.onset_detect`` with
backtracking off (the peak, not the rise, is what a stroke's reversal lines up with),
a minimum inter-onset gap, and a strength floor relative to the recording's own peaks
so a quiet click track or the player's speech does not become a hit. Which drum was hit
is NOT labelled here: a limb-to-drum assignment is a spatial question the stroke
detector answers from where the hand stopped, and the audio would need a drum-sound
classifier this pipeline does not have.

Output: ``labels/air/drums/<id>.onsets.json`` with ``{video, onsets: [seconds...],
hopSeconds, stats}``. Air sources (``"air": true``) are skipped: no hits in the audio.

Usage:
    python3 scripts/air/label_onsets.py drums [--only ID ...]
    python3 scripts/air/label_onsets.py --self-test
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from extract import cut_windows  # noqa: E402
from label_chords import decode_audio  # noqa: E402


def data_root() -> Path:
    return Path(os.environ.get("THOREMIN_DATA_DIR", Path.home() / ".local" / "share" / "thoremin"))


def detect_onsets(y: np.ndarray, *, sr: int, hop: int = 256, min_gap_seconds: float = 0.06, floor: float = 0.15) -> dict:
    import librosa

    perc = librosa.effects.percussive(y, margin=3.0)
    env = librosa.onset.onset_strength(y=perc, sr=sr, hop_length=hop, aggregate=np.median)
    if env.max() > 0:
        env = env / env.max()
    wait = max(1, int(round(min_gap_seconds * sr / hop)))
    frames = librosa.onset.onset_detect(onset_envelope=env, sr=sr, hop_length=hop, backtrack=False, wait=wait, delta=floor, units="frames")
    times = librosa.frames_to_time(frames, sr=sr, hop_length=hop)
    return {
        "hopSeconds": hop / sr,
        "onsets": [round(float(t), 4) for t in times],
        "stats": {"count": int(len(times)), "durationSeconds": round(len(y) / sr, 2), "meanGapSeconds": round(float(np.mean(np.diff(times))), 4) if len(times) > 1 else None},
    }


# ---- Self-test ---------------------------------------------------------------------

def synth_hits(times: list[float], *, sr: int, seconds: float, seed: int = 0) -> np.ndarray:
    """Noise bursts with a fast decay (a snare-ish hit) at the given times."""
    rnd = np.random.default_rng(seed)
    y = rnd.normal(0, 0.002, size=int(seconds * sr)).astype(np.float32)
    burst = int(0.08 * sr)
    env = np.exp(-np.arange(burst) / (0.015 * sr))
    for t in times:
        i = int(t * sr)
        y[i : i + burst] += (rnd.normal(0, 1, size=burst) * env * 0.5).astype(np.float32)
    return y


def self_test() -> int:
    sr = 22050
    rnd = np.random.default_rng(1)
    # 100 bpm eighth notes with +-15 ms humanisation, then a faster burst at 16ths.
    times = [0.5 + 0.3 * k + rnd.uniform(-0.015, 0.015) for k in range(16)]
    times += [5.8 + 0.15 * k for k in range(12)]
    y = synth_hits(times, sr=sr, seconds=8.0)
    res = detect_onsets(y, sr=sr)
    got = np.array(res["onsets"])
    tol = 0.03
    hit = sum(1 for t in times if np.any(np.abs(got - t) <= tol))
    false = sum(1 for g in got if not np.any(np.abs(np.array(times) - g) <= tol))
    recall = hit / len(times)
    precision = (len(got) - false) / max(1, len(got))
    print(f"self-test: {len(times)} hits, detected {len(got)}, recall {recall:.3f}, precision {precision:.3f} at +-{tol * 1000:.0f} ms")
    ok = recall >= 0.95 and precision >= 0.95
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("instrument", nargs="?", default="drums")
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--floor", type=float, default=0.15)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    if args.self_test:
        return self_test()
    doc = json.loads((HERE / "sources" / f"{args.instrument}.json").read_text())
    root = data_root()
    vid_dir = root / "videos" / "air" / args.instrument
    out_dir = root / "labels" / "air" / args.instrument
    out_dir.mkdir(parents=True, exist_ok=True)
    wanted = set(args.only) if args.only else None
    sr = 22050
    failures = []
    for src in doc["sources"]:
        vid = src["id"]
        if wanted and vid not in wanted:
            continue
        if src.get("air") or src.get("holdout"):
            print(f"skip {vid}: air, no hits to label", file=sys.stderr)
            continue
        out = out_dir / f"{vid}.onsets.json"
        if out.exists() and not args.force:
            print(f"skip {vid}: present", file=sys.stderr)
            continue
        video = vid_dir / f"{vid}.mp4"
        if not video.exists():
            print(f"missing video {vid}", file=sys.stderr)
            failures.append(vid)
            continue
        if src.get("windows"):
            video = cut_windows(video, src["windows"], out=vid_dir / f"{vid}.excerpt.mp4")
        try:
            res = detect_onsets(decode_audio(video, sr=sr), sr=sr, floor=args.floor)
        except Exception as e:  # noqa: BLE001
            print(f"ERROR {vid}: {e}", file=sys.stderr)
            failures.append(vid)
            continue
        out.write_text(json.dumps({"video": vid, **res}, indent=1))
        print(f"label {vid}: {res['stats']}", file=sys.stderr)
    print(f"done, {len(failures)} failures {failures or ''}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
