/**
 * The speakable set (#163 §4) — every string the trainer can SAY, enumerated from data.
 *
 * The spoken channel is cached audio only: no runtime TTS, no API key in the browser,
 * no per-run cost. That is only possible because the set of utterances is FINITE and
 * derivable without running anything: each cue's instruction and variations, the
 * built-in nudges, the finite `cannot` reasons, and the runner's own phrases. This
 * module is the one place that enumerates it, and it is used by BOTH ends:
 *
 * - `scripts/cue_strings.ts` prints it for the generator (`scripts/gen_cue_voice.py`),
 *   which synthesises one clip per string, content-addressed by the string's hash, so
 *   re-running regenerates exactly the strings whose text changed;
 * - `test/trainer_voice.test.ts` checks every string here has a clip in the shipped
 *   manifest — the guard that a reworded cue does not ship silently.
 *
 * The clip key is the SHA-1 of the text (first 12 hex chars): the same text in two
 * cues is one clip, and a changed word is a new clip.
 */
import { CANNOT_REASONS, DEFAULT_NUDGES, RUNNER_PHRASES, type Cue } from '@/enroll';

/** Every string the runner may say for `cues`, de-duplicated, in a stable order. */
export function speakableStrings(cues: readonly Cue[]): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    if (s && !out.includes(s)) out.push(s);
  };
  for (const c of cues) {
    add(c.instruction);
    for (const v of c.variations) add(v);
  }
  for (const s of Object.values(DEFAULT_NUDGES)) add(s);
  for (const s of Object.values(CANNOT_REASONS)) add(s);
  for (const s of Object.values(RUNNER_PHRASES)) add(s);
  return out;
}

/** The manifest the generator writes and the app reads (`public/voice/manifest.json`). */
export interface VoiceManifest {
  /** The ElevenLabs voice every clip was made with — one voice for the whole set. */
  voiceId: string;
  modelId: string;
  /** Text → clip file name (relative to the manifest's directory). */
  clips: Record<string, string>;
}

/** Strings in `wanted` with no clip in `manifest` (the coverage check). */
export function missingClips(manifest: VoiceManifest, wanted: readonly string[]): string[] {
  return wanted.filter((s) => !manifest.clips[s]);
}
