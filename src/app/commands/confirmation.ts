/**
 * Confirmation gate for destructive commands (#87 Phase 3) — the human-in-the-loop
 * boundary for the AI assistant. Following acture's `hand-written-assistant-runtime`
 * pattern: risk is an EXTERNAL convention (`getRisk`, keyed by command id) so the
 * closed `CommandRecord` stays closed, and the gate WRAPS `registry.dispatch`.
 *
 * A destructive command dispatched on the ASSISTANT surface (`context.channel ===
 * 'assistant'`) does not run — it returns a `confirmation_required` Result (errors-as-
 * data, carrying `{command, params}` and NO token). The runtime turns that into an
 * approve/deny card; only when a HUMAN approves does it mint a one-use token and
 * re-dispatch. The token is never handed back to the model, so the model can never
 * self-approve. Human dispatches (palette / hotkeys — no assistant channel) pass
 * through ungated, so this is invisible to every non-AI surface.
 */
import { err, type Registry, type Result } from 'acture';

/** A rough risk class for a command; only `destructive` gates by default. */
export type SideEffect = 'query' | 'additive' | 'destructive';

/** Risk metadata for one command — a convention, not a `CommandRecord` field. */
export interface RiskMeta {
  sideEffect?: SideEffect;
  /** Force (or waive) confirmation regardless of `sideEffect`. */
  requiresConfirmation?: boolean;
}

/** The thoremin commands that mutate SAVED state (not just the live working layer),
 *  so they need the user's approval when the assistant proposes them:
 *   - instrument.load  discards unsaved edits in the current working layer
 *   - instrument.save  overwrites an existing saved instrument
 *   - instrument.create commits under a name (a collision clobbers a saved instrument) */
const DESTRUCTIVE_COMMANDS = new Set<string>(['instrument.load', 'instrument.save', 'instrument.create']);

/** The default thoremin risk map: destructive for the instrument mutations above,
 *  additive for reversible dial edits, query for everything else. */
export function defaultGetRisk(id: string): RiskMeta {
  if (DESTRUCTIVE_COMMANDS.has(id)) return { sideEffect: 'destructive' };
  return { sideEffect: id.startsWith('dial.') ? 'additive' : 'query' };
}

/** One-use approval token store. `approve` is called by the runtime AFTER a human
 *  approves (never by the model); `consume` is called by the gate on re-dispatch and
 *  is valid only for the exact `{command, params}` it was minted for. */
export interface ApprovalStore {
  approve(command: string, params: unknown): string;
  consume(token: string, command: string, params: unknown): boolean;
}

function randomToken(): string {
  return globalThis.crypto?.randomUUID?.() ?? `tok_${Math.random().toString(36).slice(2)}${Date.now?.() ?? ''}`;
}

/** Build a fresh one-use approval store. */
export function createApprovalStore(): ApprovalStore {
  const issued = new Map<string, string>(); // token → key(command, params)
  const key = (command: string, params: unknown) => `${command} ${JSON.stringify(params ?? null)}`;
  return {
    approve(command, params) {
      const token = randomToken();
      issued.set(token, key(command, params));
      return token;
    },
    consume(token, command, params) {
      if (issued.get(token) !== key(command, params)) return false;
      issued.delete(token); // one-use
      return true;
    },
  };
}

/** The dispatch-context fields the gate reads. `channel:'assistant'` marks an
 *  AI-originated dispatch; `approvedToken` is the one-use token minted after approval. */
export interface AssistantDispatchContext {
  channel?: string;
  approvedToken?: string;
  [k: string]: unknown;
}

/** The shape of `registry.dispatch` the gate wraps (a local alias, not an acture export).
 *  Trailing args (acture's `options`, e.g. an internal token) are forwarded untouched. */
type Dispatch = (command: string, params?: unknown, context?: unknown, ...rest: unknown[]) => Promise<Result<unknown>>;

/**
 * Build a dispatch middleware that gates destructive commands on the assistant surface.
 * A gated call without a valid one-use token returns a `confirmation_required` Result
 * (no token in it); everything else — non-destructive commands, and ALL non-assistant
 * dispatches — passes straight through to `next`.
 */
export function confirmationGate(
  getRisk: (id: string) => RiskMeta,
  approvals: ApprovalStore,
): (next: Dispatch) => Dispatch {
  return (next) => async (command, params, context, ...rest) => {
    const risk = getRisk(command);
    const needs = risk.requiresConfirmation ?? risk.sideEffect === 'destructive';
    const ctx = context as AssistantDispatchContext | undefined;
    if (!needs || ctx?.channel !== 'assistant') return next(command, params, context, ...rest);
    if (ctx.approvedToken && approvals.consume(ctx.approvedToken, command, params)) {
      return next(command, params, context, ...rest);
    }
    return err('confirmation_required', `"${command}" needs your approval before it runs.`, { command, params });
  };
}

/**
 * Install the confirmation gate onto a registry by reassigning its `dispatch` in place
 * (the same idiom acture's `recordSequence` uses). Returns the `ApprovalStore` the
 * runtime uses to mint tokens on human approval. Idempotent per registry is NOT
 * guaranteed — call once per registry.
 */
export function installConfirmationGate(
  registry: Registry,
  options: { getRisk?: (id: string) => RiskMeta; approvals?: ApprovalStore } = {},
): { approvals: ApprovalStore } {
  const getRisk = options.getRisk ?? defaultGetRisk;
  const approvals = options.approvals ?? createApprovalStore();
  const original = registry.dispatch.bind(registry) as Dispatch;
  registry.dispatch = confirmationGate(getRisk, approvals)(original) as typeof registry.dispatch;
  return { approvals };
}
