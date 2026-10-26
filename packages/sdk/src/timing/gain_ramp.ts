/**
 * A gain ramp from wherever the gain is now, shared by the song stretchers' hold fade
 * (#366) and the Lyria engine's pause fade (#735). In the SDK so no slice imports another slice (or the app) for it.
 */
/** Drop what is scheduled from `at` on and pin the gain where it is now: the anchor any new automation starts from. */
function holdGain(param: AudioParam, at: number): void {
  const from = param.value;
  param.cancelScheduledValues(at);
  param.setValueAtTime(from, at);
}

/** Ramp a gain to `level` over `seconds` from wherever it is now (0 s = at once). */
export function rampGain(param: AudioParam, level: number, seconds: number, at: number): void {
  holdGain(param, at);
  if (seconds > 0) param.linearRampToValueAtTime(level, at + seconds);
  else param.setValueAtTime(level, at);
}

/**
 * Glide a gain to `level` with time constant `timeConstant` (exponential approach) from wherever it
 * is now. The hold matters: a target set before a later-ending linear ramp is overridden by it (#825).
 */
export function glideGain(param: AudioParam, level: number, timeConstant: number, at: number): void {
  holdGain(param, at);
  param.setTargetAtTime(level, at, timeConstant);
}
