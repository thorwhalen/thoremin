/**
 * The embouchure-onset reading (#248) on a self-made face stream: a flautist whose
 * pucker forms a known time before each phrase, holds through the phrase's inner notes,
 * and releases after it; a breath (the jaw opens, then closes) before each phrase; a
 * small tonguing twitch at each inner note. Everything is at 30 fps with the onsets off
 * the frame grid, so the tests pin the sub-frame interpolation as well as the logic.
 */
import { describe, expect, it } from 'vitest';
import {
  BLENDSHAPE_SIGNALS,
  coveredSeconds,
  createEmbouchureDetector,
  detectOnsets,
  jitterSigma,
  leadStats,
  mad,
  matchEvents,
  median,
  mouthFrames,
  mouthSignals,
  nearAny,
  onsetProfile,
  quantile,
  scoreDetection,
  series,
  type MouthFrame,
} from '../../scripts/air/lib_embouchure_onset';
import { rng } from './synthetic_hand';

const FPS = 30;
const RAMP = 0.2; // seconds, raised cosine
const LEAD = 0.3; // the pucker starts forming this long before the first note
const PHRASES = [4.017, 12.311, 20.529, 28.744, 36.961, 45.177]; // first-note onsets, off the frame grid
const INNER = [1.05, 2.1]; // inner notes of each phrase, seconds after its first note
const HOLD = 3.0;
const SIGMA = 0.003;

/** 0..1 raised-cosine ramp over `RAMP` seconds from `t0`. */
const ramp = (t: number, t0: number) => (t < t0 ? 0 : t > t0 + RAMP ? 1 : 0.5 * (1 - Math.cos((Math.PI * (t - t0)) / RAMP)));

interface Synth {
  frames: MouthFrame[];
  phraseOnsets: number[];
  innerOnsets: number[];
}

function synthFlautist(o: { seed?: number; twitch?: boolean; withPoints?: boolean } = {}): Synth {
  const r = rng(o.seed ?? 1);
  const noise = () => (r() + r() + r() + r() - 2) * SIGMA * 1.73; // ~Gaussian, sigma SIGMA
  const frames: MouthFrame[] = [];
  const n = Math.round(52 * FPS);
  for (let i = 0; i < n; i++) {
    const t = i / FPS;
    let pucker = 0.05;
    let jaw = 0.02;
    let aperture = 0.06;
    for (const p of PHRASES) {
      // The embouchure: up before the phrase, held, released after.
      pucker += 0.4 * (ramp(t, p - LEAD) - ramp(t, p + HOLD + 0.3));
      // The breath: the jaw opens 0.9 s before the note and closes onto the embouchure.
      jaw += 0.3 * (ramp(t, p - 0.9) - ramp(t, p - 0.55));
      aperture += 0.15 * (ramp(t, p - 0.9) - ramp(t, p - 0.55)) - 0.04 * ramp(t, p - LEAD) + 0.04 * ramp(t, p + HOLD + 0.3);
      if (o.twitch) {
        // Tonguing: a two-frame jaw twitch at each inner note, 8 sigma high.
        for (const d of INNER) {
          const dt = t - (p + d);
          if (dt >= -0.02 && dt < 0.05) jaw += 8 * SIGMA;
        }
      }
    }
    const blendshapes: Record<string, number> = {};
    for (const s of BLENDSHAPE_SIGNALS) blendshapes[s.slice(5)] = 0.03 + noise();
    blendshapes.mouthPucker = pucker + noise();
    blendshapes.jawOpen = jaw + noise();
    const frame: MouthFrame = { t, present: true, blendshapes };
    if (o.withPoints) {
      const scale = 0.2; // inter-ocular, normalised image units
      frame.points = {
        '33': [0.4, 0.4, 0],
        '263': [0.6, 0.4, 0],
        '13': [0.5, 0.6 - (aperture * scale) / 2, -0.01],
        '14': [0.5, 0.6 + (aperture * scale) / 2, -0.01],
        '0': [0.5, 0.57, -0.01],
        '17': [0.5, 0.63, -0.01],
        '61': [0.5 - 0.15 * scale, 0.6, 0],
        '291': [0.5 + 0.15 * scale, 0.6, 0],
        '1': [0.5, 0.5, -0.02],
        '152': [0.5, 0.5 + (0.7 + jaw) * scale, 0],
      };
    }
    frames.push(frame);
  }
  return { frames, phraseOnsets: PHRASES, innerOnsets: PHRASES.flatMap((p) => INNER.map((d) => p + d)) };
}

describe('mouthSignals', () => {
  it('reads the blendshapes and the lip geometry, normalised by the inter-ocular distance', () => {
    const { frames } = synthFlautist({ withPoints: true });
    const v = mouthSignals(frames[0]);
    expect(v['face.mouthPucker']).toBeCloseTo(0.05, 1);
    expect(v['lip.aperture']).toBeCloseTo(0.06, 2);
    expect(v['lip.width']).toBeCloseTo(0.3, 6);
    expect(v['lip.height']).toBeCloseTo(0.3, 6);
    expect(v['jaw.drop']).toBeCloseTo(0.72, 2);
    expect(v['lip.protrusion']).toBeGreaterThan(0);
  });
  it('is NaN for the geometry without points and for everything when the face is absent', () => {
    const { frames } = synthFlautist();
    expect(Number.isNaN(mouthSignals(frames[0])['lip.aperture'])).toBe(true);
    expect(Number.isFinite(mouthSignals(frames[0])['face.mouthPucker'])).toBe(true);
    const gone = mouthSignals({ t: 0, present: false, blendshapes: {} });
    for (const v of Object.values(gone)) expect(Number.isNaN(v)).toBe(true);
  });
  it('parses stream records, points included', () => {
    const [f] = mouthFrames([{ tick: 0, t: 0.5, value: { present: true, blendshapes: { jawOpen: 0.2 }, points: { '13': [0.5, 0.6, 0] } } }]);
    expect(f.t).toBe(0.5);
    expect(f.blendshapes.jawOpen).toBe(0.2);
    expect(f.points?.['13']).toEqual([0.5, 0.6, 0]);
  });
});

describe('statistics', () => {
  it('median, quantile, mad and leadStats agree on a small sample', () => {
    const xs = [1, 2, 3, 4, 100];
    expect(median(xs)).toBe(3);
    expect(quantile(xs, 0.5)).toBe(3);
    expect(quantile(xs, 0)).toBe(1);
    expect(quantile(xs, 1)).toBe(100);
    expect(mad(xs)).toBeCloseTo(1.4826, 4);
    const s = leadStats(xs);
    expect(s.n).toBe(5);
    expect(s.median).toBe(3);
    expect(s.mean).toBe(22);
    expect(leadStats([]).n).toBe(0);
    expect(Number.isNaN(leadStats([]).median)).toBe(true);
  });
  it('jitterSigma recovers the noise of a still signal', () => {
    const { frames } = synthFlautist();
    const { x } = series(frames, 'face.mouthPressLeft');
    expect(jitterSigma(x)).toBeGreaterThan(SIGMA * 0.7);
    expect(jitterSigma(x)).toBeLessThan(SIGMA * 1.4);
  });
});

describe('onsetProfile (the oracle reading)', () => {
  const { frames, phraseOnsets, innerOnsets } = synthFlautist();
  const { t, x } = series(frames, 'face.mouthPucker');

  it('finds the pucker forming before every phrase, with the 10/50/90 % crossings where the ramp puts them', () => {
    const prof = onsetProfile(t, x, phraseOnsets.map((on) => ({ t: on, from: on - 3 })));
    expect(prof.every((p) => p.moved && p.changeNoiseUnits > 50)).toBe(true);
    // A raised cosine over RAMP reaches 10 % at 0.041 s, 50 % at 0.1 s, 90 % at 0.159 s.
    const l10 = median(prof.map((p) => p.lead10));
    const l50 = median(prof.map((p) => p.lead50));
    const l90 = median(prof.map((p) => p.lead90));
    expect(Math.abs(l10 - (LEAD - 0.041))).toBeLessThan(0.02);
    expect(Math.abs(l50 - (LEAD - 0.1))).toBeLessThan(0.02);
    expect(Math.abs(l90 - (LEAD - 0.159))).toBeLessThan(0.02);
    // The largest excursion before the sound is the settled pucker itself, somewhere
    // between its settling and the onset.
    for (const p of prof) expect(p.leadPeak).toBeGreaterThanOrEqual(0);
    for (const p of prof) expect(p.leadPeak).toBeLessThan(LEAD);
  });

  it('reports an onset whose windows have no frames as unmeasured, never as "did not move"', () => {
    // A span that starts before the stream exists, and one whose playing window falls
    // in a gap with no face: both are unknowns, not zeros.
    const before = onsetProfile(t, x, [{ t: 0.05, from: -3 }]);
    expect(before[0].measured).toBe(false);
    expect(before[0].moved).toBe(false);
    const gapT = t.filter((v) => v < 10 || v > 11);
    const gapX = x.filter((_, i) => t[i] < 10 || t[i] > 11);
    const inGap = onsetProfile(gapT, gapX, [{ t: 10.5, from: 9 }]);
    expect(inGap[0].measured).toBe(false);
    const fine = onsetProfile(t, x, [{ t: phraseOnsets[1], from: phraseOnsets[1] - 3 }]);
    expect(fine[0].measured).toBe(true);
  });

  it('reads an inner note as "did not move": the embouchure is held', () => {
    const prof = onsetProfile(t, x, innerOnsets.map((on) => ({ t: on, from: on - 0.5 })));
    expect(prof.every((p) => !p.moved)).toBe(true);
    expect(prof.every((p) => Math.abs(p.changeNoiseUnits) < 3)).toBe(true);
  });

  it('sees the breath as the jaw peak before the phrase, not as a rest-to-play change', () => {
    const jaw = series(frames, 'face.jawOpen');
    const prof = onsetProfile(jaw.t, jaw.x, phraseOnsets.map((on) => ({ t: on, from: on - 3 })));
    // Rest and play levels of the jaw are equal (the breath is a bump), so the crossing
    // leads are NaN, while the peak sits in the open-jaw plateau 0.55..0.7 s before.
    expect(prof.every((p) => !p.moved)).toBe(true);
    const pk = prof.map((p) => p.leadPeak);
    expect(pk.every(Number.isFinite)).toBe(true);
    expect(median(pk)).toBeGreaterThan(0.5);
    expect(median(pk)).toBeLessThan(0.75);
  });
});

describe('createEmbouchureDetector (the causal reading)', () => {
  const { frames, phraseOnsets, innerOnsets } = synthFlautist({ twitch: true });
  const pucker = series(frames, 'face.mouthPucker');
  const jaw = series(frames, 'face.jawOpen');
  const WINDOW = { before: 0.6, after: 0.1 };

  it('level mode fires once per phrase, early in the ramp, and never inside a phrase', () => {
    const events = detectOnsets(pucker.t, pucker.x, { mode: 'level', thresholdNoiseUnits: 6, sign: 1 });
    const score = scoreDetection(phraseOnsets, events.map((a) => a.t), WINDOW);
    expect(score.recall).toBe(1);
    expect(score.precision).toBe(1);
    // 6 sigma of a 0.4 rise is a few percent of the ramp: the crossing is 25-40 ms in.
    expect(score.lead.median).toBeGreaterThan(LEAD - 0.045);
    expect(score.lead.median).toBeLessThan(LEAD - 0.015);
    expect(score.lead.mad).toBeLessThan(0.02);
    // The anchors carry the ictus contract.
    for (const a of events) {
      expect(a.confidence).toBeGreaterThan(0);
      expect(a.confidence).toBeLessThanOrEqual(1);
      expect(a.strength).toBeGreaterThan(0);
      expect(Number.isFinite(a.sharpness)).toBe(true);
      expect(a.lateral).toBe(0);
    }
  });

  it('a level threshold above the tonguing twitch is blind to it; velocity mode at a lower one sees it, and the release too', () => {
    const level = detectOnsets(jaw.t, jaw.x, { mode: 'level', thresholdNoiseUnits: 12, sign: 0 });
    const levelInner = matchEvents(innerOnsets, level.map((a) => a.t), { before: 0.1, after: 0.1 });
    expect(levelInner.pairs.length).toBe(0);
    const vel = detectOnsets(jaw.t, jaw.x, { mode: 'velocity', thresholdNoiseUnits: 4, sign: 0, refractory: 0.15 });
    const velInner = matchEvents(innerOnsets, vel.map((a) => a.t), { before: 0.1, after: 0.1 });
    expect(velInner.pairs.length).toBe(innerOnsets.length);
    // Every breath (open and close) fires too: that is the price of a movement detector.
    expect(vel.length).toBeGreaterThan(innerOnsets.length + phraseOnsets.length);
  });

  it('interpolates the crossing below the frame period and holds a refractory window', () => {
    const det = createEmbouchureDetector({ mode: 'level', thresholdNoiseUnits: 6, sign: 1, refractory: 1, warmupFrames: 5 });
    // 60 still frames, then a jump that crosses the threshold between two frames.
    const out: { t: number }[] = [];
    for (let i = 0; i < 60; i++) det.push(i / FPS, 0.1 + (i % 2 ? 0.001 : -0.001));
    const a = det.push(60 / FPS, 0.5);
    expect(a).not.toBeNull();
    expect(a!.t).toBeGreaterThan(59 / FPS);
    expect(a!.t).toBeLessThan(60 / FPS);
    // Back to rest and up again inside the refractory: no second anchor.
    for (let i = 61; i < 70; i++) if (det.push(i / FPS, 0.1)) out.push({ t: i / FPS });
    expect(det.push(70 / FPS, 0.5)).toBeNull();
    expect(out.length).toBe(0);
  });

  it('restarts after a gap and ignores non-finite samples', () => {
    const det = createEmbouchureDetector({ mode: 'level', thresholdNoiseUnits: 6, sign: 1, warmupFrames: 5 });
    for (let i = 0; i < 40; i++) det.push(i / FPS, 0.1 + (i % 2 ? 0.001 : -0.001));
    expect(det.push(41 / FPS, NaN)).toBeNull();
    // A two-second gap: the baseline is re-seeded at the new level, so no anchor.
    expect(det.push(2 + 41 / FPS, 0.5)).toBeNull();
  });
});

describe('matchEvents and the playing-time bookkeeping', () => {
  it('matches one-to-one inside an asymmetric window and reports misses and extras', () => {
    const ref = [1, 2, 3, 4];
    const est = [0.7, 0.9, 2.05, 3.5, 4.2];
    const m = matchEvents(ref, est, { before: 0.5, after: 0.1 });
    // 1 takes 0.9 (nearest), 2 takes 2.05 (within after), 3 has nothing in [2.5, 3.1]
    // (3.5 is too late), 4 has nothing (3.5 is a lead of 0.5 -> matched; 4.2 trails by 0.2).
    expect(m.pairs.map((p) => [p.ref, p.est])).toEqual([
      [1, 0.9],
      [2, 2.05],
      [4, 3.5],
    ]);
    expect(m.pairs.map((p) => +p.lead.toFixed(2))).toEqual([0.1, -0.05, 0.5]);
    expect(m.missed).toEqual([3]);
    expect(m.extra).toEqual([0.7, 4.2]);
  });
  it('coveredSeconds merges overlapping pads and clips to the span', () => {
    expect(coveredSeconds([1, 2], 1, 0, 10)).toBe(3);
    expect(coveredSeconds([1, 8], 1, 0, 10)).toBe(4);
    expect(coveredSeconds([0.5], 1, 0, 10)).toBe(1.5);
    expect(coveredSeconds([], 1, 0, 10)).toBe(0);
  });
  it('nearAny is a window test over sorted times', () => {
    expect(nearAny([1, 5, 9], 4.5, 1)).toBe(true);
    expect(nearAny([1, 5, 9], 7, 1)).toBe(false);
    expect(nearAny([], 7, 1)).toBe(false);
  });
});
