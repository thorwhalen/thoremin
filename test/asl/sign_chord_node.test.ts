/**
 * The sign-chord node: A..G signed → the key's chord on stable voice ids; held between
 * letters by default, released when the hand leaves; silent unless the dial says chords.
 */
import { describe, expect, it } from 'vitest';
import { signChordNode, SIGN_CHORD_VOICE_ID_BASE, MAX_SIGN_CHORD_VOICES } from '@thoremin/ext-asl/nodes/sign_chord';
import { emptyScores, SIGN_IDS, type SignId, type SignScores } from '@thoremin/asl';
import { chordName, type ScaleSpec } from '@thoremin/sdk/music/theory';
import type { SynthParams } from '@thoremin/sdk/nodes/domain';

const D_MAJOR: ScaleSpec = { root: 2, type: 'major', octaves: 2, baseOctave: 3 };
const reading = (label: SignId | null, present = true): SignScores => ({ ...emptyScores(), present, label, kind: label ? 'static' : null });
const ctx = { tick: 0, time: 0, dt: 1 / 30, resources: {} };

function run(seq: (SignScores | undefined)[], config: Record<string, unknown> = { enabled: true, chords: true }) {
  const node = signChordNode.make(signChordNode.params!.parse({}));
  return seq.map((r) => node.process({ reading: r, spec: D_MAJOR, config, octaveShift: 0 }, ctx) as { params: SynthParams; triad: number[]; captions: string[] });
}

describe('sign-chord', () => {
  it('F in D major plays F#m on four stable voice ids', () => {
    const [out] = run([reading('F')]);
    expect(chordName(out!.triad)).toBe('F#m');
    expect(out!.params.voices.map((v) => v.id)).toEqual(Array.from({ length: MAX_SIGN_CHORD_VOICES }, (_, i) => SIGN_CHORD_VOICE_ID_BASE + i));
    expect(out!.params.voices.some((v) => v.present)).toBe(true);
  });

  it('holds the chord through other letters, releases when the hand leaves', () => {
    const outs = run([reading('A'), reading('H'), reading(null), reading(null, false)]);
    expect(outs.map((o) => chordName(o.triad) || '-')).toEqual(['A', 'A', 'A', '-']);
    expect(outs[3]!.params.voices.every((v) => !v.present)).toBe(true);
  });

  it('without holdChord, only a held A..G sounds', () => {
    const outs = run([reading('A'), reading('H')], { enabled: true, chords: true, holdChord: false });
    expect(outs.map((o) => o.triad.length)).toEqual([3, 0]);
  });

  it('is silent while the dial says no chords, and captions only when it does', () => {
    const [off] = run([reading('A')], { enabled: true, chords: false });
    expect(off!.triad).toEqual([]);
    expect(off!.captions).toEqual([]);
    const [on] = run([reading('A')]);
    expect(on!.captions[SIGN_IDS.indexOf('F')]).toBe('F#m');
  });
});
