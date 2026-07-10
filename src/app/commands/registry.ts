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
import { DIAL_FIELD_COMMANDS } from './perDial';
import { INSTRUMENT_COMMANDS } from './instruments';
import { installConfirmationGate, type ApprovalStore } from './confirmation';

/** Build a registry with all thoremin commands registered: the generic dial verbs,
 *  one typed `set` command per dial (generated from the dials SSOT), and the
 *  instrument load/save/create commands. */
export function createThoreminRegistry(): Registry {
  const r = createRegistry();
  r.registerAll(DIAL_COMMANDS);
  r.registerAll(DIAL_FIELD_COMMANDS);
  r.registerAll(INSTRUMENT_COMMANDS);
  return r;
}

/** The app-wide command registry singleton. */
export const registry: Registry = createThoreminRegistry();

/**
 * The human-in-the-loop approval store for the AI assistant (#87 Phase 3). Installing
 * the gate wraps the singleton's `dispatch`: a destructive command (instrument
 * load/save/create) dispatched with `context.channel === 'assistant'` returns a
 * `confirmation_required` Result instead of running, until the runtime re-dispatches
 * it with a one-use token from THIS store (minted only after a human approves). Every
 * other surface — the palette and hotkeys, which never set the assistant channel —
 * dispatches ungated, so the gate is invisible to them. Tests that want an ungated
 * registry use `createThoreminRegistry()` (raw) and install the gate explicitly.
 */
export const approvals: ApprovalStore = installConfirmationGate(registry).approvals;
