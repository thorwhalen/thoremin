/**
 * A synthetic air-drum performance on the starter kit's pads (#245, #261): a hand
 * gripping a stick (`scripts/air/lib_synthetic_grip.ts`) plays a scripted list of
 * strokes, each aimed at a pad's centre or rim, softly or hard. This is the pads demo
 * take (`scripts/demos/instrument_take.ts --instrument drums`) and the fixture the
 * landing-point tests replay, in one place, so the demo and the test cannot drift.
 *
 * The geometry is the one a wide-arc hit has. The stick turns about the hand (the pivot)
 * and its tip, the tracked point, moves on a circular arc: a hard stroke is a long, fast
 * swing (0.7 rad in 90 ms), a soft one shorter and slow (0.6 rad in 220 ms). Both are
 * braked falls, fastest mid-way and still at the bottom (a cosine ease: an air stroke,
 * not a surface rebound). Between strokes the arm carries the raised stick to the next
 * pad along a smoothstep, which is the move a landing fit must not read as a stroke.
 *
 * `scoreTake` is the acceptance of #261: every scripted stroke claimed by one hit on its
 * own pad, and no hit that no stroke claims. Self-made data only, safe to commit.
 */
import type { HandsFrame } from '@thoremin/sdk/nodes/domain';
import { DEFAULT_PADS_SET, STARTER_KIT, type PadId, type Pads } from '@thoremin/sdk/nodes/music/drum_pads';
import { gripFrames, type StickPose } from '../../scripts/air/lib_synthetic_grip';

export const DRUM_TAKE_FPS = 30;
export const DRUM_TAKE_WIDTH = 640;
export const DRUM_TAKE_HEIGHT = 480;

export interface DrumStroke {
  pad: PadId;
  where: 'centre' | 'rim';
  force: 'soft' | 'hard';
  /** How far the stick is raised (radians), in place of the force's own lift: a player
   *  whose stroke heights vary (#533). The fall's duration stays the force's. */
  lift?: number;
}

/** A scripted stroke with the frame time its tip reaches the bottom. */
export type ScriptedStroke = DrumStroke & { tLand: number };

/** The demo's performance: the snare at its centre and rim, softly and hard, then the
 *  other pads. The first stroke is the warm-up the node learns its floor from. */
export const DRUM_SCRIPT: readonly DrumStroke[] = [
  { pad: 'p1', where: 'centre', force: 'hard' },
  { pad: 'p1', where: 'centre', force: 'soft' },
  { pad: 'p1', where: 'centre', force: 'hard' },
  { pad: 'p1', where: 'rim', force: 'soft' },
  { pad: 'p1', where: 'rim', force: 'hard' },
  { pad: 'p3', where: 'centre', force: 'soft' },
  { pad: 'p3', where: 'centre', force: 'hard' },
  { pad: 'p3', where: 'rim', force: 'hard' },
  { pad: 'p2', where: 'centre', force: 'hard' },
  { pad: 'p2', where: 'centre', force: 'soft' },
  { pad: 'p5', where: 'centre', force: 'hard' },
  { pad: 'p4', where: 'centre', force: 'hard' },
  { pad: 'p1', where: 'centre', force: 'hard' },
];

/** The stick, pixels, from the hand (pivot) to the tip. */
const STICK = 170;
/** How far the stick is raised (radians) and how long its fall takes (seconds), per
 *  force. The soft swing is the softest stroke the air drum counts with a margin: the
 *  stick tip's smallest stroke is 0.45 reach (`STICK_MIN_STROKE_REACH`, near enough
 *  radians), and a swing under it is heard only when the arm's move before it happens
 *  to add to the descent. */
const FORCE = { soft: { lift: 0.6, fall: 0.22 }, hard: { lift: 0.7, fall: 0.09 } };
/** The arm's move to the next pad, the wait at the top, and the stick's return, seconds. */
const MOVE_S = 0.5;
const HOLD_S = 0.12;
const RETURN_S = 0.22;
/** A still hand before the first stroke and after the last, seconds. */
const LEAD_IN_S = 0.6;
const TAIL_S = 0.8;
/** The stick's angle at contact: it lies to the left of the hand (the player's right hand
 *  held out to the side) and a little below it. */
const LAND_ANGLE = Math.PI - 0.1;
/** Where a rim stroke lands, as a fraction of the pad's half-width from its centre. */
const RIM_FRACTION = 0.85;

/** The starter kit switched on, every other slot off. */
export function starterKitPads(): Pads {
  const pads: Pads = { ...DEFAULT_PADS_SET };
  for (const id of STARTER_KIT) pads[id] = { ...pads[id], on: true };
  return pads;
}

export interface DrumTake {
  frames: HandsFrame[];
  /** Per frame: the stick's pivot and tip, source pixels (what the demo draws). */
  overlay: { pivot: { x: number; y: number }; tip: { x: number; y: number } }[];
  script: ScriptedStroke[];
}

export interface DrumTakeOptions {
  /** The strokes to play. Default {@link DRUM_SCRIPT}. */
  script?: readonly DrumStroke[];
  /** Landmark noise, standard deviation in grip lengths (seeded). Default 0. */
  noise?: number;
  seed?: number;
}

/**
 * The take: the gripping hand on every frame, the stick's pose per frame, and the script
 * with each stroke's landing time. The pads are in the displayed frame's fractions; the
 * frames are source pixels, so a target is mirrored back.
 */
export function drumTake(pads: Pads, options: DrumTakeOptions = {}): DrumTake {
  const { script: strokes = DRUM_SCRIPT, noise = 0, seed = 1 } = options;
  const W = DRUM_TAKE_WIDTH;
  const H = DRUM_TAKE_HEIGHT;
  const FPS = DRUM_TAKE_FPS;
  const target = (s: DrumStroke) => {
    const p = pads[s.pad];
    const dx = s.where === 'rim' ? RIM_FRACTION * (p.w / 2) : 0;
    return { x: (1 - (p.x + dx)) * W, y: p.y * H };
  };
  // The stick turns about the hand: tip = pivot + STICK * (cos a, sin a).
  const pivotFor = (tip: { x: number; y: number }) => ({ x: tip.x - STICK * Math.cos(LAND_ANGLE), y: tip.y - STICK * Math.sin(LAND_ANGLE) });
  const poses: StickPose[] = [];
  const overlay: DrumTake['overlay'] = [];
  const script: ScriptedStroke[] = [];
  let t = 0;
  let pivot = pivotFor(target(strokes[0]));
  let angle = LAND_ANGLE + FORCE.soft.lift;
  const push = () => {
    const tip = { x: pivot.x + STICK * Math.cos(angle), y: pivot.y + STICK * Math.sin(angle) };
    poses.push({ t, width: W, height: H, pivot: { ...pivot }, tip });
    overlay.push({ pivot: { ...pivot }, tip });
    t += 1 / FPS;
  };
  const phase = (seconds: number, step: (u: number) => void) => {
    const n = Math.max(1, Math.round(seconds * FPS));
    for (let i = 1; i <= n; i++) {
      step(i / n);
      push();
    }
  };
  // Rest first, so the tracker sees a still hand.
  phase(LEAD_IN_S, () => {});
  for (const s of strokes) {
    const f = { ...FORCE[s.force], ...(s.lift !== undefined ? { lift: s.lift } : {}) };
    const from = { ...pivot };
    const to = pivotFor(target(s));
    const a0 = angle;
    const up = LAND_ANGLE + f.lift;
    // Move the arm to the pad with the stick raised (smoothstep, no dip).
    phase(MOVE_S, (u) => {
      const e = u * u * (3 - 2 * u);
      pivot = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
      angle = a0 + (up - a0) * e;
    });
    phase(HOLD_S, () => {});
    // The stroke: a braked fall (fastest mid-way, still at the bottom), then back up.
    phase(f.fall, (u) => {
      angle = up - (f.lift * (1 - Math.cos(Math.PI * u))) / 2;
    });
    script.push({ ...s, tLand: t - 1 / FPS });
    phase(RETURN_S, (u) => {
      angle = LAND_ANGLE + (f.lift * (1 - Math.cos(Math.PI * u))) / 2;
    });
  }
  phase(TAIL_S, () => {});
  // The mirrored webcam labels the player's right hand 'Left' (the dial's default).
  return { frames: gripFrames(poses, { arm: 0, handedness: 'Left', noise, seed }), overlay, script };
}

/** What a scored hit needs: when it sounds and the pad it struck. */
export interface ScoredHit {
  t: number;
  pad?: PadId | null;
}

export interface TakeScore<H extends ScoredHit = ScoredHit> {
  /** Strokes whose hit struck their own pad. */
  on: number;
  /** Strokes whose hit struck another pad, or none. */
  off: number;
  /** Strokes no hit sounded. */
  missed: number;
  /** Hits no stroke accounts for (an arm move read as a stroke). */
  false: number;
  /** Per scripted stroke: the hit that claimed it, or null. */
  perStroke: { stroke: ScriptedStroke; hit: H | null }[];
}

/** A hit claims the stroke whose landing is within this of its sound time, seconds: a
 *  predicted hit sounds at the landing, a ghost note one frame after it, and the
 *  strokes are more than half a second apart. */
export const CLAIM_WINDOW = 0.15;

/**
 * The acceptance count (#261): each scripted stroke claims the unclaimed hit nearest its
 * landing time within {@link CLAIM_WINDOW}; a claimed hit is on or off its stroke's pad,
 * an unclaimed stroke is missed, and an unclaimed hit is false.
 */
export function scoreTake<H extends ScoredHit>(hits: readonly H[], script: readonly ScriptedStroke[], { window = CLAIM_WINDOW } = {}): TakeScore<H> {
  const claimed = new Set<H>();
  const perStroke: TakeScore<H>['perStroke'] = [];
  let on = 0;
  let off = 0;
  let missed = 0;
  for (const stroke of script) {
    let best: H | null = null;
    for (const h of hits) {
      if (claimed.has(h) || Math.abs(h.t - stroke.tLand) > window) continue;
      if (!best || Math.abs(h.t - stroke.tLand) < Math.abs(best.t - stroke.tLand)) best = h;
    }
    if (best) {
      claimed.add(best);
      if (best.pad === stroke.pad) on++;
      else off++;
    } else missed++;
    perStroke.push({ stroke, hit: best });
  }
  return { on, off, missed, false: hits.length - claimed.size, perStroke };
}
