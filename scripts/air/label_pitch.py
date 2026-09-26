#!/usr/bin/env python3
"""Note labels from the AUDIO of a solo monophonic instrument (flute, bass): the
label source for the fingering and fret-position models.

Same idea as ``label_chords.py``, one octave down in ambition: a flute or a bass
played alone is monophonic, so a pitch tracker gives the sounding note directly.
Method: probabilistic YIN (``librosa.pyin``) on the audio, restricted to the source's
declared pitch range, frame-wise MIDI rounding, a voiced-probability floor, then a
temporal median over a few hops and a merge into note segments; segments shorter than
``--min-seconds`` become ``N`` (a pitch tracker flickers by an octave or a semitone at
a note's edges, and those frames are dropped by the join's margin anyway).

Output: ``labels/air/<instrument>/<id>.pitch.json`` with
``{video, range, hopSeconds, segments: [{start, end, label}], stats}`` where a label is
a note name with octave (``"G4"``); the join maps it to a pitch class or keeps the
octave, as the model wants. Same segment shape as the chord labels, so the same
``segmentLabeller`` reads both.

Runs under the shared ``python3`` (librosa, numpy; ffmpeg on PATH).

Usage:
    python3 scripts/air/label_pitch.py flute [--only ID ...]
    python3 scripts/air/label_pitch.py --self-test
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
from label_chords import NO_CHORD, decode_audio, path_to_segments  # noqa: E402

DEFAULT_RANGE = {"flute": ("C4", "C7"), "bass": ("E1", "G4")}


def data_root() -> Path:
    return Path(os.environ.get("THOREMIN_DATA_DIR", Path.home() / ".local" / "share" / "thoremin"))


def note_to_midi(name: str) -> int:
    import librosa

    return int(round(librosa.note_to_midi(name)))


def midi_to_note(m: int) -> str:
    import librosa

    return str(librosa.midi_to_note(int(m), unicode=False))


def track_notes(
    y: np.ndarray,
    *,
    sr: int,
    lo: str,
    hi: str,
    hop: int = 512,
    voiced_floor: float = 0.3,
    median_hops: int = 5,
) -> tuple[np.ndarray, list[str], float]:
    """Frame-wise note index path over ``[*notes, N]`` (states), the state names, hop seconds."""
    import librosa
    from scipy.ndimage import median_filter

    fmin = librosa.note_to_hz(lo)
    fmax = librosa.note_to_hz(hi)
    # The analysis window must hold several periods of the LOWEST note: a bass E1 is
    # 41 Hz (24 ms), so the 93 ms default window is four periods and pyin loses it.
    # Six periods (not rounded up to a power of two: 8192 samples smears every note
    # edge by a quarter second).
    frame_length = max(2048, int(6 * sr / fmin))
    f0, voiced, vprob = librosa.pyin(y, fmin=fmin, fmax=fmax, sr=sr, hop_length=hop, frame_length=frame_length, fill_na=np.nan)
    lo_m, hi_m = note_to_midi(lo), note_to_midi(hi)
    states = [midi_to_note(m) for m in range(lo_m, hi_m + 1)] + [NO_CHORD]
    n_state = len(states) - 1
    midi = np.full(len(f0), n_state, dtype=int)
    ok = np.isfinite(f0) & (vprob >= voiced_floor)
    m = np.round(librosa.hz_to_midi(f0[ok])).astype(int)
    m = np.clip(m, lo_m, hi_m) - lo_m
    midi[ok] = m
    if len(midi) > median_hops:
        # Median over hops removes one-hop octave/semitone flickers; N (the last state)
        # is numerically largest so it never becomes a mid-range note by averaging.
        midi = median_filter(midi, size=median_hops, mode="nearest")
    return midi, states, hop / sr


def label_audio(y: np.ndarray, *, sr: int, lo: str, hi: str, min_seconds: float = 0.12, **kw) -> dict:
    path, states, hop_s = track_notes(y, sr=sr, lo=lo, hi=hi, **kw)
    segments = path_to_segments(path, states=states, hop_seconds=hop_s, min_seconds=min_seconds, total_seconds=len(y) / sr)
    per: dict[str, float] = {}
    for s in segments:
        per[s["label"]] = round(per.get(s["label"], 0.0) + s["end"] - s["start"], 2)
    return {"range": [lo, hi], "hopSeconds": hop_s, "segments": segments, "stats": {"secondsPerLabel": per, "durationSeconds": round(len(y) / sr, 2)}}


# ---- Self-test ------------------------------------------------------------------

def synth_melody(plan: list[tuple[str | None, float]], *, sr: int, seed: int = 0) -> tuple[np.ndarray, list[dict]]:
    """Harmonic tones (flute-ish: fundamental strong, few harmonics) with a soft attack;
    ``None`` is silence. Returns audio and the truth segments."""
    rnd = np.random.default_rng(seed)
    out, truth, t0 = [], [], 0.0
    for name, dur in plan:
        n = int(dur * sr)
        t = np.arange(n) / sr
        seg = np.zeros(n)
        if name is not None:
            f = 440.0 * 2 ** ((note_to_midi(name) - 69) / 12)
            env = np.minimum(1.0, t / 0.03) * np.minimum(1.0, (dur - t) / 0.03)
            for h, amp in ((1, 1.0), (2, 0.35), (3, 0.15)):
                seg += amp * np.sin(2 * np.pi * f * h * t + rnd.uniform(0, 2 * np.pi))
            seg *= env * 0.4
        truth.append({"start": t0, "end": t0 + dur, "label": name or NO_CHORD})
        out.append(seg)
        t0 += dur
    y = np.concatenate(out).astype(np.float32)
    return y + rnd.normal(0, 0.002, size=y.shape).astype(np.float32), truth


def label_at(segments: list[dict], t: float) -> str:
    for s in segments:
        if s["start"] <= t < s["end"]:
            return s["label"]
    return NO_CHORD


def self_test() -> int:
    sr = 22050
    ok_all = True
    for instrument, plan in (
        ("flute", [("G4", 0.6), ("A4", 0.6), ("B4", 0.6), ("C5", 0.6), (None, 0.4), ("D5", 0.5), ("E5", 0.5), ("G5", 0.8), ("G4", 0.6)]),
        ("bass", [("E1", 0.8), ("A1", 0.8), ("D2", 0.8), ("G2", 0.8), (None, 0.4), ("C2", 0.6), ("F2", 0.6), ("B1", 0.8)]),
    ):
        lo, hi = DEFAULT_RANGE[instrument]
        y, truth = synth_melody(plan, sr=sr)
        res = label_audio(y, sr=sr, lo=lo, hi=hi)
        grid = np.arange(0.0, len(y) / sr, 0.02)
        got = np.array([label_at(res["segments"], t) for t in grid])
        want = np.array([label_at(truth, t) for t in grid])
        inner = np.array([not any(abs(t - s["start"]) < 0.1 or abs(t - s["end"]) < 0.1 for s in truth) for t in grid])
        agree = float(np.mean(got[inner] == want[inner]))
        print(f"self-test {instrument}: agreement away from note edges {agree:.3f}; segments {[(s['label'], round(s['end'] - s['start'], 2)) for s in res['segments']]}")
        ok_all &= agree >= 0.95
    print("PASS" if ok_all else "FAIL")
    return 0 if ok_all else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("instrument", nargs="?")
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--min-seconds", type=float, default=0.12)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    if args.self_test:
        return self_test()
    if not args.instrument:
        ap.error("instrument is required unless --self-test")
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
        if src.get("holdout") or src.get("air"):
            print(f"skip {vid}: no instrument sounds, nothing to label", file=sys.stderr)
            continue
        out = out_dir / f"{vid}.pitch.json"
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
        lo, hi = src.get("pitchRange") or DEFAULT_RANGE[args.instrument]
        print(f"label {vid} range={lo}..{hi}", file=sys.stderr)
        try:
            y = decode_audio(video, sr=sr)
            res = label_audio(y, sr=sr, lo=lo, hi=hi, min_seconds=args.min_seconds)
        except Exception as e:  # noqa: BLE001
            print(f"ERROR {vid}: {e}", file=sys.stderr)
            failures.append(vid)
            continue
        out.write_text(json.dumps({"video": vid, **res}, indent=1))
        top = sorted(res["stats"]["secondsPerLabel"].items(), key=lambda kv: -kv[1])[:8]
        print(f"  {res['stats']['durationSeconds']}s, top labels {top}", file=sys.stderr)
    print(f"done, {len(failures)} failures {failures or ''}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
