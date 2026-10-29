/**
 * Core alone ships no extension code: build the app from `extensions.core.json` (no
 * extensions) into a temporary directory and fail if
 *
 *  1. any module of an extension (under `src/extensions/` other than the list module, under
 *     `src/slices/` (a built-in feature's slice, #600 Phase E), under
 *     `packages/ext-*`, or an installed `node_modules/@thoremin/ext-*`) is in the build's module graph (read from the bundle itself, so a core file importing an extension's library
 *     helper is caught even when nothing of it survives as a string), or
 *  2. any node type, branch id or dial kind of a shipped extension appears in the JS (a copy
 *     of an extension's identifiers living in core).
 *
 * Then it builds the PROBE extensions alone (`test/fixtures/ext-probe/extensions.probe.json`,
 * #600 S1) and fails unless both probes, eager and lazy, are in that bundle and nothing of the
 * shipped extensions is: an extension from outside the shipped list builds through the same seams.
 *
 * The type-level half of the guard is `npm run typecheck:core`; the runtime half is the test
 * suite run with the same manifest. Together they are `npm run test:core`. Core still names a
 * few extension concepts as strings (the overlay's `airDrumConfig` port kind), which carry no
 * extension code and are listed in the ADR as the remaining hand-listed remnants.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build, type Plugin } from 'vite';
import { AIR_EXTENSION } from '@thoremin/ext-air';
import { HARMONY_EXTENSION } from '@thoremin/ext-harmony';
import { ASL_EXTENSION } from '@thoremin/ext-asl';
import { DRAWN_EXTENSION } from '@thoremin/ext-draw';
import { FACES_EXTENSION } from '@thoremin/ext-faces';
import { PATCHER_EXTENSION } from '@thoremin/ext-patcher';
import { MIDI_EXTENSION } from '../src/slices/midi';
import { GENERATIVE_EXTENSION } from '../src/slices/generative';
import { SONG_EXTENSION } from '../src/slices/song';
import { BODY_EXTENSION } from '../src/slices/body';
import { CONDUCTOR_EXTENSION } from '../src/slices/conductor';
import { LAB_EXTENSION } from '../src/slices/lab';
import { PHYSICAL_THEREMIN_EXTENSION } from '../src/slices/theremin';
import { SOUND_MAPPER_EXTENSION } from '../src/slices/sound-mapper';
import { GAMES_EXTENSION } from '../src/slices/games';
import { TRAINER_EXTENSION } from '../src/slices/trainer';
import type { Extension } from '@thoremin/sdk/instruments/extension';
import { PROBE_EXTENSION } from '../test/fixtures/ext-probe/index';
import { PROBE_LAZY_EXTENSION } from '../test/fixtures/ext-probe/lazy_stub';
import { CORE_MANIFEST, readExtensionEntries } from '../vite.extensions';

const SHIPPED: readonly Extension[] = [AIR_EXTENSION, HARMONY_EXTENSION as unknown as Extension, ASL_EXTENSION, DRAWN_EXTENSION as unknown as Extension, FACES_EXTENSION, PATCHER_EXTENSION, MIDI_EXTENSION as unknown as Extension, GENERATIVE_EXTENSION as unknown as Extension, SONG_EXTENSION as unknown as Extension, BODY_EXTENSION as unknown as Extension, CONDUCTOR_EXTENSION as unknown as Extension, LAB_EXTENSION as unknown as Extension, TRAINER_EXTENSION as unknown as Extension, PHYSICAL_THEREMIN_EXTENSION as unknown as Extension, SOUND_MAPPER_EXTENSION as unknown as Extension, GAMES_EXTENSION as unknown as Extension];

if (readExtensionEntries(CORE_MANIFEST).length !== 0) throw new Error(`${CORE_MANIFEST} must list no extensions`);
const shippedIds = readExtensionEntries('extensions.json').map((e) => e.id);
const unchecked = shippedIds.filter((id) => !SHIPPED.some((e) => e.id === id));
if (unchecked.length) throw new Error(`check_core_bundle: add ${unchecked.join(', ')} to SHIPPED so its identifiers are checked`);

/** The probe extensions' manifest (#600 S1): an extension from OUTSIDE the shipped list. */
const PROBE_MANIFEST = 'test/fixtures/ext-probe/extensions.probe.json';
const PROBE_ALIAS = { '@thoremin-probe': resolve('test/fixtures/ext-probe') };

/** Build the app from `manifest`; return the extension modules in its module graph and its JS. */
async function buildWith(manifest: string, alias: Record<string, string> = {}): Promise<{ extensionModules: Set<string>; probeModules: Set<string>; js: string }> {
  process.env.THOREMIN_EXTENSIONS = manifest;
  const out = mkdtempSync(join(tmpdir(), 'thoremin-core-'));
  try {
    const extensionModules = new Set<string>();
    const probeModules = new Set<string>();
    const moduleGraph: Plugin = {
      name: 'check-core-bundle',
      generateBundle(_options, bundle) {
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== 'chunk') continue;
          for (const id of Object.keys(chunk.modules)) {
            const path = id.replace(/\\/g, '/');
            const inTree = path.split('/src/extensions/')[1];
            if (inTree !== undefined && inTree !== 'index.ts') extensionModules.add(`src/extensions/${inTree}`);
            // A built-in feature's slice (#600 Phase E) is an extension too.
            const slice = path.split('/src/slices/')[1];
            if (slice !== undefined) extensionModules.add(`src/slices/${slice}`);
            const pkg = path.match(/\/packages\/(ext-[^/]+\/.*)$/);
            if (pkg) extensionModules.add(`packages/${pkg[1]}`);
            // An extension that is its own repository, installed as a dependency.
            const installed = path.match(/\/node_modules\/(@thoremin\/ext-[^/]+\/.*)$/);
            if (installed) extensionModules.add(`node_modules/${installed[1]}`);
            const probe = path.match(/\/test\/fixtures\/ext-probe\/(.*)$/);
            if (probe) probeModules.add(probe[1]);
          }
        }
      },
    };
    await build({ build: { outDir: out, emptyOutDir: true }, logLevel: 'warn', plugins: [moduleGraph], resolve: { alias } });
    const js = readdirSync(join(out, 'assets'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(join(out, 'assets', f), 'utf8'))
      .join('\n');
    return { extensionModules, probeModules, js };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

const needles = SHIPPED.flatMap((e) => [
  // An eager extension's node types are its nodes'; a lazy one's are the types it `provides`.
  ...[...(e.nodes ?? []).map((n) => n.type), ...(e.provides ?? [])].map((t) => `"${t}"`),
  ...e.branches.map((b) => `"${b.id}"`),
  ...e.dials.map((d) => `"${d.kind}"`),
]);
// A port KIND core still names as a string (the overlay reads the drum's config) is not code.
// `"conductor"` is also a common word core says for other things (a tool id an entry point is
// `from`, the SDK's chord clock and pose vocabulary), and the core `score` node still reads the
// conductor dial's kind on its `config` port (#600 S18b).
const allowed = new Set(['"air-drum-config"', '"conductor"', '"conductor-config"']);

/** Fail when a build carries a shipped extension's module or identifier. */
function assertNoShipped(label: string, extensionModules: Set<string>, js: string): void {
  if (extensionModules.size) {
    console.error(`${label} bundle contains extension modules: ${[...extensionModules].sort().join(', ')}`);
    process.exit(1);
  }
  const leaked = needles.filter((n) => js.includes(n) && !allowed.has(n));
  if (leaked.length) {
    console.error(`${label} bundle carries extension identifiers: ${leaked.join(', ')}`);
    process.exit(1);
  }
}

const core = await buildWith(CORE_MANIFEST);
assertNoShipped('core-alone', core.extensionModules, core.js);
console.log(`core-alone bundle: no extension module, none of ${needles.length} extension identifiers (${(core.js.length / 1024).toFixed(0)} kB of JS)`);

// The probes alone (#600 S1): an extension from outside the shipped list builds through the same
// seams, its eager and lazy halves are in the bundle, and nothing of the shipped ones is.
const probe = await buildWith(PROBE_MANIFEST, PROBE_ALIAS);
assertNoShipped('probe-only', probe.extensionModules, probe.js);
const probeNeedles = [...PROBE_EXTENSION.nodes!.map((n) => n.type), ...PROBE_LAZY_EXTENSION.provides!, PROBE_EXTENSION.dials[0].kind, PROBE_LAZY_EXTENSION.dials[0].kind].map((n) => `"${n}"`);
const missing = probeNeedles.filter((n) => !probe.js.includes(n));
const missingModules = ['index.ts', 'ui.tsx', 'lazy_stub.ts', 'lazy.ts', 'lazy_ui_stub.tsx', 'lazy_ui.tsx'].filter((m) => !probe.probeModules.has(m));
if (missing.length || missingModules.length) {
  console.error(`probe-only bundle lacks the probe: identifiers ${missing.join(', ') || '(none)'}; modules ${missingModules.join(', ') || '(none)'}`);
  process.exit(1);
}
console.log(`probe-only bundle: both probes (eager and lazy, ${probe.probeModules.size} modules), no shipped extension`);
