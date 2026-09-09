/**
 * The BYO-key store — one place a player's API keys live, per provider, in this
 * browser's localStorage and nowhere else (#133 settled the posture; #128 and #141
 * confirmed it for the generative layer).
 *
 * Lifted out of `src/plugins/assistant/providers.ts` (which re-exports it, so the
 * assistant's imports are unchanged) so that a node-library module — the lazily
 * loaded `lyria_engine.ts` — can read the Google key without importing a React
 * plugin: the node library never depends on `src/plugins`. The storage key keeps
 * its historical `thoremin:plugin:assistant:apiKey:<provider>` prefix on purpose,
 * so a key a player pasted into the assistant keeps working for Lyria and nothing
 * already saved is orphaned.
 *
 * Deliberately tiny and dependency-free: no Zod, no zodal. A key is a secret, not a
 * collection of named things, and the only affordances are get / set / remove.
 */

/** The localStorage key holding a provider's API key. */
export const keyStorageKey = (provider: string): string => `thoremin:plugin:assistant:apiKey:${provider}`;

/** The stored key for `provider`, or null when none (or when there is no storage). */
export function getStoredKey(provider: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(keyStorageKey(provider));
}

export function setStoredKey(provider: string, key: string): void {
  localStorage.setItem(keyStorageKey(provider), key.trim());
}

export function removeStoredKey(provider: string): void {
  localStorage.removeItem(keyStorageKey(provider));
}
