#!/usr/bin/env python3
"""Held-note labels from the AUDIO of theremin technique videos: which note the player is
sounding, so the pitch hand's shape in the same frames can be labelled with the finger position
that plays it (Eyck's FP1..FP8 are the major-scale degrees above FP1; ``measure_poses.ts``).

The air pipeline's labeller (``scripts/air/label_pitch.py``: probabilistic YIN, a per-source
tuning offset, a median over hops, merged note segments), with a theremin's range and a longer
minimum note: a theremin glides between notes and wobbles in vibrato, and a teacher talks between
demonstrations, so only notes held for ``--min-seconds`` count.

Reads the videos from the app-data dir (``~/.local/share/thoremin/videos/theremin-technique``,
never committed: third-party footage); writes ``labels/theremin/<id>.pitch.json`` there.

Usage:
    python3 scripts/theremin/label_pitch.py [--only ID ...] [--min-seconds 0.3]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "air"))
from label_chords import decode_audio  # noqa: E402
from label_pitch import label_audio  # noqa: E402

SR = 22050
#: A classical theremin's melodic range in these lessons (C3 to C6 covers Eyck's and Kavina's).
RANGE = ("C3", "C6")


def data_root() -> Path:
    return Path(os.environ.get("THOREMIN_DATA_DIR", Path.home() / ".local" / "share" / "thoremin"))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--min-seconds", type=float, default=0.3)
    args = ap.parse_args()
    videos = data_root() / "videos" / "theremin-technique"
    out = data_root() / "labels" / "theremin"
    out.mkdir(parents=True, exist_ok=True)
    for mp4 in sorted(videos.glob("*.mp4")):
        vid = mp4.stem
        if args.only and vid not in args.only:
            continue
        y = decode_audio(mp4, sr=SR)
        lab = label_audio(y, sr=SR, lo=RANGE[0], hi=RANGE[1], min_seconds=args.min_seconds)
        lab["video"] = vid
        (out / f"{vid}.pitch.json").write_text(json.dumps(lab, indent=1) + "\n")
        notes = [s for s in lab["segments"] if s["label"] != "N"]
        print(vid, "held notes:", len(notes), "tuning", lab["tuningSemitones"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
