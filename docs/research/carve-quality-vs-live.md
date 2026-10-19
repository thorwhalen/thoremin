# Carve quality chips against the live readout (#553)

The check [#436](https://github.com/thorwhalen/thoremin/issues/436) asked for and [#552](https://github.com/thorwhalen/thoremin/pull/552) only covered with a synthetic test: on a real recording, do the quality chips, with a category's spread taken from the holds' supporting frames, move toward what Trying shows frame by frame? The harness is `test/faces/carve_quality_recording.test.ts`.

## Method

The recording is `video_face_expressions` (97 frames at 30 fps: a resting face, a smile, a smile with the mouth open). It is too short for the still-point sampler, so holds are cut as that sampler would cut a longer take: consecutive dwell windows of N frames inside each segment (rest is the unclaimed rest cloud), each hold the mean of its N frames and those frames its `support`. The model is `trainModel` over the holds in reject mode, features weighted by their jitter at rest (as in `recordedCategorizer`). The chip is `carveQuality` without and with `supports`. The live readout is every frame of the category's own segment through `classify` and `liveMargin` (what the tracker and the margin meter see), and the frame-level separation is the mean distance of its frames to the other category's centre over their mean distance to their own centre (the chip's ratio, taken over frames).

## Result

Chip ratio (grade) before / after the supporting frames, against the frames' own separation and the live readout, for N-frame holds (smile = cat-1, open smile = cat-2):

| hold | smile before | smile after | smile frames | open before | open after | open frames | open smile read as itself / as none of these / flips |
|---|---|---|---|---|---|---|---|
| 4 f | 3.93 distinct | 3.36 distinct | 3.52 | 2.88 ok | 2.41 ok | 2.61 | 57 % / 43 % / 8 |
| 6 f | 4.48 distinct | 3.55 distinct | 3.71 | 2.85 ok | 2.31 ok | 2.52 | 47 % / 53 % / 11 |
| 8 f | 4.56 distinct | 3.35 distinct | 3.51 | **3.74 distinct** | 2.59 ok | 2.78 | 67 % / 33 % / 4 |
| 10 f | 4.85 distinct | 3.35 distinct | 3.51 | **3.35 distinct** | 2.29 ok | 2.51 | 43 % / 57 % / 10 |

- **The supporting frames do what #436 wanted.** After them the chip's ratio is within about 0.2 of the frames' own separation at every hold length (before, it overshot by 0.3 to 1.3 and grew with the hold length: a longer dwell averages more noise away). On the open smile, two of four hold lengths read DISTINCT before and read OK after; the live readout never reads that category as the smile (0 % in every row), so OK is the honest grade for a pair that is separated but not by much.
- The chips now rank the categories as the live readout does: the open smile is the less separated and the one that reads as itself less (43 to 67 % against 90 to 93 % for the smile).
- **What the chip still does not say.** The open smile's frames are read as "none of these" in a third to a half of the frames, and the margin meter calls half to two thirds of them on the edge or outside. That is the reject radius, not a confusion with the smile: the chip measures the distance to the nearest neighbour category over the spread, and a category whose frames wander past its own reject radius is not penalised by it. Filed as [#564](https://github.com/thorwhalen/thoremin/issues/564) (the chip could also report the share of the category's supporting frames that fall past the reject radius).

Numbers are from one 3-second recording of one face, so they are a regression check on the direction, not a calibration of the grade thresholds.

## The share past the reject radius (#564)

`carveQuality` now reports, per category, the share of its supporting frames whose nearest category centre is past the model's reject radius (`CategoryQuality.outside`; `sloppy` when it is over `QUALITY_DEFAULTS.sloppyShare`, 0.25), and the Sorting chip says "often none of these" with the number in its tooltip. It words the chip only; the grade is unchanged. On this recording it tracks the live readout's own "none of these" share to within 0.15 at every hold length, flags the open smile at all four (33 to 57 %) and never the smile (7 to 10 %). The 0.25 line is provisional: it is chosen on this one recording, where any value from 0.10 to 0.33 separates the two, and should move when a second recording says where the line belongs.
