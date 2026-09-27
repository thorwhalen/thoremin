/**
 * Real-versus-air cues and the routines that run them (#247) — paired, labelled takes.
 *
 * Every air-instrument model so far learns from other people's footage, where the air
 * version has no ground truth and the real version has a different player
 * (`docs/research/air-instruments.md` §6.4). These routines give PAIRED data instead:
 * the same player performing the same cued phrase on a real surface or instrument (its
 * sound, through the microphone, is the ground truth), then in the air (the click is the
 * only reference). Each phrase is a pair of cues with the same `pairing.phrase`, one
 * `real` and one `air`, played to the same click.
 *
 * Nothing is learned in the browser from these cues (`produces: 'performance'`). The
 * take is the product: the clean camera, the hand feature vectors, the microphone, and
 * the cue intervals plus every click on one clock. `scripts/cue/pair_take.ts` turns it
 * into aligned pairs offline.
 *
 * ## Why these phrases
 *
 * - **Clap** first and last, unpaired: a clap is a sound and a visible contact at the
 *   same instant, which is what the offline script uses to map the microphone's clock
 *   onto the camera's (a slate, as in film). Two slates, because the microphone's clock
 *   also DRIFTS against the page's over a routine; the second measures by how much.
 * - **Taps** with one hand, then **alternating** hands: the air drum's stroke, alone and
 *   in the pattern a drummer actually plays. The onset is the label.
 * - **Soft and hard**: the same taps at two levels, because the air drum should play
 *   louder when struck harder. The onset's level is the label.
 * - **Strums** (guitar routine only, for a player with a guitar): a chord on each click,
 *   changing every four. The chord's pitch content (chroma) is the label, and the air
 *   half inherits it beat for beat.
 *
 * ## Wording
 *
 * Short, second person, one sentence, like every cue. Text only for now: the spoken
 * clips (`public/voice/`) cover the face starter set, and a click in the player's
 * headphones would talk over a voice anyway.
 */
import { FEATURE_GROUPS } from '@/features/catalog';
import { CueSchema, type Cue, type CueSpecInput } from '@/enroll';

/** Every hand group the catalog computes: the take records them all (a pair is compared
 *  feature by feature offline, so the recording must not pre-select). */
export const HAND_PAIRING_GROUPS: readonly string[] = FEATURE_GROUPS.filter((g) => g.source === 'hand').map((g) => g.id);

type Surface = 'real' | 'air';

const phraseCue = (
  id: string,
  name: string,
  instruction: string,
  rationale: string,
  opts: { phrase?: string; surface?: Surface; bpm?: number; beats?: number; tags?: string[] },
): Cue =>
  CueSchema.parse({
    id,
    name,
    instruction,
    rationale,
    collects: { groups: [...HAND_PAIRING_GROUPS] },
    produces: 'performance',
    sufficiency: { kind: 'clicked', bpm: opts.bpm ?? 80, beats: opts.beats ?? 16 },
    ...(opts.phrase && opts.surface ? { pairing: { phrase: opts.phrase, surface: opts.surface } } : {}),
    tags: ['hand', 'real-vs-air', ...(opts.surface ? [opts.surface] : []), ...(opts.tags ?? [])],
  } satisfies CueSpecInput & { id: string; name: string });

const AIR_RATIONALE = 'The same phrase without the surface: what the camera sees when there is nothing to hit.';

export const REAL_VS_AIR_CUES: readonly Cue[] = [
  phraseCue(
    'rva-clap',
    'Clap',
    'Clap your hands once on each click, where the camera can see them.',
    'A clap is heard and seen at the same instant, which lines the microphone up with the camera.',
    { beats: 8, tags: ['slate'] },
  ),
  phraseCue(
    'rva-clap-again',
    'Clap again',
    'To finish, clap once on each click again, where the camera can see them.',
    'A second clap measures how far the microphone and the camera drifted apart during the routine.',
    { beats: 8, tags: ['slate'] },
  ),
  phraseCue(
    'rva-taps-real',
    'Taps, on the table',
    'Tap the table with the fingers of one hand on each click.',
    'The sound of each tap is the ground truth for when you struck.',
    { phrase: 'taps', surface: 'real' },
  ),
  phraseCue('rva-taps-air', 'Taps, in the air', 'Now the same taps in the air, just above the table, without touching it.', AIR_RATIONALE, {
    phrase: 'taps',
    surface: 'air',
  }),
  phraseCue(
    'rva-alternating-real',
    'Alternating, on the table',
    'Tap the table on each click, alternating left and right hands.',
    'Two hands, the way a drummer plays: each tap is labelled with its sound.',
    { phrase: 'alternating', surface: 'real' },
  ),
  phraseCue(
    'rva-alternating-air',
    'Alternating, in the air',
    'Now alternate hands in the air, just above the table, without touching it.',
    AIR_RATIONALE,
    { phrase: 'alternating', surface: 'air' },
  ),
  phraseCue(
    'rva-dynamics-real',
    'Soft and hard, on the table',
    'Tap the table on each click: softly for four clicks, then hard for four, and again.',
    'How loud each tap was is the label for how hard you struck.',
    { phrase: 'dynamics', surface: 'real' },
  ),
  phraseCue(
    'rva-dynamics-air',
    'Soft and hard, in the air',
    'Now the same in the air: soft for four clicks, then hard for four, and again.',
    AIR_RATIONALE,
    { phrase: 'dynamics', surface: 'air' },
  ),
  phraseCue(
    'rva-strums-real',
    'Strums, on the guitar',
    'Strum a chord you know on each click, changing to another chord every four clicks.',
    'The notes that sound on each strum label the chord shape your hand made.',
    { phrase: 'strums', surface: 'real', bpm: 70, tags: ['guitar'] },
  ),
  phraseCue(
    'rva-strums-air',
    'Strums, on air guitar',
    'Now the same chords on air guitar, changing on the same clicks.',
    'The same chord shapes with nothing to press against: each beat inherits its chord from the guitar take.',
    { phrase: 'strums', surface: 'air', bpm: 70, tags: ['guitar'] },
  ),
];

/** A routine the trainer ships with, as code (like the starter cues: never a seed row). */
export interface StarterRoutine {
  /** `starter:`-prefixed, so it can never collide with a saved routine's slug id. */
  id: string;
  name: string;
  cueIds: readonly string[];
  /** What the player needs at hand, shown next to the routine. */
  needs: string;
}

export const STARTER_ROUTINE_PREFIX = 'starter:';

export const STARTER_ROUTINES: readonly StarterRoutine[] = [
  {
    id: `${STARTER_ROUTINE_PREFIX}real-vs-air-taps`,
    name: 'Real vs air: taps',
    cueIds: ['rva-clap', 'rva-taps-real', 'rva-taps-air', 'rva-alternating-real', 'rva-alternating-air', 'rva-dynamics-real', 'rva-dynamics-air', 'rva-clap-again'],
    needs: 'a table and wired headphones; about two and a half minutes',
  },
  {
    id: `${STARTER_ROUTINE_PREFIX}real-vs-air-guitar`,
    name: 'Real vs air: guitar',
    cueIds: ['rva-clap', 'rva-strums-real', 'rva-strums-air', 'rva-clap-again'],
    needs: 'a guitar and wired headphones; about a minute',
  },
];

export const starterRoutineById = (id: string): StarterRoutine | undefined => STARTER_ROUTINES.find((r) => r.id === id);

/** True when a routine records a real-versus-air take: any clicked cue. Such a take is
 *  always recorded, with the microphone, since the recording is its whole product. */
export function routineRecordsPerformance(cues: readonly Pick<Cue, 'sufficiency'>[]): boolean {
  return cues.some((c) => c.sufficiency.kind === 'clicked');
}
