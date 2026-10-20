/**
 * Build the in-app player guide: `guide/` (Markdown sources) -> `public/guide/` (static HTML that
 * Vite copies into the build, served at `<base>guide/`). The maintenance rules (when to add a
 * page, how to regenerate the pictures) are the `thoremin-dev-guide` skill.
 *
 * Usage: vite-node scripts/gen_guide.ts [--check]
 *   --check  write nothing; exit 1 if `public/guide/` differs from what the sources build
 *            (the freshness check `test/guide_pages.test.ts` runs the same comparison).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGuide } from './lib_guide';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'guide');

/** The files of `public/guide/` the builder owns (HTML and the stylesheet; `pics/` is the media script's). */
function ownedFiles(dir: string, base = ''): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const rel = base ? `${base}/${f}` : f;
    if (rel === 'pics') return [];
    return statSync(join(dir, f)).isDirectory() ? ownedFiles(join(dir, f), rel) : [rel];
  });
}

const built = buildGuide(ROOT);
const css = readFileSync(join(ROOT, 'guide', 'guide.css'), 'utf8');
const files = new Map<string, string>([...built.pages, ['guide.css', css]]);

if (built.problems.length) {
  console.error(`gen_guide: ${built.problems.length} problem(s)\n  ${built.problems.join('\n  ')}`);
  process.exit(1);
}

if (process.argv.includes('--check')) {
  const stale = [...files].filter(([p, text]) => !existsSync(join(OUT, p)) || readFileSync(join(OUT, p), 'utf8') !== text).map(([p]) => p);
  const extra = ownedFiles(OUT).filter((p) => !files.has(p));
  if (stale.length || extra.length) {
    console.error(`gen_guide: public/guide is stale (run \`npm run guide\`): ${[...stale, ...extra.map((p) => `${p} (no source)`)].join(', ')}`);
    process.exit(1);
  }
  console.log(`gen_guide: ${files.size} files up to date`);
  process.exit(0);
}

for (const p of ownedFiles(OUT)) if (!files.has(p)) rmSync(join(OUT, p));
for (const [p, text] of files) {
  mkdirSync(dirname(join(OUT, p)), { recursive: true });
  writeFileSync(join(OUT, p), text);
}
console.log(`gen_guide: ${built.pages.size} pages, ${built.media.length} media files -> public/guide/`);
