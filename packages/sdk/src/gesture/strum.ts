/**
 * When a strum sounds: the air guitar's decision (#249), shared by every instrument that
 * strums a chord in the air (the air guitar, the chord map's strum mode).
 *
 * A strum is the drum problem (`docs/research/air-instruments.md` §7.3): its moment is
 * predicted before the frame that shows it by the air drum's impact predictor
 * (`@thoremin/ictus` `createImpactPredictor`), from the strumming hand's tracked point, and
 * committed with at least `minLead` seconds to spare PLUS the age of the camera frame (a
 * frame seen late leaves less time). A strum the predictor did not see coming is sounded on
 * its confirmation, at once, as a late strum. The caller decides what a strum plays (it
 * latches its chord at the moment of the decision) and how loud; {@link strumNotes} is what a
 * chord sounds as, the guitar voicing low string first.
 *
 * In the SDK (#674) because two extensions strum: the air guitar and the harmony slice's chord map.
 * Pure and Node-safe.
 */
import { createImpactPredictor, type ImpactPredictor } from '@thoremin/ictus';
import { clamp01 } from '@thoremin/stats';
import { guitarVoicing, parseChordName } from '../music/guitar';
import type { NoteEvent } from '../nodes/note_events';

export interface StrumDetectorOptions {
  /** How far ahead of the strum it is committed, seconds (the air drum's lead), until the
   *  first {@link StrumDetector.push} names its own. */
  minLead: number;
  /** The smallest strum that counts, as a fraction of the frame height. */
  minStroke: number;
  /** The slowest approach that is a strum, frame heights per second. */
  minSpeed: number;
}

/** One strum decided. */
export interface Strum {
  /** When it should sound, engine seconds: never before the decision. */
  t: number;
  /** The stroke's strength, 0..1. */
  strength: number;
  /** Committed ahead of the strum (true), or decided too late to be (false). */
  predicted: boolean;
  /** The predicted strum time minus the decision's engine time, seconds (negative = late). */
  lead: number;
  /** Sounded on confirmation, the predictor having missed it: the caller plays it softer. */
  late: boolean;
}

export interface StrumDetector {
  /**
   * One sample of the strumming point (`t`: its capture time, engine seconds; `x`, `y`:
   * frame heights, y down) seen at engine time `now`, with the lead the output needs now
   * (read live, so a changed setting applies at the next sample without forgetting the
   * learned stroke floor). Returns the strums it decided.
   */
  push(sample: { t: number; x: number; y: number }, now: number, minLead: number): Strum[];
  /** Whether the strumming hand's stroke floor has been learned. */
  ready(): boolean;
}

/** Two samples closer than this are not two camera frames (the air drum's rule). */
const MIN_SAMPLE_SPACING = 0.004;

export function createStrumDetector(opts: StrumDetectorOptions): StrumDetector {
  const predictor: ImpactPredictor = createImpactPredictor({ minLead: opts.minLead, minAmplitude: opts.minStroke, minApproachSpeed: opts.minSpeed });
  let lastT = -Infinity;
  return {
    push(sample, now, minLead) {
      if (sample.t < lastT + MIN_SAMPLE_SPACING) return [];
      lastT = sample.t;
      predictor.setMinLead(minLead + Math.max(0, now - sample.t));
      const strums: Strum[] = [];
      for (const e of predictor.push(sample)) {
        if (e.kind === 'predict') {
          const lead = e.t - now;
          strums.push({ t: Math.max(e.t, now), strength: clamp01(e.strength), predicted: lead >= 0, lead, late: false });
        } else if (e.predicted === null) {
          strums.push({ t: now, strength: clamp01(e.strength), predicted: false, lead: e.t - now, late: true });
        }
      }
      return strums;
    },
    ready: () => Number.isFinite(predictor.level()),
  };
}

/** Velocity of a strum sounded on confirmation instead of prediction. */
export const LATE_VELOCITY = 0.6;

/**
 * The notes of one strum of `chordName` at time `t`: the chord's guitar voicing, low
 * string first, `spread` seconds apart, each on its string's voice. A string the chord
 * does not play gets a zero-velocity note at the strum's start: a damp, so a G's low
 * strings do not ring on under the D that follows it. Empty for a name that is not a chord.
 */
export function strumNotes(chordName: string, t: number, velocity: number, spread: number, extra: Pick<NoteEvent, 'predicted' | 'lead'>, octaveShift = 0): NoteEvent[] {
  const chord = parseChordName(chordName);
  if (!chord) return [];
  const notes: NoteEvent[] = [];
  let k = 0;
  const voicing = guitarVoicing(chord);
  voicing.forEach((midi, string) => {
    if (midi === null) notes.push({ t, midi: 0, velocity: 0, voice: string, ...extra });
  });
  voicing.forEach((midi, string) => {
    if (midi === null) return;
    notes.push({ t: t + k * spread, midi: midi + 12 * octaveShift, velocity, voice: string, ...extra });
    k += 1;
  });
  return notes;
}
