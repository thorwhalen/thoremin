/**
 * How hard a listening game is: one word per game, read as a pitch tolerance in cents and a set
 * of timing windows. Shared by thoremin's games slice (its `games.difficulty` dial) and the
 * standalone pages.
 */
import { AUDIO_ONSET_WINDOWS, AUDIO_ONSET_WINDOWS_EASY, tier, type Windows } from '@thoremin/judge';

export const DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Pitch tolerance per difficulty, cents: UltraStar's 2, 1 and 0 semitones read as half-widths (the research doc, 5.1). */
export const PITCH_TOLERANCE: Record<Difficulty, number> = { easy: 150, normal: 100, hard: 50 };

/** Match the note asks more: its tolerance is a tuner's, halved. */
export const MATCH_TOLERANCE: Record<Difficulty, number> = { easy: 75, normal: 50, hard: 25 };

/** Timing windows per difficulty. */
export const ONSET_WINDOWS: Record<Difficulty, Windows> = {
  easy: AUDIO_ONSET_WINDOWS_EASY,
  normal: AUDIO_ONSET_WINDOWS,
  hard: [tier('perfect', 0.02), tier('great', 0.04), tier('good', 0.07)],
};
