/**
 * The view model a game hands its stage: plain data, everything the picture shows and nothing it
 * must compute. The overlay element draws only from this, so a test reads what the player would
 * see without a canvas, and the drawing changes without touching a game.
 */
import type { GameKind } from './lesson';

/** What a stage shows: one of the games, or the calibration take. */
export type StageKind = GameKind | 'calibrate';

export type Phase = 'count-in' | 'playing' | 'results';

/** A target on the stage. `state` is what the judge said, or `pending`. */
export interface ViewNote {
  id: number;
  start: number;
  end: number;
  midi?: number;
  state: 'pending' | 'active' | 'hit' | 'miss';
  /** The tier when hit (`perfect`, `great`, `good`), or why it missed (`wrong note`). */
  label?: string;
  /** Share of the note on pitch so far (Sing), 0..1. */
  fill?: number;
}

/** A point of the player's pitch trail: MIDI, or null where unvoiced. */
export interface TrailPoint {
  t: number;
  midi: number | null;
}

/** A judgment to flash on the stage. */
export interface Flash {
  t: number;
  label: string;
  /** Seconds, event minus target; absent for a miss. */
  offset?: number;
}

export interface Results {
  /** 0..1. */
  accuracy: number;
  /** Count per tier name and `miss`. */
  counts: Record<string, number>;
  /** "rushing" / "dragging" / "steady" with the mean offset, for the timed games. */
  timing?: { meanMs: number; sdMs: number; verdict: 'rushing' | 'dragging' | 'steady' };
  /** The game's own one line, e.g. "4 of 7 notes held in tune". */
  summary: string;
}

export interface GameView {
  game: StageKind;
  title: string;
  phase: Phase;
  /** Engine seconds now. */
  now: number;
  /** The span of time the stage shows, engine seconds. */
  from: number;
  to: number;
  /** The pitch range shown (Sing, Match), MIDI. */
  low: number;
  high: number;
  /** Cents half-width of "on pitch", drawn as the bars' thickness. */
  toleranceCents: number;
  notes: ViewNote[];
  trail: TrailPoint[];
  flashes: Flash[];
  /** Count-in beats still to come (shown big during the count-in). */
  countdown: number;
  /** Running accuracy 0..1 and combo. */
  accuracy: number;
  combo: number;
  /** A melody's own range, its notes' lowest and highest (absent for a rhythm): what a staff's clef and Play along's lanes are chosen from, whatever is on screen. */
  melody?: { low: number; high: number };
  /** The key the song is written in, as fifths (`spelling.estimateKey` when the song does not say). */
  key?: number;
  /** The song's beat grid (Sing, Play along): what a staff writes its bars and note values from. */
  grid?: { t0: number; beatS: number; beatsPerBar: number };
  /** Match the note: the target now, the live deviation in cents, how much of the hold is done. */
  target?: { midi: number; cents: number | null; hold: number };
  results?: Results;
  /** A line about the microphone when it is not live ("Allow the microphone"), drawn over the stage. */
  notice?: string;
}

/** Timing verdict from a mean offset (seconds): beyond 15 ms either way is a tendency. */
export function timingVerdict(mean: number, sd: number): NonNullable<Results['timing']> {
  const meanMs = Math.round(mean * 1000);
  return { meanMs, sdMs: Math.round(sd * 1000), verdict: meanMs < -15 ? 'rushing' : meanMs > 15 ? 'dragging' : 'steady' };
}
