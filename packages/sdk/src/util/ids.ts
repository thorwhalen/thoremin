/**
 * Id helpers — the single source of truth for turning a human-typed name into a
 * stable, url/file/key-safe id.
 *
 * Four call sites had grown their own byte-identical copy of this slug chain
 * (presets, lab views, library tags, recording file stems). They differ ONLY in
 * the fallback used when the name slugs to nothing, so that is the one parameter:
 * `slugId(name, 'preset')`, `slugId(name, 'view')`, `slugId(name, 'tag')`,
 * `slugId(name)` (no fallback — the recording stem sanitizer supplies its own).
 *
 * The exact transform is load-bearing: these ids are PERSISTED (localStorage
 * collection keys, tag associations, file names), so it must never change.
 */

/**
 * Lowercase slug of `text`: trim, lowercase, collapse every run of non-`[a-z0-9]`
 * characters into a single dash, and strip leading/trailing dashes. Returns
 * `fallback` when the result would be empty (default `''`, i.e. no fallback).
 *
 * Pure and deterministic (no time/random), so it is safe in tests and reproducible.
 */
export function slugId(text: string, fallback = ''): string {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || fallback
  );
}
