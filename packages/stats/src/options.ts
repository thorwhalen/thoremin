/**
 * Merging a caller's options over named defaults (#912, #924), here in the leaf package so every
 * package can use it (`ictus` and this package cannot import the SDK, which re-exports it).
 *
 * `{ ...DEFAULTS, ...options }` lets an explicit `undefined` (`{ length: undefined }`, often a
 * pass-through of the caller's own optional argument) override the default and reach the code
 * as `undefined`. Dropping the undefined keys first makes "not given" and "given as undefined"
 * mean the same thing: the default.
 */
const NONE = Object.freeze({});

/**
 * `options` without its undefined-valued keys, to spread over defaults (absent: an empty object).
 * Returns `options` ITSELF when no key is undefined, so the common call allocates nothing: some
 * callers run once per audio hop (`yin`, `formantsOf`). Spread the result; never mutate it.
 */
export function definedOnly<T extends object>(options: T | undefined): T {
  if (options === undefined) return NONE as T;
  for (const key in options) {
    if (Object.hasOwn(options, key) && (options as Record<string, unknown>)[key] === undefined) {
      return Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)) as T;
    }
  }
  return options;
}
