/**
 * Timing windows: how far from its target an event may land and still count, and in which tier.
 *
 * Every rhythm game and every music tutor that judges time does the same thing: nested windows
 * around the target time, the tightest one the best tier, anything outside the widest one a miss
 * (or a stray, when no target is near). What differs is the numbers, so the numbers are data
 * here: a `Windows` is an ordered list of tiers, tight to loose, each with its own early and late
 * half-width in SECONDS. Early and late are separate because a detector that is biased one way
 * (a frame-snapped strike lands late) is judged fairly by an asymmetric window when the bias
 * cannot be calibrated out; with calibration, keep them symmetric.
 *
 * Windows in BEATS (`windowsInBeats`) are the rule for slow, large movements and for lessons at
 * a stated tempo: a quarter of a beat is generous at 60 bpm and tight at 180.
 *
 * Pure: no DOM, no clock.
 */

/** One tier: a name the UI shows and how early and how late (seconds, both positive) it reaches. */
export interface Tier {
  name: string;
  early: number;
  late: number;
}

/** Tiers ordered tight to loose; each must contain the one before it. */
export type Windows = readonly Tier[];

/** A symmetric tier of half-width `half` seconds. */
export const tier = (name: string, half: number): Tier => ({ name, early: half, late: half });

/**
 * Check a window list: tiers non-empty, half-widths positive and finite, each tier containing
 * the one before. Throws with the offending tier named, so a bad preset fails where it is made.
 */
export function checkWindows(windows: Windows): Windows {
  if (windows.length === 0) throw new Error('windows: at least one tier is needed');
  windows.forEach((t, i) => {
    if (!(t.early > 0 && t.late > 0 && Number.isFinite(t.early) && Number.isFinite(t.late))) {
      throw new Error(`windows: tier "${t.name}" needs positive, finite early and late half-widths`);
    }
    const prev = windows[i - 1];
    if (prev && (t.early < prev.early || t.late < prev.late)) {
      throw new Error(`windows: tier "${t.name}" must contain "${prev.name}" (tiers go tight to loose)`);
    }
  });
  return windows;
}

/** The widest reach of a window list: how early a target opens and how late it closes. */
export const reach = (windows: Windows): { early: number; late: number } => windows[windows.length - 1];

/**
 * The tier an offset falls in (`offset` = event time - target time, seconds; negative is early),
 * or `null` outside every tier. Boundaries are inclusive.
 */
export function tierOf(offset: number, windows: Windows): Tier | null {
  for (const t of windows) {
    if (offset >= -t.early && offset <= t.late) return t;
  }
  return null;
}

/** Tiers given in BEATS, turned into seconds at a beat period `beatS` (60 / bpm). */
export function windowsInBeats(tiers: Windows, beatS: number): Windows {
  return checkWindows(tiers.map((t) => ({ name: t.name, early: t.early * beatS, late: t.late * beatS })));
}

/**
 * Windows for a struck or clapped onset heard by a microphone. Audio onsets are recovered to a
 * few milliseconds, so the spread that matters is the player's: skilled tapping varies by 10 to
 * 20 ms, casual tapping by 25 to 40 ms (the research doc, §judgement). The top tier is about
 * 1.5 sigma of a skilled player, the outer one catches a casual player's honest attempt.
 */
export const AUDIO_ONSET_WINDOWS: Windows = checkWindows([tier('perfect', 0.03), tier('great', 0.06), tier('good', 0.1)]);

/** Easier windows for a first lesson or a child: everything about a quarter wider. */
export const AUDIO_ONSET_WINDOWS_EASY: Windows = checkWindows([tier('perfect', 0.04), tier('great', 0.08), tier('good', 0.14)]);
