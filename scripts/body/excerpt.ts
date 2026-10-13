/**
 * Cut a body fixture's window out of a whole clip's pose stream, with its reference
 * grid (#373). The grid is taken on the WHOLE clip and then cut, so the stroke
 * detector's warm-up and an excerpt's first beats are not lost.
 *
 * Usage: npx vite-node scripts/body/excerpt.ts -- <pose.ndjson.gz> <out.ndjson.gz> --from S --to S
 *          --beats <beats.json | stroke> --bpb N --meta-out <extra.json> [--provenance <json file>]
 *
 * `--beats stroke` takes the grid from the beating wrist (`strokeGrid`); a JSON file is
 * `scripts/body/audio_beats.py`'s output. `--provenance` is merged into the extra meta
 * (the clip's licence, source URL, author). The extra meta then goes to
 * `scripts/build_body_fixture.ts --meta`. Inputs and outputs live in the app-data dir;
 * only the fixture is committed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { parseRecords, serializeRecords, type StreamRecord } from '@thoremin/dag';
import type { BodyFrame } from '@thoremin/sdk/nodes/domain';
import { beatingWrist, strokeGrid } from './lib_clips';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const [src, out] = process.argv.slice(2).filter((a) => a !== '--');
  const from = Number(arg('--from'));
  const to = Number(arg('--to'));
  const beatsArg = arg('--beats');
  const metaOut = arg('--meta-out');
  if (!src || !out || !Number.isFinite(from) || !Number.isFinite(to) || !beatsArg || !metaOut) {
    console.error('usage: excerpt.ts <pose.ndjson.gz> <out.ndjson.gz> --from S --to S --beats <file|stroke> --bpb N --meta-out <extra.json> [--provenance <json>]');
    process.exit(1);
  }
  const recs = parseRecords(gunzipSync(readFileSync(src)).toString('utf8'));
  const fps = Math.round((1 / (recs[1].t - recs[0].t)) * 1000) / 1000;
  const frames = recs.map((r) => r.value) as BodyFrame[];
  const wrist = beatsArg === 'stroke' ? beatingWrist(frames) : undefined;
  const beats = wrist ? strokeGrid(frames, fps, wrist) : (JSON.parse(readFileSync(beatsArg, 'utf8')) as { beats: number[] }).beats;
  const beatsSource = wrist
    ? `the conductor's own strokes: ictus's stroke detector (createIctusDetector, defaults, yDown) on the ${wrist} wrist over the whole clip`
    : (JSON.parse(readFileSync(beatsArg, 'utf8')) as { source?: string }).source ?? beatsArg;

  const kept = recs.filter((r) => r.t >= from - 1e-9 && r.t < to - 1e-9);
  const t0 = kept[0].t;
  const cut: StreamRecord[] = kept.map((r, i) => ({ tick: i, t: Math.round((i / fps) * 1e6) / 1e6, value: r.value }));
  writeFileSync(out, gzipSync(Buffer.from(serializeRecords(cut)), { level: 9 }));

  const provenance = arg('--provenance') ? (JSON.parse(readFileSync(arg('--provenance')!, 'utf8')) as Record<string, unknown>) : {};
  const extra = {
    ...provenance,
    excerpt: { fromS: from, toS: to },
    grid: {
      source: beatsSource,
      ...(wrist ? { wrist, reference: true } : {}),
      beatsPerBar: Number(arg('--bpb') ?? 4),
      beats: beats.filter((b) => b >= t0 && b < t0 + cut.length / fps).map((b) => Math.round((b - t0) * 1e4) / 1e4),
    },
  };
  writeFileSync(metaOut, JSON.stringify(extra, null, 2) + '\n');
  console.log(`${cut.length} frames (${from}..${to} s), ${extra.grid.beats.length} grid beats -> ${out}, ${metaOut}`);
}

main();
