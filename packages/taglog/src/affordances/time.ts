/**
 * taglog — shared time formatting (a pure affordance util).
 *
 * Lives in the affordance layer so BOTH the adapters (export formats) and the
 * presentation layer depend on it downward (presentation -> affordances,
 * adapters -> affordances) rather than presentation reaching sideways into adapters.
 */

/**
 * Format seconds as `HH:MM:SS.mmm`. Rounds to whole milliseconds UP FRONT so a
 * fractional part >= 0.9995s carries into the next second instead of producing an
 * out-of-range 4-digit millisecond field (which would be an invalid WebVTT/timecode).
 */
export function formatTimecode(seconds: number): string {
  const total = Math.max(0, Math.round(seconds * 1000)); // whole ms, carry-safe
  const ms = total % 1000;
  const totalSec = (total - ms) / 1000;
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}.${pad(ms, 3)}`;
}
