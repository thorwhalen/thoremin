/**
 * The audio glitch counter (step 4 of the 2026-10-05 timing plan, #240): how many times
 * the audio output ran dry, counted while the instrument plays.
 *
 * Why it exists. `latencyHint: 0` buys a few milliseconds of output latency by asking
 * for the smallest buffer the platform allows, and a smaller buffer is one the audio
 * thread can miss. A hint that glitches is worse than the milliseconds it saves, and
 * nobody hears a single dropout as a bug report, so the low-latency dial is guarded by
 * this count: the status line says when the output glitched, and with the dial on, it
 * says to turn it off. It is built first, before the dial it guards (the plan's order).
 *
 * Two readings, the better one when present:
 *
 * - `playbackStats`: Chromium's `AudioContext.playbackStats` (the W3C AudioPlaybackStats
 *   proposal) reports `underrunEvents` and `underrunDuration` directly. Measured present
 *   in Chromium 153; absent in Firefox and WebKit.
 * - `clock`: elsewhere, the output timestamp pair. `getOutputTimestamp()` relates a
 *   context time to the performance clock at the output; while the output runs dry the
 *   context clock stops and the performance clock does not, so the offset
 *   `performanceTime - contextTime` steps up by the length of the dropout and stays there.
 *   The pair's own readings bounce by up to a callback buffer, so a step is the MEDIAN of
 *   the latest few offsets standing above the median of the window before them by more
 *   than {@link GLITCH_STEP_S}; the slow drift between the two clocks (tens of ppm) moves
 *   the window's median along with it and is never counted. A heuristic, stated as one:
 *   a dropout shorter than the step is not counted, and the source is reported so a
 *   reader knows which kind of count it is.
 *
 * Counted only while the context is `running`; a suspend, an interruption, a route change
 * (`reset`, from the timing tracker's audio epoch) or a gap in the sampling (a hidden tab)
 * restarts the clock reading instead of counting the jump. Pure apart from the context
 * it is handed; replayable in Node.
 */

/** A clock step under this (seconds) is jitter, not a dropout. One callback buffer at
 *  48 kHz is 2.7 to 10.7 ms; a median over {@link GLITCH_RECENT_SAMPLES} readings removes
 *  most of the bounce, and a real dropout is at least a buffer long. */
export const GLITCH_STEP_S = 0.004;
/** The latest readings whose median is compared with the window before them. */
export const GLITCH_RECENT_SAMPLES = 5;
/** The reference window, readings (about a second at the tick rate). */
export const GLITCH_WINDOW_SAMPLES = 45;
/** A gap between two readings longer than this (seconds) restarts the clock reading. */
export const GLITCH_MAX_GAP_S = 0.5;
/** The "recent" count looks back this far (seconds). */
export const GLITCH_RECENT_WINDOW_S = 60;

/** Chromium's AudioPlaybackStats, the fields read. */
export interface PlaybackStatsLike {
  readonly underrunEvents?: number;
  readonly underrunDuration?: number;
}

/** The slice of an `AudioContext` the counter reads. */
export interface GlitchAudioLike {
  readonly state?: string;
  readonly playbackStats?: PlaybackStatsLike | null;
  getOutputTimestamp?(): { contextTime?: number; performanceTime?: number };
}

export type GlitchSource = 'playbackStats' | 'clock' | 'none';

export interface GlitchReading {
  /** Glitches counted since the counter was made. */
  total: number;
  /** Glitches in the last {@link GLITCH_RECENT_WINDOW_S}. */
  recent: number;
  /** Seconds of output lost, where the source reports it (`playbackStats`); NaN otherwise. */
  underrunS: number;
  /** Which reading the count comes from. */
  source: GlitchSource;
}

export interface GlitchCounterOptions {
  stepS?: number;
  recentSamples?: number;
  windowSamples?: number;
  maxGapS?: number;
  recentWindowS?: number;
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The running count; see the module header. */
export class GlitchCounter {
  private readonly stepS: number;
  private readonly recentSamples: number;
  private readonly windowSamples: number;
  private readonly maxGapS: number;
  private readonly recentWindowS: number;
  private offsets: number[] = [];
  private lastNowS = NaN;
  private lastPerf = NaN;
  /** Times (seconds, the caller's clock) of the counted glitches. */
  private times: number[] = [];
  private total = 0;
  private source: GlitchSource = 'none';
  /** The stats' counters at the previous reading; null before one (or after a reset). */
  private statsLast: { events: number; duration: number } | null = null;
  private underrunS = 0;
  private nowS = 0;

  constructor(options: GlitchCounterOptions = {}) {
    this.stepS = options.stepS ?? GLITCH_STEP_S;
    this.recentSamples = options.recentSamples ?? GLITCH_RECENT_SAMPLES;
    this.windowSamples = options.windowSamples ?? GLITCH_WINDOW_SAMPLES;
    this.maxGapS = options.maxGapS ?? GLITCH_MAX_GAP_S;
    this.recentWindowS = options.recentWindowS ?? GLITCH_RECENT_WINDOW_S;
  }

  /** A route, state or rate change: restart the reading (the counts are kept). */
  reset(): void {
    this.offsets = [];
    this.lastNowS = NaN;
    this.lastPerf = NaN;
    this.statsLast = null;
  }

  /** Read the context once; `nowMs` is the caller's clock (`performance.now()`). */
  observe(ac: GlitchAudioLike, nowMs: number): void {
    const nowS = nowMs / 1000;
    this.nowS = nowS;
    if (ac.state !== undefined && ac.state !== 'running') {
      this.reset();
      return;
    }
    const stats = ac.playbackStats;
    if (stats && finite(stats.underrunEvents)) {
      this.source = 'playbackStats';
      const events = stats.underrunEvents;
      const duration = finite(stats.underrunDuration) ? stats.underrunDuration : 0;
      // The stats count from the context's creation: the first reading (or the first after
      // a reset, or a new context whose counters went back) is the base, not glitches.
      if (this.statsLast && events >= this.statsLast.events) {
        for (let i = this.statsLast.events; i < events; i++) this.count(nowS);
        this.underrunS += Math.max(0, duration - this.statsLast.duration);
      }
      this.statsLast = { events, duration };
      return;
    }
    this.observeClock(ac, nowS);
  }

  private observeClock(ac: GlitchAudioLike, nowS: number): void {
    if (typeof ac.getOutputTimestamp !== 'function') return;
    const ts = ac.getOutputTimestamp();
    if (!finite(ts.contextTime) || !finite(ts.performanceTime) || !(ts.performanceTime > 0)) return;
    this.source = 'clock';
    if (finite(this.lastNowS) && nowS - this.lastNowS > this.maxGapS) this.reset();
    this.lastNowS = nowS;
    // The pair updates once per output callback: a repeated reading adds no information.
    if (ts.performanceTime === this.lastPerf) return;
    this.lastPerf = ts.performanceTime;
    this.offsets.push(ts.performanceTime / 1000 - ts.contextTime);
    if (this.offsets.length > this.windowSamples + this.recentSamples) this.offsets.shift();
    if (this.offsets.length < this.recentSamples + this.recentSamples) return;
    const split = this.offsets.length - this.recentSamples;
    const before = median(this.offsets.slice(0, split));
    const latest = median(this.offsets.slice(split));
    if (latest - before > this.stepS) {
      this.count(nowS);
      // The step is the new level: compare what follows with it, not with the old one.
      this.offsets = this.offsets.slice(split);
    }
  }

  private count(nowS: number): void {
    this.total++;
    this.times.push(nowS);
  }

  reading(): GlitchReading {
    const since = this.nowS - this.recentWindowS;
    while (this.times.length && this.times[0] < since) this.times.shift();
    const underrunS = this.source === 'playbackStats' ? this.underrunS : NaN;
    return { total: this.total, recent: this.times.length, underrunS, source: this.source };
  }
}
