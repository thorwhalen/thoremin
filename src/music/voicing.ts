/**
 * Chord voicing + tempo-based rendering for the face chord (issue #64 follow-up).
 *
 * Two pure, dependency-free pieces (no DOM, no audio):
 *
 *  1. {@link voiceTriad} — arrange a root-position triad (3 ascending scale tones)
 *     into a tasteful chord with a clear low bass fundamental. The voicings are
 *     researched arranging idioms (close, bass+triad, open/spread, shell, power);
 *     they are *view-independent* (anchored an octave below the scale-degree root)
 *     and *quality-agnostic* (the two upper intervals are read from the triad, so the
 *     same recipe works for major / minor / diminished / augmented — and, since #75,
 *     for the non-tertian sonorities a non-seven-note chord source produces).
 *
 *  2. {@link renderGains} — per-voice gain factors (0..1) for an articulation
 *     pattern at a given beat position: a sustained pad plus tempo-based arpeggios,
 *     a re-articulated pulse, an Alberti pattern, and a strum. These say "which
 *     voices sound right now"; the synth's own envelope smooths the edges.
 */

/** Voicing idioms (how a triad's tones are stacked into a chord with a low bass). */
export const VOICINGS = ['spread', 'bassTriad', 'close', 'shell', 'power'] as const;
export type VoicingId = (typeof VOICINGS)[number];

/** Articulation patterns (how a voiced chord is played over time). */
export const RENDERINGS = ['sustained', 'strum', 'arpUp', 'arpDown', 'arpUpDown', 'pulse', 'alberti'] as const;
export type RenderingId = (typeof RENDERINGS)[number];

/** Renderings that march to the tempo clock (the rest ignore BPM). */
export function isTempoRendering(r: RenderingId): boolean {
  return r === 'arpUp' || r === 'arpDown' || r === 'arpUpDown' || r === 'pulse' || r === 'alberti';
}

/**
 * Voice a root-position triad `[root, third, fifth]` (ascending MIDI scale tones)
 * into a chord with a low bass fundamental. The bass is anchored an octave below
 * the scale-degree root (plus the live `octaveShift`, so the chord tracks the
 * melody's register) — deliberately *below* the playing range, since the chord is
 * an accompaniment, not part of the visible scale. Returns ascending-ish MIDI.
 * Returns `[]` for a malformed (non-triad) input.
 */
export function voiceTriad(triad: number[], voicing: VoicingId, octaveShift = 0): number[] {
  if (triad.length < 3) return [];
  const [r, third, fifth] = triad;
  // T and F are the two upper intervals READ from the triad (root→2nd tone, root→3rd
  // tone), not assumed. For a tertian triad T=3/4 and F=6/7/8; for a non-tertian
  // chord-source sonority (e.g. C-maj-pent degree-0 {0,4,9} → F=9) they are whatever
  // the source stacks — the voicing recipe stays valid ascending MIDI either way.
  const T = third - r;
  const F = fifth - r;
  const b = r - 12 + 12 * octaveShift; // low bass = the fundamental
  switch (voicing) {
    case 'close':
      return [b, b + T, b + F];
    case 'bassTriad':
      return [b, b + 12, b + 12 + T, b + 12 + F];
    case 'spread':
      // root, fifth, third-up-an-octave, root-up — the classic wide piano voicing.
      return [b, b + F, b + 12 + T, b + 12];
    case 'shell':
      // root + third + a far-flung fifth: sparse, transparent.
      return [b, b + T, b + 12 + F];
    case 'power':
      // root + fifth + octave: bold, quality-neutral.
      return [b, b + F, b + 12];
    default:
      return [b, b + F, b + 12 + T, b + 12];
  }
}

export interface RenderOpts {
  /** Steps per beat (2 = eighth notes, the default grid). */
  subdiv?: number;
  /** Per-voice strum delay in seconds (default 25 ms). */
  strumSec?: number;
  /** Fraction of each step the pulse sounds before re-articulating (default 0.85). */
  pulseGate?: number;
}

/**
 * Per-voice gain factors (0..1) for `n` voices under `rendering`.
 *  - `beat` is the running beat position (quarter notes) for tempo patterns.
 *  - `timeSinceChange` (seconds since the chord last changed) drives the strum
 *    stagger and resets the roll on each new chord.
 * Pure: the same inputs always give the same gains (so it replays deterministically).
 *
 * These gains say *which voices sound right now*; the synth's per-voice envelope
 * shapes the edges. NOTE the tradeoff: crisp articulation of the tempo renderings
 * (arpeggios / pulse / alberti) needs the instrument's attack AND release to be
 * short relative to the step length (≈ 60 / bpm / subdiv seconds). A long-attack
 * pad (e.g. `warmPad`) will smear a fast arpeggio into a sustained wash — by
 * design, not a bug — so pair tempo renderings with a crisp preset (organ / glass
 * / bell) for clear articulation.
 */
export function renderGains(
  n: number,
  rendering: RenderingId,
  beat: number,
  timeSinceChange: number,
  opts: RenderOpts = {},
): number[] {
  if (n <= 0) return [];
  const subdiv = opts.subdiv ?? 2;
  const strumSec = opts.strumSec ?? 0.025;
  const pulseGate = opts.pulseGate ?? 0.85;

  const ones = () => new Array<number>(n).fill(1);
  const zeros = () => new Array<number>(n).fill(0);
  const only = (idx: number) => {
    const g = zeros();
    g[((idx % n) + n) % n] = 1;
    return g;
  };

  const stepF = (Number.isFinite(beat) ? beat : 0) * subdiv;
  const step = Math.floor(stepF);

  switch (rendering) {
    case 'sustained':
      return ones();
    case 'arpUp':
      return only(step);
    case 'arpDown':
      return only(-step);
    case 'arpUpDown': {
      if (n === 1) return ones();
      const cyc = 2 * (n - 1);
      const pos = ((step % cyc) + cyc) % cyc;
      return only(pos < n ? pos : cyc - pos);
    }
    case 'pulse': {
      // Re-articulate the whole chord each step: on for the first `pulseGate` of
      // the step, off for the tail (so the synth release leaves an audible pulse).
      const frac = stepF - step;
      return frac < pulseGate ? ones() : zeros();
    }
    case 'alberti': {
      // low, high, mid, high — the classic broken-chord pattern, generalized.
      const order = n <= 1 ? [0] : n === 2 ? [0, 1] : [0, n - 1, 1, n - 1];
      return only(order[((step % order.length) + order.length) % order.length]);
    }
    case 'strum': {
      // Staggered onsets from the chord change, then sustain (a roll into a pad).
      const g = zeros();
      for (let j = 0; j < n; j++) g[j] = timeSinceChange >= j * strumSec ? 1 : 0;
      return g;
    }
    default:
      return ones();
  }
}
