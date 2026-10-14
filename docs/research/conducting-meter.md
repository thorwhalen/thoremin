# Can the conductor's hand pattern say 2, 3 or 4? (#187 PR 6)

Verdict: no. Measured on every committed conducting clip, the hand pattern does not separate 2/4, 3/4 and 4/4 reliably enough to ship a classifier, so PR 6 of #187 is closed as measured-not-viable and nothing was added to `@thoremin/ictus`. The harness is `scripts/meter/measure_meter.ts` (`npx vite-node scripts/meter/measure_meter.ts`); it reproduces every number below.

## What was tried

The plan sketched lateral-direction profiles per pattern (2: down-up, 3: down-right-up, 4: down-left-right-up), the downbeat taken from the most vertical approach, and promotion after two consistent bars. Two features of the stroke follower's anchors were fitted:

- `strength`: the stroke's excursion over the player's recent envelope (`Anchor.strength`). The downbeat is the biggest stroke of a bar, so a bar of N beats should show one strong stroke every N.
- `vertical`: `1 / (1 + 3 |lateral|)`, the plan's "most vertical approach" (`Anchor.lateral` is the horizontal travel since the previous stroke).

Every accepted stroke gets an integer beat index (gaps measured in the median gap; a stroke closer than 0.55 of it is a rebound and dropped; one 1.6 gaps away is a missed beat). For N in {2, 3, 4} the fit is the share of the feature's variance (R²) explained by the split "k = p mod N" against the rest, over the best phase p, the strong class being the stronger one. The 95th percentile of the best-of-N fit on 400 shuffles of the same strokes is the chance level for that many strokes. A clip counts as classified only if the best N is the clip's and its fit beats that chance level.

Sources: `conducting_{44,34,24}` (the hand tracker, one video, 7 to 13 strokes per clip after the first) and `video_body_conducting_{44,34,24}` (the pose tracker's wrists, a different conductor and video, 24 to 45 strokes per clip; the right wrist is the baton hand).

## Result

Clips classified correctly and above chance: `strength` 1/3 on the hand tracker, 1/3 on the baton wrist, 1/3 on the other wrist; `vertical` 0/3 on all three sources. The best-fitting N was the right one in 7 of 18 cells and above chance in 3.

| source | clip | strokes | R² N=2 | N=3 | N=4 | best N | truth | chance 95% | classified |
|---|---|---|---|---|---|---|---|---|---|
| hand tracker | 2/4 | 7 | 0.27 | 0.06 | 0.34 | 4 | 2 | 0.96 | no |
| hand tracker | 3/4 | 13 | 0.05 | 0.83 | 0.09 | 3 | 3 | 0.56 | yes |
| hand tracker | 4/4 | 11 | 0.16 | 0.13 | 0.62 | 4 | 4 | 0.63 | no (0.62 against 0.63) |
| baton wrist | 2/4 | 24 | 0.49 | 0.10 | 0.20 | 2 | 2 | 0.30 | yes |
| baton wrist | 3/4 | 33 | 0.02 | 0.09 | 0.10 | 4 | 3 | 0.23 | no |
| baton wrist | 4/4 | 31 | 0.02 | 0.01 | 0.06 | 4 | 4 | 0.23 | no |

(`strength` rows only; the `vertical` rows and the other wrist are in the script's output.)

Reading it:

- On the hand-tracker clips the downbeat is visible in the stroke strengths (3/4: 0.83 against 0.05 to 0.09 for the wrong bar lengths), but the clips are 3 to 4 bars long, so a 4/4 fit of 0.62 cannot be told from chance (0.63). Two bars of evidence (the plan's promotion rule) is 8 strokes in 4/4 and the same fit is then noise.
- On the longer pose-wrist clips of a different conductor the signal is mostly absent: a legato 4 and a 3 are conducted with beats of near-equal vertical size, so the downbeat is not the biggest stroke. Only the 2/4 clip, where down and up differ by construction, is classified.
- The lateral/vertical-approach feature carries nothing: the horizontal travel of the tracked point depends on which hand the tracker follows, on the camera side and on the conductor's pattern, and the same beat position lands on both sides across bars.
- Which wrist is the baton hand changes the answer, and a meter recogniser would have to choose it.

## What it would take to retry

A classifier that a player can hear needs more footage than there is: several conductors per meter, longer than 8 bars, with the beats annotated, so that the fit can be tested on clips it was not designed on. Until then the bar length comes from the score's time signature or the conductor dial's `beatsPerBar`, as before, and `beatInBar` keeps counting from the first accepted stroke. The follow-up is tracked in the issue linked from #187.
