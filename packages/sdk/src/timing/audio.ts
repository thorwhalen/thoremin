/**
 * The one description of the `AudioContext` the timing code reads (#392).
 *
 * Why it exists. The output-stage rule, the glitch counter, the clock map, the latency
 * probe and the drum sink each read a few fields of the context, and each used to state
 * its own slice of it: five interfaces that agreed by hand on what `getOutputTimestamp`
 * returns and which fields a browser may lack. Now the fields are written once, here,
 * and each reader's slice is a {@link AudioView} of them: which fields it needs, and
 * which it reads when present. A real `AudioContext` satisfies every view, and so does a
 * test's fake with only the fields that view names.
 */

/** Chromium's AudioPlaybackStats, the fields read. */
export interface PlaybackStatsLike {
  readonly underrunEvents?: number;
  readonly underrunDuration?: number;
}

/** Every field of an `AudioContext` the timing code reads. The optional ones are those a
 *  browser may not implement (`outputLatency` on older WebKit, `playbackStats` outside
 *  Chromium, `getOutputTimestamp` in some embedded views). */
export interface AudioContextLike {
  readonly state: string;
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly baseLatency?: number;
  readonly outputLatency?: number;
  readonly playbackStats?: PlaybackStatsLike | null;
  getOutputTimestamp?(): { contextTime?: number; performanceTime?: number };
}

/** A reader's slice of {@link AudioContextLike}: the fields `Needed` as the context
 *  declares them, plus the fields `Optional` it reads only when present. */
export type AudioView<Needed extends keyof AudioContextLike, Optional extends keyof AudioContextLike = never> = Pick<AudioContextLike, Needed> &
  Partial<Pick<AudioContextLike, Optional>>;
