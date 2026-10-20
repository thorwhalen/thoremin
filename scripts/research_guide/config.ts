/**
 * Where the research guide reads from and writes to, resolved from the environment so
 * no absolute path is ever committed.
 *
 * - `THOREMIN_GUIDE_HOME` (default `~/.local/share/thoremin/research-guide`): the
 *   generator's own folder outside the repo: the built site (`site/`), the staleness
 *   state (`state.json`), the GitHub cache (`gh-cache.json`) and the private overlay
 *   (`private.json`). The site carries private material, so it never lives in the repo.
 * - `THOREMIN_GUIDE_PRIVATE_ROOTS`: colon-separated `name=dir` pairs naming the private
 *   working-doc folders (a `private:<name>/<rel>` path resolves against them). Defaults
 *   to the two folders this project's sessions write to, when they exist.
 * - `THOREMIN_GUIDE_SESSION`: the `--session` given to annals (default `research-guide`).
 */
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REPO_SLUG = 'thorwhalen/thoremin';
export const GITHUB = `https://github.com/${REPO_SLUG}`;

export interface GuideConfig {
  home: string;
  out: string;
  statePath: string;
  ghCachePath: string;
  privateDataPath: string;
  privateRoots: Record<string, string>;
  session: string;
}

function defaultPrivateRoots(): Record<string, string> {
  const pp = process.env.PP ?? join(homedir(), 'py', 'proj');
  const candidates: Record<string, string> = {
    _agent_work: join(pp, '_agent_work', 'thoremin'),
    research: join(homedir(), '.local', 'share', 'thoremin', 'research'),
  };
  return Object.fromEntries(Object.entries(candidates).filter(([, dir]) => existsSync(dir)));
}

function parseRoots(spec: string): Record<string, string> {
  const roots: Record<string, string> = {};
  for (const pair of spec.split(':').filter(Boolean)) {
    const eq = pair.indexOf('=');
    if (eq <= 0) throw new Error(`THOREMIN_GUIDE_PRIVATE_ROOTS: expected name=dir, got "${pair}"`);
    roots[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return roots;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, { out }: { out?: string } = {}): GuideConfig {
  const home = env.THOREMIN_GUIDE_HOME ?? join(homedir(), '.local', 'share', 'thoremin', 'research-guide');
  return {
    home,
    out: out ?? join(home, 'site'),
    statePath: join(home, 'state.json'),
    ghCachePath: join(home, 'gh-cache.json'),
    privateDataPath: join(home, 'private.json'),
    privateRoots: env.THOREMIN_GUIDE_PRIVATE_ROOTS ? parseRoots(env.THOREMIN_GUIDE_PRIVATE_ROOTS) : defaultPrivateRoots(),
    session: env.THOREMIN_GUIDE_SESSION ?? 'research-guide',
  };
}

/** Folders under a private root that hold agent briefs, not research: never listed. */
export const PRIVATE_SKIP = [/(^|\/)\d{4}-\d{2}-\d{2}-(briefs|guides)(\/|$)/, /(^|\/)node_modules(\/|$)/];
