/**
 * The contract of the `music-context` node: what a host hands it (the active timeline and the clock
 * that plays it) and what it says each tick (the key and the chord in force, the next of each with
 * the engine time it lands, and the expectations ahead). Other nodes read these readings on an edge
 * from {@link MUSIC_CONTEXT_NODE_ID} (the chord map follows `chord`); the scale reaches
 * `store-controls` as a `ScaleOverride` (`./scale`).
 *
 * Pure types and constants.
 */
import type { Chord } from '../harmony/chord';
import type { KeyMode } from '../score/schema';
import type { Expectation } from './cursor';
import type { ContextSource, MusicalContext } from './schema';

/** The node's id in a composed graph. */
export const MUSIC_CONTEXT_NODE_ID = 'musicContext';
/** The branch that composes it. */
export const MUSIC_CONTEXT_BRANCH = 'music-context';

/** Which musical time plays the timeline: a song player's `songTime`, or the conductor's `time`
 *  for a conducted score. */
export const CONTEXT_CLOCKS = ['song', 'conductor'] as const;
export type ContextClock = (typeof CONTEXT_CLOCKS)[number];

/** The timeline in force and its clock: what a host's producers hand the node. */
export interface ActiveContext {
  context: MusicalContext;
  clock: ContextClock;
}

export interface MusicKeyReading {
  tonic: number;
  mode: KeyMode;
  scalePcs: readonly number[];
  /** "G major", "D minor", spelled. */
  name: string;
  confidence: number;
}

export interface MusicChordReading {
  /** The chord in force (null: none: before the first, after the last, in a gap). */
  chord: Chord | null;
  name: string | null;
  confidence: number;
  /** The next chord and the engine time (seconds) it lands, when it is within the look-ahead
   *  and the music is moving. */
  next: { chord: Chord; name: string; at: number } | null;
}

/** An expectation with the engine time it is due (Infinity while the music is not moving). */
export type TimedExpectation = Expectation & { at: number };

export interface MusicContextStatus {
  /** A timeline is in force. */
  active: boolean;
  source: ContextSource | null;
  clock: ContextClock | null;
  /** The music is moving (its clock runs). */
  moving: boolean;
  /** Song seconds the reading is for. */
  position: number;
  key: string | null;
  chord: string | null;
  /** Whether the instrument's scale follows the music now. */
  ownsScale: boolean;
}

export const IDLE_MUSIC_CONTEXT_STATUS: MusicContextStatus = { active: false, source: null, clock: null, moving: false, position: 0, key: null, chord: null, ownsScale: false };
