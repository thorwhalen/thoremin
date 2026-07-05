/**
 * The thoremin command registry (#87) — the single dispatch surface for
 * param-mutations. Every consumer (keyboard bindings via acture-hotkeys, the
 * command palette via acture-palette-react, the AI assistant via acture-ai-vercel /
 * MCP) reads THIS one registry; none re-describes a dial. State is reached by the
 * handlers' closure capture of the dials store (acture's registry never holds an
 * adapter), so the registry stays a pure command index.
 *
 * `createThoreminRegistry()` builds a fresh registry (used by tests for isolation);
 * `registry` is the app-wide singleton the consumers bind to.
 */
import { createRegistry, type Registry } from 'acture';
import { DIAL_COMMANDS } from './dials';

/** Build a registry with all thoremin commands registered. */
export function createThoreminRegistry(): Registry {
  const r = createRegistry();
  r.registerAll(DIAL_COMMANDS);
  return r;
}

/** The app-wide command registry singleton. */
export const registry: Registry = createThoreminRegistry();
