/**
 * Multi-provider LLM registry (#87 Phase 3) — a data-driven, open-closed table of the
 * chat providers the assistant can use. Each entry lazily imports its Vercel-AI-SDK
 * provider package (`@ai-sdk/*`, the AI-SDK v4 line) and builds a model handle for
 * `streamText`. thoremin stays 100% client-side: the model call runs in the browser
 * with the USER'S OWN key (BYO-key), stored per provider in localStorage and sent only
 * to that provider — the same trust model as the existing Lyria (ai-dj) plugin.
 *
 * To add a provider: install its `@ai-sdk/<name>` on the AI-SDK v4 (`^1`) line and add
 * an entry. Mistral (`@ai-sdk/mistral`) and xAI (`@ai-sdk/xai`) work directly in the
 * browser and are drop-in. OpenRouter (one key → hundreds of models) currently ships
 * only for AI-SDK v5+, so it waits until thoremin moves off `ai@4`.
 */
import type { LanguageModel } from 'ai';
import type { ProviderId } from './types';

/** A provider's identity, model choices, key metadata, and lazy model factory. */
export interface ProviderSpec {
  id: ProviderId;
  label: string;
  models: string[];
  defaultModel: string;
  keyHelpUrl: string;
  keyPlaceholder: string;
  /** Lazily import the provider SDK and build a model handle for `streamText`. */
  createModel(apiKey: string, modelId: string): Promise<LanguageModel>;
}

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1'],
    defaultModel: 'gpt-4o',
    keyHelpUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-...',
    async createModel(apiKey, modelId) {
      const { createOpenAI } = await import('@ai-sdk/openai');
      return createOpenAI({ apiKey })(modelId);
    },
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    models: ['claude-sonnet-5', 'claude-opus-4-8', 'claude-haiku-4-5'],
    defaultModel: 'claude-sonnet-5',
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
    // gemini-3.5-flash is the current GA flash (what `gemini-flash-latest` points to);
    // gemini-2.0-flash was shut down 2026-06-01, so it is intentionally omitted.
    models: ['gemini-3.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash'],
    defaultModel: 'gemini-3.5-flash',
    keyHelpUrl: 'https://aistudio.google.com/app/apikey',
    keyPlaceholder: 'AIza...',
    async createModel(apiKey, modelId) {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
      return createGoogleGenerativeAI({ apiKey })(modelId);
    },
  },
};

/** All providers, in display order. */
export const PROVIDER_LIST: ProviderSpec[] = Object.values(PROVIDERS);

/** The localStorage key holding a provider's API key. */
const keyStorageKey = (id: ProviderId): string => `thoremin:plugin:assistant:apiKey:${id}`;

export const getStoredKey = (id: ProviderId): string | null => localStorage.getItem(keyStorageKey(id));
export const setStoredKey = (id: ProviderId, key: string): void => localStorage.setItem(keyStorageKey(id), key.trim());
export const removeStoredKey = (id: ProviderId): void => localStorage.removeItem(keyStorageKey(id));
