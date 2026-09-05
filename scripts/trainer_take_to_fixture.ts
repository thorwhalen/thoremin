/**
 * Turn a recorded trainer take into a committed replay fixture (#160 / #163 / #146).
 *
 * A training take is the cheapest ground truth this repo can produce. The trainer asks
 * the player, in the player's own words, to do one thing ("look to your left"), records
 * the clean camera, the feature vectors and a cue interval per instruction — all on one
 * clock. That last part is what no video clip can supply: `test/fixtures/video_head_pose`
 * settled pitch, smile and brow but had to leave **yaw and roll open**, because a file's
 * own metadata cannot say whether the recording was mirrored, so "the person turned to
 * *their* left" is unrecoverable from the pixels. A cue asks for it directly.
 *
 * This script is the join. It reads a take folder, resolves the cue intervals through
 * taglog's own {@link resolveIntervals} (not a private re-implementation), slices each
 * recorded edge to the ticks that fall inside a cue, and writes a fixture directory that
 * `test/helpers/fixtures.ts` can load unchanged.
 *
 * ## Three things it refuses to do
 *
 * 1. **Emit face-mesh landmarks.** A 478-point mesh is facial geometry; blendshape
 *    coefficients and a head-pose triple are not, and neither reconstructs a face. The
 *    committed `video_head_pose` fixture already strips them by hand for exactly this
 *    reason. Here it is enforced: any value carrying a `landmarks` array is rejected
 *    outright rather than trimmed, because a converter that silently drops a field is a
 *    converter nobody checks. (`trainerTakeSession` now also pins `featureEdges` so the
 *    mesh never reaches the take in the first place — this is the second line of defence,
 *    and it is the one that guards what enters the repo.)
 * 2. **Write outside `test/fixtures/`.** The output name is a bare scenario name, not a
 *    path.
 * 3. **Invent a clock.** Every emitted record keeps the take's own `tick` and `t`, so the
 *    streams stay mutually aligned and joinable back to the source take.
 *
 * ## Usage
 *
 *     npx vite-node scripts/trainer_take_to_fixture.ts -- <take-dir> <scenario> [--dry-run]
 *
 * `<take-dir>` is an unzipped take folder holding `<stem>.features.jsonl`,
 * `<stem>.annotations.jsonl` and `<stem>.manifest.json`. `<scenario>` becomes
 * `test/fixtures/<scenario>/`.
 */
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { gzipSync } from 'node:zlib';
import { resolveIntervals } from '@/taglog/affordances/resolve';
import type { EdgeEvent, ResolvedInterval, TagKind, TagStatus } from '@/taglog/affordances/schema';

/** Gzip anything at or above this many bytes, mirroring the existing committed fixtures. */
const GZIP_THRESHOLD_BYTES = 200_000;

/** One line of `features.jsonl`, as written by `FeatureJsonlTap`. */
interface FeatureLine {
  tick: number;
  t: number;
  key: string;
  value: unknown;
}

/** One emitted fixture line — the `StreamRecord` shape `valuesFromNDJSON` reads. */
interface StreamRecordOut {
  tick: number;
  t: number;
  value: unknown;
}

/** The take's annotation anchor (first line of `annotations.jsonl`). */
interface Anchor {
  anchor: true;
  t: number;
  session: string;
  schema: string;
  wallClockISO: string;
}

export interface CueWindow {
  /** The cue id, with taglog's `cue:` prefix stripped. */
  cue: string;
  /** Interval start/end as offsets into the take, seconds (`t - t0`). */
  start: number;
  end: number;
  /** Absolute engine-clock times, as recorded. */
  startAbs: number;
  endAbs: number;
  /** True if the take ended before the cue closed. */
  openEnded: boolean;
}

export interface ConvertResult {
  scenario: string;
  stem: string;
  t0: number;
  cues: CueWindow[];
  /** Per-edge: how many records survived the cue slice, out of how many were recorded. */
  streams: { key: string; kept: number; total: number; bytes: number; gzipped: boolean }[];
  verdicts: { cue: string; outcome: string; t: number }[];
}

/** A JSONL parse that reports the line number, because a truncated take is a real case. */
function* parseJsonl<T>(text: string, what: string): Generator<T> {
  let n = 0;
  for (const line of text.split('\n')) {
    n++;
    const s = line.trim();
    if (!s) continue;
    try {
      yield JSON.parse(s) as T;
    } catch (err) {
      throw new Error(`${what}: line ${n} is not JSON (${err instanceof Error ? err.message : String(err)})`);
    }
  }
}

/**
 * The one thing that must never pass. Recursively true if `v` carries a `landmarks`
 * array — the 478-point face mesh, or a hand's 21-point keypoint list under that name.
 * Deliberately a *detector*, not a stripper: see the module docstring.
 */
export function carriesLandmarks(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(carriesLandmarks);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.landmarks) || Array.isArray(o.keypoints)) return true;
    return Object.values(o).some(carriesLandmarks);
  }
  return false;
}

/** Find the take's stem from the files present, so the caller need not repeat it. */
export function findStem(dir: string): string {
  const names = readdirSync(dir);
  const feat = names.find((n) => n.endsWith('.features.jsonl'));
  if (!feat) {
    throw new Error(
      `${dir}: no *.features.jsonl. Is this an unzipped take folder? A 'downloads' take is a .zip — unzip it first.`,
    );
  }
  return basename(feat, '.features.jsonl');
}

/**
 * Turn the take's annotation rows into taglog {@link EdgeEvent}s so
 * {@link resolveIntervals} can pair opens with closes. The rows already carry every
 * field an EdgeEvent needs except `kind`, which the tag id determines: the trainer
 * writes intervals as `cue:<id>` and everything else as points (`annotations.ts`).
 */
export function edgeEventsFromRows(rows: readonly Record<string, unknown>[]): EdgeEvent[] {
  return rows.map((r) => {
    const tag = String(r.tag);
    const status = String(r.status) as TagStatus;
    const kind: TagKind = tag.startsWith('cue:') ? 'interval' : 'point';
    return {
      tag,
      kind,
      status,
      t: Number(r.t),
      tCorrected: Number(r.tCorrected ?? r.t),
      seq: Number(r.seq),
      clock: (r.clock ?? 'media') as EdgeEvent['clock'],
      src: (r.src ?? 'auto') as EdgeEvent['src'],
    };
  });
}

/**
 * Cue windows from resolved intervals, take-relative.
 *
 * **An open-ended cue extends to `Infinity`, not to its own start.** `resolveIntervals`
 * gives an unclosed open `end === start` when it is not told when the recording stopped
 * (`options.endT`) — a zero-length interval. Taking that literally would silently discard
 * every sample of the cue the take stopped during, which is the one cue whose data a
 * crashed or abandoned take still has. Semantically the cue *was still running* when the
 * recording ended, so every later record belongs to it. {@link sealOpenEnded} then
 * replaces the sentinel with the last time actually observed, so `cues.json` reports a
 * real number rather than `null`.
 */
export function cueWindows(intervals: readonly ResolvedInterval[], t0: number): CueWindow[] {
  return intervals
    .filter((iv) => iv.kind === 'interval' && iv.tag.startsWith('cue:'))
    .map((iv) => ({
      cue: iv.tag.slice('cue:'.length),
      start: iv.start - t0,
      end: iv.openEnded ? Infinity : iv.end - t0,
      startAbs: iv.start,
      endAbs: iv.openEnded ? Infinity : iv.end,
      openEnded: iv.openEnded,
    }))
    .sort((a, b) => a.start - b.start);
}

/**
 * Replace the `Infinity` end of any open-ended window with the last record time actually
 * seen, so the emitted index carries a real duration. Mutates in place, after the pass.
 */
export function sealOpenEnded(windows: CueWindow[], lastT: number, t0: number): void {
  for (const w of windows) {
    if (!Number.isFinite(w.endAbs)) {
      w.endAbs = Math.max(lastT, w.startAbs);
      w.end = w.endAbs - t0;
    }
  }
}

/** True if an absolute time falls inside any cue window (inclusive of both ends). */
export function insideAnyCue(tAbs: number, windows: readonly CueWindow[]): boolean {
  return windows.some((w) => tAbs >= w.startAbs && tAbs <= w.endAbs);
}

export interface ConvertOptions {
  /** Write nothing; just report what would be written. */
  dryRun?: boolean;
  /** Where `test/fixtures` lives (injected so tests can point at a temp dir). */
  fixturesRoot: string;
}

/**
 * Convert one take folder into one fixture directory. Pure enough to unit-test: the only
 * side effects are the writes, and `dryRun` removes those.
 */
export function convertTake(takeDir: string, scenario: string, opts: ConvertOptions): ConvertResult {
  if (!/^[a-z0-9_]+$/.test(scenario)) {
    throw new Error(`scenario "${scenario}" must be lowercase letters, digits and underscores — it becomes a directory name`);
  }
  const stem = findStem(takeDir);

  const annPath = join(takeDir, `${stem}.annotations.jsonl`);
  if (!existsSync(annPath)) {
    throw new Error(
      `${annPath} is missing. A take without annotations carries no cue intervals, and the cue intervals are the entire point of this conversion.`,
    );
  }
  const annRows = [...parseJsonl<Record<string, unknown>>(readFileSync(annPath, 'utf8'), annPath)];
  const anchor = annRows[0] as unknown as Anchor;
  if (!anchor || anchor.anchor !== true || typeof anchor.t !== 'number') {
    throw new Error(`${annPath}: first line must be the anchor record carrying t0`);
  }
  const t0 = anchor.t;

  const events = edgeEventsFromRows(annRows.slice(1));
  const windows = cueWindows(resolveIntervals(events), t0);
  if (windows.length === 0) {
    throw new Error(`${annPath}: no cue intervals resolved — nothing to slice by`);
  }
  const verdicts = events
    .filter((e) => e.status === 'point' && e.tag.startsWith('verdict:'))
    .map((e) => {
      const w = windows.filter((x) => e.t >= x.startAbs && e.t <= x.endAbs).pop();
      return { cue: w?.cue ?? '(outside any cue)', outcome: e.tag.slice('verdict:'.length), t: e.t - t0 };
    });

  // Group the feature stream by edge key, keeping only ticks inside a cue.
  const featPath = join(takeDir, `${stem}.features.jsonl`);
  if (!existsSync(featPath)) throw new Error(`${featPath} is missing`);
  const byKey = new Map<string, StreamRecordOut[]>();
  const totals = new Map<string, number>();
  let lastT = t0;
  for (const line of parseJsonl<FeatureLine>(readFileSync(featPath, 'utf8'), featPath)) {
    totals.set(line.key, (totals.get(line.key) ?? 0) + 1);
    if (line.t > lastT) lastT = line.t;
    if (carriesLandmarks(line.value)) {
      throw new Error(
        `${featPath}: edge "${line.key}" carries a landmarks/keypoints array. Face-mesh and hand-keypoint geometry must not enter a committed fixture. ` +
          `Re-record the take on a build where trainerTakeSession pins featureEdges (it records only the derived feature vectors), or drop the edge before converting.`,
      );
    }
    if (!insideAnyCue(line.t, windows)) continue;
    const arr = byKey.get(line.key) ?? [];
    arr.push({ tick: line.tick, t: line.t, value: line.value });
    byKey.set(line.key, arr);
  }
  if (byKey.size === 0) {
    throw new Error(`${featPath}: no feature records fell inside a cue interval — check that the take and its annotations share a clock`);
  }
  sealOpenEnded(windows, lastT, t0);

  const outDir = join(opts.fixturesRoot, scenario);
  if (!opts.dryRun) mkdirSync(outDir, { recursive: true });

  const streams: ConvertResult['streams'] = [];
  for (const [key, records] of [...byKey].sort(([a], [b]) => a.localeCompare(b))) {
    // Compact + stable key order, matching the committed `face.pose.ndjson.gz` serializer.
    const text = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
    const raw = Buffer.from(text, 'utf8');
    const gzipped = raw.byteLength >= GZIP_THRESHOLD_BYTES;
    // Node's gzipSync writes a zero MTIME in the gzip header and is byte-reproducible
    // across runs and machines (verified), which is what lets the committed .gz be
    // diffed and re-generated without spurious churn. The Python-generated fixtures
    // pass `mtime=0` explicitly for the same reason.
    const bytes = gzipped ? gzipSync(raw) : raw;
    if (!opts.dryRun) writeFileSync(join(outDir, `${key}.ndjson${gzipped ? '.gz' : ''}`), bytes);
    streams.push({ key, kept: records.length, total: totals.get(key) ?? 0, bytes: bytes.byteLength, gzipped });
  }

  const result: ConvertResult = { scenario, stem, t0, cues: windows, streams, verdicts };
  if (!opts.dryRun) {
    writeFileSync(join(outDir, 'cues.json'), JSON.stringify({ t0, cues: windows, verdicts }, null, 2) + '\n');
    writeFileSync(join(outDir, 'meta.json'), JSON.stringify(metaFor(result, takeDir), null, 2) + '\n');
    writeFileSync(join(outDir, 'README.md'), readmeFor(result));
  }
  return result;
}

/** Provenance, in the shape the other fixtures use. Never carries a local path. */
function metaFor(r: ConvertResult, takeDir: string): Record<string, unknown> {
  const manifestPath = join(takeDir, `${r.stem}.manifest.json`);
  let manifest: Record<string, unknown> | null = null;
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    } catch {
      manifest = null;
    }
  }
  return {
    scenario: r.scenario,
    source: 'trainer-take',
    // The stem is a timestamp, not a path — safe to commit, and it is the only way to
    // correlate a fixture back to the take it came from.
    takeStem: r.stem,
    t0: r.t0,
    cues: r.cues.map((c) => c.cue),
    recordedKeys: r.streams.map((s) => s.key),
    frames: Object.fromEntries(r.streams.map((s) => [s.key, s.kept])),
    fps: (manifest?.fps as number | undefined) ?? null,
    converterVersion: 1,
  };
}

/** A provenance README, following `test/fixtures/video_head_pose/README.md`. */
function readmeFor(r: ConvertResult): string {
  const rows = r.cues
    .map((c) => {
      const v = r.verdicts.find((x) => x.cue === c.cue);
      return `| \`${c.cue}\` | ${c.start.toFixed(2)} – ${c.end.toFixed(2)} s | ${(c.end - c.start).toFixed(2)} s | ${v ? v.outcome : '—'}${c.openEnded ? ' (open-ended)' : ''} |`;
    })
    .join('\n');
  const streamRows = r.streams
    .map((s) => `| \`${s.key}\` | ${s.kept} / ${s.total} | ${(s.bytes / 1024).toFixed(1)} KB${s.gzipped ? ' (gz)' : ''} |`)
    .join('\n');
  return `# \`${r.scenario}\` — a trainer take, sliced by cue

Generated by \`scripts/trainer_take_to_fixture.ts\` from a recorded training take.
**Do not hand-edit** — re-run the converter instead.

## Why a trainer take and not a clip

The cue is the ground truth. \`test/fixtures/video_head_pose/README.md\` records why yaw
and roll stayed open after #161: a clip's metadata cannot say whether it was mirrored, so
"the person turned to *their* left" is unrecoverable from the file. A cue asks the player
for that directly, in their own frame of reference, and the interval says exactly when
they did it.

## What is in here

Each \`<nodeId>.<port>.ndjson[.gz]\` is a \`StreamRecord\` stream — \`{tick, t, value}\`
per line, loadable with \`loadStream('${r.scenario}', '<nodeId>.<port>')\`. Only records
whose \`t\` falls inside a cue interval are kept; the dead time between cues is dropped.
The take's own \`tick\`/\`t\` are preserved, so the streams stay mutually aligned.

| stream | records kept / recorded | size |
|---|---|---|
${streamRows}

**No landmark or keypoint geometry.** The converter rejects any take carrying it rather
than trimming it, and \`trainerTakeSession\` pins the recorded edges to the derived feature
vectors so it never reaches the take.

## The cues

Times are seconds from \`t0\` (\`cues.json\` carries \`t0\` and the absolute times).

| cue | window | held | verdict |
|---|---|---|---|
${rows}

## Regenerating

Record a take through the trainer, unzip it, then:

\`\`\`
npx vite-node scripts/trainer_take_to_fixture.ts -- <take-dir> ${r.scenario}
\`\`\`
`;
}

/** CLI. Kept below the exports so the module stays importable by tests. */
function main(argv: string[]): void {
  const args = argv.filter((a) => a !== '--');
  const dryRun = args.includes('--dry-run');
  const positional = args.filter((a) => !a.startsWith('--'));
  const [takeDir, scenario] = positional;
  if (!takeDir || !scenario) {
    console.error('usage: vite-node scripts/trainer_take_to_fixture.ts -- <take-dir> <scenario> [--dry-run]');
    process.exit(2);
    return;
  }
  const fixturesRoot = join(process.cwd(), 'test', 'fixtures');
  const r = convertTake(takeDir, scenario, { dryRun, fixturesRoot });
  const where = join('test', 'fixtures', scenario);
  console.log(`${dryRun ? '[dry run] would write' : 'wrote'} ${where}/`);
  console.log(`  take   ${r.stem}  (t0 = ${r.t0})`);
  console.log(`  cues   ${r.cues.length}: ${r.cues.map((c) => c.cue).join(', ')}`);
  for (const s of r.streams) {
    console.log(`  stream ${s.key}: ${s.kept}/${s.total} records, ${(s.bytes / 1024).toFixed(1)} KB${s.gzipped ? ' gz' : ''}`);
  }
}

// vite-node runs this as the entry module; a test importing it must not trigger the CLI.
if (process.argv[1] && process.argv[1].includes('trainer_take_to_fixture')) {
  main(process.argv.slice(2));
}
