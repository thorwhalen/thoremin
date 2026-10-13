/**
 * Every test file starts with the LAZY extensions' nodes already loaded, so `createAppRegistry()`
 * registers them synchronously (the same property a rebuilt registry has in the app once a
 * lazy extension has loaded: `docs/design/lazy-extensions.md`). The tests that build the
 * production graph (every branch, a lazy extension's included) then need no `await`.
 *
 * The lazy path itself (declared, pending, loaded on demand, a failed load) is tested with its
 * own extensions in `test/lazy_extensions.test.ts`, which this preload does not touch.
 */
import { EXTENSIONS, loadExtensionNodes } from '@/extensions';

await Promise.all(EXTENSIONS.map((e) => loadExtensionNodes(e)));
