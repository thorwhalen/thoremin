# Dynamic gestures: moving categories beside the static carve (design, #718)

Status: design 2026-10-20; phase 1 built (#751: `motion.ts`, `gestures/segmenter.ts`, the `gesture` cue); phases 2-5 open (#752-#755). Issue: [#718](https://github.com/thorwhalen/thoremin/issues/718); the static carve it sits beside: [#385](https://github.com/thorwhalen/thoremin/issues/385) and [#387](https://github.com/thorwhalen/thoremin/issues/387) (B8: "static only", with dynamic gestures designed here and built later); the research it starts from: `docs/research/trainer-mode.md` section 2.3 and `docs/research/body-conducting-and-pose-categories.md` (the line on dynamic gestures: the $-family, the Gesture Follower, GVF).

## 1. What is being decided

The carve (`packages/sdk/src/enroll/`) turns a take into categories of **held** poses. Its front end is the still-point sampler (`sampler.ts`), which keeps the frames where the feature vector has stayed still for a dwell and throws the transitions away, because clustering transitions finds the centre of the motion envelope, not anything a player can do on purpose. That is right for a smile, wrong for a wave: a wave, a sweep, a circle, a nod, a flick is *only* transition.

The decision: a **dynamic category** is a different kind of thing from a static one, not a flag on it. It has a different capture (a labelled window, not a still), a different classifier (a windowed one over the feature stream), a different quality model (shape agreement across repetitions, not spread around a centre) and a different output (an event with a progress and a variation, not a membership held in time). What they share is the session, the file envelope, the cue routine, the bindings and the sorting grid. The rest of this note says how.

## 2. The classifier: a windowed matcher over the feature stream

Input is what the static classifier already reads: the per-frame **feature vector** of a modality (`FeatureVector`: named numbers in torso lengths or noise units, from the face, hand or body extractor), at the camera rate. No new extractor is needed; a dynamic category is a path through the same feature space.

**Reference algorithm: the Gesture Variation Follower** (Caramiaux, Montecchio, Tanaka, Bevilacqua, 2014, summarised in `trainer-mode.md` 2.3). GVF follows a gesture *as it unfolds* with a particle filter whose state is the phase along each template plus the variations of speed, scale and rotation, and it reports, per template, a likelihood, the current phase and the variation estimates. That is the shape this app needs for three reasons: it is causal (past frames only, like `ictus`), it recognises a gesture before it ends (a wave is played, not awaited), and its variation estimates are an expressive channel for free (how fast, how big), which the trainer research already argued a step function wastes.

Plan for the implementation, from the cheapest rung up, each behind the same interface:

1. **Template matching over a sliding window** (the $-family and DTW lineage in `body-conducting-and-pose-categories.md`): the last W frames, resampled, normalised, distance to each category's templates under dynamic time warping with a band. Strong enough for v1 and easy to explain.
2. **GVF** proper (particle filter), when progress and variation are wanted as outputs.
3. Anything learned (an HMM, a small network) only if 1 and 2 fail on real takes; the interface does not change.

The seam is one injected `WindowMatcher`, the same way `RhythmPrior` and `AnchorDetector` are injected in `ictus`: `push(frame) -> { gestureId | null, progress, variation, confidence }`, `reset()`. Pure TypeScript in the SDK beside `classify.ts`, no clock, no DOM, held pure by the same purity test. Defaults: the strongest matcher that needs no new dependency (rung 1).

**Feature subset and invariance.** A gesture is matched on a chosen subset of features (a wave is the wrist's x, not the face's mouth), picked by the same machinery that weights features for static categories (`lda.ts`, `invariance.ts`), with the nuisance down-weighting the session already learns. Position, scale and (for hands) rotation invariance are options of the matcher, defaulting to the invariances that the modality's static categorizer already applies (torso-normalised for the body, mirrored where the file says `mirrored`).

## 3. How it reuses the carve session

The carve session is cue-driven (`cue.ts`, `session.ts`): a routine says what to do, the session captures per cue, and `build()` produces a model once. A dynamic category reuses the pieces that are not about stillness:

- **The routine and the cue.** A new cue `produces` kind, `gesture`, next to `vocabulary`, `baseline` and `nuisance`. Its prompt asks for a repetition ("Do the wave 5 times; pause between"), and unlike a face cue it **names the gesture**, as `sequence.ts` does for the air instruments' vocabulary: dynamic gestures are few and the player knows what they want ("wave", "circle"), and a cluster of unnamed motion has no still centre to find.
- **The capture.** Instead of the still-point sampler, a **motion segmenter** (the sampler's complement: it keeps the dynamic segments the sampler discards, using the same velocity signal and the same dwell logic inverted) cuts the repetitions out of the take. Each segment is a **trace**: a short run of feature rows. The segmenter's thresholds come from the session's noise estimator, so "moving" is measured in the same noise units as "held".
- **The noise estimator and the baseline cue** are shared unchanged: they set what counts as motion and what counts as rest. A gesture cue's own frames do not feed the estimator (as a nuisance demonstration's do not, #460): five waves folded into the jitter would inflate the unit they are judged in, so a routine runs a rest cue before its first gesture cue.
- **The hierarchy is not used for gestures** (nothing to cluster when the player named them), but its role in *finding the right number of categories* is replaced by **per-gesture trace agreement** (section 4).
- **The file.** The versioned personal categorizer file gains an optional, additive section for dynamic categories (`gestures: [{ id, label, features, traces }]`), the version unchanged, absent from older files, dropped by older builds (the same treatment `skeleton` and `mirrored` got). Samples stay the source of truth: the matcher is derived from the traces, never stored.
- **Bindings** are keyed by category id on the record (`record.ts`), so a gesture binds like a face. What differs is the trigger: a static category binds to *entering and leaving*; a gesture is an **event** (`fired`, with progress and variation on the way), so its binding dispatches on fire and may carry the variation as a parameter.

## 4. The sorting and quality model

A static category is judged by spread and separation (`quality.ts`: separation, leave-one-hold-out, number of holds). The dynamic analogues, to be computed over the traces of a gesture:

- **Agreement**: the mean DTW distance of each trace to the others of its gesture, in units of the typical agreement across gestures. Low agreement means the player did not repeat the same thing; the chip says "your five waves differ" and offers to drop the odd one (the leave-one-trace-out version of the suspect hold).
- **Separation between gestures**: the distance from one gesture's templates to the nearest other's, against its own agreement; below a ratio, two gestures will be confused ("circle" and "wave" share a path).
- **Separation from rest and from the static categories**: a gesture whose traces start and end at a static category's hold is fine; one that passes through a static hold for longer than the dwell would also fire that category, so the grid flags the overlap.
- **Traces**: one trace is no agreement ("needs another repetition"), the same wording as one hold.
- **Everyday false fires**: the existing "everyday check" (`everyday.ts`: how often a category fires by accident over ordinary movement) applies directly and matters more here, because ordinary movement is exactly what a dynamic gesture is made of.

Sorting for dynamic categories is thin on purpose: rename, delete, drop a trace, record more, merge (pool two gestures' traces). Splitting is not offered; a player who wants two gestures records two.

## 5. What it stores

On the device, per categorizer: the traces (rows aligned with `features`, rounded as `support` is, decimated to the matcher's rate), the chosen features, the gesture's window length and its invariance options. Never the raw video. Estimated size: a trace of 1.5 s at 30 fps over 10 features is 450 numbers; 5 traces per gesture and a dozen gestures stay inside the budget a categorizer file already has for `support`. The live tuning (sensitivity, gesture-specific confidence threshold, a refractory period after a fire) is kept on the device only, as the existing live dials are, and is never exported.

Training data from a player is player data: it follows the data rules of the app (the collection `thoremin.categorizers`, no separate store).

## 6. Where it belongs in the code

- `packages/sdk/src/enroll/` gains `gestures/` (segmenter, window matcher, trace quality) beside the static modules, with a barrel export, purity-held.
- `packages/sdk/src/enroll/cue.ts` gains the `gesture` produces kind; `record.ts` and `categorizer.ts` gain the additive section.
- The faces extension (`packages/ext-faces`) gets a Gestures section in the Sorting grid and a repetition prompt in the carve routine; nothing in the host changes, and the conductor node and `ictus` are not touched (the two meet only if a conducting beat is to be learned from traces, which is out of scope).
- A node that reads a categorizer's gestures emits an event stream beside the category stream the face node already emits.

## 7. Open questions, with a leaning

1. **Per-frame or per-segment classification.** Per-frame (GVF, causal, fires early) is the goal; per-segment (after the motion ends) is the simplest first rung and is enough for "a wave toggles a sound". Leaning: ship per-segment first, with a refractory period; add the causal matcher behind the same interface.
2. **How many repetitions.** Three to five is the gesture-recognition literature's usual floor; the quality chip decides, not a fixed count.
3. **One hand or both, and which body part.** Resolved by the feature subset, not by the matcher; the first modality is the hand (the wrist's path), then the body.
4. **Do dynamic and static categories share one categorizer file or have two.** One file with an optional section, so a binding set and a carve are one thing to save and share.
5. **A live ear check.** The matcher's thresholds cannot be set from synthetic takes alone; a real-take set is a human-only prerequisite for phase 4 below.

## 8. Phases (each a separate issue)

1. **Motion segmenter and trace capture**: the `gesture` cue kind, the segmenter on the sampler's velocity signal, traces on the session, a synthetic-hand test set (`synthetic_hand.ts`).
2. **Window matcher, rung 1**: DTW with a band over the chosen features, the `WindowMatcher` seam, the per-segment fire, goldens on synthetic gestures.
3. **File and quality**: the additive file section, trace agreement and separation, the Sorting chips, everyday false fires.
4. **The extension surface**: the Gestures section in the grid, the repetition prompt, bindings that fire on an event; needs a real-take set to set the defaults (`manual-task`).
5. **Causal matcher (GVF)**: progress and variation outputs, per-frame firing, the variation as a binding parameter.

## References

1. [Adaptive Gesture Recognition with Variation Estimation for Interactive Systems](https://research.gold.ac.uk/10541/1/gvf_tiis_si.pdf), Caramiaux et al., ACM TiiS 4(4), 2014.
2. [ofxGVF, the Gesture Variation Follower](https://github.com/bcaramiaux/ofxGVF), reference implementation.
3. `docs/research/trainer-mode.md` section 2.3 and `docs/research/body-conducting-and-pose-categories.md`, which hold the $-family, Gesture Follower and DTW references.
