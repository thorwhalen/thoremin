/**
 * Channel-by-level measurement over the body fixtures (#373, body-movement A1): prints
 * the tables of `docs/research/body-conducting-and-pose-categories.md` and writes every
 * cell to a CSV.
 *
 * Usage: npx vite-node scripts/body/measure_channels.ts -- [--csv out.csv] [scenario ...]
 *
 * With no scenario, every `test/fixtures/video_body_*` whose `meta.json` carries a grid
 * (`grid.beats`, the music's beats in the excerpt's own seconds) or a stated tempo
 * (`music.bpm`; the phase is then unknown and only the phase-free scores mean anything),
 * plus the synthetic control (`synthetic`, a skeleton with a known bounce, step and
 * sway and tracker-sized noise; `lib_synthetic.ts`).
 */
import { readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { measureClip, extractChannels, pulseSummary, type CellResult } from './lib_channels';
import { FIXTURES, loadClip, syntheticClip, type BodyClip } from './lib_clips';

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
      // The best event for this channel and level, by R (the event is printed).
      const best = cells.filter((c) => c.channel === ch && c.level === l).sort((a, b) => b.score.r - a.score.r)[0];
      const tag = best.event === 'multi' ? '' : ` ${best.event[0]}`;
      return `${clip.phaseKnown ? f2(best.score.f) : '-'} | ${f2(best.score.fLag)} | ${f2(best.score.r)}${tag}`;
    });
    lines.push(`| ${ch} | ${row.join(' | ')} |`);
  }
  return lines.join('\n');
}

function pulseTable(clip: BodyClip): string {
  const dt = 1 / clip.fps;
  const t = clip.frames.map((_, i) => i * dt);
  const beatS = (clip.grid[clip.grid.length - 1] - clip.grid[0]) / (clip.grid.length - 1);
  const lines = ['| channel | trusted | strength | level (beats) | share |', '|---|---:|---:|---:|---:|'];
  for (const ch of extractChannels(clip.frames, clip.fps)) {
    const s = pulseSummary(ch.y, t, beatS);
    lines.push(`| ${ch.id} | ${f2(s.trusted)} | ${f2(s.strength)} | ${Number.isFinite(s.levelBeats) ? s.levelBeats : '-'} | ${f2(s.levelShare)} |`);
  }
  return lines.join('\n');
}

function main(): void {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const csvAt = args.indexOf('--csv');
  const csvPath = csvAt >= 0 ? args.splice(csvAt, 2)[1] : undefined;
  const names = args.length
    ? args
    : [...readdirSync(FIXTURES).filter((d) => d.startsWith('video_body_') && existsSync(join(FIXTURES, d, 'meta.json'))), 'synthetic'];
  const csv = ['clip,channel,event,polarity,level,rate,f,fLag,lagS,r,bas,cemgil'];
  for (const name of names) {
    const clip = name === 'synthetic' ? syntheticClip() : loadClip(name);
    const cells = measureClip(clip.frames, clip.fps, clip.grid, clip.beatsPerBar);
    console.log(table(clip, cells) + '\n');
    console.log(`Pulse follower per channel (${clip.name}):\n\n${pulseTable(clip)}\n`);
    for (const c of cells) {
      const s = c.score;
      csv.push([clip.name, c.channel, c.event, c.polarity, c.level, s.rate, s.f, s.fLag, s.lagS, s.r, s.bas, s.cemgil].map((v) => (typeof v === 'number' ? Number(v.toFixed(4)) : v)).join(','));
    }
  }
  if (csvPath) {
    writeFileSync(csvPath, csv.join('\n') + '\n');
    console.log(`wrote ${csv.length - 1} cells -> ${csvPath}`);
  }
}

main();
