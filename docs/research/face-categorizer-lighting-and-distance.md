# Lighting and camera distance vs a personal face categorizer (#330 P3)

Measured 2026-10-13, before deciding which live dials the personal face categorizer gets. The question: how far do lighting and camera distance move the feature vector a categorizer classifies, compared with the distances that separate its categories? Every number below comes from the repo's own code: `blendshapesToFaceFrame`, `buildFaceCtx` with `FACE_FEATURES` (the `face-feature-vector` node's path), the production noise estimator (`createNoiseEstimator` with `scaleWeights`), `weightedDistance`, `trainModel` and `classify`. The feature set is the categorizer's: `FACE_TRAINING_GROUPS` minus `FACE_OMIT`, 94 features. Distances are in noise units (NU), the unit every categorizer distance is in.

## Verdicts

**Lighting: no dial.** Ordinary lighting changes move the mean vector by about as much as sensor noise does with no lighting change, below a still face's own frame-to-frame jitter, and about a tenth of the distance between two of one person's expressions. Only a dim, noisy room moves it a lot, and that movement differs by feature, by person and by frame: subtracting the best possible constant per-feature offset (the most any dial could do) removes 14-19 % of it. The right response to a dark room is a warning ("too dark: add light, or record again"), not a dial.

**Distance: a dial, learned per player, gated per feature.** Moving the camera alone can carry a held face out of its category's reject radius. The effect is concentrated in about a dozen features (eyes look wider and brows higher as the camera gets closer), it is only roughly linear in log face scale, and the slope differs between moving in and moving out by 1.3x to 6x within one take. So the categorizer learns the slope from its own samples (within each category, against log `face.head.scale`), keeps it only for features distance explains well (r² at least 0.5), and the dial subtracts it live. One global slope for everyone would not be sound. This is what `packages/ext-faces/src/lib/live.ts` does.

## Lighting

**Source:** [Deficits in the Mimicry of Facial Expressions in Parkinson's Disease, video 1](https://commons.wikimedia.org/wiki/File:Deficits-in-the-Mimicry-of-Facial-Expressions-in-Parkinsons-Disease-Video1.ogv), Livingstone et al. 2015, CC BY 4.0. 31.5 s, 1280x720, five frontal, studio-lit segments by four people (calm, happy, sad, angry, fear). Nothing derived from it is committed beyond the numbers here.

**Method.** Each variant re-renders the same frames (so a difference is lighting only), runs MediaPipe FaceLandmarker (the app's float16 model and tasks-vision 0.10.35, VIDEO mode, CPU) in headless Chromium, and computes the categorizer's features per frame as the app does. The baseline run is deterministic (two runs byte-identical). The noise unit is the production estimator over the baseline; it is 1.22x the held-rest jitter of the `video_head_pose` fixture, so the NU figures if anything overstate lighting.

**Reference distances (baseline, NU):** frame to frame (median) 12.5; happy vs sad (same person) 104.7; happy vs angry 132.8; calm vs fear 147.3. A categorizer trained on the five segments has a reject radius near 100 NU and classifies 92 % of frames correctly.

| variant | face luminance | detected | mean shift (NU) | after best offset (NU) | largest single feature (NU) | 5-category accuracy |
|---|---|---|---|---|---|---|
| baseline | 138 | 100 % | 0 | | | 92 % |
| sensor noise only | 137 | 100 % | 7.8 | 9.7 | 3.0 | 92 % |
| about 1 EV darker | 84 | 100 % | 10.5 | 10.0 | 2.6 | 91 % |
| overexposed | 202 | 100 % | 7.6 | 11.3 | 2.5 | 92 % |
| low contrast | 131 | 100 % | 7.2 | 10.1 | 1.8 | 93 % |
| warm (3000 K) | 107 | 100 % | 10.1 | 9.7 | 3.5 | 92 % |
| cool (10000 K) | 114 | 100 % | 5.7 | 6.8 | 1.9 | 91 % |
| half the face in shadow | 80 | 100 % | 13.1 | 15.4 | 4.7 | 92 % |
| dim and noisy (about -1.5 EV) | 51 | 100 % | 28.5 | 24.0 | 8.1 | 88 % |
| very dim and noisy (about -2.5 EV) | 29 | 100 % | 59.3 | 48.3 | 22.8 | 85 % |

"After best offset" is the median per-frame distance once the best global per-feature offset is subtracted. Blendshapes carry 45-59 % of every shift, the AUs (built from blendshapes) 15-28 %, geometry 12-30 % (growing with darkness), head pose 0-3 %. In the dim variants the shift differs between segments about as much as it differs from zero, and the frame-to-frame scatter exceeds it: there is no constant to subtract. Detection never failed, even at face luminance 29.

## Distance

**Fixture:** `test/fixtures/video_head_pose`, the dolly window (10.9-13.6 s, 80 frames, a smile held, the camera moved from 35.5 to 17.6 cm by the transform's translation). Only blendshape features and head pose are computable there (the committed stream carries no landmarks): 70 categorizer features.

**Size of the effect (NU):** far vs near 63.7; rest vs smile 156.7; rest vs frown 142.5; the fixture's reject radius (2.5x the rest spread) 52.7. Of 67 non-pose features, 27 move more than 3 NU over the dolly, 11 more than 10, 3 more than 20.

| feature | dolly move (NU) | r | slope approach / retreat (per cm) |
|---|---|---|---|
| eye.wideLeft | 31.7 | -0.85 | -0.0038 / -0.0021 |
| au5 | 27.5 | -0.81 | -0.0029 / -0.0018 |
| symmetry.smile | 20.0 | -0.76 | -0.0066 / -0.0033 |
| eye.wideRight | 18.3 | -0.62 | -0.0020 / -0.0015 |
| brow.outerUpLeft | 15.7 | -0.67 | -0.0465 / -0.0118 |
| au2 | 12.7 | -0.57 | -0.0390 / -0.0061 |
| symmetry.browOuter | 12.6 | 0.81 | 0.0151 / 0.0113 |
| au7 | 9.7 | 0.84 | 0.0080 / 0.0082 |
| eye.squintLeft | 9.5 | 0.81 | 0.0138 / 0.0120 |
| brow.innerUp | 9.1 | -0.78 | -0.0164 / -0.0143 |

A negative slope means the feature grows as the camera gets closer.

**Why, and how linear.** Resolution alone is not the cause: the same frames shrunk to half size move 7.4 NU with no expression feature above 3 NU, and detection only fails near 40 px between the outer eye corners. The dolly's movement is perspective plus the head tilt that comes with leaning in (roll, yaw and pitch all correlate with distance in this take, so the two cannot be separated here). Log face scale fits better than distance (median r² 0.47 vs 0.39); a quadratic barely helps (median residual 6.0 vs 4.4 NU). The fit is weak for most features (median r² 0.11 over all 67), and clean only for a few (au7 with eye.squint, brow.innerUp, symmetry.browOuter, eye.wide).

**The proxies live.** `face.head.scale` (inter-ocular distance) and `face.head.distanceProxy` are computed every frame when the `face.head` group is on; `FACE_OMIT` only keeps them out of a categorizer's features, and a take's samples keep them. Inter-ocular distance follows image scale exactly and correlates 0.92 with the inverse of the transform's depth on the lighting clip (0.98 in the fixture's README). It foreshortens when the head turns; the iris-based proxy holds up better under yaw.

## What this decided

- No lighting dial. Follow-up: a "too dark" warning from face luminance or a jump in live jitter.
- The distance dial (`fitDistance` in `packages/ext-faces/src/lib/live.ts`): per categorizer, the pooled within-category slope of each feature against log `face.head.scale` (else `face.head.distanceProxy`), kept only where r² is at least 0.5, subtracted live in proportion to the dial, toward the samples' mean scale. A take recorded at one distance teaches nothing, and the dial says so. A take that leans in and out while holding each face is what teaches it; a dedicated distance cue in the take would make that deliberate (follow-up).

## Caveats

One clip of four talking people, studio-lit, with synthetic lighting changes: real low light (auto-exposure, motion blur, compression) is not modelled. The classification check uses speech segments and a loose reject floor; a categorizer of held faces with a rest-based radius is tighter, so the dim variants would matter more there, while ordinary lighting stays below jitter. The distance fixture is one take of 80 frames, pose mixed in, blendshape features only.
