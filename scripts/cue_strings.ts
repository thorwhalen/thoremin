/**
 * Print the trainer's speakable strings (#163 §4) as a JSON array — the input of
 * `scripts/gen_cue_voice.py`, which synthesises one cached clip per string.
 *
 *   npm run voice      (= vite-node scripts/cue_strings.ts | python3 scripts/gen_cue_voice.py)
 *
 * The set comes from the same `speakableStrings()` the coverage test uses, so the
 * generator and the guard can never disagree about what needs a clip.
 */
import { STARTER_CUES } from '@/app/enroll/starterCues';
import { speakableStrings } from '@/app/enroll/speakable';

process.stdout.write(JSON.stringify(speakableStrings(STARTER_CUES), null, 2) + '\n');
