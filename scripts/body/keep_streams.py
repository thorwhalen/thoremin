#!/usr/bin/env python3
"""Backfill the body corpus of #373 to the video-data rule (#510).

The Commons videos fetched for the body-movement measurement had pose streams only,
decoded from 640x360 transcodes, with their provenance spread over ``*.meta.json``,
``prov_*.json`` and ``*.beats.json``. This decodes every one of them, at its native
size, into all three landmark streams (pose, hands, face; ``scripts/video_streams.py``)
and writes one ``<id>.meta.json`` per clip with the skill's fields: the source's own
title, author, licence and description from Commons, the labels and where each came
from, the video's sha256 and size, each stream's extractor and model, and pointers to
the #373 intermediates (copied beside the meta, so the landmarks dir stands alone).

Layout (under the app-data root, ``THOREMIN_DATA_DIR`` or ``~/.local/share/thoremin``):

- ``body/src/<file>``           the downloaded videos (#373's own place; deletable)
- ``landmarks/body/<id>.*``     the streams, the meta and the copied #373 intermediates
- ``videos/body/<id>.decoded.mp4``  a decodable copy where OpenCV cannot read the original

Usage:
    python3 scripts/body/keep_streams.py [--only ID ...] [--jobs 3] [--python <media venv python>]
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import video_streams as vs  # noqa: E402


def keep(src: dict, *, corpus: dict, root: Path, py: Path) -> dict:
    """One clip: facts, the source's fields, the streams, the #373 intermediates, the meta."""
    cid = src["id"]
    video = root / "body" / "src" / src["file"]
    work = root / "body" / "work"
    out_dir = root / "landmarks" / corpus["corpus"]
    out_dir.mkdir(parents=True, exist_ok=True)
    meta_path = out_dir / f"{cid}.meta.json"
    meta: dict = {"clip": cid, "corpus": corpus["corpus"]}
    if video.exists():
        meta["video"] = {**vs.video_facts(video), "kept": True, "localPath": f"body/src/{src['file']}"}
    elif meta_path.exists():
        meta["video"] = {"kept": False}
    else:
        return {"clip": cid, "error": f"missing video body/src/{src['file']}"}
    try:
        meta.update(vs.commons_source(src["sourceUrl"]))
    except Exception as e:  # the streams are worth keeping even when the API is down
        meta.update({"sourceUrl": src["sourceUrl"], "sourceError": f"{type(e).__name__}: {e}"})
    meta.update({"labels": src["labels"], "purpose": src["purpose"], "fetchedAt": corpus["fetchedAt"],
                 "notes": src.get("notes", []), "fixtures": [f"test/fixtures/{f}" for f in src.get("fixtures", [])]})

    # The #373 intermediates: small JSON copied beside the meta; the old pose streams named.
    w = src.get("work", {})
    earlier: dict = {}
    for key in ("meta", "prov"):
        if w.get(key) and (work / w[key]).exists():
            earlier[key] = json.loads((work / w[key]).read_text())
    copied = []
    for b in w.get("beats", []):
        if (work / b).exists():
            stem = b.split(".", 1)[0]  # allelulias_full -> allelulias.full.beats.json
            dest = out_dir / f"{cid}.{stem.split('_', 1)[1] if '_' in stem else stem}.beats.json"
            shutil.copyfile(work / b, dest)
            copied.append(dest.name)
    if copied:
        meta["beatGrids"] = copied
    if w.get("pose"):
        meta["earlierStreams"] = {
            "about": "the #373 pose streams, decoded from 640x360 transcodes (the `_full` ones over the whole video, the others the fixture excerpts); kept where they are",
            "files": [f"body/work/{p}" for p in w["pose"] if (work / p).exists()],
        }
    if earlier:
        meta["earlierMeta"] = earlier

    if video.exists():
        decode, note = video, None
        if not vs.decodable(video, py):
            decode = vs.transcode(video, root / "videos" / corpus["corpus"] / f"{cid}.decoded.mp4")
            note = f"videos/{corpus['corpus']}/{cid}.decoded.mp4: native size and rate, H.264 CRF 18 (OpenCV cannot read the original)"
            meta["video"]["decodedVia"] = note
        known = vs.known_streams(meta_path)
        vs.write_meta(meta_path, meta)  # the source's fields first: a run cut short keeps them
        meta["streams"] = vs.extract_streams(decode, out_dir, cid, python=py, log=out_dir / "extract.log", input_note=note,
                                              known=known, meta_path=meta_path)
    merged = vs.write_meta(meta_path, meta)
    return {"clip": cid, "failed": [s for s, e in merged.get("streams", {}).items() if "error" in e],
            "missing": vs.missing_fields(merged)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--jobs", type=int, default=3, help="clips decoded at once (each runs its three extractors in turn)")
    ap.add_argument("--python", default=None)
    args = ap.parse_args()
    py = vs.media_python(args.python)
    corpus = json.loads((HERE / "sources.json").read_text())
    root = vs.data_root()
    wanted = set(args.only) if args.only else None
    srcs = [s for s in corpus["sources"] if not wanted or s["id"] in wanted]
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        results = list(pool.map(lambda s: keep(s, corpus=corpus, root=root, py=py), srcs))
    for r in results:
        print(json.dumps(r))
    return 1 if any(r.get("error") or r.get("failed") for r in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())
