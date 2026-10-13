/**
 * The load state of each LAZY extension (`docs/design/lazy-extensions.md`), as a `LoadStatus`
 * per extension id (`@thoremin/lazy`'s vocabulary: `loading` while its chunk is fetched,
 * `ready` once its nodes are registered, `error` when the fetch failed).
 *
 * A failed load is retried by RELOADING the page, not in place: browsers keep a failed
 * `import()` of a URL in their module map and never fetch it again in that page (Chromium,
 * verified by `smoke/tests/lazy_extension.smoke.ts`). The settings persist, so the reload
 * comes back on the same instrument and loads it at boot.
 *
 * Its own module, a store and nothing else, so the panel placeholders and the loader both
 * read it without importing each other.
 */
import { create } from 'zustand';
import type { LoadStatus } from '@thoremin/lazy';

interface ExtensionLoadState {
  status: Readonly<Record<string, LoadStatus>>;
  report: (id: string, status: LoadStatus) => void;
}

export const useExtensionLoad = create<ExtensionLoadState>()((set) => ({
  status: {},
  report: (id, status) => set((s) => ({ status: { ...s.status, [id]: status } })),
}));
