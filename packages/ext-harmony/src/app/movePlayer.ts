/**
 * Plays a chord move for "Rate this move" (#715): the first chord, then the second, each a soft
 * sine triad, through an AudioContext of its own (as the trainer's click has), so the practice is
 * heard whatever the instrument is doing and needs no running graph.
 */
import { diatonicChords, pitchClasses, type Key } from '@thoremin/sdk/harmony/chord';
import { midiToFreq } from '@thoremin/sdk/music/theory';
import type { RatingMode } from '@thoremin/sdk/harmony/ratings';

/** The key each mode's moves are played in: degrees are what is rated, so any key would do. */
export const PRACTICE_KEYS: Record<RatingMode, Key> = { major: { tonic: 0, scale: 'major' }, minor: { tonic: 9, scale: 'minor' } };

/** How long each chord sounds, seconds, and the gap between them. */
const CHORD_S = [1.1, 1.5] as const;
const GAP_S = 0.05;
const GAIN = 0.12;

/** A degree's triad as MIDI notes: the root from C3 up, the others stacked above it. */
export function triadNotes(mode: RatingMode, degree: number): number[] {
  const chord = diatonicChords(PRACTICE_KEYS[mode])[degree];
  const root = 48 + chord.root;
  return pitchClasses(chord).map((p) => root + ((p - chord.root + 12) % 12));
}

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Play the move from degree `from` to degree `to` in the mode's practice key. */
export function playMove(mode: RatingMode, from: number, to: number): void {
  const c = context();
  if (!c) return;
  let t = c.currentTime + 0.05;
  [from, to].forEach((degree, i) => {
    const length = CHORD_S[i];
    for (const midi of triadNotes(mode, degree)) {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = midiToFreq(midi);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(GAIN, t + 0.03);
      g.gain.setTargetAtTime(0, t + length - 0.25, 0.08);
      osc.connect(g).connect(c.destination);
      osc.start(t);
      osc.stop(t + length + 0.3);
    }
    t += length + GAP_S;
  });
}
