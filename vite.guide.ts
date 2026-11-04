/**
 * The player guide for a build that lists other extensions than the public one: the committed
 * `public/guide/` is built for `extensions.json` (`scripts/gen_guide.ts`), and Vite copies it into
 * every build as it is. A build with another list (the gated DAW app's, `vite.daw.config.ts`)
 * adds this plugin, which rebuilds the guide for that list (`buildGuide`'s `extensions`: the
 * entries marked `extension:` for a listed extension come in) and writes it over the copy, after
 * the bundle is written. The pictures stay the copied ones (`public/guide/pics/`).
 *
 * A guide that does not build (a link to nothing) fails the build, as `npm run guide` would.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { buildGuide } from './scripts/lib_guide';
import { buildExports } from './scripts/lib_guide_export';

/** Rebuild the player guide for the extension ids `extensions` into the build's `guide/`. */
export function guideForExtensions(root: string, extensions: readonly string[]): Plugin {
  let outDir = '';
  return {
    name: 'thoremin-guide-for-extensions',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      const built = buildGuide(root, { extensions });
      if (built.problems.length) this.error(`the player guide for this build has ${built.problems.length} problem(s):\n  ${built.problems.join('\n  ')}`);
      const css = readFileSync(join(root, 'guide', 'guide.css'), 'utf8');
      const files = new Map<string, string>([...built.pages, ['guide.css', css], ...buildExports(built, { css })]);
      for (const [path, text] of files) {
        const target = join(outDir, 'guide', path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, text);
      }
    },
  };
}
