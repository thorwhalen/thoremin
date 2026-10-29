/**
 * The Pitch Maze: a ball travels on its own along a track of segments, each a note's lane across
 * the octave (the voice moves the ball across: the pitch class, `cursor`). A segment is one of two
 * kinds, and the levels go from one to the other:
 *
 * - a **wall** (the first levels): a bar across with one opening at its note. The ball stops under
 *   it unless it is under the opening, and goes through only while the voice holds that note, for
 *   as long as the wall is thick (a `dwell` with no decay: progress while held, a wait, not a fall,
 *   while not). Forgiving: a wrong note costs time, never the game.
 * - a **band** (the higher levels, the piano roll seen as a road to the horizon): a lit strip along
 *   the note's lane, as long as the note lasts. Nothing stops the ball; while a band is under it
 *   the player gains points on the band and loses them off it (or silent), and at zero the game is
 *   lost. The band's width is the precision asked for, down to a few cents either side.
 *
 * The notes are a melody (a Sing lesson), so getting through sings the tune; a wall's note is
 * played as a hint early enough to die away before the ball arrives (the microphone hears the
 * loudspeaker), a band's is not (the next band would hear the hint).
 *
 * Pure: fed the engine time and what was heard each tick.
 */
import { createDwell, type Dwell } from './dwell';
import type { Cue } from './cues';
import { dxOn, pushTrail, type Backdrop, type FieldView, type Point, type PointSource, type SegmentView } from './field';
import { nameOf } from './lesson';
import type { Heard } from './listen';
import { NOTHING_HEARD } from './listen';
import { pitchX, OCTAVE } from './cursor';
import type { Results } from './view';

export type SegmentKind = 'wall' | 'band';

/** A segment of the track: where it starts and how long it is (screen heights), its note and its lane's width (semitones). */
export interface Segment {
  kind: SegmentKind;
  at: number;
  length: number;
  midi: number;
  widthSemitones: number;
}

export interface TrackOptions {
  title: string;
  start: number;
  segments: readonly Segment[];
  cursor: PointSource;
  backdrop: Backdrop;
  /** How the stage shows it: from above (the walls) or as a road to the horizon (the bands). */
  view?: 'top' | 'road';
  /** The pitch class at the left edge. Default 60. */
  tonic?: number;
  /** Travel speed, screen heights per second. Default 0.22. */
  speed?: number;
  /** Play a wall's note this many seconds of travel before it. 0 = no hints. Default 2. */
  hintLeadS?: number;
  /** Points at the start, gained per second on a band and lost per second off it. */
  points?: { start: number; gain: number; loss: number };
  /** Off a band in its first this-many seconds costs nothing (the voice is still moving to the note; a rhythm game's good window). */
  graceS?: number;
  hint?: string;
}

export const TRACK_DEFAULTS = { tonic: 60, speed: 0.22, hintLeadS: 2, points: { start: 5, gain: 2, loss: 3 }, graceS: 0.1, view: 'top' as 'top' | 'road' };

/** Where the ball sits on the screen, from the bottom: the camera follows it. */
export const BALL_SCREEN_Y = 0.25;
const REFERENCE_VELOCITY = 0.7;

export function createTrackSession(opts: TrackOptions) {
  const o = { ...TRACK_DEFAULTS, ...opts };
  const segs = o.segments.map((s, id) => ({
    ...s,
    id,
    gapX: pitchX(s.midi, o.tonic),
    gapW: s.widthSemitones / OCTAVE,
    dwell: s.kind === 'wall' ? (createDwell({ needS: s.length / o.speed }) as Dwell) : null,
    hinted: s.kind !== 'wall' || o.hintLeadS <= 0,
  }));
  const end = segs.length ? Math.max(...segs.map((s) => s.at + s.length)) + 0.4 : 0.5;
  const walls = segs.filter((s) => s.kind === 'wall');
  const bands = segs.filter((s) => s.kind === 'band');
  const trail: (Point & { t: number })[] = [];
  let ballY = 0;
  let ballX = 0.5;
  let last = o.start;
  let stuckS = 0;
  let onS = 0;
  let offS = 0;
  let points = o.points.start;
  let lost = false;
  let endedAt: number | null = null;

  const inLane = (x: number, s: (typeof segs)[number]) => Math.abs(dxOn(x, s.gapX, true)) <= s.gapW / 2;

  /** Move the ball by dt; true when a wall holds it. */
  function move(dt: number, live: boolean): boolean {
    const w = walls.find((x) => !x.dwell!.done);
    if (!w || ballY + o.speed * dt < w.at) {
      ballY = Math.min(end, ballY + o.speed * dt);
      return false;
    }
    const open = live && inLane(ballX, w);
    if (ballY < w.at) {
      ballY = open ? ballY + o.speed * dt : w.at;
      if (ballY > w.at) w.dwell!.step(true, (ballY - w.at) / o.speed);
      return !open;
    }
    w.dwell!.step(open, dt);
    ballY = w.at + w.dwell!.progress * w.length;
    return !open;
  }

  function tick(now: number, heard: Heard = NOTHING_HEARD): { view: FieldView; cues: Cue[] } {
    const cues: Cue[] = [];
    const cursor = o.cursor.push(heard, now);
    if (cursor) ballX = cursor.x;
    const live = !!cursor?.live;
    const dt = Math.max(0, now - last);
    last = now;
    let stuck = false;
    let onBand: boolean | null = null;
    if (endedAt === null && now >= o.start) {
      for (const s of segs) {
        if (!s.hinted && s.at - ballY <= o.speed * o.hintLeadS) {
          s.hinted = true;
          cues.push({ t: now, midi: s.midi, velocity: REFERENCE_VELOCITY, kind: 'reference' });
        }
      }
      stuck = move(dt, live);
      if (stuck) stuckS += dt;
      const under = bands.find((b) => ballY >= b.at && ballY < b.at + b.length);
      const graced = (b: (typeof segs)[number]) => ballY - b.at < o.graceS * o.speed;
      if (under && (live && inLane(ballX, under) || !graced(under))) {
        onBand = live && inLane(ballX, under);
        if (onBand) {
          onS += dt;
          points += o.points.gain * dt;
        } else {
          offS += dt;
          points -= o.points.loss * dt;
        }
        if (points <= 0) {
          points = 0;
          lost = true;
          endedAt = now;
        }
      }
      if (ballY >= end) endedAt ??= now;
    }
    pushTrail(trail, live ? { x: ballX, y: BALL_SCREEN_Y } : null, now, 0.4);

    const segViews: SegmentView[] = segs
      .map((s) => ({
        id: s.id,
        kind: s.kind,
        d0: s.at - ballY,
        d1: s.at + s.length - ballY,
        gapX: s.gapX,
        gapW: s.gapW,
        label: nameOf(s.midi).replace(/-?\d+$/, ''),
        state: (s.dwell ? (s.dwell.done ? 'passed' : s.dwell.progress > 0 ? 'inside' : 'ahead') : ballY >= s.at + s.length ? 'passed' : ballY >= s.at ? 'inside' : 'ahead') as SegmentView['state'],
      }))
      .filter((s) => s.d1 > -1 && s.d0 < (o.view === 'road' ? 6 : 1));
    const passed = segs.filter((s) => (s.dwell ? s.dwell.done : ballY >= s.at + s.length)).length;
    const elapsed = Math.max(0, (endedAt ?? now) - o.start);
    const bandS = onS + offS;
    const results = ((): Results | undefined => {
      if (endedAt === null) return undefined;
      if (bands.length === 0) {
        const ideal = end / o.speed;
        return {
          accuracy: Math.min(1, ideal / Math.max(elapsed, ideal)),
          counts: { walls: walls.length, 'seconds waiting': Math.round(stuckS) },
          summary: `Through ${walls.length} walls in ${Math.round(elapsed)} s, ${Math.round(stuckS)} s waiting at a wall`,
        };
      }
      const share = bandS > 0 ? onS / bandS : 0;
      return {
        accuracy: share,
        counts: { points: Math.round(points), 'notes passed': passed },
        summary: lost ? `Out of points after ${passed} of ${segs.length} notes` : `Through ${segs.length} notes, on the note ${Math.round(share * 100)} % of the time`,
      };
    })();
    const view: FieldView = {
      game: 'maze',
      title: o.title,
      phase: endedAt === null ? 'playing' : 'results',
      now,
      wrapX: true,
      backdrop: o.backdrop,
      cursor: cursor ? { x: ballX, y: BALL_SCREEN_Y, live } : null,
      trail: trail.map(({ x, y }) => ({ x, y })),
      targets: [],
      maze: { segments: segViews, ball: { x: ballX, y: BALL_SCREEN_Y }, stuck, view: o.view, ...(bands.length ? { points, onBand } : {}), ...(lost ? { lost } : {}) },
      score: { done: passed, total: segs.length, elapsed },
      ...(o.hint ? { hint: o.hint } : {}),
      ...(results ? { results } : {}),
    };
    return { view, cues };
  }
  return { tick };
}

/** A melody's notes as walls, one every `spacing`, `holdS` thick at the speed (the first levels). */
export function wallsOf(notes: readonly number[], { spacing = 0.7, holdS = 0.8, speed = TRACK_DEFAULTS.speed, widthSemitones = 1.2 } = {}): Segment[] {
  return notes.map((midi, k) => ({ kind: 'wall', at: (k + 1) * spacing, length: speed * holdS, midi, widthSemitones }));
}

/**
 * A melody as bands, the piano roll laid along the road: each note as long as it lasts at the tempo,
 * with a short gap between notes (no points either way there), after a run-up of `leadS`.
 */
export function bandsOf(
  notes: readonly { midi: number; beats: number }[],
  { bpm, speed = TRACK_DEFAULTS.speed, widthSemitones = 1, gapS = 0.12, leadS = 3 }: { bpm: number; speed?: number; widthSemitones?: number; gapS?: number; leadS?: number },
): Segment[] {
  let at = leadS * speed;
  return notes.map((n) => {
    const dur = (n.beats * 60) / bpm;
    const s: Segment = { kind: 'band', at, length: Math.max(0.05, (dur - gapS) * speed), midi: n.midi, widthSemitones };
    at += dur * speed;
    return s;
  });
}

/** The maze's levels: walls that open narrower, then the road, its lanes narrower down to a few cents. */
export const TRACK_LEVELS = [
  { id: 'walls-wide', name: 'Walls, wide openings (2 semitones)', kind: 'wall', widthSemitones: 2, holdS: 0.6 },
  { id: 'walls', name: 'Walls (1.2 semitones)', kind: 'wall', widthSemitones: 1.2, holdS: 0.8 },
  { id: 'walls-narrow', name: 'Walls, narrow (0.7 semitones)', kind: 'wall', widthSemitones: 0.7, holdS: 1.2 },
  { id: 'road', name: 'Road: stay on the note (a semitone wide)', kind: 'band', widthSemitones: 1, holdS: 0 },
  { id: 'road-close', name: 'Road: within 25 cents', kind: 'band', widthSemitones: 0.5, holdS: 0 },
  { id: 'road-exact', name: 'Road: within 12 cents', kind: 'band', widthSemitones: 0.24, holdS: 0 },
] as const;

export type TrackLevel = (typeof TRACK_LEVELS)[number];

/** The road's travel speed: faster than the walls', so a note's band is a comfortable length ahead. */
export const ROAD_SPEED = 0.6;

/** The track for a melody at a level: its segments, speed and view. */
export function trackFor(notes: readonly { midi: number; beats: number }[], bpm: number, level: TrackLevel): { segments: Segment[]; speed: number; view: 'top' | 'road' } {
  if (level.kind === 'wall') return { segments: wallsOf(notes.map((n) => n.midi), { holdS: level.holdS, widthSemitones: level.widthSemitones }), speed: TRACK_DEFAULTS.speed, view: 'top' };
  return { segments: bandsOf(notes, { bpm, speed: ROAD_SPEED, widthSemitones: level.widthSemitones }), speed: ROAD_SPEED, view: 'road' };
}

// --- The walls-only maze, as first written (its options kept). ---

export interface MazeOptions {
  title: string;
  start: number;
  /** The openings' notes, bottom wall first (MIDI; their class places the opening, the note is the hint). */
  notes: readonly number[];
  cursor: PointSource;
  backdrop: Backdrop;
  tonic?: number;
  /** The opening's width, semitones. Default 1.2. */
  gapSemitones?: number;
  /** Climb speed, screen heights per second. Default 0.22. */
  speed?: number;
  /** Seconds the note must be held to get through a wall (its thickness). Default 0.8. */
  holdS?: number;
  /** Distance between walls, screen heights. Default 0.7. */
  spacing?: number;
  hintLeadS?: number;
  hint?: string;
}

export const MAZE_DEFAULTS = { gapSemitones: 1.2, speed: 0.22, holdS: 0.8, spacing: 0.7 };

/** How hard the walls are: the opening's width (semitones) and the hold. */
export const MAZE_LEVELS = {
  easy: { gapSemitones: 2, holdS: 0.6 },
  normal: { gapSemitones: 1.2, holdS: 0.8 },
  hard: { gapSemitones: 0.7, holdS: 1.2 },
} as const;

/** A maze of walls only: the track session over `wallsOf` the notes. */
export function createMazeSession(opts: MazeOptions) {
  const o = { ...MAZE_DEFAULTS, ...opts };
  return createTrackSession({
    ...opts,
    speed: o.speed,
    segments: wallsOf(o.notes, { spacing: o.spacing, holdS: o.holdS, speed: o.speed, widthSemitones: o.gapSemitones }),
  });
}
