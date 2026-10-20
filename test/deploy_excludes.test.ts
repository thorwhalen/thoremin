/**
 * Nothing the app serves may live under a path segment that the deploy leaves behind.
 *
 * `app.toml` has `[deploy] exclude = ["media", "wips"]`: tw_platform passes each as an UNANCHORED
 * rsync `--exclude`, so ANY file or folder named like one, at any depth, is never copied to the
 * served app directory (the exclude protects the server from ~300 MB of a laptop's working files).
 * An asset under such a folder builds fine and then answers the SPA fallback page in production:
 * the player guide's pictures lived in `public/guide/media/` and showed nothing once deployed. So
 * this guard walks what the build serves (`public/`, and the build output `frontend/` when it
 * exists) and fails on a path segment that matches an exclude pattern. Do NOT remove an exclude
 * from `app.toml` to make this pass: rename the folder (the guide's pictures are `pics/`).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');

/** `[deploy] exclude = [...]` of app.toml, as the patterns rsync receives. */
function deployExcludes(): string[] {
  const toml = readFileSync(join(ROOT, 'app.toml'), 'utf8');
  const section = toml.split(/^\[deploy\]\s*$/m)[1]?.split(/^\[/m)[0] ?? '';
  const m = section.match(/^exclude\s*=\s*\[([^\]]*)\]/m);
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
}

/** rsync's glob for one path segment: `*` and `?` and `[...]`, anchored to the whole segment. */
function segmentMatches(pattern: string, segment: string): boolean {
  const re = pattern.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
  return new RegExp(`^${re}$`).test(segment);
}

function walk(dir: string, base = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const rel = base ? `${base}/${name}` : name;
    return statSync(join(dir, name)).isDirectory() ? [rel, ...walk(join(dir, name), rel)] : [rel];
  });
}

describe('the deploy excludes', () => {
  const patterns = deployExcludes();

  it('app.toml lists the excludes this guard reads', () => {
    expect(patterns.length, 'could not read [deploy] exclude from app.toml').toBeGreaterThan(0);
  });

  for (const root of ['public', 'frontend']) {
    it.runIf(existsSync(join(ROOT, root)))(`nothing under ${root}/ has a path segment the deploy excludes`, () => {
      const bad = walk(join(ROOT, root)).filter((p) => p.split('/').some((seg) => patterns.some((pat) => segmentMatches(pat, seg))));
      expect(
        bad.slice(0, 10),
        `${root}/ has paths the deploy would not ship (app.toml [deploy] exclude = ${JSON.stringify(patterns)}, an unanchored rsync --exclude): ${bad.slice(0, 5).join(', ')}. ` +
          'They would be missing in production (the app answers its fallback page). Rename the folder; do not change app.toml.',
      ).toEqual([]);
    });
  }
});
