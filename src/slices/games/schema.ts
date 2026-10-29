/**
 * The listening games' settings: the `games` dial (which game, which lesson, how hard; one
 * object, every leaf a scalar so each is a command path) and the per-device `gamesPrefs` (the
 * player's calibrated offset, which belongs to the device and the player, never to an instrument).
 */
import { z } from 'zod';
import { AUDIO_ONSET_WINDOWS, AUDIO_ONSET_WINDOWS_EASY, tier, type Windows } from '@thoremin/judge';
import { GAME_KINDS } from './lib/lesson';

/** A game, or the calibration take (tap along to clicks), which runs through the same node. */
export const GAME_MODES = [...GAME_KINDS, 'calibrate'] as const;
export type GameMode = (typeof GAME_MODES)[number];

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

export const GamesSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  game: z.enum(GAME_MODES).default('sing'),
  /** A lesson id from the shipped lessons; one not of this game falls back to the game's first. */
  lesson: z.string().default('sing-five'),
  difficulty: z.enum(DIFFICULTIES).default('normal'),
  /** Semitones every lesson pitch moves by: a melody in the player's range. */
  transpose: z.number().int().min(-24).max(24).default(0),
  /** Any octave counts (a man singing a woman's part). */
  octaveFold: z.boolean().default(true),
  /** Sing: play the first note during the count-in. */
  reference: z.boolean().default(true),
});
export type GamesSettings = z.infer<typeof GamesSettingsSchema>;
export const DEFAULT_GAMES: GamesSettings = GamesSettingsSchema.parse({});

export const CALIBRATION_SOURCES = ['none', 'tap', 'loopback'] as const;

export const GamesPrefsSchema = z.object({
  /** Seconds subtracted from every heard time before judging: the round trip plus the player's anticipation (tap) or the device's round trip (loopback). */
  offset: z.number().min(-0.5).max(0.5).default(0),
  /** The take's robust spread, seconds; null before a take. */
  spread: z.number().nullable().default(null),
  source: z.enum(CALIBRATION_SOURCES).default('none'),
  /** ISO date of the take, '' before one. */
  measuredAt: z.string().default(''),
});
export type GamesPrefs = z.infer<typeof GamesPrefsSchema>;
export const DEFAULT_GAMES_PREFS: GamesPrefs = GamesPrefsSchema.parse({});
export const GAMES_PREFS = 'gamesPrefs';
