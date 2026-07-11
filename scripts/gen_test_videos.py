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
    # ---- #119 Feature-Lab coverage clips ------------------------------------
    # Each isolates ONE feature group so its meters sweep their full achievable
    # range (the min/max-envelope normalizer can only be validated by a clip that
    # actually REACHES the extremes). One axis per clip: a 5s text-to-video model
    # reliably renders a single continuous motion, not a 3-part choreography.
    "hand_palm_orientation": (
        "A single human hand centered in frame, fingers extended straight and held together, "
        "against a plain dark studio background, bright even lighting, photorealistic, sharp focus. "
        "The hand slowly and continuously rotates about the wrist: it starts with the palm facing "
        "the camera, turns a quarter turn so the thumb points up and the palm faces sideways, then "
        "keeps turning until the back of the hand faces the camera, then smoothly rotates back to "
        "the palm facing the camera. The wrist stays centered and the fingers stay straight and still."
        + HAND_SUFFIX
    ),
    "hand_finger_independence": HAND_PREFIX
    + "The fingers curl one at a time in sequence — index, then middle, then ring, then little finger — "
    "each folding down to the palm and straightening again while the other fingers stay extended and still."
    + HAND_SUFFIX,
    "hand_spread": HAND_PREFIX
    + "The fingers slowly splay apart as wide as they can go, then slowly close together until they touch, "
    "repeatedly; the fingers stay straight and the palm keeps facing the camera the whole time."
    + HAND_SUFFIX,
    "hand_depth": HAND_PREFIX
    + "The open hand, fingers spread and still, moves slowly straight toward the camera until it fills the "
    "frame, then slowly straight back away from the camera, keeping the same pose throughout."
    + HAND_SUFFIX,
    "face_head_pose": (
        "A close-up of one person's face against a plain dark studio background, bright even lighting, "
        "photorealistic, sharp focus. Keeping a neutral expression and eyes open, the person slowly turns "
        "their head to the left, then to the right, then tilts it up, then down, then tips it side to side "
        "toward each shoulder, returning to facing the camera. The face stays centered and fully visible."
        + HAND_SUFFIX
    ),
    "face_gaze": (
        "An extreme close-up of one person's face, head held perfectly still and facing the camera, against "
        "a plain dark studio background, bright even lighting, photorealistic, sharp focus. Only the eyes "
        "move: the person looks far left, then far right, then up, then down, then back to the center, then "
        "blinks. The head does not move or rotate at all." + HAND_SUFFIX
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
