# scripts/subframe — the sub-frame impact benchmark

The scoring pipeline behind [`docs/research/subframe-impact-prediction.md`](../../docs/research/subframe-impact-prediction.md). Everything it makes lands under `~/.local/share/thoremin/synthetic/` and is never committed; only the three small fixtures under `test/fixtures/subframe_*` are.

1. **Generate the clip sets** (needs the `an` package, `pip install an`, which brings `an.impacts`; nothing is rendered, so no browser is needed):

   ```bash
   python scripts/subframe/gen_clip_sets.py --quick    # 32 clips, 30 fps only, one seed
   python scripts/subframe/gen_clip_sets.py            # 288 clips: object × kind × fps × shutter × timing × seed
   ```

2. **Score the estimators** (the frame-snapped baseline, the shipped ictus detector, the impact predictor with a learned or known plane, the priors and the magnet), across keypoint noise levels and required leads; writes `results.json` and `results.md` next to the set and prints the summary:

   ```bash
   npx vite-node scripts/subframe/score.ts --set ~/.local/share/thoremin/synthetic/bench-v2 --noise 0,1,2 --min-lead 0,0.03,0.06
   ```

   The slow column: `--fps 15` thins every clip to a regular slower camera, `--infer 0.045` paces it by a simulated inference time (the latest frame wins; `decimate.ts`). The stamp regimes (`stamps.ts`): `--poll 60` is `raf-poll`, positions held from the latest frame and sampled at a 60 Hz vsync with the vsync time as the stamp (Safari before the pump fix); `--dejitter line` runs the frame pump's gated de-jitter over the stamps with the source each regime stands for (`exact` and `capture-jitter-actual` are capture stamps and must come out byte-identical, which the scorer checks; `--dejitter clamp` is the variant capped at the raw stamp, for comparison). `--predict-opts '<json>'` passes extra `createImpactPredictor` options to every predictor run, so a variant is scored against the shipped defaults without editing them (`'{"airReference":"departure"}'` reproduces the air rows before #234). Each flag is read once: pass it once.

   `decompose.ts` splits the prediction's air error into its parts (the commit's crossing against the confirmation's, the reference's bias, the learned lag's trail), per rate and lead, with the same `--set` and `--predict-opts`:

   ```bash
   npx vite-node scripts/subframe/decompose.ts --set ~/.local/share/thoremin/synthetic/bench-v2 --min-lead 0.03,0.077
   ```

3. **Make a committed fixture** from one clip (keypoints verbatim, the truth without its per-frame table):

   ```bash
   an impacts clip ~/.local/share/thoremin/synthetic/fixtures --kind air --beats 8 --fps 30 --exposure 0.5 --no-render
   npx vite-node scripts/subframe/build_fixture.ts ~/.local/share/thoremin/synthetic/fixtures/<clip> subframe_<name>
   ```

The truth sidecar's schema is documented in the `an` package (`an/impacts/truth.py`); the scorer reads `spec`, `objects[0].impact_keypoint`, `events[].{t_grid, t_impact, kind, impact_xy, frames.lowest_error}` and the observation stream `keypoints.ndjson`.
