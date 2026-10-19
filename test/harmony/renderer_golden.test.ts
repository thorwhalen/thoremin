/**
 * The golden voices of the shared chord renderer (H2 of #613, `docs/design/harmonic-layers.md`
 * §7): every voicing x every rendering, over scripted performances (chord changes, silences, an
 * octave shift, uneven ticks, three keys including a non-tertian pentatonic source), recorded
 * from the renderer as it was BEFORE the realization pipeline and compared sample for sample
 * after. A hash per combination keeps the snapshot small; the first combination is also kept
 * in full, so a failure shows what changed.
 *
 * What "today's output byte for byte" means for every chord thoremin plays through the
 * renderer (the face chords, the personal categorizer chords, the chord map's held chords).
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { createChordRenderer } from '@thoremin/sdk/music/chord_render';
import { RENDERINGS, VOICINGS } from '@thoremin/sdk/music/voicing';
import type { ScaleSpec } from '@thoremin/sdk/music/theory';

const SPECS: Record<string, ScaleSpec> = {
  cMajor: { root: 0, type: 'major', octaves: 2, baseOctave: 3 },
  aHarmonic: { root: 9, type: 'minorHarmonic', octaves: 2, baseOctave: 3 },
  cPentatonic: { root: 0, type: 'pentatonic', octaves: 2, baseOctave: 4 },
};

/** A scripted performance: per tick a degree (-1 silence), an octave shift and a tick length. */
const SCRIPT = Array.from({ length: 90 }, (_, i) => ({
  degree: [0, 0, 0, 3, 3, 4, 4, 4, -1, 5, 5, 1, 6, 2, 0][Math.floor(i / 6)],
  octaveShift: i >= 60 && i < 75 ? 1 : i >= 75 ? -1 : 0,
  dt: [1 / 30, 1 / 60, 1 / 30, 0.05, 1 / 120][i % 5],
}));

function play(spec: ScaleSpec, voicing: (typeof VOICINGS)[number], rendering: (typeof RENDERINGS)[number]) {
  const r = createChordRenderer({ idBase: 1000, maxVoices: 4 });
  return SCRIPT.map((s, i) =>
    r.render({ degree: s.degree, spec, voicing, rendering, bpm: 90 + (i % 3) * 20, octaveShift: s.octaveShift, gain: 0.3, sound: 'warmPad', silentSound: 'triangle', dt: s.dt }),
  );
}

const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);

describe('the chord renderer, golden', () => {
  it('renders every voicing and rendering exactly as recorded', () => {
    const hashes: Record<string, string> = {};
    for (const [key, spec] of Object.entries(SPECS)) for (const v of VOICINGS) for (const r of RENDERINGS) hashes[`${key}|${v}|${r}`] = hash(play(spec, v, r));
    expect(hashes).toMatchSnapshot();
  });

  it('one combination in full, to read a difference', () => {
    expect(play(SPECS.cMajor, 'spread', 'arpUpDown').slice(0, 30)).toMatchSnapshot();
  });
});
