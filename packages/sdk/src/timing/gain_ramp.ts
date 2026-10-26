/**
 * A gain ramp from wherever the gain is now, shared by the song stretchers' hold fade
 * (#366) and the Lyria engine's pause fade (#735). In the SDK so no slice imports another slice (or the app) for it.
 */
/** Ramp a gain to `level` over `seconds` from wherever it is now (0 s = at once). */
export function rampGain(param: AudioParam, level: number, seconds: number, at: number): void {
  const from = param.value;
  param.cancelScheduledValues(at);
  param.setValueAtTime(from, at);
  if (seconds > 0) param.linearRampToValueAtTime(level, at + seconds);
  else param.setValueAtTime(level, at);
}
