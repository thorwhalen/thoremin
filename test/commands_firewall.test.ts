/**
 * The command/hot-path import firewall (#87). thoremin lints with `tsc --noEmit`
 * (no ESLint), so the boundary the command-dispatch design requires is enforced
 * as a TEST instead of an ESLint `no-restricted-imports` rule:
 *
 *  - Nothing under `src/app/commands/` may import the hot `useControls` store, the
 *    DAG engine, the node library, or the audio synth. A command changes sound only
 *    by writing a DIAL (via `src/app/dials/`), so the real-time path can never
 *    accidentally acquire dispatch overhead.
 *  - Nothing under `src/dag/` or `src/nodes/` may import the command registry, so a
 *    per-tick / audio event can never be routed through dispatch.
 *  - The AI assistant (`src/plugins/assistant/`, #87 Phase 3) is a registry CONSUMER —
 *    it may import React / the AI SDK / the registry / the dials read-side freely, but
 *    it must reach SOUND only by dispatching a command (which writes a dial). So it is
 *    forbidden the hot store / DAG / nodes / audio-host modules (a DENYlist, since a
 *    consumer's legitimate import surface is open-ended, unlike a command handler's).
 *
 * Enforced over import specifiers (not raw text), so a comment mentioning a module
 * doesn't trip it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Recursively list .ts/.tsx files under a directory. */
function tsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(p));
    else if (/\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

/** The module specifiers a file imports (static + dynamic + re-export). */
function importSpecifiers(src: string): string[] {
  const specs: string[] = [];
  const from = /(?:\bimport\b|\bexport\b)[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g;
  const dyn = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const bare = /^\s*import\s+['"]([^'"]+)['"]/gm;
  for (const re of [from, dyn, bare]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) specs.push(m[1]);
  }
  return specs;
}

/**
 * The sanctioned imports a command file may make. This is an ALLOWLIST, deliberately:
 * a denylist of "forbidden" modules is always one newly-added hot-path file behind
 * (the host audio lives in `useEngine`/`recorder`/`useAudioEngine`, not just
 * `src/nodes`; and a `.ts`-extension specifier can dodge a `$`-anchored name rule).
 * With an allowlist, anything not explicitly sanctioned — the hot `useControls`
 * store, the DAG, the nodes, the audio/host layer, any other `@/app/*` — is refused
 * by default. Commands reach state ONLY through the dials settings layer + the pure
 * settings-transform/schema modules.
 */
const COMMAND_IMPORT_ALLOWLIST: RegExp[] = [
  /^acture(\/|$)/, // the command-dispatch library
  /^zod(\/|$)/,
  /^@zodal\//, // dials-core / dials-ui / store types
  /^@\/app\/dials\//, // the dials settings layer (setDial/resetDial/dialsStore) — the write bridge
  /^@\/settings\//, // pure settings schema + transforms (layerToSettings, thoreminDials, presets)
  /^\.\/[^./]/, // a same-directory sibling command module (./dials, ./registry) — NOT `../` reach-out
];
const isAllowedFromCommands = (spec: string): boolean =>
  COMMAND_IMPORT_ALLOWLIST.some((re) => re.test(spec));

/**
 * Modules the AI assistant must NEVER import: it changes sound only by dispatching a
 * command (which writes a dial), so the real-time path stays out of its reach. This is
 * the same forbidden set the command allowlist refuses, expressed as a denylist because
 * a UI consumer legitimately imports React / cmdk / the AI SDK / the registry / the
 * dials read-side (`@/app/dials/*`) — an allowlist would be endless and wrong here.
 */
const FORBIDDEN_FROM_ASSISTANT: RegExp[] = [
  /(^|\/)nodes(\/|$)/, // the node library
  /(^|\/)dag(\/|$)/, // the DAG engine
  /^@\/app\/store(\.tsx?)?$/, // the hot useControls store (@/ alias)
  /^\.{1,2}\/store(\.tsx?)?$/, // ../store / ./store (relative hot store) — RELATIVE only, so it can't
  //                              swallow the sanctioned `@zodal/store` package or `@/app/dials/settingsStore`
  /(^|\/)useControls(\/|$)/, // the hot store hook by name
  /(^|\/)(useEngine|recorder|useAudioEngine)(\.tsx?)?$/, // the audio/engine host — BOTH the `@/` alias
  //                                                        AND a relative reach-out (`../../app/useEngine`)
];
const isForbiddenFromAssistant = (spec: string): boolean => FORBIDDEN_FROM_ASSISTANT.some((re) => re.test(spec));

describe('command-dispatch import firewall (#87)', () => {
  it('commands import ONLY the sanctioned surface (never the hot store / DAG / nodes / audio)', () => {
    const files = tsFiles('src/app/commands');
    expect(files.length).toBeGreaterThan(0); // guard: the dir exists and has files
    for (const f of files) {
      for (const spec of importSpecifiers(readFileSync(f, 'utf8'))) {
        expect(
          isAllowedFromCommands(spec),
          `${f} imports "${spec}", which is outside the command allowlist (acture / zod / @zodal / @/app/dials / @/settings / sibling). A command must write a dial, never reach the hot store, DAG, nodes, or audio layer.`,
        ).toBe(true);
      }
    }
  });

  it('the allowlist refuses hot-store / audio / DAG specifiers (incl. .ts extensions)', () => {
    // Guard the guard: a regression for the extension-bypass + the host-audio gap.
    for (const spec of [
      '@/app/store',
      '@/app/store.ts',
      '../store',
      '../store.ts',
      '@/app/useEngine',
      '@/app/recorder',
      '@/hooks/useAudioEngine',
      '@/nodes/output/webaudio_synth',
      '@/dag',
    ]) {
      expect(isAllowedFromCommands(spec), `"${spec}" must be firewalled from commands`).toBe(false);
    }
    // ...while the sanctioned ones (incl. an explicit extension) stay allowed.
    for (const spec of ['acture', 'zod', '@zodal/dials-core', '@/app/dials/settingsStore', '@/settings/dials', './registry']) {
      expect(isAllowedFromCommands(spec), `"${spec}" is sanctioned and must be allowed`).toBe(true);
    }
  });

  it('the DAG / node / tick layer never imports the command registry', () => {
    for (const dir of ['src/dag', 'src/nodes']) {
      for (const f of tsFiles(dir)) {
        for (const spec of importSpecifiers(readFileSync(f, 'utf8'))) {
          expect(/(^|\/)commands(\/|$)/.test(spec), `${f} imports "${spec}" — the real-time path must not route through dispatch`).toBe(false);
        }
      }
    }
  });

  it('the AI assistant reaches sound only via dispatch (never the hot store / DAG / nodes / audio)', () => {
    const files = tsFiles('src/plugins/assistant');
    expect(files.length).toBeGreaterThan(0); // guard: the assistant exists and is scanned
    for (const f of files) {
      for (const spec of importSpecifiers(readFileSync(f, 'utf8'))) {
        expect(
          isForbiddenFromAssistant(spec),
          `${f} imports "${spec}" — the assistant must change sound by dispatching a command, not by reaching the hot store / DAG / nodes / audio directly.`,
        ).toBe(false);
      }
    }
  });

  it('the assistant denylist refuses the hot-path modules (alias AND relative) but allows its real consumer surface', () => {
    // Guard the guard: forbid the real-time path in both its `@/` alias and relative forms.
    for (const spec of [
      '@/app/store', '@/app/store.ts', '../store', './store',
      '@/app/useEngine', '@/app/recorder', '@/hooks/useAudioEngine',
      '../../app/useEngine', '../../app/recorder', '../../hooks/useAudioEngine', // relative reach-outs
      '@/dag', '@/nodes/output/webaudio_synth',
    ]) {
      expect(isForbiddenFromAssistant(spec), `"${spec}" must be firewalled from the assistant`).toBe(true);
    }
    // ...while the assistant's legitimate imports stay allowed (incl. the sanctioned @zodal/store package).
    for (const spec of ['react', 'ai', 'acture', 'acture-ai-vercel', '@ai-sdk/openai', '@/app/commands', '@/app/dials/settingsStore', '@zodal/store', 'lucide-react', '../../hooks/useLocalStorage']) {
      expect(isForbiddenFromAssistant(spec), `"${spec}" is a sanctioned assistant import and must be allowed`).toBe(false);
    }
  });
});
