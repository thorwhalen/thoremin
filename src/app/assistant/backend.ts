/**
 * The model-call seam (#87 Phase 3). `ChatBackend.runTurn` runs one assistant turn and
 * reports back through callbacks; it is the ONE place the actual LLM call lives, so:
 *  - the default {@link createVercelChatBackend} runs entirely in the browser with the
 *    user's BYO key (no backend — thoremin's promise stays intact), and
 *  - a future server-side backend (e.g. behind a hosted gateway) can implement the same
 *    interface without touching {@link AssistantSession} or the UI, and
 *  - tests inject a scripted mock backend, so the session's state machine and the
 *    approval flow are exercised with no network.
 *
 * Runs on the AI SDK v5+ line (currently `ai@7`). The v4 line is not an option: its
 * final `@ai-sdk/google` predates Gemini 3 and drops the `thoughtSignature` Gemini 3
 * requires echoed back on tool calls — see the note in `providers.ts`.
 */
import { streamText, isStepCount, type ModelMessage, type Tool } from 'ai';
import type { AnyCommandRecord } from 'acture';
import { PROVIDERS } from './providers';
import type { ProviderId } from './types';

export interface AssistantTurnInput {
  system: string;
  messages: ModelMessage[];
  signal?: AbortSignal;
}

export interface AssistantTurnCallbacks {
  onTextDelta(delta: string): void;
  onDispatch(command: AnyCommandRecord, result: unknown): void;
  /** A tool call that never reached the registry — the model named a tool that doesn't
   *  exist, or sent arguments its schema rejects. Distinct from a dispatched command
   *  that failed (that arrives via {@link onDispatch} as an errors-as-data Result). */
  onToolError(toolName: string, error: unknown): void;
  onError(error: Error): void;
}

export interface ChatBackend {
  runTurn(input: AssistantTurnInput, callbacks: AssistantTurnCallbacks): Promise<void>;
}

/** Bound the tool-call loop so a confused model can't spin: a few dial edits + a reply. */
const MAX_STEPS = 6;

/** Build the assistant's tool set, wiring `onDispatch` into each tool. Injected so the
 *  backend stays decoupled from the registry/projection (and mockable in tests). */
export type ToolBuilder = (onDispatched: (command: AnyCommandRecord, result: unknown) => void) => Record<string, Tool>;

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

/** The default backend: the Vercel AI SDK run client-side against the chosen provider. */
export function createVercelChatBackend(opts: {
  provider: ProviderId;
  model: string;
  apiKey: string;
  buildTools: ToolBuilder;
}): ChatBackend {
  return {
    async runTurn(input, callbacks) {
      const model = await PROVIDERS[opts.provider].createModel(opts.apiKey, opts.model);
      const tools = opts.buildTools(callbacks.onDispatch);
      const result = streamText({
        model,
        system: input.system,
        messages: input.messages,
        tools,
        stopWhen: isStepCount(MAX_STEPS),
        abortSignal: input.signal,
      });
      // The tools execute inside streamText and report via onDispatch; here we only
      // stream the model's text and surface stream/model/tool errors as data.
      for await (const part of result.stream) {
        switch (part.type) {
          case 'text-delta':
            callbacks.onTextDelta(part.text);
            break;
          // A tool the SDK could not even run: unknown tool name, or input that failed
          // schema validation. Our acture tools return errors-as-data rather than
          // throwing, so this fires for malformed model output, not for command failure.
          case 'tool-error':
            callbacks.onToolError(part.toolName, part.error);
            break;
          case 'error':
            callbacks.onError(toError(part.error));
            break;
          default:
            break;
        }
      }
    },
  };
}
