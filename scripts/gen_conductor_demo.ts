/**
 * Generate a conductor-mode SynthParams stream for the audible demo: a control
 * curve (triangle: rise then fall) drives `performance → transport → score`,
 * so a fixed C-major scale speeds up + grows louder, then slows + softens —
 * accelerando/crescendo then ritardando/decrescendo, "conducted" by the curve.
 *
 * Usage: vite-node scripts/gen_conductor_demo.ts <out.params.ndjson>
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { runHeadless, serializeRecords, type GraphSpec, type StreamRecord } from '@/dag';
import { createCoreRegistry } from '@/nodes';

async function main(): Promise<void> {
  const out = process.argv[2] ?? 'media/conductor_demo.params.ndjson';
  const fps = 30;
  const ticks = fps * 12; // 12s

  // Triangle control 0 → 1 → 0.
  const ramp = Array.from({ length: ticks }, (_, i) => {
    const t = i / (ticks - 1);
    return t < 0.5 ? t * 2 : (1 - t) * 2;
  });

  const notes = [60, 62, 64, 65, 67, 69, 71, 72].map((midi, i) => ({ midi, start: i, duration: 0.9, velocity: 1 }));

  const spec: GraphSpec = {
    nodes: [
      { id: 'ctrl', type: 'replay-source', params: { values: ramp } },
      { id: 'perf', type: 'performance', params: { bpmMin: 50, bpmMax: 260, dynMin: 0.3, dynMax: 1, humanizeBpm: 3 } },
      { id: 'xport', type: 'transport' },
      { id: 'score', type: 'score', params: { notes, loopBeats: 8, baseGain: 0.4, instrument: 'triangle' } },
    ],
    edges: [
      { from: { node: 'ctrl', port: 'value' }, to: { node: 'perf', port: 'control' } },
      { from: { node: 'perf', port: 'bpm' }, to: { node: 'xport', port: 'bpm' } },
      { from: { node: 'perf', port: 'velocityScale' }, to: { node: 'score', port: 'velocityScale' } },
      { from: { node: 'xport', port: 'beat' }, to: { node: 'score', port: 'beat' } },
    ],
  };

  const { recorder } = await runHeadless(spec, createCoreRegistry(), { ticks, nominalDt: 1 / fps, recordOnly: ['score.params'] });
  const params = recorder.values('score.params');
  const records: StreamRecord[] = params.map((value, i) => ({ tick: i, t: i / fps, value }));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, serializeRecords(records));
  console.log(`conductor demo: ${ticks} ticks (12s) -> ${out}`);
}

void main();
