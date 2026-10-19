/**
 * The app's AI-provider key store, provided to the extensions (#600 S14): an extension's engine
 * reads a key through `@thoremin/sdk-ui/keys`, never `src/keys` (V12 of the architecture review).
 */
import { provideProviderKeys } from '@thoremin/sdk-ui/keys';
import { getStoredKey } from '@/keys/providerKeys';

provideProviderKeys({ get: getStoredKey });
