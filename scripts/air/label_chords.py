#!/usr/bin/env python3
"""Chord labels from the AUDIO of a real-guitar video: the label source for the
chord-shape model.

Real-instrument footage carries its own ground truth in the sound, where air footage
carries none; this script turns that sound into time-stamped chord segments that
``build_chord_shape_dataset.ts`` joins with the fretting-hand landmark stream.

Method (deliberately classical, so it is inspectable and has no model to download):
harmonic component of the audio (HPSS) -> constant-Q chroma -> cosine match against
binary chord templates -> Viterbi decoding with a sticky self-transition, constrained
to the chord vocabulary the source list declares for that video (a per-video prior:
a video titled "C to G" is never labelled Am). A no-chord state ``N`` catches talk,
silence and single notes; its emission is a floor, so a frame is a chord only when the
chroma really looks like one. Deep-chroma models (madmom) do better on full mixes, but
on a solo strummed guitar with a two-to-four-chord vocabulary, templates plus the
prior are near-perfect, and the self-test below shows the method on synthetic chords.

Output: ``labels/air/<instrument>/<id>.chords.json`` with
``{video, vocabulary, hopSeconds, segments: [{start, end, label}], stats}``.
Segments shorter than ``--min-seconds`` become ``N`` (a chord change bounces through
neighbouring shapes for a hop or two; those frames are dropped, not mislabelled). A
lone plucked note is ``N`` too: every chord tone must carry energy (``min_coverage``),
because a single note's harmonics already sketch a triad. Sources flagged ``holdout``
are never labelled: a mimed performance's backing track is not what the hand plays.
The label is the SOUNDING chord; with a capo the shape is the same and the sound is
transposed, so a capo'd source must declare shape names, not pitches.

Runs under the shared ``python3`` (needs librosa, numpy; ffmpeg on PATH for decoding).

Usage:
    python3 scripts/air/label_chords.py guitar [--only ID ...]
    python3 scripts/air/label_chords.py --self-test          # synthetic chords, exits 1 on failure
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from extract import cut_windows  # noqa: E402  (same excerpt as the landmark extractor, so times line up)

NO_CHORD = "N"
PITCH_CLASS = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}
QUALITY_INTERVALS = {
    "": (0, 4, 7),        # major
    "m": (0, 3, 7),       # minor
    "7": (0, 4, 7, 10),   # dominant seventh
    "m7": (0, 3, 7, 10),
    "maj7": (0, 4, 7, 11),
    "add9": (0, 2, 4, 7),
    "sus2": (0, 2, 7),
    "sus4": (0, 5, 7),
}


def data_root() -> Path:
    return Path(os.environ.get("THOREMIN_DATA_DIR", Path.home() / ".local" / "share" / "thoremin"))


def parse_chord(name: str) -> tuple[int, tuple[int, ...]]:
    """``'Am'`` -> (9, (0, 3, 7)). Raises on an unknown spelling."""
    root = name[:2] if len(name) > 1 and name[1] in "#b" else name[:1]
    quality = name[len(root):]
    if root not in PITCH_CLASS or quality not in QUALITY_INTERVALS:
        raise ValueError(f"unknown chord name {name!r}")
    return PITCH_CLASS[root], QUALITY_INTERVALS[quality]


def chord_template(name: str) -> np.ndarray:
    root, intervals = parse_chord(name)
    t = np.zeros(12)
    for i in intervals:
        t[(root + i) % 12] = 1.0
    return t / np.linalg.norm(t)


def decode_audio(path: Path, *, sr: int) -> np.ndarray:
    """Mono float32 samples via ffmpeg (librosa's own loaders do not read mp4 reliably)."""
    with tempfile.TemporaryDirectory() as d:
        wav = Path(d) / "audio.wav"
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(path), "-ac", "1", "-ar", str(sr), "-f", "wav", str(wav)],
            check=True,
        )
        import soundfile as sf

        y, got = sf.read(str(wav), dtype="float32", always_2d=False)
        assert got == sr
        return np.asarray(y, dtype=np.float32)


def chroma_of(y: np.ndarray, *, sr: int, hop: int) -> np.ndarray:
    import librosa

    harmonic = librosa.effects.harmonic(y, margin=3.0)
    c = librosa.feature.chroma_cqt(y=harmonic, sr=sr, hop_length=hop, n_chroma=12, bins_per_octave=36)
    # Light TEMPORAL median smoothing: a strum's chroma is steady over a few hops.
    # (Not librosa's nn_filter: that one averages over nearest neighbours anywhere in
    # the recording, which lets a long chord absorb a short one.)
    from scipy.ndimage import median_filter

    c = median_filter(c, size=(1, 5), mode="nearest") if c.shape[1] > 5 else c
    norm = np.linalg.norm(c, axis=0, keepdims=True)
    return c / np.maximum(norm, 1e-9)


def decode_chords(
    chroma: np.ndarray,
    rms: np.ndarray,
    *,
    vocabulary: list[str],
    stay: float,
    no_chord_floor: float,
    silence_ratio: float,
    temperature: float,
    min_coverage: float,
) -> np.ndarray:
    """Viterbi path over ``[*vocabulary, N]`` for each chroma frame (state indices)."""
    import librosa

    templates = np.stack([chord_template(c) for c in vocabulary])  # (K, 12)
    sim = templates @ chroma  # (K, T) cosine similarities in [0, 1]
    # A single plucked note has a triad-like chroma (its harmonics 3 and 5 land on the
    # fifth and the major third), so cosine alone calls a lone G3 a "G". Require every
    # chord tone to carry energy: scale the emission by the weakest chord tone relative
    # to the strongest chroma bin, and let it through untouched only above the floor.
    peak = np.maximum(chroma.max(axis=0, keepdims=True), 1e-9)  # (1, T)
    for k, name in enumerate(vocabulary):
        root, intervals = parse_chord(name)
        tones = [(root + i) % 12 for i in intervals]
        weakest = chroma[tones, :].min(axis=0) / peak[0]
        sim[k] *= np.minimum(1.0, weakest / min_coverage)
    # No-chord emission: a floor, raised to dominate where the audio is quiet.
    quiet = rms < silence_ratio * np.median(rms[rms > 0]) if np.any(rms > 0) else np.ones_like(rms, dtype=bool)
    n_emit = np.full(chroma.shape[1], no_chord_floor)
    n_emit[quiet] = 1.0
    emit = np.vstack([sim, n_emit[None, :]])  # (K+1, T)
    # Softmax over states per frame with a temperature: sharper than raw cosine so the
    # sticky transition does not swamp a clear chord change.
    logits = emit / max(temperature, 1e-6)
    logits -= logits.max(axis=0, keepdims=True)
    prob = np.exp(logits)
    prob /= prob.sum(axis=0, keepdims=True)
    K = emit.shape[0]
    trans = np.full((K, K), (1.0 - stay) / max(K - 1, 1))
    np.fill_diagonal(trans, stay)
    path = librosa.sequence.viterbi(prob, trans)
    return np.asarray(path)


def path_to_segments(path: np.ndarray, *, states: list[str], hop_seconds: float, min_seconds: float, total_seconds: float) -> list[dict]:
    segs: list[dict] = []
    if len(path) == 0:
        return segs
    start = 0
    for i in range(1, len(path) + 1):
        if i == len(path) or path[i] != path[start]:
            label = states[int(path[start])]
            a = start * hop_seconds
            b = min(i * hop_seconds, total_seconds)
            if b - a < min_seconds and label != NO_CHORD:
                label = NO_CHORD
            if segs and segs[-1]["label"] == label:
                segs[-1]["end"] = b
            else:
                segs.append({"start": round(a, 4), "end": round(b, 4), "label": label})
            start = i
    return segs


def label_audio(
    y: np.ndarray,
    *,
    sr: int,
    vocabulary: list[str],
    hop: int = 2048,
    stay: float = 0.97,
    no_chord_floor: float = 0.72,
    silence_ratio: float = 0.25,
    temperature: float = 0.05,
    min_seconds: float = 0.4,
    min_coverage: float = 0.3,
) -> dict:
    import librosa

    chroma = chroma_of(y, sr=sr, hop=hop)
    rms = librosa.feature.rms(y=y, frame_length=hop * 2, hop_length=hop)[0]
    n = min(chroma.shape[1], len(rms))
    chroma, rms = chroma[:, :n], rms[:n]
    states = [*vocabulary, NO_CHORD]
    path = decode_chords(chroma, rms, vocabulary=vocabulary, stay=stay, no_chord_floor=no_chord_floor, silence_ratio=silence_ratio, temperature=temperature, min_coverage=min_coverage)
    hop_seconds = hop / sr
    segments = path_to_segments(path, states=states, hop_seconds=hop_seconds, min_seconds=min_seconds, total_seconds=len(y) / sr)
    seconds_per_label: dict[str, float] = {}
    for s in segments:
        seconds_per_label[s["label"]] = round(seconds_per_label.get(s["label"], 0.0) + s["end"] - s["start"], 2)
    return {
        "vocabulary": vocabulary,
        "hopSeconds": hop_seconds,
        "segments": segments,
        "stats": {"secondsPerLabel": seconds_per_label, "durationSeconds": round(len(y) / sr, 2)},
    }


# ---- Self-test: synthesize a known progression and recover it -------------------

def synth_progression(plan: list[tuple[str | None, float]], *, sr: int, strum_hz: float = 2.0, seed: int = 0) -> tuple[np.ndarray, list[dict]]:
    """Plucked-ish chord tones (fundamental + 3 harmonics, decaying, re-struck at
    ``strum_hz``) in guitar register; ``None`` is silence; a name prefixed ``note:``
    (e.g. ``note:G``) is a single plucked note, whose truth is ``N``. Returns audio and
    the truth."""
    rnd = np.random.default_rng(seed)
    out = []
    truth = []
    t0 = 0.0
    for name, dur in plan:
        n = int(dur * sr)
        t = np.arange(n) / sr
        seg = np.zeros(n)
        if name is not None:
            single = name.startswith("note:")
            root, intervals = parse_chord(name[5:] if single else name)
            if single:
                intervals = (0,)
            # Voice the chord across two octaves in guitar range (E2 = 82.4 Hz up).
            midi = [40 + ((root + i - 4) % 12) + o for i in intervals for o in (0, 12)]
            env = np.exp(-3.0 * (t % (1.0 / strum_hz)))
            for m in midi:
                f = 440.0 * 2 ** ((m - 69) / 12)
                for h, amp in ((1, 1.0), (2, 0.5), (3, 0.3), (4, 0.15)):
                    seg += amp * np.sin(2 * np.pi * f * h * t + rnd.uniform(0, 2 * np.pi))
            seg *= env / len(midi)
            truth.append({"start": t0, "end": t0 + dur, "label": NO_CHORD if single else name})
        else:
            truth.append({"start": t0, "end": t0 + dur, "label": NO_CHORD})
        out.append(seg)
        t0 += dur
    y = np.concatenate(out).astype(np.float32)
    y += rnd.normal(0, 0.003, size=y.shape).astype(np.float32)
    return y, truth


def label_at(segments: list[dict], t: float) -> str:
    for s in segments:
        if s["start"] <= t < s["end"]:
            return s["label"]
    return NO_CHORD


def self_test() -> int:
    sr = 22050
    plan = [("C", 3.0), ("G", 3.0), ("Am", 2.5), (None, 1.5), ("F", 3.0), ("D", 2.0), ("Em", 2.5), ("note:G", 2.0), ("C", 2.0), ("note:C", 2.0)]
    y, truth = synth_progression(plan, sr=sr)
    vocab = ["C", "G", "Am", "F", "D", "Em", "E", "A"]
    res = label_audio(y, sr=sr, vocabulary=vocab)
    grid = np.arange(0.0, len(y) / sr, 0.05)
    got = np.array([label_at(res["segments"], t) for t in grid])
    want = np.array([label_at(truth, t) for t in grid])
    agree = float(np.mean(got == want))
    # Away from boundaries (the join drops a margin around each change anyway).
    def near_change(t: float) -> bool:
        return any(abs(t - s["start"]) < 0.3 or abs(t - s["end"]) < 0.3 for s in truth)
    mask = np.array([not near_change(t) for t in grid])
    agree_inner = float(np.mean(got[mask] == want[mask]))
    print(f"self-test: frame agreement {agree:.3f}, away from changes {agree_inner:.3f}")
    print("segments:", [(s["label"], s["start"], s["end"]) for s in res["segments"]])
    ok = agree_inner >= 0.95
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("instrument", nargs="?")
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--stay", type=float, default=0.97)
    ap.add_argument("--no-chord-floor", type=float, default=0.72)
    ap.add_argument("--min-seconds", type=float, default=0.4)
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
        out = out_dir / f"{vid}.chords.json"
        if src.get("holdout"):
            print(f"skip {vid}: holdout probe, its audio is not a label", file=sys.stderr)
            continue
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
        print(f"label {vid} vocabulary={src['chords']}", file=sys.stderr)
        try:
            y = decode_audio(video, sr=sr)
            res = label_audio(y, sr=sr, vocabulary=list(src["chords"]), stay=args.stay, no_chord_floor=args.no_chord_floor, min_seconds=args.min_seconds)
        except Exception as e:  # noqa: BLE001
            print(f"ERROR {vid}: {e}", file=sys.stderr)
            failures.append(vid)
            continue
        res = {"video": vid, **res}
        out.write_text(json.dumps(res, indent=1))
        print(f"  {res['stats']}", file=sys.stderr)
    print(f"done, {len(failures)} failures {failures or ''}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
