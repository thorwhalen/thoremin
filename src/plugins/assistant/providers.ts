/**
 * Multi-provider LLM registry (#87 Phase 3) — a data-driven, open-closed table of the
 * chat providers the assistant can use. Each entry lazily imports its Vercel-AI-SDK
 * provider package (`@ai-sdk/*`, the AI-SDK v5+ line) and builds a model handle for
 * `streamText`. thoremin stays 100% client-side: the model call runs in the browser
 * with the USER'S OWN key (BYO-key), stored per provider in localStorage and sent only
 * to that provider — the same trust model as the existing Lyria (ai-dj) plugin.
 *
 * To add a provider: install its `@ai-sdk/<name>` on the AI-SDK v5+ line and add an
 * entry. Mistral (`@ai-sdk/mistral`), xAI (`@ai-sdk/xai`), and OpenRouter (one key →
 * hundreds of models) all work directly in the browser and are drop-in.
 *
 * ## Why the model list is pinned, hand-curated, and dated
 *
 * The assistant is an agentic tool-caller, so a model is only useful here if it does
 * reliable multi-turn function calling. That is a *narrower* bar than "is a good chat
 * model", and it is why this list is short and opinionated rather than a mirror of each
 * provider's catalogue. Exactly one model per provider is marked `recommended` — the
 * fast mid-tier, which is the sweet spot for read-state → decide → call-a-tool work
 * (reliability × latency × cost beats raw IQ here). The flagship and cheap rungs are
 * offered as the deliberate escape hatches on either side.
 *
 * Two hard-won rules, both learned the painful way:
 *
 * 1. **Pinned ids only — never floating aliases.** `gemini-flash-latest` used to be
 *    listed; an alias silently re-points, so it auto-updates *and* auto-breaks. Pin.
 * 2. **A provider's own catalogue is not a liveness signal.** `gemini-2.5-flash` began
 *    returning `404 … no longer available` on 2026-07-09 while Google's models page
 *    still listed it as Stable, its deprecation page still promised an Oct 2026
 *    shutdown, and `ListModels` still returned it. The only ground truth is calling the
 *    model. Every id below was verified live against its provider's API on 2026-07-11.
 *
 * Re-verify before trusting this list: `npm run check:models`.
 */
import type { LanguageModel } from 'ai';
import type { ProviderId } from './types';

/** One selectable model. `note` is the "when would I pick this?" line shown in the UI. */
export interface ModelChoice {
  /** The exact, pinned wire id sent to the provider. Never an alias. */
  id: string;
  /** Short human label for the picker. */
  label: string;
  /** Why you'd choose this rung, incl. list price (input/output per 1M tokens). */
  note: string;
  /** The provider's default for this app. Exactly one per provider. */
  recommended?: boolean;
}

/** A provider's identity, model choices, key metadata, and lazy model factory. */
export interface ProviderSpec {
  id: ProviderId;
  label: string;
  models: ModelChoice[];
  keyHelpUrl: string;
  keyPlaceholder: string;
  /** Lazily import the provider SDK and build a model handle for `streamText`. */
  createModel(apiKey: string, modelId: string): Promise<LanguageModel>;
}

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    models: [
      {
        id: 'gpt-5.6-terra',
        label: 'GPT-5.6 Terra',
        note: 'Mid tier. The default tool-driver — a full rung above the cheap tier at half the flagship price. $2.50/$15 per 1M.',
        recommended: true,
      },
      {
        id: 'gpt-5.6-sol',
        label: 'GPT-5.6 Sol',
        note: 'Flagship. For genuinely hard multi-step planning; overkill for routine dial edits. $5/$30 per 1M.',
      },
      {
        id: 'gpt-5.6-luna',
        label: 'GPT-5.6 Luna',
        note: 'Cheap tier. Single obvious tool calls, intent routing. $1/$6 per 1M.',
      },
    ],
    keyHelpUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-...',
    async createModel(apiKey, modelId) {
      const { createOpenAI } = await import('@ai-sdk/openai');
      // @ai-sdk/openai v2+ targets the Responses API by default, which is what we want:
      // from GPT-5.4 on, tool calling is NOT supported on Chat Completions with
      // `reasoning: none`, so Responses is the only viable surface for an agentic caller.
      return createOpenAI({ apiKey })(modelId);
    },
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    models: [
      {
        id: 'claude-sonnet-5',
        label: 'Claude Sonnet 5',
        note: 'Workhorse. Best-in-class at staying inside a tool schema, which is what an app-driving assistant lives or dies on. $3/$15 per 1M.',
        recommended: true,
      },
      {
        id: 'claude-opus-4-8',
        label: 'Claude Opus 4.8',
        note: 'Flagship. Hard planning and loop recovery. $5/$25 per 1M.',
      },
      {
        id: 'claude-haiku-4-5',
        label: 'Claude Haiku 4.5',
        note: 'Cheap tier. Routing, state reads, one clear call. $1/$5 per 1M.',
      },
    ],
    keyHelpUrl: 'https://console.anthropic.com/settings/keys',
    keyPlaceholder: 'sk-ant-...',
    async createModel(apiKey, modelId) {
      const { createAnthropic } = await import('@ai-sdk/anthropic');
      // Anthropic gates direct browser calls behind this header (the key stays in the
      // browser and is sent only to Anthropic — deliberately named to flag that).
      return createAnthropic({
        apiKey,
        headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
      })(modelId);
    },
  },
  google: {
    id: 'google',
    label: 'Google (Gemini)',
    models: [
      {
        id: 'gemini-3.5-flash',
        label: 'Gemini 3.5 Flash',
        note: "Workhorse, and the app default: Google's own recommended tier, with a generous free tier. $1.50/$9 per 1M.",
        recommended: true,
      },
      {
        id: 'gemini-3.1-pro-preview',
        label: 'Gemini 3.1 Pro',
        note: 'Flagship. Largest context (1M) and the hardest reasoning. $2/$12 per 1M (doubles above 200K).',
      },
      {
        id: 'gemini-3.1-flash-lite',
        label: 'Gemini 3.1 Flash-Lite',
        note: 'Cheap tier. Bulk, low-latency, simple calls. $0.25/$1.50 per 1M.',
      },
    ],
    keyHelpUrl: 'https://aistudio.google.com/app/apikey',
    keyPlaceholder: 'AIza...',
    async createModel(apiKey, modelId) {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
      // Gemini 3 REQUIRES the opaque `thoughtSignature` on the first `functionCall` part
      // of each step to be echoed back, or it rejects the request outright ("Function
      // call is missing a thought_signature in functionCall parts") — with no opt-out,
      // even at the minimal thinking level. @ai-sdk/google only learned to round-trip it
      // in 2.0.3; the final v4-line release (1.2.22) predates Gemini 3 and silently drops
      // it, which is why this app is on the v5+ SDK line. Do not downgrade.
      return createGoogleGenerativeAI({ apiKey })(modelId);
    },
  },
};

/** All providers, in display order. */
export const PROVIDER_LIST: ProviderSpec[] = Object.values(PROVIDERS);

/** The provider's recommended model — what we pick when the user switches provider. */
export function recommendedModel(id: ProviderId): string {
  const { models } = PROVIDERS[id];
  return (models.find((m) => m.recommended) ?? models[0]).id;
}

/** Whether `modelId` is still offered by `provider` (a persisted setting may name a model
 *  we have since retired — e.g. a saved `gemini-2.5-flash`, which now 404s). */
export function isKnownModel(id: ProviderId, modelId: string): boolean {
  return PROVIDERS[id].models.some((m) => m.id === modelId);
}

/** The localStorage key holding a provider's API key. */
const keyStorageKey = (id: ProviderId): string => `thoremin:plugin:assistant:apiKey:${id}`;

export const getStoredKey = (id: ProviderId): string | null => localStorage.getItem(keyStorageKey(id));
export const setStoredKey = (id: ProviderId, key: string): void => localStorage.setItem(keyStorageKey(id), key.trim());
export const removeStoredKey = (id: ProviderId): void => localStorage.removeItem(keyStorageKey(id));
