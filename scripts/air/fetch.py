#!/usr/bin/env python3
"""Download the curated air-instrument sources into the app-data dir.

Reads ``scripts/air/sources/<instrument>.json`` (the committed list) and fetches each
video with the ecosystem's ``yb`` package (yt-dlp underneath) into
``$THOREMIN_DATA_DIR/videos/air/<instrument>/<id>.mp4`` (default root
``~/.local/share/thoremin``), capped at 1080p, plus the yt-dlp ``.info.json`` so the
licence and native frame rate are on record next to the file, and the subtitles and
auto-subtitles (``.vtt``, English plus the video's own language) because on-screen text and
captions name labels (the ``thoremin-dev-video-data`` rule). Already-present files are
skipped, so the script is safe to re-run after adding a source; ``--subtitles-only`` adds the
subtitles to clips already fetched, without downloading the video again.

Nothing this script writes may be committed: the repository is public and the footage
is standard-YouTube-licence material kept locally for private derivation only.

Usage:
    python3 scripts/air/fetch.py guitar [--only ID ...] [--max-height 1080] [--subtitles-only]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_SUBTITLE_LANG = "en"


def data_root() -> Path:
    return Path(os.environ.get("THOREMIN_DATA_DIR", Path.home() / ".local" / "share" / "thoremin"))


def load_sources(instrument: str) -> dict:
    return json.loads((HERE / "sources" / f"{instrument}.json").read_text())


def subtitle_langs(source: dict, info_json: Path | None = None) -> tuple[str, ...]:
    """English plus the video's own language (the source list's ``lang``, else the
    ``language`` yt-dlp recorded in the ``.info.json``), each once, English first."""
    langs = [DEFAULT_SUBTITLE_LANG]
    own = source.get("lang")
    if not own and info_json is not None and info_json.exists():
        own = json.loads(info_json.read_text()).get("language")
    if own and own not in langs:
        langs.append(own)
    return tuple(langs)


def _download(url: str, *, out_dir: Path, langs: tuple[str, ...], **kw) -> None:
    from yb import download_youtube_video  # local ecosystem package (yt-dlp underneath)

    download_youtube_video(
        url,
        download_dir=out_dir,
        merge_to="mp4",
        filename_template="%(id)s.%(ext)s",
        write_info_json=True,
        write_subtitles=True,
        write_auto_subtitles=True,
        subtitle_langs=langs,
        quiet=True,
        **kw,
    )


def fetch_one(source: dict, *, out_dir: Path, max_height: int, subtitles_only: bool = False) -> Path | None:
    vid = source["id"]
    target = out_dir / f"{vid}.mp4"
    info_json = out_dir / f"{vid}.info.json"
    url = f"https://www.youtube.com/watch?v={vid}"
    if subtitles_only:
        print(f"subtitles {vid}", file=sys.stderr)
        _download(url, out_dir=out_dir, langs=subtitle_langs(source, info_json),
                  extra_opts={"skip_download": True})
        return target if target.exists() else None
    if target.exists():
        print(f"skip {vid}: present", file=sys.stderr)
        return target
    print(f"fetch {vid}: {source['title']}", file=sys.stderr)
    _download(
        url,
        out_dir=out_dir,
        langs=subtitle_langs(source),
        fmt=f"bestvideo[height<={max_height}]+bestaudio/best[height<={max_height}]",
    )
    own = subtitle_langs(source, info_json)  # now the info.json names the video's language
    if own != subtitle_langs(source):
        _download(url, out_dir=out_dir, langs=own, extra_opts={"skip_download": True})
    return target if target.exists() else None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("instrument")
    ap.add_argument("--only", nargs="*", default=None, help="source ids to fetch (default: all)")
    ap.add_argument("--max-height", type=int, default=1080)
    ap.add_argument("--subtitles-only", action="store_true",
                    help="fetch the subtitles of clips already present, not the video")
    args = ap.parse_args()

    doc = load_sources(args.instrument)
    out_dir = data_root() / "videos" / "air" / args.instrument
    out_dir.mkdir(parents=True, exist_ok=True)
    wanted = set(args.only) if args.only else None
    failures = []
    for src in doc["sources"]:
        if wanted and src["id"] not in wanted:
            continue
        try:
            got = fetch_one(src, out_dir=out_dir, max_height=args.max_height,
                            subtitles_only=args.subtitles_only)
        except Exception as e:  # noqa: BLE001 - report and continue; one dead link must not stop the batch
            got = None
            print(f"ERROR {src['id']}: {e}", file=sys.stderr)
        if got is None:
            failures.append(src["id"])
    print(f"done: {len(doc['sources']) - len(failures)} present, {len(failures)} failed {failures or ''}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
