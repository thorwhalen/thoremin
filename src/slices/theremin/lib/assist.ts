/**
 * The physical theremin's assistance: what a modern instrument (Moog's Theremini, the Claravox)
 * adds to the raw heterodyne pitch, as one chain over the pitch in fractional MIDI notes.
 *
 * One number, `level` (0 = a pure theremin, every stage off and the pitch passed through
 * untouched), sets the defaults of four separate stages ({@link assistDefaults}); a player who
 * tunes one stage owns them all (`custom`), but level 0 still turns everything off:
 *
 * 1. **Vibrato aid.** A wrist vibrato is a 4 to 8 Hz wobble of a few tenths of a semitone; a naive
 *    pitch correction pulls it flat (the Theremini's own manual: at full correction "vibrato is
 *    eliminated"). The detector splits the pitch into a slow centre and the wobble around it, and
 *    while the wobble is a vibrato (its rate in band, its depth above the jitter) it is held out of
 *    the smoothing and the correction, then added back, `1 + depthGain * aid` times as deep.
 * 2. **Smoothing.** The 1-euro filter (Casiez et al. 2012) on what remains: still when the hand is
 *    still, responsive when it moves.
 * 3. **Correction.** A pull toward the nearest note of the snap scale (chromatic, or the
 *    instrument's scale), `strength` 0 = free glide, 1 = locked to the note.
 */

/** The assistance settings, as the dial holds them. */
export interface AssistSettings {
  /** 0 = pure theremin (nothing on); up to 1. */
  level: number;
  /** False: the stages follow `level`; true: the player tuned them (the fields below). */
  custom: boolean;
  /** What the correction pulls toward. */
  snap: SnapScale;
  /** The pull, 0..1. */
  correction: number;
  /** The smoothing, 0 (off) .. 1 (heaviest). */
  smoothing: number;
  /** The vibrato aid, 0 (off) .. 1. */
  vibratoAid: number;
}

export const SNAP_SCALES = ['chromatic', 'scale'] as const;
export type SnapScale = (typeof SNAP_SCALES)[number];

/** The stages' values at an assistance level: a little assistance pulls gently toward the
 *  semitones; past the middle it pulls toward the instrument's scale. */
export function assistDefaults(level: number): Omit<AssistSettings, 'level' | 'custom'> {
  const a = Math.min(1, Math.max(0, level));
  return {
    snap: a >= 0.5 ? 'scale' : 'chromatic',
    correction: a,
    smoothing: 0.8 * a,
    vibratoAid: a,
  };
}

/** The stages in force: off at level 0, the level's defaults unless the player tuned them. */
export function effectiveAssist(s: AssistSettings): Omit<AssistSettings, 'level' | 'custom'> {
  if (!(s.level > 0)) return { snap: 'chromatic', correction: 0, smoothing: 0, vibratoAid: 0 };
  if (!s.custom) return assistDefaults(s.level);
  return { snap: s.snap, correction: s.correction, smoothing: s.smoothing, vibratoAid: s.vibratoAid };
}

/** The nearest note of a pitch-class set to a fractional MIDI pitch (any octave). */
export function nearestInScale(m: number, pitchClasses: readonly number[]): number {
  if (pitchClasses.length === 0) return Math.round(m);
  let best = Math.round(m);
  let bestD = Infinity;
  const base = Math.floor(m);
  for (let k = base - 12; k <= base + 12; k++) {
    if (!pitchClasses.includes(((k % 12) + 12) % 12)) continue;
    const d = Math.abs(k - m);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/** The pull toward `target`: `strength` 0 leaves `m`, 1 lands on `target`. */
export const pullToward = (m: number, target: number, strength: number): number => target + (m - target) * (1 - Math.min(1, Math.max(0, strength)));

/** Tuning constants of the chain (not player settings). */
export const ASSIST_TUNING = {
  /** The split between the centre and the wobble, Hz: below every vibrato rate. */
  splitHz: 2.5,
  /** A vibrato's rate band, Hz. */
  minRateHz: 3.5,
  maxRateHz: 9,
  /** Its depth band, semitones RMS: above the tracker's jitter, below a deliberate glide. */
  minDepth: 0.08,
  maxDepth: 1.5,
  /** How long the wobble's rate and depth are measured over, s. */
  windowS: 0.8,
  /** The wobble's autocorrelation one period later that makes it a vibrato, 0..1. */
  minPeriodicity: 0.45,
  /** How much nearer a new note must be before the correction moves to it, as a share of the
   *  step between the two notes (a pentatonic's three semitones want a wider margin than one). */
  hysteresis: 0.25,
  /** How fast the detection fades in and out, s. */
  fadeS: 0.15,
  /** How much deeper the aid makes a detected vibrato at aid 1. */
  depthGain: 0.5,
  /** The 1-euro filter at smoothing 1 (min cutoff, Hz) and at smoothing near 0. */
  heavyCutoffHz: 0.4,
  lightCutoffHz: 6,
  beta: 0.3,
  dCutoffHz: 1,
};

/**
 * The wobble's depth (RMS, semitones), its best period's normalised autocorrelation over the
 * vibrato band, and the rate that period gives, Hz.
 */
export function wobbleStats(hist: readonly { dt: number; w: number }[], t: Pick<typeof ASSIST_TUNING, 'minRateHz' | 'maxRateHz'>): { depth: number; rate: number; periodicity: number } {
  const n = hist.length;
  if (n < 4) return { depth: 0, rate: 0, periodicity: 0 };
  const meanDt = hist.reduce((a, h) => a + h.dt, 0) / n;
  // Detrended: a glide leaves the centre lagging by a steady offset, which is no oscillation (and
  // would correlate with itself at every lag).
  const ts: number[] = [];
  let acc = 0;
  for (const h of hist) ts.push((acc += h.dt));
  const tm = ts.reduce((a, x) => a + x, 0) / n;
  const wm = hist.reduce((a, h) => a + h.w, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (ts[i] - tm) * (hist[i].w - wm);
    sxx += (ts[i] - tm) ** 2;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const w = hist.map((h, i) => h.w - wm - slope * (ts[i] - tm));
  let energy = 0;
  for (const x of w) energy += x * x;
  const depth = Math.sqrt(energy / n);
  if (!(energy > 0)) return { depth, rate: 0, periodicity: 0 };
  const minLag = Math.max(2, Math.floor(1 / (t.maxRateHz * meanDt)));
  const maxLag = Math.min(n - 2, Math.ceil(1 / (t.minRateHz * meanDt)));
  let best = 0;
  let bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0;
    let a = 0;
    let b = 0;
    for (let i = lag; i < n; i++) {
      num += w[i] * w[i - lag];
      a += w[i] * w[i];
      b += w[i - lag] * w[i - lag];
    }
    const r = a > 0 && b > 0 ? num / Math.sqrt(a * b) : 0;
    if (r > best) {
      best = r;
      bestLag = lag;
    }
  }
  return { depth, rate: bestLag ? 1 / (bestLag * meanDt) : 0, periodicity: best };
}

const alpha = (cutoffHz: number, dt: number): number => 1 / (1 + 1 / (2 * Math.PI * cutoffHz * dt));

/** What the chain reports each step, besides the pitch. */
export interface AssistReading {
  pitch: number;
  /** How sure the detector is that a vibrato is playing, 0..1. */
  vibrato: number;
  /** The detected vibrato's rate, Hz, when it is one. */
  vibratoRateHz: number | null;
  /** The note the correction pulled toward, or null with no correction. */
  target: number | null;
}

/** A stateful assistance chain; `step` once per new hand frame, `reset` when the hand is lost. */
export interface AssistChain {
  step(pitch: number, dt: number, stages: Omit<AssistSettings, 'level' | 'custom'>, scalePitchClasses: readonly number[]): AssistReading;
  reset(): void;
}

export function createAssistChain(t = ASSIST_TUNING): AssistChain {
  let centre: number | null = null;
  let weight = 0;
  // The wobble's recent history, for its rate and periodicity (autocorrelation) and depth (RMS).
  let hist: { dt: number; w: number }[] = [];
  let xPrev: number | null = null;
  let dxPrev = 0;
  let lastTarget: number | null = null;
  const reset = () => {
    lastTarget = null;
    centre = null;
    weight = 0;
    hist = [];
    xPrev = null;
    dxPrev = 0;
  };
  const oneEuro = (x: number, dt: number, minCutoff: number): number => {
    if (xPrev === null) {
      xPrev = x;
      dxPrev = 0;
      return x;
    }
    const dx = (x - xPrev) / dt;
    dxPrev += alpha(t.dCutoffHz, dt) * (dx - dxPrev);
    xPrev += alpha(minCutoff + t.beta * Math.abs(dxPrev), dt) * (x - xPrev);
    return xPrev;
  };
  return {
    reset,
    step(pitch, dtIn, stages, scale) {
      const dt = dtIn > 0 && Number.isFinite(dtIn) ? dtIn : 1 / 30;
      // The centre and the wobble, measured whatever the stages: switching the aid on mid-note
      // must not start from nothing.
      centre = centre === null ? pitch : centre + alpha(t.splitHz, dt) * (pitch - centre);
      const wobble = pitch - centre;
      hist.push({ dt, w: wobble });
      let span = hist.reduce((acc, h) => acc + h.dt, 0);
      while (hist.length > 2 && span - hist[0].dt >= t.windowS) span -= hist.shift()!.dt;
      const { depth, rate, periodicity } = wobbleStats(hist, t);
      // A vibrato is PERIODIC: the tracker's jitter is as deep and crosses zero as often, but does
      // not correlate with itself one period later.
      const isVibrato = span >= t.windowS * 0.8 && periodicity >= t.minPeriodicity && rate >= t.minRateHz && rate <= t.maxRateHz && depth >= t.minDepth && depth <= t.maxDepth;
      const step = dt / t.fadeS;
      weight = Math.min(1, Math.max(0, weight + (isVibrato ? step : -step)));
      const aid = Math.min(1, Math.max(0, stages.vibratoAid));
      const held = aid > 0 ? weight : 0;
      // What the smoothing and the correction see: the pitch less the protected wobble.
      const base = pitch - held * wobble;
      let smoothed = base;
      // The cutoff falls geometrically from light to heavy as the smoothing rises.
      if (stages.smoothing > 0) smoothed = oneEuro(base, dt, t.lightCutoffHz * (t.heavyCutoffHz / t.lightCutoffHz) ** Math.min(1, stages.smoothing));
      else xPrev = null;
      let corrected = smoothed;
      let target: number | null = null;
      if (!(stages.correction > 0)) lastTarget = null;
      if (stages.correction > 0) {
        const nearest = stages.snap === 'scale' ? nearestInScale(smoothed, scale) : Math.round(smoothed);
        // Hysteresis: the note in force is kept until another is nearer by a margin, so a hand
        // held on the boundary between two notes does not warble between them.
        const keep = lastTarget !== null && Math.abs(smoothed - lastTarget) - Math.abs(smoothed - nearest) <= t.hysteresis * Math.abs(lastTarget - nearest);
        target = keep ? lastTarget! : nearest;
        lastTarget = target;
        corrected = pullToward(smoothed, target, stages.correction);
      }
      const out = corrected + held * wobble * (1 + t.depthGain * aid);
      return { pitch: out, vibrato: weight, vibratoRateHz: isVibrato ? rate : null, target };
    },
  };
}
