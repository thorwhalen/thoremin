/**
 * CLI: turn a recorded trainer take into a committed replay fixture (#160 / #163 / #146).
 *
 *     npx vite-node scripts/trainer_take_to_fixture.ts -- <take-dir> <scenario> [--dry-run] [--force]
 *
 * `<take-dir>` is an **unzipped** take folder holding `<stem>.features.jsonl`,
 * `<stem>.annotations.jsonl` and `<stem>.manifest.json` (a `downloads` take is a `.zip`).
 * `<scenario>` becomes `test/fixtures/<scenario>/`.
 *
 * ## Why this is a separate file from the logic
 *
 * The first version put both in one module and guarded the entry point with
 * `if (process.argv[1]?.includes('trainer_take_to_fixture'))`, so that importing it from
 * a test would not run the CLI. **That guard is always false under `vite-node`**, which
 * is the documented way to run it: `argv[1]` is
 * `node_modules/.bin/vite-node`, and the script's own path never appears in `argv` at
 * all. The result was a documented command that printed nothing and exited 0 — a tool
 * nobody could invoke, in a repo whose CLAUDE.md rule is "a feature nobody can find is
 * not shipped". It was caught by an adversarial review actually *running* the documented
 * command, which is the only check that would have caught it.
 *
 * So the split is the fix, and it is the convention already here: `lib_audio.ts` holds
 * the logic and is imported by tests, `render_audio.ts` is the CLI and calls `main()`
 * unconditionally. Nothing needs to detect whether it is the entry module, because only
 * the CLI file has a side effect.
 */
import { join } from 'node:path';
import { convertTake } from './lib_trainer_take';

function main(): void {
  // vite-node already strips the `--` separator before handing us argv, but a direct
  // `node`/`tsx` invocation does not — filter it either way rather than depend on which.
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  const positional = args.filter((a) => !a.startsWith('--'));
  const [takeDir, scenario] = positional;

  if (!takeDir || !scenario) {
    console.error('usage: vite-node scripts/trainer_take_to_fixture.ts -- <take-dir> <scenario> [--dry-run] [--force]');
    process.exit(2);
    return;
  }

  const fixturesRoot = join(process.cwd(), 'test', 'fixtures');
  const r = convertTake(takeDir, scenario, { dryRun, force, fixturesRoot });
  const where = join('test', 'fixtures', scenario);
  console.log(`${dryRun ? '[dry run] would write' : 'wrote'} ${where}/`);
  console.log(`  take   ${r.stem}  (t0 = ${r.t0})`);
  console.log(`  cues   ${r.cues.length}: ${r.cues.map((c) => c.cue).join(', ')}`);
  for (const s of r.streams) {
    console.log(`  stream ${s.key}: ${s.kept}/${s.total} records, ${(s.bytes / 1024).toFixed(1)} KB${s.gzipped ? ' gz' : ''}`);
  }
}

main();
