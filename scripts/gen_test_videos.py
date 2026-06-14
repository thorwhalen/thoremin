#!/usr/bin/env python3
"""Generate short targeted test clips for the DAG pipeline via falaw (fal.ai).

Each clip isolates one gesture so it can be turned into a focused fixture
(video -> landmarks -> features). Raw .mp4s land in the gitignored media/videos/;
the derived NDJSON fixtures (committed) are built by video_to_landmarks.py +
build_video_fixture.ts.

Usage:
    python scripts/gen_test_videos.py [scenario ...]   # default: all
Requires: falaw + FAL_KEY in the environment.
"""
import sys
import falaw

# Prompts tuned for landmark trackers: single subject, frontal, plain dark
# background, bright even lighting, photorealistic, static locked-off camera.
HAND_PREFIX = (
    "A single human hand centered in frame, palm facing the camera, against a "
    "plain dark studio background, bright even lighting, photorealistic, sharp focus. "
)
HAND_SUFFIX = " Static locked-off camera, no other objects, no text, no watermark."

SCENARIOS = {
    "hand_sweep": HAND_PREFIX
    + "Fingers spread, the hand slowly glides from the left edge to the right edge of the frame and back, staying fully visible."
    + HAND_SUFFIX,
    "hand_open_close": HAND_PREFIX
    + "The hand repeatedly opens wide with fingers fully spread, then closes into a fist, several times, slowly and clearly."
    + HAND_SUFFIX,
    "hand_pinch": HAND_PREFIX
    + "The thumb and index finger repeatedly pinch together until they touch, then spread apart, several times slowly; the other fingers stay extended."
    + HAND_SUFFIX,
    "two_hands": (
        "Two human hands, both palms facing the camera, against a plain dark studio background, "
        "bright even lighting, photorealistic, sharp focus. The two hands move independently — "
        "one rises while the other lowers, then they swap — staying fully visible and separated."
        + HAND_SUFFIX
    ),
    "face_expressions": (
        "A close-up of one person's face looking straight at the camera, against a plain dark "
        "studio background, bright even lighting, photorealistic, sharp focus. The person cycles "
        "slowly and clearly through expressions: neutral, then a big smile, then a surprised open "
        "mouth, then raised eyebrows, then back to neutral." + HAND_SUFFIX
    ),
}


def main() -> int:
    which = sys.argv[1:] or list(SCENARIOS)
    for name in which:
        prompt = SCENARIOS.get(name)
        if not prompt:
            print(f"unknown scenario {name}; have: {', '.join(SCENARIOS)}", file=sys.stderr)
            return 1
        out = f"media/videos/{name}.mp4"
        print(f"generating {name} ...")
        r = falaw.text_to_video(
            prompt,
            quality="high",  # Seedance Pro
            extra={"aspect_ratio": "1:1", "resolution": "720p", "duration": "5"},
        )
        r.first.download(to=out)
        print(f"  -> {out}  ({getattr(r.first, 'url', '')})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
