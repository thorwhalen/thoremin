"""Generate the synthetic impact clip sets the sub-frame estimators are scored on.

The clips come from the `an` package's impact harness (`an.impacts`, thorwhalen/an):
a stick or a ball striking a surface, or turning in mid-air with no contact, on a
known tempo grid with humanised timing, sampled by a camera model with a shutter and
capture-time jitter. Each clip ships `truth.json` (intended grid time, executed impact
time, what every frame shows) and `keypoints.ndjson` (the observation stream, in the
thoremin recorder's shape). Nothing here is rendered: the keypoints are exact and the
scorer adds tracker noise itself, so the mp4 would only be needed to run a pixel
tracker, which is out of scope.

Output goes under `~/.local/share/thoremin/synthetic/` (never committed; see the
app-data-lifecycle rule). The scorer is `scripts/subframe/score.ts`.

    python scripts/subframe/gen_clip_sets.py            # the benchmark set
    python scripts/subframe/gen_clip_sets.py --quick    # one seed, 30 fps only

Axes of the benchmark set (`bench-v1`), all over `an.impacts.BENCHMARK_SPEC` (a
96 -> 132 bpm accelerando over 24 beats, accents (1, .6, .8, .6), 12 ms AR(1) timing
jitter): object x kind x fps (24, 30, 60) x shutter (0, 180 degrees) x capture timing
(exact; irregular capture reported nominally; irregular capture reported truthfully,
i.e. post-#226; regular capture with noise on the reported time, 4 ms at 30 fps, i.e.
the pre-#226 inference-time stamp) x seed.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import replace
from itertools import product
from pathlib import Path

from an.impacts import BENCHMARK_SPEC, ImpactClipSpec, write_impact_clip

DEFAULT_ROOT = Path("~/.local/share/thoremin/synthetic").expanduser()

#: Capture jitter as a fraction of the frame period (the harness refuses a jitter that
#: could make exposures overlap: at 60 fps with a 180-degree shutter the cap is about
#: 2 ms, so a fixed 4 ms is not honourable at every rate).
CAPTURE_JITTER_FRACTION = 0.08
#: Noise on the REPORTED timestamp of a regularly captured frame, as a fraction of the
#: frame period (the harness caps it at a quarter period so reported times keep
#: increasing): the pre-#226 world, where a frame was stamped when inference happened
#: to run. 4 ms at 30 fps.
STAMP_NOISE_FRACTION = 0.12

#: (label, capture jitter fraction, reported-timestamp noise fraction, timestamps) — how
#: the camera's capture time relates to the time the observation stream reports.
TIMING_AXES: tuple[tuple[str, float, float, str], ...] = (
    ("exact", 0.0, 0.0, "nominal"),
    ("capture-jitter", CAPTURE_JITTER_FRACTION, 0.0, "nominal"),
    ("capture-jitter-actual", CAPTURE_JITTER_FRACTION, 0.0, "actual"),
    ("stamp-noise", 0.0, STAMP_NOISE_FRACTION, "nominal"),
)


def bench_specs(*, quick: bool = False) -> list[tuple[dict, ImpactClipSpec]]:
    objects = ("stick", "ball")
    kinds = ("surface", "air")
    fps = (30.0,) if quick else (24.0, 30.0, 60.0)
    exposures = (0.0, 0.5)
    seeds = (0,) if quick else (0, 1, 2)
    out = []
    for o, k, f, e, (label, jfrac, nsd, stamps), s in product(objects, kinds, fps, exposures, TIMING_AXES, seeds):
        spec = replace(
            BENCHMARK_SPEC,
            object=o, kind=k, fps=f, exposure=e,
            timestamp_jitter_sd=jfrac / f, timestamp_noise_sd=nsd / f, timestamps=stamps, seed=s,
        )
        out.append(({"object": o, "kind": k, "fps": f, "exposure": e, "timing": label, "seed": s}, spec))
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    ap.add_argument("--name", default="bench-v1")
    ap.add_argument("--quick", action="store_true", help="one seed, 30 fps only")
    args = ap.parse_args(argv)
    root = args.root / (args.name + ("-quick" if args.quick else ""))
    root.mkdir(parents=True, exist_ok=True)
    specs = bench_specs(quick=args.quick)
    index = []
    for i, (axes, spec) in enumerate(specs):
        clip_dir = write_impact_clip(spec, root, render=False)
        index.append({"clip": clip_dir.name, "axes": axes, "spec": spec.to_dict()})
        print(f"[{i + 1}/{len(specs)}] {clip_dir.name}", file=sys.stderr)
    (root / "index.json").write_text(json.dumps({"set": root.name, "clips": index}, indent=1))
    print(root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
