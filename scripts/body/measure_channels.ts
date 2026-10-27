/**
 * Channel-by-level measurement over the body fixtures (#373, body-movement A1): prints
 * the tables of `docs/research/body-conducting-and-pose-categories.md` and writes every
 * cell to a CSV.
 *
 * Usage: npx vite-node scripts/body/measure_channels.ts -- [--csv out.csv] [scenario ...]
 *        npx vite-node scripts/body/measure_channels.ts -- --pose <pose.ndjson.gz> --beats <beats.json> [--bpb 4]
 *        (the second form vets a clip before it becomes a fixture: `video_to_pose.py`'s
 *        output and `audio_beats.py`'s JSON, both in the app-data dir)
 *        npx vite-node scripts/body/measure_channels.ts -- --root <dir> [--summary] [--csv out.csv]
 *        (every fixture-shaped folder under `dir`: a corpus exported outside the repository,
 *        such as terpsi's clips, #861; `--summary` prints only the across-clips tables)
 *
 * A scenario is a fixture name or a path to a fixture-shaped folder (`lib_clips.loadClip`).
 *
 * With no scenario, every `test/fixtures/video_body_*` whose `meta.json` carries a grid
 * (`grid.beats`, the music's beats in the excerpt's own seconds) or a stated tempo
 * (`music.bpm`; the phase is then unknown and only the phase-free scores mean anything),
 * plus the synthetic control (`synthetic`, a skeleton with a known bounce, step and
 * sway and tracker-sized noise; `lib_clips.ts`).
 */
import { readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { measureClip, extractChannels, pulseSummary, bestCell, meterReading, medianBeatS, chanceFLag, type CellResult } from './lib_channels';
import { FIXTURES, loadClip, adHocClip, syntheticClip, clipDirs, type BodyClip } from './lib_clips';

const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '-');

function table(clip: BodyClip, cells: readonly CellResult[]): string {
  const levels = ['beat', 'half-bar', 'bar'] as const;
  const channels = [...new Set(cells.map((c) => c.channel))];
  const lines = [
    `### ${clip.name}${clip.phaseKnown ? '' : ' (stated tempo, phase unknown: F is after the lag)'}`,
    '',
    '| channel | ' + levels.map((l) => `${l} F | ${l} F (lag) | ${l} R`).join(' | ') + ' |',
    '|---|' + levels.map(() => '---:|---:|---:').join('|') + '|',
  ];
  for (const ch of channels) {
    const row = levels.map((l) => {
      // The best event for this channel and level by the Rayleigh p (many anchors, all
      // in phase; R alone favours a sparse set), the event printed.
      if (!cells.some((c) => c.channel === ch && c.level === l)) return '- | - | -';
      const best = bestCell(cells, ch, l);
      const tag = best.event === 'multi' ? '' : ` ${best.event[0]}`;
      const sig = best.score.p < 0.001 ? '**' : best.score.p < 0.01 ? '*' : '';
      return `${clip.phaseKnown ? f2(best.score.f) : '-'} | ${f2(best.score.fLag)} | ${f2(best.score.r)}${sig} (${best.score.n})${tag}`;
    });
    const side = clip.referenceWrist === 'left' ? 'l' : 'r';
    const note = !clip.referenceWrist ? '' : ch === `wrist.${side}` ? ' (the grid)' : ch === `elbow.${side}` ? ' (same arm)' : '';
    lines.push(`| ${ch}${note} | ${row.join(' | ')} |`);
  }
  const chance = chanceFLag(clip.grid, 0, (clip.frames.length - 1) / clip.fps);
  lines.push('', `Chance at the beat (random anchors, one per beat, 200 draws): F after the lag median ${f2(chance.median)}, 95th percentile ${f2(chance.p95)}.`);
  return lines.join('\n');
}

function pulseTable(clip: BodyClip): string {
  const dt = 1 / clip.fps;
  const t = clip.frames.map((_, i) => i * dt);
  const beatS = medianBeatS(clip.grid);
  const lines = ['| channel | trusted | strength | level (beats) | share |', '|---|---:|---:|---:|---:|'];
  for (const ch of extractChannels(clip.frames, clip.fps)) {
    const s = pulseSummary(ch.y, t, beatS);
    lines.push(`| ${ch.id} | ${f2(s.trusted)} | ${f2(s.strength)} | ${Number.isFinite(s.levelBeats) ? s.levelBeats : '-'} | ${f2(s.levelShare)} |`);
  }
  return lines.join('\n');
}

function meterLine(clip: BodyClip): string {
  const beatS = medianBeatS(clip.grid);
  const m = meterReading(clip.frames, clip.fps, beatS);
  return `| ${clip.name} | ${clip.beatsPerBar} | ${m.beatChannel} ${f2(m.beatS / beatS)} (r ${f2(m.beatR)}) | ${m.barChannel} ${f2(m.barS / beatS)} (r ${f2(m.barR)}) | ${f2(m.ratio)} |`;
}

/** A channel x level locks on a clip when its best cell's Rayleigh p is under this. */
const LOCK_P = 0.01;

/** One line per channel: on how many clips it locks at each level (Rayleigh p < 0.01) and
 *  the median R of its best cell there; then the pulse follower's trust over the clips. */
function acrossClipsTable(runs: ReadonlyArray<{ clip: BodyClip; cells: readonly CellResult[] }>): string {
  const levels = ['beat', 'half-bar', 'bar'] as const;
  const channels = [...new Set(runs.flatMap((r) => r.cells.map((c) => c.channel)))];
  const lines = [
    `### Across ${runs.length} clips: clips locked (Rayleigh p < ${LOCK_P}), median R`,
    '',
    '| channel | ' + levels.map((l) => `${l} locked | ${l} R`).join(' | ') + ' | follower trusted (median) | follower level (beats, modal) |',
    '|---|' + levels.map(() => '---:|---:').join('|') + '|---:|---:|',
  ];
  const med = (xs: number[]) => {
    const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
    return v.length ? v[v.length >> 1] : NaN;
  };
  const pulses = runs.map((r) => {
    const t = r.clip.frames.map((_, i) => i / r.clip.fps);
    const beatS = medianBeatS(r.clip.grid);
    return new Map(extractChannels(r.clip.frames, r.clip.fps).map((ch) => [ch.id, pulseSummary(ch.y, t, beatS)]));
  });
  for (const ch of channels) {
    const row = levels.map((l) => {
      const best = runs.filter((r) => r.cells.some((c) => c.channel === ch && c.level === l)).map((r) => bestCell(r.cells, ch, l).score);
      if (!best.length) return '- | -';
      return `${best.filter((s) => s.p < LOCK_P).length}/${best.length} | ${f2(med(best.map((s) => s.r)))}`;
    });
    const ps = pulses.map((m) => m.get(ch)).filter((x): x is NonNullable<typeof x> => !!x);
    const levelCounts = new Map<number, number>();
    for (const p of ps) if (Number.isFinite(p.levelBeats)) levelCounts.set(p.levelBeats, (levelCounts.get(p.levelBeats) ?? 0) + 1);
    const modal = [...levelCounts].sort((a, b) => b[1] - a[1])[0];
    lines.push(`| ${ch} | ${row.join(' | ')} | ${ps.length ? f2(med(ps.map((p) => p.trusted))) : '-'} | ${modal ? `${modal[0]} (${modal[1]}/${ps.length})` : '-'} |`);
  }
  return lines.join('\n');
}

function main(): void {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const csvAt = args.indexOf('--csv');
  const csvPath = csvAt >= 0 ? args.splice(csvAt, 2)[1] : undefined;
  const opt = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args.splice(i, 2)[1] : undefined;
  };
  const posePath = opt('--pose');
  const beatsPath = opt('--beats');
  const bpb = Number(opt('--bpb') ?? 4);
  if (posePath && beatsPath) {
    const clip = adHocClip(posePath, beatsPath, bpb);
    const cells = measureClip(clip.frames, clip.fps, clip.grid, clip.beatsPerBar);
    console.log(table(clip, cells) + '\n');
    console.log(`Pulse follower per channel:\n\n${pulseTable(clip)}\n`);
    return;
  }
  const root = opt('--root');
  const summaryOnly = args.includes('--summary');
  if (summaryOnly) args.splice(args.indexOf('--summary'), 1);
  const names = root
    ? clipDirs(root)
    : args.length
    ? args
    : [...readdirSync(FIXTURES).filter((d) => d.startsWith('video_body_') && existsSync(join(FIXTURES, d, 'meta.json'))), 'synthetic'];
  const meter = ['| clip | stated beats per bar | beat level: channel, period in beats (ACF r) | bar level: channel, period in beats (ACF r) | ratio |', '|---|---:|---|---|---:|'];
  const csv = ['clip,channel,event,polarity,level,n,rate,f,fLag,lagS,r,p,logP,bas,cemgil'];
  const runs: Array<{ clip: BodyClip; cells: CellResult[] }> = [];
  for (const name of names) {
    const clip = name === 'synthetic' ? syntheticClip() : loadClip(name);
    const cells = measureClip(clip.frames, clip.fps, clip.grid, clip.beatsPerBar);
    runs.push({ clip, cells });
    if (!summaryOnly) {
      console.log(table(clip, cells) + '\n');
      console.log(`Pulse follower per channel (${clip.name}):\n\n${pulseTable(clip)}\n`);
    }
    meter.push(meterLine(clip));
    for (const c of cells) {
      const s = c.score;
      csv.push([clip.name, c.channel, c.event, c.polarity, c.level, s.n, s.rate, s.f, s.fLag, s.lagS, s.r, s.p, s.logP, s.bas, s.cemgil].map((v) => (typeof v === 'number' ? Number(v.toPrecision(4)) : v)).join(','));
    }
  }
  console.log(`Two levels at once (the meter):\n\n${meter.join('\n')}\n`);
  if (runs.length > 1) console.log(acrossClipsTable(runs) + '\n');
  if (csvPath) {
    writeFileSync(csvPath, csv.join('\n') + '\n');
    console.log(`wrote ${csv.length - 1} cells -> ${csvPath}`);
  }
}

main();
