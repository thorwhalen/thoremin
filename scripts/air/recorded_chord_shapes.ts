/**
 * Make the air guitar's shipped chord shapes from the author's recorded take, and score them
 * on frames held out of their making.
 *
 * Reads the private recordings checkout (`test/helpers/recordings.ts` says where); writes only
 * numbers measured on it (`packages/ext-air/src/lib/recorded_chords.json`: per-chord feature
 * means and a pooled spread, no frames). Method: `lib_recorded_chords.ts`.
 *
 * Usage: npx vite-node scripts/air/recorded_chord_shapes.ts [--write]
 */
import { writeFileSync } from 'node:fs';
import { HAS_RECORDINGS } from '../../test/helpers/recordings';
import { heldOutScore, RECORDED_TAKE, recordedSegments, summarise } from './lib_recorded_chords';

if (!HAS_RECORDINGS) throw new Error('needs the thoremin-recordings checkout (see test/helpers/recordings.ts)');

const { segments, decisions } = recordedSegments();
console.log('Labels:');
decisions.forEach((d, i) => console.log(`  ${segments[i]!.label.padEnd(7)} heard "${d.heard}" p=${d.p.toFixed(2)}: ${d.why}; ${segments[i]!.frames.length} frames`));

const score = heldOutScore(segments);
const pct = (x: number) => `${Math.round(100 * x)}%`;
console.log(`\nHeld out (two folds, ${score.frames} frames): chord ${pct(score.chordAccuracy)}, voicing ${pct(score.shapeAccuracy)}`);
console.log('| chord | frames | named right | mostly mistaken for |\n|---|---|---|---|');
for (const c of score.perChord) console.log(`| ${c.label} | ${c.frames} | ${pct(c.right / c.frames)} | ${c.mostlyAs ?? ''} |`);

if (process.argv.includes('--write')) {
  const summary = summarise(
    segments,
    {
      take: RECORDED_TAKE,
      player: "the app's author: right-handed, standard guitar, so the left hand frets",
      recordedOn: '2026-11-05',
      method: 'scripts/air/recorded_chord_shapes.ts: each chord named aloud then held and strummed; frames from 1 s after the name to 0.3 s before the next speech; the fretting hand only',
    },
    {
      frames: score.frames,
      chordAccuracy: Math.round(1000 * score.chordAccuracy) / 1000,
      shapeAccuracy: Math.round(1000 * score.shapeAccuracy) / 1000,
      note: 'Two folds within the one take (each chord\'s first half named by a model of the second halves, then the reverse). One sitting: a shape re-made another day varies more, so expect less, and enrol a chord again to make it your own.',
    },
  );
  const path = new URL('../../packages/ext-air/src/lib/recorded_chords.json', import.meta.url);
  writeFileSync(path, JSON.stringify(summary, null, 1) + '\n');
  console.log(`\nwrote ${path.pathname}`);
}
