/**
 * What each shipped instrument should do under the synthetic sources, beyond loading (the seed
 * sweep's manifest, `smoke/seed_instruments.json`, says which seeds exist and which are silent
 * under the synthetic sources, with why; this says HOW the others are played and checked). A seed not named here is a continuous
 * instrument: the sweeping synthetic hand plays it, and its sound changes as the hand moves.
 */

export interface SeedPlay {
  /** Extra page query that makes the synthetic hand play this seed (`synthetic.strike=1`: drum
   *  strokes; `synthetic.conduct=1`: beating time). */
  extra?: string;
  /** `hits`: a struck instrument, checked by its onsets rather than a continuous changing sound. */
  check?: 'hits';
}

export const SEED_PLAY: Record<string, SeedPlay> = {
  'Air Drum': { extra: 'synthetic.strike=1', check: 'hits' },
  'Conduct the Chords': { extra: 'synthetic.conduct=1' },
  // The pitch rod is the player's right hand; the synthetic source's one hand is their left.
  'Physical Theremin': { extra: 'synthetic.hands=both' },
};

/** The sound thresholds, against the listening tap's readings (`audioTap.ts`). */
export const HEARING = {
  /** The peak that counts as sound (the seed sweep's floor). */
  floor: 0.003,
  /** After a switch, let the previous instrument's release ring out before listening. */
  settleMs: 1_200,
  /** How long a playing instrument is listened to: one sweep of the synthetic hand is 4 s. */
  playMs: 4_000,
  /** How long a handless one is listened to. */
  quietMs: 2_000,
  /** A playing instrument sounds in at least this share of the readings... */
  sounding: 0.5,
  /** ...and its spectral shape moves by at least this much between readings 100 ms apart (the
   *  continuous seeds measure 0.32 to 0.68 with the sweeping hand; a held, unchanging tone is 0). */
  shapeFlux: 0.08,
  /** A struck instrument: at least this many onsets (0.9 s strokes)... */
  hits: 3,
  /** ...listened for in `playMs` pieces until they come, up to this long (#803: a loaded runner
   *  drops strokes, so a fixed few seconds read as a missing hit). */
  hitsWithinMs: 20_000,
} as const;
