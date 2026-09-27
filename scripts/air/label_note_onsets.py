#!/usr/bin/env python3
"""Note ONSET times from the audio of a flute video, at a few milliseconds: the
ground truth the embouchure-onset measurement (#248) is scored against.

``label_pitch.py`` says WHICH note sounds and roughly WHEN (probabilistic YIN at a
23 ms hop, a temporal median over five hops, a minimum segment length), which is right
for a fingering model and too coarse for a timing one: a segment start can be off by
two or three hops. This script takes every segment start of the pitch labels and
refines it against the audio at a 2.9 ms hop, using the pitch the label already knows:
the power in a narrow band around the note's fundamental (and its second harmonic),
which rises when *that note* starts and is blind to breath noise, speech and the
previous note. The onset ``t`` is where the band power crosses half-way from the
pre-onset floor to the note's plateau (``rise50``: with a symmetric analysis window
that crossing sits on a step onset, unbiased); ``rise10`` and ``rise90`` bracket it,
so a consumer can choose between "the sound begins" and "the sound has arrived". A
broadband RMS onset over the same window (``rms50``) is written next to it as a
cross-check.

Each onset carries its context, because the mouth's job differs by context: the
silence before it (``gapBefore``, seconds of ``N``; a phrase onset from rest is where
the embouchure is formed, a re-articulation after a short gap is a tongue stroke with
the lips already set) and its ``kind``: ``rest`` (preceded by ``N``) or ``change``
(preceded by another note: a fingering change under a continuous breath, where the
mouth need not move at all).

Output: ``labels/air/<instrument>/<id>.note_onsets.json`` with ``{video, hopSeconds,
onsets: [{t, tPitch, label, kind, gapBefore, durationSeconds, rise10, rise50, rise90,
rms50, riseDb}], stats}``; ``t`` is ``rise50``. Times are in the seconds of the clip the
landmarks were extracted from (the excerpt, when the source has windows).

Runs under the shared ``python3`` (librosa, numpy, scipy; ffmpeg on PATH).

Usage:
    python3 scripts/air/label_note_onsets.py flute [--only ID ...]
    python3 scripts/air/label_note_onsets.py --self-test
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
from label_chords import NO_CHORD, decode_audio  # noqa: E402

SR = 22050
HOP = 64  # 2.9 ms at 22050 Hz
N_FFT = 1024  # 46 ms window: a quarter-tone band is resolvable above C4 (262 Hz)
SEARCH_BEFORE = 0.35  # seconds before the pitch label's start the true onset may lie
SEARCH_AFTER = 0.20  # ... and after (the label's median filter can only delay it so far)
PLATEAU_SECONDS = 0.25  # the note's own level is read over this much after the label start
FLOOR_SECONDS = 0.20  # the pre-onset floor over this much before the search window's start
MIN_NOTE_SECONDS = 0.12  # shorter labelled notes are skipped: no plateau to measure
MIN_RISE_DB = 6.0  # a "note" whose band energy rises less than this over its floor is not one
MIN_WINDOW_HOPS = 4  # fewer hops than this in the floor or plateau window and the level cannot be read
PLATEAU_PERCENTILE = 75  # the note's level is read above its own wobble
FLOOR_PERCENTILE = 50
EPS = 1e-12


def data_root() -> Path:
    return Path(os.environ.get("THOREMIN_DATA_DIR", Path.home() / ".local" / "share" / "thoremin"))


def note_to_hz(name: str) -> float:
    import librosa

    return float(librosa.note_to_hz(name))


def band_power(y: np.ndarray, *, sr: int, f0: float, hop: int = HOP, n_fft: int = N_FFT, semitones: float = 0.5) -> np.ndarray:
    """Per-hop LINEAR power in a band of +-``semitones`` around ``f0`` and around 2*f0."""
    import librosa

    S = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop, center=True)) ** 2
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    ratio = 2 ** (semitones / 12)
    total = np.zeros(S.shape[1])
    for h in (1.0, 2.0):
        lo, hi = f0 * h / ratio, f0 * h * ratio
        sel = (freqs >= lo) & (freqs <= hi)
        if not sel.any():
            sel = np.array([int(np.argmin(np.abs(freqs - f0 * h)))])
        total += S[sel].sum(axis=0)
    return total


def rms_power(y: np.ndarray, *, hop: int = HOP, n_fft: int = N_FFT) -> np.ndarray:
    import librosa

    return librosa.feature.rms(y=y, frame_length=n_fft, hop_length=hop, center=True)[0] ** 2


def crossing_time(env: np.ndarray, *, hop_seconds: float, t0: float, level: float, from_index: int) -> float | None:
    """First time at/after ``from_index`` where the envelope crosses ``level`` upwards,
    linearly interpolated between hops. ``t0`` is the time of index 0."""
    for i in range(max(from_index, 1), len(env)):
        if env[i] >= level and env[i - 1] < level:
            a, b = env[i - 1], env[i]
            f = (level - a) / (b - a) if b > a else 0.0
            return float(t0 + (i - 1 + f) * hop_seconds)
    return None


def rise_times(env: np.ndarray, *, hop_seconds: float, t0: float, floor: float, plateau: float, search_from: int, plateau_from: int) -> dict[str, float | None]:
    """The 10 / 50 / 90 % crossings (linear power) of the LAST rise into the plateau:
    walk back from the plateau to the last hop under the 10 % level, so a blip in the
    floor is not the onset, then read the three crossings forward from there. With a
    symmetric analysis window the 50 % crossing sits ON a step onset; 10 % and 90 %
    bracket it by about half the window either side."""
    level = lambda frac: floor + frac * (plateau - floor)  # noqa: E731
    j = plateau_from
    while j > search_from and env[j - 1] >= level(0.1):
        j -= 1
    j = max(search_from, j)
    out: dict[str, float | None] = {}
    for name, frac in (("rise10", 0.1), ("rise50", 0.5), ("rise90", 0.9)):
        out[name] = crossing_time(env, hop_seconds=hop_seconds, t0=t0, level=level(frac), from_index=j)
    return out


def refine_onset(y: np.ndarray, *, sr: int, t_pitch: float, f0: float, hop: int = HOP) -> dict | None:
    """The refined onset of a note the pitch labeller says starts at ``t_pitch``."""
    hop_s = hop / sr
    w0 = max(0.0, t_pitch - SEARCH_BEFORE - FLOOR_SECONDS)
    w1 = min(len(y) / sr, t_pitch + max(SEARCH_AFTER, PLATEAU_SECONDS))
    seg = y[int(w0 * sr) : int(w1 * sr)]
    if len(seg) < N_FFT * 2:
        return None
    band = band_power(seg, sr=sr, f0=f0, hop=hop)
    rms = rms_power(seg, hop=hop)
    i_of = lambda t: int(round((t - w0) / hop_s))  # noqa: E731
    floor_lo, floor_hi = i_of(w0), i_of(t_pitch - SEARCH_BEFORE)
    plat_lo, plat_hi = i_of(t_pitch), i_of(min(w1, t_pitch + PLATEAU_SECONDS))
    if floor_hi - floor_lo < MIN_WINDOW_HOPS or plat_hi - plat_lo < MIN_WINDOW_HOPS:
        return None
    b_floor = float(np.percentile(band[floor_lo:floor_hi], FLOOR_PERCENTILE))
    b_plat = float(np.percentile(band[plat_lo:plat_hi], PLATEAU_PERCENTILE))
    if b_plat <= 0 or 10 * np.log10((b_plat + EPS) / (b_floor + EPS)) < MIN_RISE_DB:
        return None
    r = rise_times(band, hop_seconds=hop_s, t0=w0, floor=b_floor, plateau=b_plat, search_from=floor_hi, plateau_from=plat_lo)
    if r["rise50"] is None:
        return None
    r_floor = float(np.percentile(rms[floor_lo:floor_hi], FLOOR_PERCENTILE))
    r_plat = float(np.percentile(rms[plat_lo:plat_hi], PLATEAU_PERCENTILE))
    m = None
    if r_plat > 0 and 10 * np.log10((r_plat + EPS) / (r_floor + EPS)) >= MIN_RISE_DB:
        m = rise_times(rms, hop_seconds=hop_s, t0=w0, floor=r_floor, plateau=r_plat, search_from=floor_hi, plateau_from=plat_lo)["rise50"]
    rounded = {k: (round(v, 4) if v is not None else None) for k, v in r.items()}
    return {**rounded, "rms50": round(m, 4) if m is not None else None, "riseDb": round(float(10 * np.log10((b_plat + EPS) / (b_floor + EPS))), 1)}


def label_onsets(y: np.ndarray, *, sr: int, segments: list[dict], hop: int = HOP) -> list[dict]:
    out: list[dict] = []
    for i, seg in enumerate(segments):
        label = seg["label"]
        if label == NO_CHORD:
            continue
        if seg["end"] - seg["start"] < MIN_NOTE_SECONDS:
            continue
        prev = segments[i - 1] if i > 0 else None
        if prev is None or prev["label"] == NO_CHORD:
            kind = "rest"
            gap = (prev["end"] - prev["start"]) if prev is not None else seg["start"]
        else:
            kind = "change"
            gap = 0.0
        r = refine_onset(y, sr=sr, t_pitch=seg["start"], f0=note_to_hz(label), hop=hop)
        if r is None:
            continue
        out.append(
            {
                "t": r["rise50"],
                "tPitch": round(seg["start"], 4),
                "label": label,
                "kind": kind,
                "gapBefore": round(gap, 3),
                "durationSeconds": round(seg["end"] - seg["start"], 3),
                **r,
            }
        )
    return out


# ---- Self-test -----------------------------------------------------------------------


def synth_flute(notes: list[tuple[float, float, str]], *, sr: int, seconds: float, attack: float = 0.01, seed: int = 0) -> np.ndarray:
    """A breathy harmonic tone per (onset, duration, note) with a linear attack of
    ``attack`` seconds, plus faint broadband noise; the reference onset is the start
    of the attack."""
    rng = np.random.default_rng(seed)
    y = rng.standard_normal(int(seconds * sr)).astype(np.float32) * 0.002
    t = np.arange(int(seconds * sr)) / sr
    for onset, dur, name in notes:
        f0 = note_to_hz(name)
        lo, hi = int(onset * sr), int((onset + dur) * sr)
        tt = t[lo:hi] - onset
        env = np.clip(tt / attack, 0, 1) * np.clip((dur - tt) / 0.02, 0, 1)
        tone = sum((0.5**k) * np.sin(2 * np.pi * f0 * (k + 1) * tt) for k in range(4))
        y[lo:hi] += (0.3 * env * tone).astype(np.float32)
    return y


def self_test() -> int:
    sr = SR
    # Onsets deliberately off the pitch labeller's 23 ms grid and off the 2.9 ms hop.
    notes = [(0.5123, 0.6, "G4"), (1.7071, 0.4, "A4"), (2.1071, 0.5, "B4"), (3.0333, 0.8, "D5"), (4.4567, 0.3, "E5")]
    y = synth_flute(notes, sr=sr, seconds=5.5)
    # Pitch labels as label_pitch.py would write them: 23 ms hops, starts rounded
    # LATE by up to three hops (the median filter's delay).
    hop_p = 512 / sr
    segs: list[dict] = []
    cursor = 0.0
    for k, (onset, dur, name) in enumerate(notes):
        start = round((int(onset / hop_p) + (k % 4)) * hop_p, 4)
        end = round(onset + dur, 4)
        if start - cursor > 0.1:
            segs.append({"start": cursor, "end": start, "label": NO_CHORD})
        else:
            # A note change under one breath: the segments touch (path_to_segments
            # never leaves a gap between two notes).
            segs[-1]["end"] = start
        segs.append({"start": start, "end": end, "label": name})
        cursor = end
    segs.append({"start": cursor, "end": 5.5, "label": NO_CHORD})
    got = label_onsets(y, sr=sr, segments=segs)
    ok = True
    print(f"{'note':5} {'true':>8} {'pitch':>8} {'rise50':>8} {'err ms':>7} kind")
    for (onset, _, name), o in zip(notes, got):
        err = (o["t"] - onset) * 1000
        # t is the 50 % power crossing: on a step onset it is unbiased under the
        # symmetric window; on the 10 ms linear attack here it lands INSIDE the
        # attack (never before it), a few ms after the attack begins.
        good = 0 <= err <= 12 and o["label"] == name
        ok &= good
        print(f"{name:5} {onset:8.4f} {o['tPitch']:8.4f} {o['t']:8.4f} {err:7.1f} {o['kind']} {'' if good else '  <-- FAIL'}")
    if len(got) != len(notes):
        print(f"FAIL: {len(got)} onsets for {len(notes)} notes")
        ok = False
    kinds = [o["kind"] for o in got]
    if kinds != ["rest", "rest", "change", "rest", "rest"]:
        print(f"FAIL: kinds {kinds}")
        ok = False
    print("self-test", "OK" if ok else "FAILED")
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("instrument", nargs="?")
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()
    if args.self_test:
        return self_test()
    if not args.instrument:
        ap.error("instrument or --self-test")
    root = data_root()
    vid_dir = root / "videos" / "air" / args.instrument
    lab_dir = root / "labels" / "air" / args.instrument
    sources = json.loads((HERE / "sources" / f"{args.instrument}.json").read_text())["sources"]
    for src in sources:
        vid = src["id"]
        if args.only and vid not in args.only:
            continue
        out = lab_dir / f"{vid}.note_onsets.json"
        pitch = lab_dir / f"{vid}.pitch.json"
        if out.exists():
            print(f"skip {vid} (present)")
            continue
        if not pitch.exists():
            print(f"skip {vid} (no pitch labels)")
            continue
        excerpt = vid_dir / f"{vid}.excerpt.mp4"
        video = excerpt if excerpt.exists() else vid_dir / f"{vid}.mp4"
        labels = json.loads(pitch.read_text())
        print(f"=== {vid}: {len(labels['segments'])} pitch segments", flush=True)
        y = decode_audio(video, sr=SR)
        onsets = label_onsets(y, sr=SR, segments=labels["segments"])
        kinds = {k: sum(1 for o in onsets if o["kind"] == k) for k in ("rest", "change")}
        result = {
            "video": vid,
            "hopSeconds": HOP / SR,
            "onsets": onsets,
            "stats": {"count": len(onsets), "byKind": kinds, "durationSeconds": round(len(y) / SR, 2)},
        }
        out.write_text(json.dumps(result, indent=1))
        print(f"  {len(onsets)} onsets ({kinds}) -> {out}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
