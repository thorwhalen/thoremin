/**
 * Option helpers: merging a caller's options over named defaults. The helper lives in the leaf
 * `@thoremin/stats` (#924, so `ictus` can use it too); this path keeps the SDK's import working.
 */
export { definedOnly } from '@thoremin/stats/options';
