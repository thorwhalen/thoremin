/**
 * The air flute's and the air guitar's starter sequences (#263): what a method book's first
 * pages ask for, in the fingering chart's spelling, and the open chords every player meets
 * first. Shipped in code and merged with the player's saved sequences by the trainer's
 * sequence store (core), which owns the collection but not any instrument's content.
 */
import { FLUTE_CHART, chartNotes } from '@/extensions/air/lib/fingerings';
import { starterSequence, type NamedSequence } from '@/app/enroll/sequenceStore';

const starter = starterSequence;

/** The notes of a major scale from `root` (a note name) through the chart, inclusive. */
function majorScale(root: string, octaves = 1): string[] {
  const steps = [2, 2, 1, 2, 2, 2, 1];
  const all = chartNotes(FLUTE_CHART);
  const start = all.findIndex((x) => x.note === root);
  if (start < 0) return [];
  const out = [all[start].note];
  let i = start;
  for (let o = 0; o < octaves; o++) {
    for (const s of steps) {
      i += s;
      if (i >= all.length) return out;
      out.push(all[i].note);
    }
  }
  return out;
}

/** The flute's starters: what a method book's first pages ask for, in the chart's spelling. */
export const FLUTE_STARTER_SEQUENCES: readonly NamedSequence[] = [
  starter('Flute: first notes (B, A, G)', ['B4', 'A4', 'G4', 'A4', 'B4']),
  starter('Flute: G major, one octave', majorScale('G4')),
  // Up to C#6, the top of the default chart range: the third octave's D6 is out of it.
  starter('Flute: D major, second register (D5 to C#6)', majorScale('D5').filter((n) => n !== 'D6')),
  starter('Flute: chromatic, first octave', chartNotes(FLUTE_CHART, ['D4', 'D5']).map((x) => x.note)),
  starter('Flute: G major, two loops', majorScale('G4'), { loops: 2 }),
];

/** The guitar's starters: the open chords every player meets first. */
export const GUITAR_STARTER_SEQUENCES: readonly NamedSequence[] = [
  starter('Guitar: G, C, D', ['G', 'C', 'D']),
  starter('Guitar: E, A, D (the open-string family)', ['E', 'A', 'D']),
  starter('Guitar: Em, Am, Dm', ['Em', 'Am', 'Dm']),
  starter('Guitar: G C D Em, two loops', ['G', 'C', 'D', 'Em'], { loops: 2 }),
];

