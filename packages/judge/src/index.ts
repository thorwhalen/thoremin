/**
 * `@thoremin/judge` — the pure half of every music game and lesson: timing windows and tiers,
 * onset judging (live and offline), pitch-note judging, score folds, and latency calibration.
 * Input-agnostic: an onset may come from a microphone, a camera stroke or a key; a pitch track
 * from an audio estimator or a hand's height. It imports only `@thoremin/stats`, so it stays
 * extractable like `ictus`.
 */
export * from './windows';
export * from './onsets';
export * from './score';
export * from './pitch';
export * from './calibration';
