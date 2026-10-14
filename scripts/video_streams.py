#!/usr/bin/env python3
"""Every landmark stream of a downloaded video, kept with its metadata (the video-data rule).

The maintainer's rule (2026-10-14, the dev skill ``thoremin-dev-video-data``): a video
thoremin downloads is decoded into ALL its landmark streams (pose, hands, face), each
gzipped, with a ``<clip>.meta.json`` good enough to find the video again and to know
what it shows. The video may then be deleted; the streams and the meta may not.

This module is the one place that does it, so the corpora (the body clips of #373, the
air instruments of ``scripts/air/``) do not each grow a copy:

- ``extract_streams`` runs the three extractors that already own their models
  (``video_to_pose.py``, ``video_to_landmarks.py``, ``video_to_face.py --landmarks-out``)
  as subprocesses of the media interpreter, so there is no second MediaPipe pipeline to
  drift from the fixtures, and returns each stream's provenance;
- ``video_facts`` reads what the file is (sha256, duration, fps, size), ``decodable``
  says whether OpenCV can read it (Theora ``.ogg`` / ``.ogv`` often cannot: then
  ``transcode`` makes a native-size H.264 copy to decode, and the meta says so);
- ``commons_source`` and ``ytdlp_source`` read the source's own title, author, licence and
  description (Wikimedia Commons' API; a yt-dlp ``.info.json``);
- ``write_meta`` merges a meta dict into ``<clip>.meta.json`` (an existing file's
  hand-written fields survive a re-run).

Outputs are skipped when present, so a re-run after a failure is cheap.

Usage (one clip):
    python3 scripts/video_streams.py <video> <out_dir> --id <clip> \
        [--source-url URL] [--info-json FILE] [--purpose "#510"] [--streams pose hands face]

MediaPipe lives in an isolated venv (``media/.venv``); ``--python`` or
``THOREMIN_MEDIA_PYTHON`` points at its interpreter.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import html
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = REPO / "scripts"

_FACE_LANDMARKER = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
_HAND_LANDMARKER = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
_POSE_LANDMARKER = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_{variant}/float16/latest/pose_landmarker_{variant}.task"

#: What each stream is made by. ``files`` are the outputs, by ``{id}``; the first is the
#: one the extractor's summary line describes. The thresholds are passed explicitly so the
#: meta states them rather than an extractor's default that may change.
STREAMS: dict[str, dict] = {
    "pose": {
        "script": "video_to_pose.py",
        "files": ["{id}.pose.ndjson.gz"],
        "args": lambda o, p: [o[0], "--model", p["pose_model"], "--min-confidence", str(p["pose_confidence"])],
        "model": lambda p: {"name": f"PoseLandmarker {p['pose_model']}", "url": _POSE_LANDMARKER.format(variant=p["pose_model"]),
                            "numPoses": 1, "minConfidence": p["pose_confidence"]},
        "shape": "BodyFrame: 33 landmarks in pixels, world landmarks (metres), visibility",
    },
    "hands": {
        "script": "video_to_landmarks.py",
        "files": ["{id}.hands.ndjson.gz"],
        "args": lambda o, p: [o[0], "--max-hands", str(p["max_hands"]), "--min-confidence", str(p["hands_confidence"])],
        "model": lambda p: {"name": "HandLandmarker", "url": _HAND_LANDMARKER, "numHands": p["max_hands"],
                            "minConfidence": p["hands_confidence"]},
        "shape": "HandsFrame: 21 pixel keypoints per hand with the raw z, worldKeypoints, handedness as the model reported it",
    },
    "face": {
        "script": "video_to_face.py",
        "files": ["{id}.face.ndjson.gz", "{id}.face.landmarks.ndjson.gz"],
        "args": lambda o, p: [o[0], "--landmarks-out", o[1]],
        "model": lambda p: {"name": "FaceLandmarker", "url": _FACE_LANDMARKER, "numFaces": 1,
                            "minConfidence": "mediapipe default (0.5)"},
        "shape": "face: blendshapes per frame; face.landmarks: FaceFrame superset (blendshapes, 478 landmarks with z, transformMatrix column-major)",
    },
}

ALL_STREAMS = tuple(STREAMS)

DEFAULT_PARAMS = {"pose_model": "full", "pose_confidence": 0.5, "max_hands": 2, "hands_confidence": 0.4}


def data_root() -> Path:
    """The app-data root: ``THOREMIN_DATA_DIR`` or ``~/.local/share/thoremin``."""
    return Path(os.environ.get("THOREMIN_DATA_DIR", Path.home() / ".local" / "share" / "thoremin"))


def media_python(explicit: str | None = None) -> Path:
    p = Path(explicit or os.environ.get("THOREMIN_MEDIA_PYTHON") or REPO / "media" / ".venv" / "bin" / "python")
    if not p.exists():
        sys.exit(f"media venv python not found at {p}; pass --python or set THOREMIN_MEDIA_PYTHON")
    return p


def mediapipe_version(py: Path) -> str:
    res = subprocess.run([str(py), "-I", "-c", "import mediapipe; print(mediapipe.__version__)"], capture_output=True, text=True)
    return res.stdout.strip() or "unknown"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def video_facts(path: Path) -> dict:
    """What the file is: sha256, duration, frame rate and size (ffprobe)."""
    res = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height,avg_frame_rate,r_frame_rate:format=duration", "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    )
    probe = json.loads(res.stdout)
    st = probe["streams"][0]
    num, den = (st.get("avg_frame_rate") or st["r_frame_rate"]).split("/")
    fps = float(num) / float(den) if float(den) else None
    return {
        "file": path.name,
        "sha256": sha256(path),
        "bytes": path.stat().st_size,
        "durationS": round(float(probe["format"]["duration"]), 3),
        "fps": round(fps, 3) if fps else None,
        "width": st["width"],
        "height": st["height"],
        "mirrored": False,
    }


def decodable(video: Path, py: Path) -> bool:
    """Whether the media interpreter's OpenCV reads a first frame (Theora often fails)."""
    code = "import cv2,sys; c=cv2.VideoCapture(sys.argv[1]); ok,_=c.read(); sys.exit(0 if ok else 1)"
    return subprocess.run([str(py), "-I", "-c", code, str(video)], capture_output=True).returncode == 0


def transcode(video: Path, out: Path) -> Path:
    """A native-size, native-rate H.264 copy OpenCV can decode (no rescale, CRF 18)."""
    if not out.exists():
        out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(video), "-map", "0:v:0", "-c:v", "libx264",
                        "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", str(out)], check=True)
    return out


def _summary(stdout: str) -> dict:
    """The extractor's last line (``frames=N fps=F ... <x>-detected=D (R%)``) as numbers."""
    line = stdout.strip().splitlines()[-1] if stdout.strip() else ""
    out: dict = {}
    if m := re.search(r"frames=(\d+)", line):
        out["frames"] = int(m.group(1))
    if m := re.search(r"-detected=(\d+) \((\d+)%\)", line):
        out["detectedFrames"], out["detectionRate"] = int(m.group(1)), int(m.group(2))
    return out


def extract_streams(video: Path, out_dir: Path, clip_id: str, *, python: Path, streams=ALL_STREAMS,
                    params: dict | None = None, log: Path | None = None, input_note: str | None = None) -> dict:
    """Run each extractor once; return ``{stream: provenance}`` (``error`` on a failure).

    A stream whose outputs all exist is not re-run; its provenance is then read back from
    the clip's existing meta by the caller (``write_meta`` merges)."""
    p = {**DEFAULT_PARAMS, **(params or {})}
    out_dir.mkdir(parents=True, exist_ok=True)
    mp_version = mediapipe_version(python)
    result: dict = {}
    for name in streams:
        spec = STREAMS[name]
        outs = [out_dir / f.format(id=clip_id) for f in spec["files"]]
        if all(o.exists() for o in outs):
            continue
        cmd = [str(python), str(SCRIPTS / spec["script"]), str(video), *spec["args"]([str(o) for o in outs], p)]
        print(f"extract {clip_id} {name}", file=sys.stderr)
        res = subprocess.run(cmd, capture_output=True, text=True)
        if log:
            with log.open("a") as f:
                f.write(f"{clip_id} {name} rc={res.returncode}\n{res.stdout}{res.stderr[-4000:]}\n")
        entry = {
            "files": [o.name for o in outs],
            "extractor": f"scripts/{spec['script']}",
            "model": spec["model"](p),
            "mediapipe": mp_version,
            "shape": spec["shape"],
            "input": input_note or video.name,
            "extractedAt": _dt.date.today().isoformat(),
            **_summary(res.stdout),
        }
        if res.returncode != 0:
            for o in outs:
                o.unlink(missing_ok=True)
            entry["error"] = (res.stderr.strip().splitlines() or [f"rc={res.returncode}"])[-1]
        result[name] = entry
    return result


def _text(value: str | None) -> str | None:
    """The source's HTML as plain text: tags out, entities decoded, whitespace folded."""
    if value is None:
        return None
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", value))).strip()


def commons_source(page_url: str, *, user_agent: str = "thoremin-video-streams/1 (https://github.com/thorwhalen/thoremin)") -> dict:
    """Title, author, licence and description of a Wikimedia Commons file, from its API."""
    title = urllib.parse.unquote(page_url.rsplit("/wiki/", 1)[1])
    q = urllib.parse.urlencode({"action": "query", "titles": title, "prop": "imageinfo",
                                "iiprop": "extmetadata|url|sha1|size", "format": "json"})
    req = urllib.request.Request(f"https://commons.wikimedia.org/w/api.php?{q}", headers={"User-Agent": user_agent})
    with urllib.request.urlopen(req, timeout=30) as r:
        page = next(iter(json.load(r)["query"]["pages"].values()))
    info = page["imageinfo"][0]
    em = {k: v.get("value") for k, v in info.get("extmetadata", {}).items()}
    return {
        "platform": "wikimedia-commons",
        "platformId": page.get("pageid"),
        "sourceUrl": info.get("descriptionurl", page_url),
        "mediaUrl": info["url"].split("?", 1)[0],
        "mediaSha1": info.get("sha1"),
        "title": _text(em.get("ObjectName")) or page["title"],
        "author": _text(em.get("Artist")),
        "credit": _text(em.get("Credit")),
        "licence": _text(em.get("LicenseShortName")),
        "licenceUrl": em.get("LicenseUrl"),
        "description": _text(em.get("ImageDescription")),
        "descriptionHtml": em.get("ImageDescription"),
        "categories": [c for c in (em.get("Categories") or "").split("|") if c],
        "dateOriginal": _text(em.get("DateTimeOriginal")),
    }


def ytdlp_source(info_json: Path) -> dict:
    """The same fields from a yt-dlp ``.info.json`` (the platform's own text, verbatim)."""
    info = json.loads(info_json.read_text())
    return {
        "platform": info.get("extractor_key", info.get("extractor")),
        "platformId": info.get("id"),
        "sourceUrl": info.get("webpage_url"),
        "title": info.get("title"),
        "author": info.get("uploader") or info.get("channel"),
        "licence": info.get("license") or "not stated (the platform's standard licence)",
        "description": info.get("description"),
        "tags": info.get("tags") or [],
        "dateOriginal": info.get("upload_date"),
        "infoJson": info_json.name,
    }


def write_meta(path: Path, meta: dict) -> dict:
    """Merge ``meta`` into the JSON at ``path``: dicts merge, other values replace;
    an existing key ``meta`` leaves out is kept (a hand-written note survives a re-run)."""
    def merge(a: dict, b: dict) -> dict:
        out = dict(a)
        for k, v in b.items():
            out[k] = merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
        return out
    old = json.loads(path.read_text()) if path.exists() else {}
    merged = merge(old, meta)
    path.write_text(json.dumps(merged, indent=2, ensure_ascii=False) + "\n")
    return merged


def missing_fields(meta: dict, *, streams=ALL_STREAMS) -> list[str]:
    """What the skill asks for that this meta lacks (a checklist, not a gate)."""
    need = ["sourceUrl", "title", "author", "licence", "description", "labels", "fetchedAt", "video", "purpose"]
    gaps = [k for k in need if not meta.get(k)]
    gaps += [f"streams.{s}" for s in streams if s not in meta.get("streams", {})]
    return gaps


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("out_dir")
    ap.add_argument("--id", required=True, help="the clip id: the output files' stem")
    ap.add_argument("--source-url", help="the page the video came from (Commons pages are read through the API)")
    ap.add_argument("--info-json", help="a yt-dlp .info.json for the source fields")
    ap.add_argument("--purpose", action="append", default=[], help="why it was fetched (an issue), repeatable")
    ap.add_argument("--streams", nargs="+", choices=ALL_STREAMS, default=list(ALL_STREAMS))
    ap.add_argument("--python", default=None)
    args = ap.parse_args()

    py = media_python(args.python)
    video, out_dir = Path(args.video).expanduser(), Path(args.out_dir).expanduser()
    meta: dict = {"clip": args.id, "video": video_facts(video)}
    if args.source_url and "commons.wikimedia.org" in args.source_url:
        meta.update(commons_source(args.source_url))
    elif args.info_json:
        meta.update(ytdlp_source(Path(args.info_json)))
    elif args.source_url:
        meta["sourceUrl"] = args.source_url
    if args.purpose:
        meta["purpose"] = args.purpose
    decode = video
    if not decodable(video, py):
        decode = transcode(video, data_root() / "videos" / "decoded" / f"{args.id}.mp4")
        meta["video"]["decodedVia"] = "a native-size H.264 copy (OpenCV cannot read the original), ffmpeg libx264 CRF 18"
    meta["streams"] = extract_streams(decode, out_dir, args.id, python=py, streams=args.streams, log=out_dir / "extract.log")
    merged = write_meta(out_dir / f"{args.id}.meta.json", meta)
    failed = [s for s, e in merged.get("streams", {}).items() if "error" in e]
    print(json.dumps({"clip": args.id, "failed": failed, "missing": missing_fields(merged, streams=args.streams)}))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
