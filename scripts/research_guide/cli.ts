/**
 * `npm run research-guide`: build the private research guide, print the staleness
 * report, and with `--publish` hand the site to annals. Flags: `--offline` (reuse the
 * cached GitHub data), `--out DIR` (build elsewhere), `--replace <annals link>` (the
 * document to update in place; default `THOREMIN_GUIDE_ANNALS`, else the last publish
 * recorded in the guide's state). See `build.ts`.
 */
import { build, publish } from './build';

const argv = process.argv.slice(2);
const outAt = argv.indexOf('--out');
const result = build({ offline: argv.includes('--offline'), out: outAt >= 0 ? argv[outAt + 1] : undefined });
console.log(result.lines.join('\n'));
console.log(`Built the guide: ${result.out}`);
const replaceAt = argv.indexOf('--replace');
if (argv.includes('--publish')) console.log(`Published: ${publish(result, { replace: replaceAt >= 0 ? argv[replaceAt + 1] : undefined }).url}`);
