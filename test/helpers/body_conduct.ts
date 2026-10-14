/**
 * Scripted conducting gestures for the body's transport (#377): a pose stream from a list
 * of gestures (rest, ready, the upbeat, strokes, a held fermata, a cut-off), with seeded
 * tracker noise, and the exact time of every stroke's ictus.
 *
 * The beating arm is the player's right. Its wrist height is scripted in the transport's
 * own unit (0 at the hips, 1 at the shoulders); the elbow sits between the shoulder and the
 * wrist. Strokes have a sharp bottom (an |sin| cusp, the ictus) like the synthetic bounce,
 * so the impact detector's job is well posed; the left arm hangs still.
 */
import { BLM, BODY_LANDMARK_COUNT, makeBodyKeypoints, type BodyFrame } from '@thoremin/sdk/nodes/domain';
import { gaussian, seeded } from './random';

export type Gesture =
  /** Both arms hanging, still. */
  | { kind: 'rest'; s: number }
  /** The beating arm raised to the ready height and still. */
  | { kind: 'ready'; s: number }
  /** The preparatory beat: up from the ready height, then down onto the first ictus (its end). */
  | { kind: 'upbeat'; s: number }
  /** Strokes at `bpm`; each starts and ends on an ictus (the first is the previous gesture's end).
   *  `size` scales the stroke (1 = the default height, and the wrist reaches out further from
   *  the body as it grows, #378); `shape` is a `sharp` bottom (an |sin| cusp, the default) or a
   *  `smooth` one (a rounded, legato turn); `reach` overrides how far out the wrist is
   *  (torso lengths), independently of the size. */
  | { kind: 'beat'; bpm: number; beats: number; size?: number; shape?: 'sharp' | 'smooth'; reach?: number }
  /** Stays where it is (raised after a stroke), still: a fermata. */
  | { kind: 'hold'; s: number }
  /** A short flick, the arm dropped to the side, then still. */
  | { kind: 'cutoff'; s: number }
  /** Strokes with the arm low and moving, never still: walking in, adjusting. */
  | { kind: 'fidget'; s: number }
  /** The whole body bouncing at `bpm` (a sharp bottom), the arms hanging: a dancer's beat. */
  | { kind: 'bounce'; bpm: number; beats: number }
  /** Arms hanging, the whole skeleton shaking by `px` of extra noise (settling in, the pose
   *  model locking on). */
  | { kind: 'shake'; s: number; px: number }
  /** Nobody in frame. */
  | { kind: 'absent'; s: number }
  /** The raised arm repositioned by `by` torso lengths (up when positive), smoothly over `s`:
   *  a slow adjustment in the ready pose, not an upbeat (#461). */
  | { kind: 'drift'; s: number; by: number }
  /** The raised arm swaying by `amp` torso lengths at `hz` about where it is (#461). */
  | { kind: 'sway'; s: number; amp: number; hz: number };

export const STROKE_BOTTOM = 0.55;
export const STROKE_TOP = 1.1;
export const READY_RAISE = 0.9;
export const HANGING = -0.05;
/** How far out from the shoulder the wrist is, torso lengths. */
export const REACH = 0.25;

export interface ConductScript {
  frames: BodyFrame[];
  /** The ictus times of the strokes (the upbeat's end and every stroke's end). */
  ictus: number[];
  /** Each gesture's start time, in order. */
  starts: number[];
  /** The script's length, seconds. */
  seconds: number;
}

/** `arm`: `fixed` (the default, #377) puts the elbow at a fixed offset from the
 *  shoulder-wrist midpoint; `jointed` (#378) solves it from the upper arm's and forearm's
 *  lengths, so the arm's straightness follows the wrist's reach, as the expression reads it. */
export function conduct(gestures: Gesture[], { fps = 30, noisePx = 0.25, torso = 150, seed = 377, arm = 'fixed' as 'fixed' | 'jointed' } = {}): ConductScript {
  const rnd = seeded(seed);
  // The wrist's height as a function of time, piecewise.
  type Piece = { t0: number; t1: number; raise: (u: number) => number; dip?: (u: number) => number; shake?: number; absent?: boolean; reach?: number; reach0?: number };
  const pieces: Piece[] = [];
  const ictus: number[] = [];
  const starts: number[] = [];
  let t = 0;
  let r = HANGING;
  let reach = REACH;
  const add = (s: number, f: (u: number) => number, extra: Partial<Piece> = {}) => {
    pieces.push({ t0: t, t1: t + s, raise: f, reach0: reach, ...extra });
    t += s;
    r = f(1);
    reach = extra.reach ?? REACH;
  };
  for (const g of gestures) {
    starts.push(t);
    const from = r;
    switch (g.kind) {
      case 'rest':
        // Settle down over the first 0.4 s, then still.
        add(g.s, (u) => (u * g.s < 0.4 ? from + (HANGING - from) * smooth((u * g.s) / 0.4) : HANGING));
        break;
      case 'ready':
        add(g.s, (u) => (u * g.s < 0.4 ? from + (READY_RAISE - from) * smooth((u * g.s) / 0.4) : READY_RAISE));
        break;
      case 'upbeat':
        add(g.s, (u) => (u < 0.5 ? from + (STROKE_TOP + 0.1 - from) * Math.sin(Math.PI * u) : STROKE_BOTTOM + (STROKE_TOP + 0.1 - STROKE_BOTTOM) * Math.sin(Math.PI * (1 - u))));
        ictus.push(t);
        break;
      case 'beat': {
        const p = 60 / g.bpm;
        const size = g.size ?? 1;
        const wave = g.shape === 'smooth' ? (x: number) => (1 - Math.cos(2 * Math.PI * x)) / 2 : (x: number) => Math.abs(Math.sin(Math.PI * x));
        add(g.beats * p, (u) => STROKE_BOTTOM + size * (STROKE_TOP - STROKE_BOTTOM) * wave(u * g.beats), { reach: g.reach ?? REACH * size * size });
        for (let i = 1; i <= g.beats; i++) ictus.push(starts[starts.length - 1] + i * p);
        break;
      }
      case 'hold':
        add(g.s, () => from);
        break;
      case 'cutoff':
        // A flick up and back over 0.25 s, the drop over 0.4 s, then still.
        add(g.s, (u) => {
          const x = u * g.s;
          if (x < 0.25) return from + 0.15 * Math.sin((Math.PI * x) / 0.25);
          if (x < 0.65) return from + (HANGING - from) * smooth((x - 0.25) / 0.4);
          return HANGING;
        });
        break;
      case 'fidget': {
        // Irregular: the arm moves between random heights at random intervals, so no run of
        // its turning points is a steady rhythm.
        const way: [number, number][] = [[0, from]];
        for (let x = 0; x < g.s; ) {
          x += 0.2 + 0.6 * rnd();
          way.push([Math.min(x, g.s), 0.45 * rnd()]);
        }
        add(g.s, (u) => {
          const x = u * g.s;
          const k = Math.max(1, way.findIndex(([wx]) => wx >= x));
          const [x0, y0] = way[k - 1];
          const [x1, y1] = way[k];
          return y0 + (y1 - y0) * smooth((x - x0) / Math.max(1e-6, x1 - x0));
        });
        break;
      }
      case 'bounce': {
        const p = 60 / g.bpm;
        add(g.beats * p, () => HANGING, { dip: (u) => 1 - Math.abs(Math.sin(Math.PI * u * g.beats)) });
        for (let i = 1; i <= g.beats; i++) ictus.push(starts[starts.length - 1] + i * p);
        break;
      }
      case 'shake':
        add(g.s, () => HANGING, { shake: g.px });
        break;
      case 'absent':
        add(g.s, () => from, { absent: true });
        break;
      case 'drift':
        add(g.s, (u) => from + g.by * smooth(u));
        break;
      case 'sway':
        add(g.s, (u) => from + g.amp * Math.sin(2 * Math.PI * g.hz * u * g.s));
        break;
    }
  }
  const pieceAt = (x: number): { piece: Piece | undefined; u: number } => {
    for (const p of pieces) if (x <= p.t1 + 1e-9) return { piece: p, u: Math.min(1, Math.max(0, (x - p.t0) / (p.t1 - p.t0))) };
    return { piece: undefined, u: 1 };
  };
  const raiseAt = (x: number): number => {
    const { piece, u } = pieceAt(x);
    return piece ? piece.raise(u) : r;
  };
  const frames: BodyFrame[] = [];
  const width = 640;
  const height = 480;
  for (let i = 0; i * (1 / fps) <= t + 1e-9; i++) {
    const ft = i / fps;
    const { piece, u } = pieceAt(ft);
    if (piece?.absent) {
      frames.push({ t: ft, width, height, present: false, landmarks: [], visibility: [] });
      continue;
    }
    // A bounce: the whole body dips by up to 0.08 of the torso, sharp at the bottom.
    const dip = piece?.dip ? piece.dip(u) * 0.08 * torso : 0;
    const { landmarks, world } = makeBodyKeypoints({ width, height, cx: 0.5, cy: 0.7 + dip / height, torso, leftArm: 0, rightArm: 0, kneeBend: 0, lean: 0 });
    const sh = landmarks[BLM.right_shoulder];
    const hipY = (landmarks[BLM.left_hip].y + landmarks[BLM.right_hip].y) / 2;
    // The reach moves to a new gesture's over its first 0.3 s (no jump).
    const reachNow = piece ? (piece.reach0 ?? REACH) + ((piece.reach ?? REACH) - (piece.reach0 ?? REACH)) * smooth((ft - piece.t0) / 0.3) : reach;
    const wrist = { x: sh.x - reachNow * torso, y: hipY - raiseAt(ft) * torso };
    const elbow = arm === 'jointed' ? elbowOf(sh, wrist, torso) : { x: (sh.x + wrist.x) / 2 - 0.15 * torso, y: (sh.y + wrist.y) / 2 + 0.1 * torso };
    landmarks[BLM.right_wrist] = wrist;
    landmarks[BLM.right_elbow] = elbow;
    for (const j of [BLM.right_pinky, BLM.right_index, BLM.right_thumb]) landmarks[j] = { x: wrist.x - 0.05 * torso, y: wrist.y - 0.08 * torso };
    const sd = Math.hypot(noisePx, piece?.shake ?? 0);
    const noisy = landmarks.map((p) => ({ ...p, x: p.x + sd * gaussian(rnd), y: p.y + sd * gaussian(rnd) }));
    frames.push({ t: ft, width, height, present: true, landmarks: noisy, world, visibility: new Array(BODY_LANDMARK_COUNT).fill(0.99) });
  }
  return { frames, ictus, starts, seconds: t };
}

/** The upper arm and the forearm, torso lengths: the elbow is where they meet (a two-link
 *  arm, bent outward and down), so a wrist further from the shoulder is a straighter arm. */
const UPPER_ARM = 0.6;
const FOREARM = 0.6;
function elbowOf(sh: { x: number; y: number }, wr: { x: number; y: number }, torso: number): { x: number; y: number } {
  const u = UPPER_ARM * torso;
  const f = FOREARM * torso;
  const dx = wr.x - sh.x;
  const dy = wr.y - sh.y;
  const d = Math.min(Math.hypot(dx, dy), (u + f) * 0.999);
  const ux = dx / (Math.hypot(dx, dy) || 1);
  const uy = dy / (Math.hypot(dx, dy) || 1);
  // Along the shoulder-wrist line to the foot of the elbow, then out to the side away from
  // the body (the right arm is on the image's left: -x) and down.
  const along = (u * u - f * f + d * d) / (2 * d);
  const off = Math.sqrt(Math.max(0, u * u - along * along));
  let nx = -uy;
  let ny = ux;
  if (nx > 0 || (nx === 0 && ny < 0)) {
    nx = -nx;
    ny = -ny;
  }
  return { x: sh.x + ux * along + nx * off, y: sh.y + uy * along + ny * off };
}

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
