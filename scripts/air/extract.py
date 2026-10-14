#!/usr/bin/env python3
"""Decode every downloaded air-instrument video into ALL its landmark streams, kept with a meta.

The video-data rule (the dev skill ``thoremin-dev-video-data``): every stream the clip
supports, gzipped, and a ``<id>.meta.json`` good enough to find the video again and to
know what it shows. The decoding and the meta are ``scripts/video_streams.py``'s, the
one place that runs the three extractors that already own their models (so there is no
second MediaPipe pipeline to drift from the fixtures):

- pose   -> ``landmarks/air/<instrument>/<id>.pose.ndjson.gz``
- hands  -> ``landmarks/air/<instrument>/<id>.hands.ndjson.gz``
- face   -> ``landmarks/air/<instrument>/<id>.face.ndjson.gz`` (blendshapes) and
  ``<id>.face.landmarks.ndjson.gz`` (the 478 landmarks with z and the transform matrix),
  on a pose-guided head crop when the pose stream exists (``video_streams``' default)
- meta   -> ``landmarks/air/<instrument>/<id>.meta.json``: the yt-dlp ``.info.json``'s
  title, channel, licence and description verbatim, the curated source entry (why,
  player, chord vocabulary: the labels and where they came from), the video's sha256,
  fps and size, the windows, each stream's extractor, model and mediapipe version.

All three streams by default, even when the instrument needs one (guitar chords read
hands only): the rule keeps what a later feature will want. ``--streams`` re-runs some.
A source's ``windows`` (seconds) are honoured by first cutting an excerpt with ffmpeg
(re-encoded at the native frame rate, audio kept so the chord labeller works on the same
clip and its times line up with the landmarks), so a ten-minute lesson with a one-minute
drill costs one minute of inference.

Outputs from before the rule (``<id>.src.hands.ndjson``, ``<id>.face.ndjson``,
``<id>.pose.ndjson``) are gzipped to the new names first; a blendshape-only face is then
re-extracted for its landmarks. Outputs are skipped when present, so re-running after
adding a source is cheap.

MediaPipe lives in the isolated ``media/.venv`` (see ``scripts/video_to_landmarks.py``);
``--python`` or ``THOREMIN_MEDIA_PYTHON`` points at its interpreter.

Usage:
    python3 scripts/air/extract.py guitar [--streams pose hands face] [--only ID ...]
    python3 scripts/air/extract.py drums --file <a local clip>   # e.g. a self-recorded take
"""
from __future__ import annotations

import argparse
import gzip
import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import video_streams as vs  # noqa: E402

#: Names before the video-data rule -> the stream file that replaces each.
LEGACY_NAMES = {
    "{id}.src.hands.ndjson": "{id}.hands.ndjson.gz",
    "{id}.face.ndjson": "{id}.face.ndjson.gz",
    "{id}.pose.ndjson": "{id}.pose.ndjson.gz",
}


def migrate_legacy(out_dir: Path, vid: str) -> list[str]:
    """Gzip a pre-rule output to its new name (lossless; the plain file goes)."""
    moved = []
    for old_t, new_t in LEGACY_NAMES.items():
        old, new = out_dir / old_t.format(id=vid), out_dir / new_t.format(id=vid)
        if old.exists() and not new.exists():
            with old.open("rb") as src, gzip.GzipFile(new, "wb", mtime=0) as dst:
                shutil.copyfileobj(src, dst)
            old.unlink()
            moved.append(f"{old.name} -> {new.name}")
    return moved


def source_meta(src: dict | None, *, instrument: str, vid_dir: Path, vid: str) -> dict:
    """The meta fields a source gives: the platform's own (info.json) and the curated entry."""
    meta: dict = {"clip": vid, "corpus": f"air/{instrument}"}
    info = vid_dir / f"{vid}.info.json"
    if info.exists():
        meta.update(vs.ytdlp_source(info))
    if src is None:
        meta["labels"] = [{"label": f"a local {instrument} clip", "from": "the --file argument"}]
        return meta
    meta.setdefault("sourceUrl", f"https://www.youtube.com/watch?v={vid}")
    meta.setdefault("title", src.get("title"))
    meta.setdefault("author", src.get("channel"))
    if src.get("license"):
        meta["licence"] = src["license"]
    labels = [{"label": f"{instrument} played by {src.get('player', 'the player')}", "from": "the curated source list (scripts/air/sources)"}]
    if src.get("chords"):
        labels.append({"label": f"chord vocabulary {src['chords']}", "from": "the curated source list (a human, from the video's title and playing)"})
    meta.update({"labels": labels, "purpose": ["#249 (air instruments)"], "source": src})
    if src.get("windows"):
        meta["windows"] = src["windows"]
    return meta


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
    ap.add_argument("--streams", nargs="+", choices=vs.ALL_STREAMS, default=list(vs.ALL_STREAMS))
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--python", default=None, help="interpreter with mediapipe + opencv")
    ap.add_argument("--pose-model", default="full", choices=["lite", "full", "heavy"])
    ap.add_argument("--file", nargs="*", default=None, help="local clips (not in the source list) to decode into the same landmarks dir, named by stem")
    args = ap.parse_args()

    py = vs.media_python(args.python)
    doc = json.loads((HERE / "sources" / f"{args.instrument}.json").read_text())
    root = vs.data_root()
    vid_dir = root / "videos" / "air" / args.instrument
    out_dir = root / "landmarks" / "air" / args.instrument
    out_dir.mkdir(parents=True, exist_ok=True)
    wanted = set(args.only) if args.only else None
    log = out_dir / "extract.log"
    failures = []
    jobs: list[tuple[str, Path, Path, dict | None]] = []  # id, the file decoded, the file fetched, the source
    for src in doc["sources"]:
        vid = src["id"]
        if wanted and vid not in wanted:
            continue
        video = vid_dir / f"{vid}.mp4"
        if not video.exists():
            print(f"missing video {vid}; run fetch.py first", file=sys.stderr)
            failures.append(vid)
            continue
        decode = cut_windows(video, src["windows"], out=vid_dir / f"{vid}.excerpt.mp4") if src.get("windows") else video
        jobs.append((vid, decode, video, src))
    for f in args.file or []:
        path = Path(f).expanduser()
        if not path.exists():
            print(f"missing local clip {path.name}", file=sys.stderr)
            failures.append(path.stem)
            continue
        jobs.append((path.stem, path, path, None))
    for vid, decode, video, src in jobs:
        moved = migrate_legacy(out_dir, vid)
        meta = source_meta(src, instrument=args.instrument, vid_dir=vid_dir, vid=vid)
        meta["video"] = vs.video_facts(video)
        note = f"{decode.name}: the source's windows cut and concatenated (ffmpeg, libx264, native rate)" if decode != video else None
        meta_path = out_dir / f"{vid}.meta.json"
        known = vs.known_streams(meta_path)
        vs.write_meta(meta_path, meta)  # the source's fields first: a run cut short keeps them
        streams = vs.extract_streams(decode, out_dir, vid, python=py, streams=args.streams, params={"pose_model": args.pose_model},
                                     log=log, input_note=note, known=known, meta_path=meta_path)
        meta["streams"] = streams
        if moved:
            meta.setdefault("notes", []).append(f"migrated to the video-data rule's names: {', '.join(moved)}")
        merged = vs.write_meta(meta_path, meta)
        failures += [f"{vid}:{s}" for s, e in streams.items() if "error" in e]
        gaps = vs.missing_fields(merged, streams=args.streams)
        print(f"{vid}: streams {sorted(merged.get('streams', {}))}" + (f", meta lacks {gaps}" if gaps else ""), file=sys.stderr)
    print(f"done, {len(failures)} failures {failures or ''}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
