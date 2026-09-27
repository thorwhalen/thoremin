# @thoremin/lazy

Lazy loading as one catalogued pattern: `lazyResource` (request once, discard a late arrival, never re-hammer a failure, retry on re-enable, never throw) and the `LoadStatus` every heavy node reports. Pure and Node-safe: no DAG import, no DOM, no vendor library.

The pattern and its five rules are in `docs/design/lazy-loading.md`.
