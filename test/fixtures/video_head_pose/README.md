# `video_head_pose` — the head-pose / expression sign fixture

The recording that settles the **#76 axis-sign question headlessly**, so it stops needing
a live webcam session every time someone touches face mapping (#146 §1).

## Provenance

Decoded from a 13.5 s 1080p30 iPhone 14 Pro front-camera clip recorded by the maintainer
on 2026-08-22, with:

```
media/.venv/bin/python scripts/video_to_face.py <clip>.mov /tmp/clip.face.ndjson \
    --landmarks-out /tmp/clip.landmarks.ndjson
```

405 frames, face detected in **100%** of them.

**The committed stream carries `{present, blendshapes, transformMatrix}` only — the 478
landmarks are deliberately stripped.** Two reasons, both load-bearing:

- **Size.** With landmarks it is 1.8 MB gzipped, 2.5× the largest existing fixture.
  Without, it is 96 KB — the *smallest* fixture in the repo.
- **Privacy.** A 478-point mesh is facial geometry; blendshape coefficients and a
  4×4 head-pose matrix are not, and neither reconstructs a face. A public repo should
  carry the smaller claim.

Nothing is lost for this fixture's purpose. The head pose comes from `transformMatrix`
via the production `matrixToHeadPose`, and the **camera-distance** signal is the matrix's
translation-z, which correlates **r = 0.98** with inter-ocular distance over the dolly
window — so the scale-confound assertions need no landmarks either.

The source `.mov` is **not** committed (30 MB, and it is a video of a person's face).

## Ground truth

Established by reading the decoded traces against the actual video frames, not by
assuming what the recording was supposed to contain. Times are seconds from clip start
(the decoder reports 29.3 fps effective).

| window | what the person does | the axis it pins | measured extreme |
|---|---|---|---|
| 0.3 – 1.4 s | chin **UP**, looking at the ceiling | pitch | **−36.7°** @ 0.96 s |
| 1.7 – 3.3 s | chin **DOWN**, looking down | pitch | **+25.6°** @ 2.70 s |
| 3.9 – 4.6 s | head turned toward **image-left** | yaw | **−26.9°** @ 4.30 s |
| 4.7 – 5.9 s | wide open **smile** | smile | **0.95** @ 5.73 s (`jawOpen` 0.42) |
| 6.0 – 7.0 s | head turned toward **image-right** | yaw | **+34.8°** @ 6.62 s |
| 7.2 – 7.6 s | **frown** / brow lowered | brow | `browDown` **0.79** @ 7.41 s |
| 11.0 – 12.2 s | camera moves **closer**, smile held | (scale confound) | tz −36.0 → −17.6 |
| 12.3 – 13.7 s | camera moves back out | (scale confound) | reverses |

### What this fixture does NOT settle

- **Roll.** The clip's largest roll is **+7.1°** — an incidental tilt, not a deliberate
  ear-to-shoulder move. Too small to pin a sign against a 30° `headRangeDeg`. A future
  clip with a deliberate roll would close this.
- **Yaw and roll in BODY terms.** The table above is stated in **image** terms
  (`image-left` / `image-right`) because that is what is actually measurable from the
  file. Converting to "the person's own left/right" needs to know whether the recording
  is mirrored — iOS's *Mirror Front Camera* setting, which is off by default (saved video
  un-mirrored) but is per-device and not recorded in the file's metadata. Pitch, smile
  and brow are unaffected by horizontal mirroring, which is why they are settled and yaw
  is flagged.

## Regenerating

Re-decode the source clip with the command above, then strip the landmarks and gzip
deterministically (`mtime=0`) so the committed bytes are reproducible.
