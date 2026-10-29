/**
 * The Pitch Maze: a ball climbs on its own through a stack of walls, each a bar across the octave
 * with one opening at a note. The voice moves the ball across (the pitch class, `cursor`); at a
 * wall it stops unless it is under the opening, and it climbs through only while the voice holds
 * that note, for as long as the wall is thick. A wider opening forgives more cents. The walls'
 * notes are a melody (a Sing lesson), so getting through the maze sings the tune.
 *
 * The passage through a wall is a `dwell` with no decay: progress while the note is held, a wait
 * (not a fall) while it is not. Before a wall comes into reach its note is played once as a hint,
 * early enough to have died away before the ball arrives (the microphone hears the loudspeaker).
 *
 * Pure: fed the engine time and what was heard each tick.
 */
import { createDwell, type Dwell } from './dwell';
import type { Cue } from './cues';
import { dxOn, pushTrail, type Backdrop, type FieldView, type Point, type PointSource, type WallView } from './field';
import { nameOf } from './lesson';
import type { Heard } from './listen';
import { NOTHING_HEARD } from './listen';
import { pitchX, OCTAVE } from './cursor';

export interface MazeOptions {
  title: string;
  start: number;
  /** The openings' notes, bottom wall first (MIDI; their class places the opening, the note is the hint). */
  notes: readonly number[];
  cursor: PointSource;
  backdrop: Backdrop;
  /** The pitch class at the left edge. Default 60. */
  tonic?: number;
  /** The opening's width, semitones. Default 1.2. */
  gapSemitones?: number;
  /** Climb speed, screen heights per second. Default 0.22. */
  speed?: number;
  /** Seconds the note must be held to get through a wall (its thickness). Default 0.8. */
  holdS?: number;
  /** Distance between walls, screen heights. Default 0.7. */
  spacing?: number;
  /** Play each wall's note this many seconds of climbing before it. 0 = no hints. Default 2. */
  hintLeadS?: number;
  hint?: string;
}

export const MAZE_DEFAULTS = { tonic: 60, gapSemitones: 1.2, speed: 0.22, holdS: 0.8, spacing: 0.7, hintLeadS: 2 };

/** How hard the maze is: the opening's width (semitones) and the hold. */
export const MAZE_LEVELS = {
  easy: { gapSemitones: 2, holdS: 0.6 },
  normal: { gapSemitones: 1.2, holdS: 0.8 },
  hard: { gapSemitones: 0.7, holdS: 1.2 },
} as const;

/** Where the ball sits on the screen, from the bottom: the camera follows it. */
export const BALL_SCREEN_Y = 0.25;
const REFERENCE_VELOCITY = 0.7;

export function createMazeSession(opts: MazeOptions) {
  const o = { ...MAZE_DEFAULTS, ...opts };
  const thickness = o.speed * o.holdS;
  const gapW = o.gapSemitones / OCTAVE;
  const walls = o.notes.map((midi, id) => ({
    id,
    midi,
    y0: (id + 1) * o.spacing,
    gapX: pitchX(midi, o.tonic),
    dwell: createDwell({ needS: o.holdS }) as Dwell,
    hinted: o.hintLeadS <= 0,
  }));
  const top = walls.length ? walls[walls.length - 1].y0 + thickness + 0.4 : 0.5;
  const trail: (Point & { t: number })[] = [];
  let ballY = 0;
  let ballX = 0.5;
  let last = o.start;
  let stuckS = 0;
  let endedAt: number | null = null;

  const inGap = (x: number, w: (typeof walls)[number]) => Math.abs(dxOn(x, w.gapX, true)) <= gapW / 2;

  function tick(now: number, heard: Heard = NOTHING_HEARD): { view: FieldView; cues: Cue[] } {
    const cues: Cue[] = [];
    const cursor = o.cursor.push(heard, now);
    if (cursor) ballX = cursor.x;
    const live = !!cursor?.live;
    const dt = Math.max(0, now - last);
    last = now;
    let stuck = false;
    if (endedAt === null && now >= o.start) {
      // The wall the ball is under or inside: the first not yet passed.
      const w = walls.find((x) => !x.dwell.done);
      for (const x of walls) {
        if (!x.hinted && x.y0 - ballY <= o.speed * o.hintLeadS) {
          x.hinted = true;
          cues.push({ t: now, midi: x.midi, velocity: REFERENCE_VELOCITY, kind: 'reference' });
        }
      }
      if (!w) {
        ballY = Math.min(top, ballY + o.speed * dt);
        if (ballY >= top) endedAt = now;
      } else if (ballY < w.y0) {
        const open = live && inGap(ballX, w);
        ballY = Math.min(ballY + o.speed * dt, open ? Infinity : w.y0);
        if (ballY > w.y0) w.dwell.step(true, (ballY - w.y0) / o.speed);
        stuck = !open && ballY >= w.y0;
      } else {
        const open = live && inGap(ballX, w);
        w.dwell.step(open, dt);
        ballY = w.y0 + w.dwell.progress * thickness;
        stuck = !open;
      }
      if (stuck) stuckS += dt;
    }
    pushTrail(trail, live ? { x: ballX, y: BALL_SCREEN_Y } : null, now, 0.4);

    const screen = (y: number) => BALL_SCREEN_Y + (y - ballY);
    const wallViews: WallView[] = walls
      .map((w) => ({
        id: w.id,
        y0: screen(w.y0),
        y1: screen(w.y0 + thickness),
        gapX: w.gapX,
        gapW,
        label: nameOf(w.midi).replace(/-?\d+$/, ''),
        state: (w.dwell.done ? 'passed' : w.dwell.progress > 0 ? 'inside' : 'ahead') as WallView['state'],
      }))
      .filter((w) => w.y1 > -0.1 && w.y0 < 1.1);
    const passed = walls.filter((w) => w.dwell.done).length;
    const elapsed = Math.max(0, (endedAt ?? now) - o.start);
    const ideal = top / o.speed;
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
      maze: { walls: wallViews, ball: { x: ballX, y: BALL_SCREEN_Y }, stuck },
      score: { done: passed, total: walls.length, elapsed },
      ...(o.hint ? { hint: o.hint } : {}),
      ...(endedAt === null
        ? {}
        : {
            results: {
              accuracy: Math.min(1, ideal / Math.max(elapsed, ideal)),
              counts: { walls: walls.length, 'seconds waiting': Math.round(stuckS) },
              summary: `Through ${walls.length} walls in ${Math.round(elapsed)} s, ${Math.round(stuckS)} s waiting at a wall`,
            },
          }),
    };
    return { view, cues };
  }
  return { tick };
}
