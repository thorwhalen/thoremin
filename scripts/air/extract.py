#!/usr/bin/env python3
"""Run the existing landmark decoders over every downloaded air-instrument video.

One wrapper, three streams, each produced by the script that already owns that model
so there is no second MediaPipe pipeline to drift from the fixtures:

- hands  -> ``scripts/video_to_landmarks.py`` -> ``landmarks/air/<instrument>/<id>.src.hands.ndjson``
- pose   -> ``scripts/video_to_pose.py``      -> ``landmarks/air/<instrument>/<id>.pose.ndjson.gz``
- face   -> ``scripts/video_to_face.py``      -> ``landmarks/air/<instrument>/<id>.face.ndjson``

Guitar chords need only hands; flute will need face (embouchure) and hands; drums and
bass need pose. Pick with ``--streams``. A source's ``windows`` (seconds) are honoured by
first cutting an excerpt with ffmpeg (re-encoded at the native frame rate, audio kept so
the chord labeller works on the same clip and its times line up with the landmarks),
so a ten-minute lesson with a one-minute drill costs one minute of inference.

MediaPipe lives in the isolated ``media/.venv`` (see ``scripts/video_to_landmarks.py``);
``--python`` or ``THOREMIN_MEDIA_PYTHON`` points at its interpreter. Outputs are
skipped when present, so re-running after adding a source is cheap.

Usage:
    python3 scripts/air/extract.py guitar [--streams hands pose face] [--only ID ...]
    python3 scripts/air/extract.py drums --streams pose --file <a local clip>   # e.g. a self-recorded take
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
SCRIPTS = REPO / "scripts"

STREAM_SCRIPTS = {
    "hands": ("video_to_landmarks.py", "{id}.src.hands.ndjson", ["--max-hands", "2"]),
    "pose": ("video_to_pose.py", "{id}.pose.ndjson.gz", []),
    "face": ("video_to_face.py", "{id}.face.ndjson", []),
}


def data_root() -> Path:
    return Path(os.environ.get("THOREMIN_DATA_DIR", Path.home() / ".local" / "share" / "thoremin"))


def media_python(explicit: str | None) -> Path:
    p = explicit or os.environ.get("THOREMIN_MEDIA_PYTHON") or str(REPO / "media" / ".venv" / "bin" / "python")
    path = Path(p)
    if not path.exists():
        sys.exit(f"media venv python not found at {path}; pass --python or set THOREMIN_MEDIA_PYTHON")
    return path


def cut_windows(video: Path, windows: list[list[float]], *, out: Path) -> Path:
    """Concatenate the source's windows into one excerpt (native fps, audio kept)."""
    if out.exists():
        return out
    parts = []
    for i, (a, b) in enumerate(windows):
        part = out.with_suffix(f".part{i}.mp4")
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-ss", str(a), "-to", str(b), "-i", str(video),
             "-c:v", "libx264", "-preset", "fast", "-c:a", "aac", str(part)],
            check=True,
        )
        parts.append(part)
    if len(parts) == 1:
        parts[0].rename(out)
        return out
    lst = out.with_suffix(".txt")
    lst.write_text("".join(f"file '{p}'\n" for p in parts))
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(out)], check=True)
    for p in parts:
        p.unlink()
    lst.unlink()
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("instrument")
    ap.add_argument("--streams", nargs="+", choices=sorted(STREAM_SCRIPTS), default=["hands"])
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--python", default=None, help="interpreter with mediapipe + opencv")
    ap.add_argument("--pose-model", default="full", choices=["lite", "full", "heavy"])
    ap.add_argument("--file", nargs="*", default=None, help="local clips (not in the source list) to decode into the same landmarks dir, named by stem")
    args = ap.parse_args()

    py = media_python(args.python)
    doc = json.loads((HERE / "sources" / f"{args.instrument}.json").read_text())
    root = data_root()
    vid_dir = root / "videos" / "air" / args.instrument
    out_dir = root / "landmarks" / "air" / args.instrument
    out_dir.mkdir(parents=True, exist_ok=True)
    wanted = set(args.only) if args.only else None
    log = out_dir / "extract.log"
    failures = []
    jobs: list[tuple[str, Path]] = []
    for src in doc["sources"]:
        vid = src["id"]
        if wanted and vid not in wanted:
            continue
        video = vid_dir / f"{vid}.mp4"
        if not video.exists():
            print(f"missing video {vid}; run fetch.py first", file=sys.stderr)
            failures.append(vid)
            continue
        if src.get("windows"):
            video = cut_windows(video, src["windows"], out=vid_dir / f"{vid}.excerpt.mp4")
        jobs.append((vid, video))
    for f in args.file or []:
        path = Path(f).expanduser()
        if not path.exists():
            print(f"missing local clip {path.name}", file=sys.stderr)
            failures.append(path.stem)
            continue
        jobs.append((path.stem, path))
    for vid, video in jobs:
        for stream in args.streams:
            script, pattern, extra = STREAM_SCRIPTS[stream]
            out = out_dir / pattern.format(id=vid)
            if out.exists():
                print(f"skip {vid} {stream}: present", file=sys.stderr)
                continue
            cmd = [str(py), str(SCRIPTS / script), str(video), str(out), *extra]
            if stream == "pose":
                cmd += ["--model", args.pose_model]
            print(f"extract {vid} {stream}", file=sys.stderr)
            res = subprocess.run(cmd, capture_output=True, text=True)
            with log.open("a") as f:
                f.write(f"{vid} {stream} rc={res.returncode}\n{res.stdout}{res.stderr}\n")
            if res.returncode != 0:
                print(f"ERROR {vid} {stream}: see {log}", file=sys.stderr)
                failures.append(f"{vid}:{stream}")
            else:
                print(res.stdout.strip(), file=sys.stderr)
    print(f"done, {len(failures)} failures {failures or ''}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
