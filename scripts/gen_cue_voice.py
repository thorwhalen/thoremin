"""Generate the trainer's spoken clips (#163 §4) — cached audio, one voice, content-addressed.

Usage (from the repo root, with ELEVENLABS_API_KEY in the environment):

    npm run voice            # = vite-node scripts/cue_strings.ts | python3 scripts/gen_cue_voice.py

Reads the speakable strings (JSON array on stdin, produced by `scripts/cue_strings.ts`
from the same `speakableStrings()` the coverage test uses), and for each string whose
clip is not already in `public/voice/` asks braidio to synthesise it. Writes
`public/voice/manifest.json` mapping text -> clip file.

Idempotent and content-addressed: the clip file name is the SHA-1 of the text, so
re-running regenerates exactly the strings whose wording changed, and nothing else is
billed. (braidio's own on-disk cache, keyed on text + voice + model, is a second guard:
a clip deleted from `public/` is re-served from it at no cost.)

ONE voice for the whole set, fixed here so the set is reproducible: a guidance voice that
changed between cues would be disorienting.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

from braidio.tts import narrate

# "Sarah — Mature, Reassuring, Confident" (ElevenLabs premade). Chosen for guidance:
# reassuring, unhurried, clear. Changing this regenerates (and re-bills) every clip.
VOICE_ID = "EXAVITQu4vr4xnSDxMaL"
MODEL_ID = "eleven_multilingual_v2"
# Small: the whole set must stay well under a megabyte. 22 kHz / 32 kbps mono MP3 is
# plenty for a spoken sentence and decodes everywhere.
OUTPUT_FORMAT = "mp3_22050_32"
# A touch slower and steadier than braidio's presenter default: these are instructions.
VOICE_SETTINGS = {
    "stability": 0.6,
    "similarity_boost": 0.75,
    "style": 0.0,
    "use_speaker_boost": True,
    "speed": 0.95,
}

OUT_DIR = Path("public/voice")
MANIFEST = OUT_DIR / "manifest.json"


def clip_name(text: str) -> str:
    """Content address: the first 12 hex chars of the text's SHA-1."""
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12] + ".mp3"


def load_manifest() -> dict:
    if MANIFEST.exists():
        return json.loads(MANIFEST.read_text())
    return {"voiceId": VOICE_ID, "modelId": MODEL_ID, "clips": {}}


def main() -> int:
    strings: list[str] = json.load(sys.stdin)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest()
    if manifest.get("voiceId") != VOICE_ID or manifest.get("modelId") != MODEL_ID:
        print(f"voice/model changed -> regenerating the whole set", file=sys.stderr)
        manifest = {"voiceId": VOICE_ID, "modelId": MODEL_ID, "clips": {}}

    made, billed, kept = 0, 0, 0
    clips: dict[str, str] = {}
    for text in strings:
        name = clip_name(text)
        path = OUT_DIR / name
        if path.exists():
            kept += 1
        else:
            _, was_cached = narrate(
                text,
                path,
                voice_id=VOICE_ID,
                model_id=MODEL_ID,
                output_format=OUTPUT_FORMAT,
                voice_settings=VOICE_SETTINGS,
                return_cache_status=True,
            )
            made += 1
            billed += 0 if was_cached else 1
        clips[text] = name

    # Drop clips no string refers to any more (a reworded cue's old clip).
    wanted = set(clips.values())
    removed = 0
    for f in OUT_DIR.glob("*.mp3"):
        if f.name not in wanted:
            f.unlink()
            removed += 1

    manifest["clips"] = clips
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    total = sum((OUT_DIR / n).stat().st_size for n in wanted)
    print(
        f"{len(strings)} strings: {kept} kept, {made} written ({billed} billed, {made - billed} from braidio's cache), "
        f"{removed} stale removed; {total / 1024:.0f} KB total -> {MANIFEST}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
