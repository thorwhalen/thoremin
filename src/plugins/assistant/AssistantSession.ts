/**
 * The assistant runtime (#87 Phase 3) — an `EventTarget` (mirroring the ai-dj
 * `LyriaSessionManager`) that owns the chat transcript and drives one model turn per
 * {@link send} through a pluggable {@link ChatBackend}. The model's tool calls flow
 * through the acture command registry (the SAME single write path the palette and
 * hotkeys use), and destructive commands are mediated by the confirmation gate: they
 * return `confirmation_required` (errors-as-data), the session raises a pending
 * approval, and only on the user's {@link approve} does it mint a one-use token and
 * re-dispatch. Being framework-agnostic, the React overlay is a thin subscriber to the
 * single coarse `change` event.
 */
import type { CoreMessage } from 'ai';
import type { AnyCommandRecord } from 'acture';
import { registry, approvals } from '@/app/commands';
import { buildSystemPrompt } from './systemPrompt';
import { buildAssistantTools } from './aiTools';
import { createVercelChatBackend, type ChatBackend } from './backend';
import { PROVIDERS, getStoredKey } from './providers';
import type { AssistantSettings, ChatMessage, PendingApproval, ToolTrace } from './types';

function uid(prefix: string): string {
  const rand = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}_${rand}`;
}

/** A short human summary of a successful dispatch, from its Result value. */
function describeOk(cmdId: string, value: unknown): string {
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if ('key' in v && 'value' in v) return `${String(v.key)} → ${JSON.stringify(v.value)}`;
    if ('count' in v) return `${String(v.count)} dials set`;
    if ('name' in v) return `${cmdId.split('.').pop() ?? cmdId} "${String(v.name)}"`;
  }
  return cmdId;
}

const approvalKey = (command: string, params: unknown): string => `${command} ${JSON.stringify(params ?? null)}`;

/** True for an assistant message with neither text nor a tool trace — an aborted or
 *  pre-text-error turn that carries nothing to show or re-send. */
const isEmptyAssistantTurn = (m: ChatMessage): boolean =>
  m.role === 'assistant' && m.text.trim() === '' && (m.traces?.length ?? 0) === 0;

/** A permissive structural view of an acture Result — reads ok/value/error WITHOUT
 *  relying on discriminated-union narrowing, which the loose whole-project tsc (no
 *  strictNullChecks) won't perform across a ternary or an `&&`. */
type LooseResult = { ok: boolean; value?: unknown; error?: { code: string; message: string; details?: unknown } };
const asLoose = (r: unknown): LooseResult => r as LooseResult;

/** Build the default (browser, BYO-key) backend for the given settings + key. */
function defaultBackendFactory(settings: AssistantSettings, apiKey: string): ChatBackend {
  return createVercelChatBackend({
    provider: settings.provider,
    model: settings.model,
    apiKey,
    buildTools: (onDispatched) => buildAssistantTools(onDispatched),
  });
}

export class AssistantSession extends EventTarget {
  private _messages: ChatMessage[] = [];
  private _pending: PendingApproval[] = [];
  private _busy = false;
  private _error: string | null = null;
  private abort: AbortController | null = null;

  /** `makeBackend` is injectable so tests can drive the session with a scripted mock. */
  constructor(private makeBackend: (settings: AssistantSettings, apiKey: string) => ChatBackend = defaultBackendFactory) {
    super();
  }

  get messages(): ReadonlyArray<ChatMessage> {
    return this._messages;
  }
  get pendingApprovals(): ReadonlyArray<PendingApproval> {
    return this._pending;
  }
  get busy(): boolean {
    return this._busy;
  }
  get error(): string | null {
    return this._error;
  }

  private emit(): void {
    this.dispatchEvent(new CustomEvent('change'));
  }

  /** Seed the transcript from persisted history, dropping any empty, trace-less assistant
   *  turns (pure noise from a past abort/error that would otherwise re-send as an empty
   *  content block the provider rejects). */
  loadHistory(messages: ChatMessage[]): void {
    this._messages = messages.filter((m) => !isEmptyAssistantTurn(m)).map((m) => ({ ...m, pending: false }));
    this.emit();
  }

  clear(): void {
    this._messages = [];
    this._pending = [];
    this._error = null;
    this.emit();
  }

  /** Run one turn: append the user message, stream the assistant reply, dispatch any
   *  tool calls through the registry, and raise approvals for gated commands. */
  async send(text: string, settings: AssistantSettings): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || this._busy) return;
    const apiKey = getStoredKey(settings.provider);
    if (!apiKey) {
      this._error = `No API key set for ${PROVIDERS[settings.provider].label}.`;
      this.emit();
      return;
    }

    this._error = null;
    const userMsg: ChatMessage = { id: uid('u'), role: 'user', text: trimmed };
    const assistantMsg: ChatMessage = { id: uid('a'), role: 'assistant', text: '', pending: true, traces: [] };
    this._messages = [...this._messages, userMsg, assistantMsg];
    this._busy = true;
    this.emit();

    // The model sees prior settled turns + the new user turn. A tool-only turn (dispatches
    // but no narration) has empty text — it is EXCLUDED from the model input (its effect is
    // already reflected in the read-side dial catalog in the system prompt), because an
    // empty-content assistant message is rejected by Anthropic/Gemini (OpenAI tolerates it).
    const coreMessages: CoreMessage[] = this._messages
      .filter((m) => !m.pending && m.text.trim() !== '')
      .map((m) => ({ role: m.role, content: m.text }));

    this.abort = new AbortController();
    const backend = this.makeBackend(settings, apiKey);
    try {
      await backend.runTurn(
        { system: buildSystemPrompt(), messages: coreMessages, signal: this.abort.signal },
        {
          onTextDelta: (delta) => {
            assistantMsg.text += delta;
            this.touch(assistantMsg);
          },
          onDispatch: (cmd, result) => this.handleDispatch(assistantMsg, cmd, result),
          onError: (e) => {
            this._error = e.message;
            this.emit();
          },
        },
      );
    } catch (e) {
      this._error = e instanceof Error ? e.message : String(e);
    } finally {
      assistantMsg.pending = false;
      this._busy = false;
      this.abort = null;
      // Drop a turn that produced neither text nor a tool trace (an abort or pre-text
      // error) so it doesn't linger as noise or poison the next turn's model input.
      if (isEmptyAssistantTurn(assistantMsg)) {
        this._messages = this._messages.filter((m) => m.id !== assistantMsg.id);
        this.emit();
      } else {
        this.touch(assistantMsg);
      }
    }
  }

  /** Replace the message object (new reference) so subscribers re-render. */
  private touch(msg: ChatMessage): void {
    this._messages = this._messages.map((m) => (m.id === msg.id ? { ...msg } : m));
    this.emit();
  }

  private handleDispatch(assistantMsg: ChatMessage, cmd: AnyCommandRecord, result: unknown): void {
    const r = asLoose(result);
    if (!r.ok && r.error?.code === 'confirmation_required') {
      const details = (r.error.details ?? {}) as { command?: string; params?: unknown };
      const command = details.command ?? cmd.id;
      const params = details.params;
      const key = approvalKey(command, params);
      if (!this._pending.some((p) => approvalKey(p.command, p.params) === key)) {
        this._pending = [...this._pending, { id: uid('p'), command, params, title: cmd.title ?? command }];
      }
    }
    const trace: ToolTrace = {
      id: uid('t'),
      command: cmd.id,
      ok: r.ok,
      detail: r.ok ? describeOk(cmd.id, r.value) : (r.error?.message ?? 'error'),
    };
    assistantMsg.traces = [...(assistantMsg.traces ?? []), trace];
    this.touch(assistantMsg);
  }

  /** Approve a pending destructive command: mint a one-use token and re-dispatch. */
  async approve(id: string): Promise<void> {
    const p = this._pending.find((x) => x.id === id);
    if (!p) return;
    this._pending = this._pending.filter((x) => x.id !== id);
    this.emit();
    const token = approvals.approve(p.command, p.params);
    const result = asLoose(await registry.dispatch(p.command, p.params, { channel: 'assistant', approvedToken: token }));
    const text = result.ok ? `Done: ${p.title}.` : `Couldn't complete "${p.title}": ${result.error?.message ?? 'failed'}`;
    this._messages = [...this._messages, { id: uid('a'), role: 'assistant', text }];
    this.emit();
  }

  /** Deny a pending destructive command (nothing is dispatched). */
  deny(id: string): void {
    const p = this._pending.find((x) => x.id === id);
    if (!p) return;
    this._pending = this._pending.filter((x) => x.id !== id);
    this._messages = [...this._messages, { id: uid('a'), role: 'assistant', text: `Cancelled: ${p.title}.` }];
    this.emit();
  }

  /** Abort an in-flight turn. */
  stop(): void {
    this.abort?.abort();
  }

  dispose(): void {
    this.abort?.abort();
  }
}
