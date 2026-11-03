/**
 * The camera-model guard, from the source (#960 review): every node that reads the camera's video
 * declares it (`reads: READS_VIDEO`), so a new camera source cannot forget to.
 *
 * Why a source scan. The derivation (`src/instruments/camera.ts`) trusts the declaration, and a
 * test that iterates the registry's declared readers can only find the nodes that already
 * declare: it cannot see the one that forgot. So this reads the code: a NODE file (under a `nodes`
 * directory, or calling `defineNode`) in core, in any workspace package or in a shipped extension
 * that reads the video resource (`resources[VIDEO_RESOURCE_KEY]`, or the literal key
 * `resources.video` / `resources['video']`) must declare it. Comments are stripped first (the
 * TypeScript printer), so a docstring naming the key is not a read.
 *
 * Exempt by name, each with its reason:
 *  - the overlay draws the video as a backdrop only when it is there (`overlay.video.show`, a shell
 *    reader of the camera the derivation counts itself); it never NEEDS the video, so it does not
 *    declare it, or every instrument would open the camera.
 *
 * Out of scope, deliberately: host code that is not a node. `src/app/engine/latencyProbe.ts` reads
 * the same resource, but it is a probe the host attaches to describe the environment (the camera
 * track's settings for a latency report), never placed in a graph and never a reason to open the
 * camera, so there is nothing for it to declare; `useEngine` writes the resource.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { ALL_EXTENSION_DIRS } from './helpers/extensions';

const ROOT = process.cwd();

/** Node files that read the video and may leave it undeclared, by path, with the reason above. */
const EXEMPT: Readonly<Record<string, string>> = {
  'src/nodes/output/overlay/node.ts': 'the backdrop: drawn when the video is there, never needed',
};

/** Where node code lives: core, every workspace package, every shipped extension (deduplicated). */
const ROOTS = [...new Set(['src', ...readdirSync(join(ROOT, 'packages')).map((p) => join('packages', p, 'src')), ...ALL_EXTENSION_DIRS.map((e) => e.dir)])].filter((d) => existsSync(join(ROOT, d)));

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(join(ROOT, dir))) {
    const path = join(dir, name);
    if (name === 'node_modules') continue;
    if (statSync(join(ROOT, path)).isDirectory()) yield* sources(path);
    else if (/\.tsx?$/.test(name) && !/\.(test|d)\.tsx?$/.test(name)) yield path;
  }
}

/** The file's code with every comment removed. */
const code = (path: string): string =>
  ts.createPrinter({ removeComments: true }).printFile(ts.createSourceFile(path, readFileSync(join(ROOT, path), 'utf8'), ts.ScriptTarget.Latest, false, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS));

const READS_THE_VIDEO = /resources(\??\.video\b|\??\.?\[\s*(VIDEO_RESOURCE_KEY|['"]video['"])\s*\])/;
const DECLARES_IT = /reads:\s*(READS_VIDEO\b|\[[^\]]*(VIDEO_RESOURCE_KEY|['"]video['"]))/;
const isNodeFile = (path: string, text: string) => path.split(sep).includes('nodes') || /\bdefineNode\s*\(/.test(text);

/** Every node file that reads the video, with whether it declares it. */
const readers = ROOTS.flatMap((dir) => [...sources(dir)])
  .map((path) => ({ path: relative(ROOT, join(ROOT, path)).split(sep).join('/'), text: code(path) }))
  .filter(({ path, text }) => isNodeFile(path, text) && READS_THE_VIDEO.test(text))
  .map(({ path, text }) => ({ path, declares: DECLARES_IT.test(text) }));

describe('every node that reads the camera\'s video declares it', () => {
  it('finds the known camera models (the scan is not vacuous)', () => {
    const found = readers.map((r) => r.path);
    expect(found).toContain('src/nodes/sources/webcam_hands.ts');
    expect(found).toContain('src/nodes/sources/webcam_face.ts');
    for (const exempt of Object.keys(EXEMPT)) expect(found, `${exempt} is exempt by name, so it must still read the video`).toContain(exempt);
  });

  it('each one declares `reads: READS_VIDEO`, except the overlay\'s backdrop', () => {
    for (const { path, declares } of readers) {
      if (path in EXEMPT) continue;
      expect(declares, `${path} reads the video resource; declare \`reads: READS_VIDEO\` (@thoremin/sdk/sources/video)`).toBe(true);
    }
  });

  it('the scan sees the literal key too', () => {
    expect(READS_THE_VIDEO.test('const v = ctx.resources.video;')).toBe(true);
    expect(READS_THE_VIDEO.test("const v = ctx.resources['video'];")).toBe(true);
    expect(READS_THE_VIDEO.test('const v = ctx.resources[VIDEO_RESOURCE_KEY];')).toBe(true);
    expect(READS_THE_VIDEO.test('const v = ctx.resources.videoFrame;')).toBe(false);
  });
});
