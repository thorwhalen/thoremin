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
 *
 * ## The middleware stack (#127)
 *
 * The singleton's `dispatch` is wrapped ONCE, with the order stated as data below
 * rather than emerging from module evaluation order. First = outermost:
 *
 * 1. **confirmation gate** (#87 Phase 3) — must be outermost. A gated command returns
 *    `confirmation_required` and DID NOT RUN; journaling it or opening an undo entry
 *    for it would record a mutation that never happened.
 * 2. **undo history** (#127) — snapshots the dials layer either side of a dispatch.
 * 3. **journal** (#127) — telemetry + export/replay, the innermost observer, so what it
 *    records is what actually reached the handlers.
 */
import { createRegistry, type Registry } from 'acture';
import { dialsStore } from '@/app/dials/settingsStore';
import { DIAL_COMMANDS } from './dials';
import { DIAL_FIELD_COMMANDS } from './perDial';
import { INSTRUMENT_COMMANDS } from './instruments';
import { confirmationGate, createApprovalStore, defaultGetRisk, type ApprovalStore } from './confirmation';
import { createDialsHistory, type DialsHistory } from './history';
import { createJournal, type Journal } from './journal';
import { installMiddleware } from './middleware';

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
 * The human-in-the-loop approval store for the AI assistant (#87 Phase 3). A destructive
 * command (instrument load/save/create) dispatched with `context.channel === 'assistant'`
 * returns a `confirmation_required` Result instead of running, until the runtime
 * re-dispatches it with a one-use token from THIS store (minted only after a human
 * approves). Every other surface — the palette and hotkeys, which never set the assistant
 * channel — dispatches ungated, so the gate is invisible to them. Tests that want an
 * ungated registry use `createThoreminRegistry()` (raw) and install what they need.
 */
export const approvals: ApprovalStore = createApprovalStore();

/** Undo/redo over the dials layer (#127). Bound to ⌘/Ctrl-Z and ⌘/Ctrl-Shift-Z. */
export const history: DialsHistory = createDialsHistory(dialsStore);

/** The in-memory command journal (#127) — telemetry and export/replay. No egress. */
export const journal: Journal = createJournal();

installMiddleware(
  registry,
  confirmationGate(defaultGetRisk, approvals),
  history.middleware,
  journal.middleware,
);
