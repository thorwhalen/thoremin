/**
 * The codified theremin hand positions: a typed, versioned library of the pitch hand's positions in
 * Clara Rockmore's aerial fingering and Carolina Eyck's eight finger positions, each with what it
 * looks like, the interval it plays, its sources and how sure they are, and the shape the hand
 * tracker sees in it (`hand_pose.ts`). The guide reads it to teach the positions; the pose snap
 * (`pose_snap.ts`) reads it to pull the interval between two held positions to the codified one.
 *
 * The positions and intervals are from the sources (`docs/research/theremin-technique.md`, whose
 * reference numbers `refs` cite). The prototype shapes: Eyck's are the centroids MEASURED on her
 * own lesson videos, each frame labelled by the note she sounds (`scripts/theremin/
 * measure_poses.ts`; only these numbers are kept, the videos and landmarks are not committed);
 * Rockmore's are read from her method's words (no recording shows her fingering clearly enough to
 * measure), and say so (`measured: null`).
 */
import { z } from 'zod';
import { POSE_FEATURE_IDS } from './hand_pose';
import MEASURED from './pose_measurements.json';
import { POSE_SYSTEMS, type PoseSystem } from './pose_systems';

export const POSE_LIBRARY_VERSION = 1;

export { POSE_SYSTEMS, type PoseSystem };

/** How far a position is above the system's first: semitones (Eyck: the major scale's degrees),
 *  or steps of the instrument's scale (Rockmore: one scale step per position in her scale studies). */
const IntervalSchema = z.union([z.object({ semitones: z.number() }), z.object({ scaleSteps: z.number().int() })]);

const ConfidenceSchema = z.enum(['high', 'medium', 'low']);

export const PoseSchema = z.object({
  /** Stable id, `<system>.<position>` (`eyck.fp5`). */
  id: z.string().regex(/^(eyck|rockmore)\.[a-z0-9_]+$/),
  system: z.enum(POSE_SYSTEMS),
  /** The short name the system uses ("FP5", "Position 2"). */
  label: z.string().min(1),
  interval: IntervalSchema,
  /** What the hand does, in the sources' words. */
  shape: z.string().min(1),
  /** How sure the sources are of the shape (the interval's confidence is the system's). */
  confidence: ConfidenceSchema,
  /** Reference numbers in `docs/research/theremin-technique.md`. */
  refs: z.array(z.number().int().positive()).min(1),
  /** The shape the tracker sees, in `POSE_FEATURE_IDS` order, and how much it varies. */
  prototype: z.array(z.number()).length(POSE_FEATURE_IDS.length),
  spread: z.array(z.number().positive()).length(POSE_FEATURE_IDS.length),
  /** Where the prototype came from: measured frames and videos, or null (read from the sources).
   *  `precision`: of the held-out sure readings naming this position, the share that were it
   *  (null: never named surely); the pose snap acts only on a position precise enough. */
  measured: z.object({ frames: z.number().int().positive(), videos: z.array(z.string()).min(1), precision: z.number().min(0).max(1).nullable() }).nullable(),
});
export type Pose = z.infer<typeof PoseSchema>;

export const PoseLibrarySchema = z.object({
  version: z.literal(POSE_LIBRARY_VERSION),
  systems: z.record(
    z.enum(POSE_SYSTEMS),
    z.object({ name: z.string(), by: z.string(), summary: z.string(), refs: z.array(z.number().int().positive()), poses: z.array(PoseSchema).min(2) }),
  ),
});
export type PoseLibrary = z.infer<typeof PoseLibrarySchema>;

/** Default spreads: a finger's openness varies by about a fifth, the ring by a third of a palm,
 *  the hand's turn by 20 degrees. */
const SPREAD = [0.2, 0.2, 0.2, 0.2, 0.3, 20];
const ROCKMORE_SPREAD = [0.2, 0.2, 0.2, 0.2, 0.3, 60];

/** The narrowest a measured spread is kept: about the tracker's own jitter (a tenth of a finger's
 *  opening, a twelfth of a palm, 5 degrees). Openness stops at 0, so a finger fully curled in most
 *  frames (FP1's) measures a spread of 0, which would put a fist read 0.1 open in another position. */
const SPREAD_FLOOR = [0.1, 0.1, 0.1, 0.1, 0.075, 5];
export const floorSpread = (spread: readonly number[]): number[] => spread.map((s, i) => Math.max(s, SPREAD_FLOOR[i]!));

type Measured = Record<string, { prototype: number[]; spread: number[]; frames: number; videos: string[] }>;
type ByPosition = Record<string, { precision: number | null } | undefined>;

/** A pose with its measured prototype when one exists, else the one read from the sources. */
function pose(p: Omit<Pose, 'measured' | 'spread'> & { spread?: number[] }): Pose {
  const doc = MEASURED as { poses: Measured; heldOutByPosition?: ByPosition };
  const m = doc.poses[p.id];
  return m
    ? { ...p, prototype: m.prototype, spread: floorSpread(m.spread), measured: { frames: m.frames, videos: m.videos, precision: doc.heldOutByPosition?.[p.id]?.precision ?? null } }
    : { ...p, spread: p.spread ?? SPREAD, measured: null };
}

// Feature order: open.index, open.middle, open.ring, open.pinky, ring (thumb-index gap, palm
// lengths), roll (knuckle line from horizontal, degrees). Eyck's prototypes below are the fallback
// when `pose_measurements.json` lacks a position (it holds all eight, so they are not used); they
// follow the measured shapes. Rockmore's are read from her words on the scale measured on Eyck's
// hands: a finger drawn in reads about 0.05, a finger stretched about 0.7 (no finger reads 1 on a
// tracked hand), the forefinger resting on the thumb about 0.35. Her positions differ only in the
// fingers, so their roll spread is wide: the turn of the hand does not tell them apart.
const EYCK_RING = 'The thumb and index form a ring in every position.';

export const POSE_LIBRARY: PoseLibrary = PoseLibrarySchema.parse({
  version: POSE_LIBRARY_VERSION,
  systems: {
    eyck: {
      name: 'Eyck finger positions',
      by: 'Carolina Eyck',
      summary:
        'Eight finger positions numbered as the major scale: FP1 is the scale\'s first note and FP8 its octave, with the hand held in one place; the instrument is tuned so that FP1 to FP8 is exactly an octave. From FP1 to FP5 the forearm turns the thumb-index ring from vertical to horizontal; from FP5 to FP8 the fingers open.',
      refs: [10, 12, 19],
      poses: [
        pose({ id: 'eyck.fp1', system: 'eyck', label: 'FP1', interval: { semitones: 0 }, shape: `The ring stands vertical, the wrist bent back, the forearm turned about a point that stays still. ${EYCK_RING}`, confidence: 'high', refs: [10], prototype: [0.4, 0, 0, 0, 0.4, 20] }),
        pose({ id: 'eyck.fp2', system: 'eyck', label: 'FP2', interval: { semitones: 2 }, shape: `Close to FP1: the ring a little less upright. ${EYCK_RING}`, confidence: 'low', refs: [10], prototype: [0.35, 0.2, 0.2, 0.3, 0.2, 30] }),
        pose({ id: 'eyck.fp3', system: 'eyck', label: 'FP3', interval: { semitones: 4 }, shape: `The ring diagonal, half way through the forearm's turn. ${EYCK_RING}`, confidence: 'medium', refs: [10], prototype: [0.35, 0.2, 0.3, 0.3, 0.2, 35] }),
        pose({ id: 'eyck.fp4', system: 'eyck', label: 'FP4', interval: { semitones: 5 }, shape: `The ring tilted, most of the way to horizontal. ${EYCK_RING}`, confidence: 'medium', refs: [10], prototype: [0.35, 0.25, 0.35, 0.35, 0.15, 45] }),
        pose({ id: 'eyck.fp5', system: 'eyck', label: 'FP5', interval: { semitones: 7 }, shape: `The ring horizontal, the fingers curled as if holding a mandarin. From here to FP8 only the fingers move. ${EYCK_RING}`, confidence: 'high', refs: [10], prototype: [0.3, 0.2, 0.3, 0.45, 0.35, 80] }),
        pose({ id: 'eyck.fp6', system: 'eyck', label: 'FP6', interval: { semitones: 9 }, shape: `The ring horizontal, the fingers curled with gaps between them. ${EYCK_RING}`, confidence: 'high', refs: [10], prototype: [0.45, 0.45, 0.55, 0.65, 0.2, 80] }),
        pose({ id: 'eyck.fp7', system: 'eyck', label: 'FP7', interval: { semitones: 11 }, shape: `The fingers spread, the ring and little fingers curled slightly. ${EYCK_RING}`, confidence: 'high', refs: [10], prototype: [0.55, 0.7, 0.75, 0.6, 0.15, 70] }),
        pose({ id: 'eyck.fp8', system: 'eyck', label: 'FP8', interval: { semitones: 12 }, shape: `The fingers fully spread, the ring horizontal: the octave above FP1. ${EYCK_RING}`, confidence: 'high', refs: [10], prototype: [0.55, 0.7, 0.75, 0.7, 0.2, 75] }),
      ],
    },
    rockmore: {
      name: 'Rockmore aerial fingering',
      by: 'Clara Rockmore',
      summary:
        'Four positions and a half position, the arm held still and the fingers opening one after another. The interval of a position depends on the passage: one scale step per position in her scale studies (position 1 to 4 a fourth), an octave from 1 to 4 in her octave studies; this library uses the scale-step reading.',
      refs: [1, 2],
      poses: [
        pose({ id: 'rockmore.p1', system: 'rockmore', label: 'Position 1', interval: { scaleSteps: 0 }, shape: 'The forefinger rests on the thumb; the other fingers are drawn in; the arm at rest, the hand tilted back.', confidence: 'high', refs: [1], prototype: [0.35, 0.05, 0.05, 0.05, 0.15, 30], spread: ROCKMORE_SPREAD }),
        pose({ id: 'rockmore.p_half', system: 'rockmore', label: 'Half position', interval: { semitones: 1 }, shape: 'From position 1, the fingers stretched by a half tone.', confidence: 'medium', refs: [1], prototype: [0.4, 0.2, 0.15, 0.15, 0.2, 30], spread: ROCKMORE_SPREAD }),
        pose({ id: 'rockmore.p2', system: 'rockmore', label: 'Position 2', interval: { scaleSteps: 1 }, shape: 'The middle finger stretches forward; the arm stays still.', confidence: 'high', refs: [1], prototype: [0.35, 0.7, 0.05, 0.05, 0.15, 30], spread: ROCKMORE_SPREAD }),
        pose({ id: 'rockmore.p3', system: 'rockmore', label: 'Position 3', interval: { scaleSteps: 2 }, shape: 'The middle and ring fingers stretch forward.', confidence: 'high', refs: [1], prototype: [0.35, 0.7, 0.7, 0.05, 0.15, 30], spread: ROCKMORE_SPREAD }),
        pose({ id: 'rockmore.p4', system: 'rockmore', label: 'Position 4', interval: { scaleSteps: 3 }, shape: 'The middle, ring and little fingers stretch forward.', confidence: 'high', refs: [1], prototype: [0.35, 0.7, 0.7, 0.7, 0.15, 30], spread: ROCKMORE_SPREAD }),
      ],
    },
  },
});

/** The references the library cites, numbered as in `docs/research/theremin-technique.md`. */
export const POSE_REFS: Readonly<Record<number, { text: string; url: string }>> = {
  1: { text: 'Rockmore C. Method for Theremin (rev. transcription, Miller and McFarland-Johnson, 1998)', url: 'http://www.electrotheremin.com/claramethod.html' },
  2: { text: 'Moog R. Album notes to Rockmore C, The Art of the Theremin (Delos, 1977)', url: 'https://web.archive.org/web/2020/https://delosmusic.com/?p=349' },
  10: { text: 'Eyck C. Theremin Lessons: Playing the Major Scale (13 videos, 2021)', url: 'https://www.youtube.com/playlist?list=PLO67K64m9F4UEiJLd_QArZ8owpBfoeIvY' },
  12: { text: 'Eyck C. How to play a scale on the theremin (2018)', url: 'https://www.youtube.com/watch?v=0n-o71RUrQw' },
  19: { text: 'Kavina L. Exercise for opened finger positions (Theremin School)', url: 'https://thereminschool.com/wp-content/uploads/2025/11/B08-Exercise-for-opened-finger-positions-1.pdf' },
};

/** A system's positions. */
export const posesOf = (system: PoseSystem): readonly Pose[] => POSE_LIBRARY.systems[system]!.poses;

/** What the classifier says of a hand: the nearest position, how far, and how sure (0..1). */
export interface PoseReading {
  pose: Pose | null;
  /** The distance to the nearest prototype, in spreads (RMS over the features). */
  distance: number;
  /** 1 at the prototype, falling with the distance and with a close second. */
  confidence: number;
}

/** Further than this many spreads from every prototype: no position. */
export const POSE_REJECT_SPREADS = 2.5;

/** The nearest of `poses` to a hand's feature vector (`poseVector`): the classifier itself, over
 *  any set of positions (the measuring script scores held-out videos with it). */
export function classifyAmong<P extends Pick<Pose, 'prototype' | 'spread'>>(vector: readonly number[], poses: readonly P[]): { pose: P | null; distance: number; confidence: number } {
  let best: P | null = null;
  let d1 = Infinity;
  let d2 = Infinity;
  for (const p of poses) {
    let s = 0;
    for (let i = 0; i < vector.length; i++) s += ((vector[i]! - p.prototype[i]!) / p.spread[i]!) ** 2;
    const d = Math.sqrt(s / vector.length);
    if (d < d1) {
      d2 = d1;
      d1 = d;
      best = p;
    } else if (d < d2) d2 = d;
  }
  if (!best || d1 > POSE_REJECT_SPREADS) return { pose: null, distance: d1, confidence: 0 };
  // Near the prototype and clearly nearer than the next: sure. Half way between two: not.
  const near = Math.exp(-(d1 * d1) / 2);
  const margin = Number.isFinite(d2) ? Math.min(1, ((d2 - d1) / Math.max(d2, 1e-9)) * 2) : 1;
  return { pose: best, distance: d1, confidence: near * margin };
}

/** The nearest position of `system` to a hand's feature vector (`poseVector`). */
export const classifyPose = (vector: readonly number[], system: PoseSystem): PoseReading => classifyAmong(vector, posesOf(system));
