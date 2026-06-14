/**
 * Generate a chord-progression SynthParams stream for the audible harmony demo:
 * a position ramp walks I–IV–V–vi (in C), each chord held ~2s, through the
 * `progression` → `chord` nodes. Writes a `map.params.ndjson` you can render
 * with `render_audio.ts`.
 *
 * Usage: vite-node scripts/gen_chord_demo.ts <out.params.ndjson>
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { replayNode, serializeRecords, type StreamRecord } from '@/dag';
import { progressionNode, chordNode, type SynthParams } from '@/nodes';

async function main(): Promise<void> {
  const out = process.argv[2] ?? 'media/chord_demo.params.ndjson';
  const fps = 30;
  const chordsCount = 4;
  const ticksPerChord = fps * 2; // 2s each
  const ticks = chordsCount * ticksPerChord; // 8s

  // Position ramps 0..1 across the 8s, stepping the progression every 2s.
  const positions = Array.from({ length: ticks }, (_, i) => i / ticks);

  const prog = progressionNode.make(progressionNode.params.parse({ key: 'C', romanNumerals: ['I', 'IV', 'V', 'vi'] }));
  const symbols = (await replayNode(prog, { position: positions })).map((o) => o.chord as string);

  const chord = chordNode.make(chordNode.params.parse({ baseOctave: 4, maxVoices: 4, instrument: 'triangle' }));
  const params = (await replayNode(chord, { chord: symbols })).map((o) => o.params as SynthParams);

  const records: StreamRecord[] = params.map((value, i) => ({ tick: i, t: i / fps, value }));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, serializeRecords(records));
  console.log(`chord demo: ${ticks} ticks, chords ${[...new Set(symbols)].join(' ')} -> ${out}`);
}

void main();
