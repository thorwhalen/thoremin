/**
 * A listening tap on everything a page sends to its speakers, installed from the test before the
 * app loads (no app code changes, nothing the app can see).
 *
 * `window.thoremin.level()` reads the master gain, which is what most voices pass through; a sink
 * that connects straight to `AudioContext.destination` (a plucked string, a drum, the orchestra
 * on a context of its own) never reaches it. The tap wraps `AudioNode.prototype.connect`: whenever
 * a node is connected to a destination, it is also connected to one analyser per context, so the
 * test reads the sum the player would hear. It only listens (an analyser has no audible output).
 *
 * A reading is one frame of that sum: its peak and RMS, its spectral centroid, and its energy in
 * log-spaced bands from 60 Hz to 8 kHz (the shape a change in pitch or timbre moves), so a test
 * can ask both "is it sounding" and "is what it sounds changing".
 */
import type { Page } from '@playwright/test';

/** One frame of the tapped output. */
export interface AudioReading {
  /** Page time of the reading, ms. */
  t: number;
  peak: number;
  rms: number;
  /** Spectral centroid in Hz (0 when silent). */
  centroid: number;
  /** Energy per log-spaced band, normalised to sum 1 (all zeros when silent). */
  bands: number[];
}

/** The bands' span and count. */
const BANDS = { lowHz: 60, highHz: 8_000, count: 24 } as const;

declare global {
  interface Window {
    __smokeAudio?: { read(): AudioReading | null; peak(): number; watch(ms: number, everyMs: number): Promise<number[]>; contexts(): number };
  }
}

/** The init script (runs in the page, before any app code). Self-contained: no closure over Node. */
function installTap(bands: { lowHz: number; highHz: number; count: number }): void {
  const analysers: AnalyserNode[] = [];
  const connect = AudioNode.prototype.connect as (this: AudioNode, ...args: unknown[]) => unknown;
  const tapFor = (ctx: BaseAudioContext): AnalyserNode => {
    const holder = ctx as BaseAudioContext & { __smokeTap?: AnalyserNode };
    if (!holder.__smokeTap) {
      const a = ctx.createAnalyser();
      a.fftSize = 4096;
      a.smoothingTimeConstant = 0;
      holder.__smokeTap = a;
      analysers.push(a);
    }
    return holder.__smokeTap;
  };
  AudioNode.prototype.connect = function (this: AudioNode, ...args: unknown[]) {
    const out = connect.apply(this, args);
    if (args[0] instanceof AudioDestinationNode && !(this.context instanceof OfflineAudioContext)) connect.call(this, tapFor(this.context), ...args.slice(1, 2));
    return out;
  } as typeof AudioNode.prototype.connect;

  const edges = Array.from({ length: bands.count + 1 }, (_, i) => bands.lowHz * (bands.highHz / bands.lowHz) ** (i / bands.count));
  const peakNow = (): number => {
    let peak = 0;
    for (const a of analysers) {
      if ((a.context as AudioContext).state !== 'running') continue;
      const time = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(time);
      for (const x of time) peak = Math.max(peak, Math.abs(x));
    }
    return peak;
  };
  window.__smokeAudio = {
    contexts: () => analysers.length,
    peak: peakNow,
    // The peak every `everyMs`, in the page (no round trip per reading): fast enough to catch a
    // drum hit's transient, which a reading every 100 ms from the test can step over.
    watch: (ms, everyMs) =>
      new Promise((resolve) => {
        const out: number[] = [];
        const t0 = performance.now();
        const step = () => {
          out.push(peakNow());
          if (performance.now() - t0 < ms) setTimeout(step, everyMs);
          else resolve(out);
        };
        step();
      }),
    read() {
      const live = analysers.filter((a) => (a.context as AudioContext).state === 'running');
      if (live.length === 0) return null;
      let peak = 0;
      let sq = 0;
      let n = 0;
      let power: Float64Array | null = null;
      let binHz = 0;
      for (const a of live) {
        const time = new Float32Array(a.fftSize);
        a.getFloatTimeDomainData(time);
        for (const x of time) {
          peak = Math.max(peak, Math.abs(x));
          sq += x * x;
        }
        n += time.length;
        const db = new Float32Array(a.frequencyBinCount);
        a.getFloatFrequencyData(db);
        binHz = a.context.sampleRate / a.fftSize;
        power ??= new Float64Array(db.length);
        for (let i = 0; i < db.length; i++) power[i] += Number.isFinite(db[i]) ? 10 ** (db[i] / 10) : 0;
      }
      const band = new Array<number>(bands.count).fill(0);
      let total = 0;
      let moment = 0;
      for (let i = 1; i < power!.length; i++) {
        const hz = i * binHz;
        total += power![i];
        moment += power![i] * hz;
        const b = edges.findIndex((e, k) => k < bands.count && hz >= e && hz < edges[k + 1]);
        if (b >= 0) band[b] += power![i];
      }
      const bandSum = band.reduce((s, x) => s + x, 0);
      const silent = peak < 1e-4 || total === 0;
      return {
        t: performance.now(),
        peak,
        rms: Math.sqrt(sq / Math.max(1, n)),
        centroid: silent ? 0 : moment / total,
        bands: silent || bandSum === 0 ? band.map(() => 0) : band.map((x) => x / bandSum),
      };
    },
  };
}

/** Install the tap on a page; call before `page.goto`. */
export async function installAudioTap(page: Page): Promise<void> {
  await page.addInitScript(installTap, BANDS);
}

/** The peak every `everyMs` for `forMs`, sampled in the page (for transients). */
export async function watchPeaks(page: Page, { forMs, everyMs = 20 }: { forMs: number; everyMs?: number }): Promise<number[]> {
  return page.evaluate(([ms, every]) => window.__smokeAudio?.watch(ms, every) ?? Promise.resolve([]), [forMs, everyMs] as const);
}

/** The onsets in a run of peaks: each rise above `floor` after the sound fell back below half of it. */
export function onsets(peaks: number[], floor: number): number {
  let n = 0;
  let armed = true;
  for (const p of peaks) {
    if (armed && p > floor) {
      n++;
      armed = false;
    } else if (p < floor / 2) armed = true;
  }
  return n;
}

/** Read the tap every `everyMs` for `forMs`. */
export async function listen(page: Page, { forMs, everyMs = 100 }: { forMs: number; everyMs?: number }): Promise<AudioReading[]> {
  const out: AudioReading[] = [];
  for (let t = 0; t < forMs; t += everyMs) {
    await page.waitForTimeout(everyMs);
    const r = await page.evaluate(() => window.__smokeAudio?.read() ?? null);
    if (r) out.push(r);
  }
  return out;
}

/** What a run of readings says. */
export interface Hearing {
  /** The loudest peak. */
  loudest: number;
  /** Share of readings above the sound floor. */
  sounding: number;
  /** Mean change in spectral shape between successive sounding readings (half the L1 distance of the
   *  band vectors, 0 = the same shape, 1 = disjoint), and the change in level (dB) beside it. */
  shapeFlux: number;
  levelFluxDb: number;
  /** The centroid's spread over the sounding readings (10th to 90th percentile), Hz. */
  centroidSpanHz: number;
}

/** Summarise readings against a sound floor (the peak that counts as sound). */
export function hear(readings: AudioReading[], floor: number): Hearing {
  const on = readings.filter((r) => r.peak > floor);
  let shape = 0;
  let level = 0;
  let pairs = 0;
  for (let i = 1; i < readings.length; i++) {
    const a = readings[i - 1];
    const b = readings[i];
    if (a.peak <= floor || b.peak <= floor) continue;
    shape += a.bands.reduce((s, x, k) => s + Math.abs(x - b.bands[k]), 0) / 2;
    level += Math.abs(20 * Math.log10(b.rms / a.rms));
    pairs++;
  }
  const cs = on.map((r) => r.centroid).sort((x, y) => x - y);
  const q = (p: number) => (cs.length ? cs[Math.min(cs.length - 1, Math.floor(p * cs.length))] : 0);
  return {
    loudest: readings.reduce((m, r) => Math.max(m, r.peak), 0),
    sounding: readings.length ? on.length / readings.length : 0,
    shapeFlux: pairs ? shape / pairs : 0,
    levelFluxDb: pairs ? level / pairs : 0,
    centroidSpanHz: q(0.9) - q(0.1),
  };
}
