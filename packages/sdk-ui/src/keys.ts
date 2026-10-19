/**
 * The AI providers' API keys (#600 S14; V12 of the architecture review): an extension's engine reads
 * the key it needs through this seam, never the app's key store, which the shell provides
 * (`src/app/host/keys.ts`). Keys stay where they always were: this is a read path, nothing more.
 */

/** What the shell provides: a provider's stored key, or null. */
export interface ProviderKeysHost {
  get(provider: string): string | null;
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
