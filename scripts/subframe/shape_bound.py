"""How much of the impact predictor's error a per-player stroke template could remove (#351).

A template predicts an air stroke's turn from the shape of its approach. On a clip set whose
strokes each draw their own fall and brake (`gen_clip_sets.py --variability`), this asks the
question before anything is built: regress the prediction's error (from `score.ts --out`) on
the stroke's TRUE shape, read from `truth.json` (its fall, brake and peak speed), and report
the spread left. That is an upper bound for any template: one sees the shape only through two
or three noisy approach samples, and never sees the brake, which happens after the commit.

    python scripts/subframe/shape_bound.py results.json [--min-lead 0.077]

Needs numpy. Prints, per frame rate: the prediction's sd, and the sd left after regressing on
the peak speed, on the fall and peak speed (what the approach shows), and on all three.
"""

from __future__ import annotations

import argparse
import json
import os
from collections import defaultdict

import numpy as np


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("results", help="the JSON `score.ts --out` wrote")
    ap.add_argument("--min-lead", type=float, default=0.077)
    ap.add_argument("--estimator", default="predict")
    args = ap.parse_args(argv)
    res = json.load(open(args.results))
    root = res["set"]
    truth = {}
    for c in res["clips"]:
        t = json.load(open(os.path.join(root, c["name"], "truth.json")))
        truth[c["name"]] = (c["axes"], {e["index"]: e for e in t["events"]})
    by_fps: dict[float, list[tuple[float, float, float, float]]] = defaultdict(list)
    for r in res["records"]:
        if r["estimator"] != args.estimator or r["minLead"] != args.min_lead or r.get("errImpact") is None:
            continue
        axes, events = truth[r["clip"]]
        e = events.get(r["event"])
        if e:
            by_fps[axes["fps"]].append((r["errImpact"], e["fall"] * 1000, e["brake"] * 1000, e["peak_speed"]))
    print("| fps | n | sd (ms) | after peak speed | after fall + peak speed | after fall, brake, peak speed |")
    print("|---|---|---|---|---|---|")
    for fps in sorted(by_fps):
        a = np.array(by_fps[fps])
        y = a[:, 0]

        def left(cols: list[int]) -> float:
            x = np.column_stack([np.ones(len(a))] + [a[:, c] for c in cols])
            beta, *_ = np.linalg.lstsq(x, y, rcond=None)
            return float(np.sqrt(np.mean((y - x @ beta) ** 2)))

        if np.ptp(a[:, 1]) == 0 and np.ptp(a[:, 2]) == 0:
            print(f"| {fps:g} | {len(a)} | {y.std():.2f} | constant shapes: nothing to learn | | |")
            continue
        print(f"| {fps:g} | {len(a)} | {y.std():.2f} | {left([3]):.2f} | {left([1, 3]):.2f} | {left([1, 2, 3]):.2f} |")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
