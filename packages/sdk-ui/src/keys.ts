/**
 * The AI providers' API keys (#600 S14; V12 of the architecture review): an extension's engine reads
 * the key it needs through this seam, never the app's key store, which the shell provides
 * (`src/app/host/keys.ts`). Keys stay where they always were (this browser's storage): a read path,
 * and a write path for a setting an extension owns (the Song tool's YouTube key).
 */

/** What the shell provides: a provider's stored key, or null. */
export interface ProviderKeysHost {
  get(provider: string): string | null;
  /** Store a key on this device; returns why it could not be, or null. Absent in a read-only host. */
  set?(provider: string, key: string): string | null;
  remove?(provider: string): void;
}

let host: ProviderKeysHost | null = null;

/** Install the app's key store (the shell, once). */
export function provideProviderKeys(next: ProviderKeysHost | null): void {
  host = next;
}

/** A provider's stored key, or null (none stored, or no key store in this host). */
export function providerKey(provider: string): string | null {
  return host?.get(provider) ?? null;
}

/** Store a provider's key on this device; returns why it could not be stored, or null. */
export function setProviderKey(provider: string, key: string): string | null {
  if (!host?.set) return 'This page cannot store keys.';
  return host.set(provider, key);
}

/** Forget a provider's key on this device. */
export function removeProviderKey(provider: string): void {
  host?.remove?.(provider);
}
