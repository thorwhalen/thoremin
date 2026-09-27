/**
 * `src/lazy` — the catalogued lazy-loading pattern (#188): a heavy node loads its
 * SDK / model / wasm / session only when asked, through an injectable loader, and
 * reports where it is on a `status` port in one shared vocabulary. See
 * `docs/design/lazy-loading.md` for the rule and the adopters table.
 */
export { lazyResource } from './resource';
export type { LazyResource, LazyResourceOptions, Loader, LoadContext, LoadResult } from './resource';
export { withActive } from './status';
export type { LoadPhase, LoadStatus } from './status';
