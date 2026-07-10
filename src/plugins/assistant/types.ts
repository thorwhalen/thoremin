/**
 * Assistant plugin types (#87 Phase 3) — the data model for the in-app AI assistant
 * that operates the instrument by dispatching acture commands. A chat message, the
 * tool-call trace shown inline, a pending human approval, and the persisted settings.
 * Kept React-free and dependency-light so the runtime + tests import it in Node.
 */

/** The LLM providers thoremin ships. Each is called directly from the browser with
 *  the user's own API key (no backend). See {@link ./providers}. */
export type ProviderId = 'openai' | 'anthropic' | 'google';

/** Persisted assistant settings (the active provider + model). API keys live
 *  separately, per provider, under `thoremin:plugin:assistant:apiKey:<provider>`. */
export interface AssistantSettings {
  provider: ProviderId;
  model: string;
}

/** Default: Google Gemini 3.5 Flash — near-Pro capability at Flash cost/speed. */
export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = {
  provider: 'google',
  model: 'gemini-3.5-flash',
};

export type ChatRole = 'user' | 'assistant';

/** One dispatch the assistant made during a turn, rendered as an inline trace line so
 *  the user sees exactly what changed (and any refusal). `command` is the canonical id. */
export interface ToolTrace {
  id: string;
  command: string;
  ok: boolean;
  detail: string;
}

/** A single chat message. An assistant message may carry the tool-call traces from its
 *  turn and a `pending` flag while it is still streaming. */
export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  traces?: ToolTrace[];
  pending?: boolean;
}

/** A destructive command the assistant proposed that awaits the user's approval. */
export interface PendingApproval {
  id: string;
  command: string;
  params: unknown;
  title: string;
}
