/**
 * CLI: turn a real-versus-air take (#247) into labelled pairs under the app-data dir.
 *
 *     npm run pair -- <take.zip | take-folder> [--out <dir>]
 *
 * A `downloads` take is a `.zip` in the browser's Downloads folder; it is extracted to
 * `~/.local/share/thoremin/takes/cue/<name>/`, and the pairs are written to
 * `~/.local/share/thoremin/datasets/cue/<stem>/` (`THOREMIN_DATA_DIR` moves the root).
 * Nothing lands in the repository. The logic is `lib_pair_take.ts`; this file only
 * parses arguments and prints (the split is why: see `trainer_take_to_fixture.ts`).
 */
import { runPairTake, summarize } from './lib_pair_take';

function main(): void {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const outFlag = args.indexOf('--out');
  const outDir = outFlag >= 0 ? args[outFlag + 1] : undefined;
  const positional = args.filter((a, i) => !a.startsWith('--') && (outFlag < 0 || i !== outFlag + 1));
  const [input] = positional;
  if (!input) {
    console.error('usage: npm run pair -- <take.zip | take-folder> [--out <dir>]');
    process.exit(2);
    return;
  }
  const { outDir: where, result, written } = runPairTake(input, { outDir });
  for (const line of summarize(result)) console.log(line);
  console.log(`wrote ${written.length} files to ${where}`);
}

main();
