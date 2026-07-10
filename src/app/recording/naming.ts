/**
 * Recording naming — pure, browser-independent helpers that compose the
 * folder/file names for a recording session (#88). The folder name IS the file
 * stem, so every file self-identifies even when moved out of its folder. Kept
 * pure and unit-testable, mirroring the existing `recordingFilename`/`extForMime`
 * helpers in `../recorder` (which this supersedes for the multi-stream flow).
 *
 * Naming scheme (see issue #88 §3): an info-carrying stem + a type-carrying
 * primary extension, with a role as a SECONDARY extension when several streams
 * share a primary ext, e.g. `demo-theremin-2026-07-05T14-30-12.overlay.webm`.
 */

/** A filesystem-safe timestamp, e.g. `2026-07-05T14-30-12` (colons/millis
 * dropped; the `T` and dashes are safe on every filesystem and stay sortable).
 * Accepts a `Date` or an ISO string so callers can pass a deterministic stamp in
 * tests (the runtime passes `new Date()`). */
export function compactStamp(dateOrIso: Date | string): string {
  const iso = typeof dateOrIso === 'string' ? dateOrIso : dateOrIso.toISOString();
  return iso
    .replace(/\.\d+Z?$/, '') // drop fractional seconds (+ trailing Z if present)
    .replace(/Z$/, '') // drop a bare trailing Z (no millis case)
    .replace(/:/g, '-'); // colons are illegal on Windows / awkward everywhere
}

/** Lowercase slug for an id-like token (tag / instrument), mirroring `presetId`. */
function slugToken(token: string): string {
  return token
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The prefilled recording name: `{tag?-}{instrument}-{stamp}`. The tag and
 * instrument are slugged (id-like), the stamp is kept verbatim (already safe and
 * sortable). Empty/absent tokens are skipped so a missing tag leaves no `--`.
 */
export function prefillName({
  instrument,
  tag,
  date,
}: {
  instrument: string;
  tag?: string;
  date: Date | string;
}): string {
  const parts = [tag, instrument].map((t) => (t ? slugToken(t) : '')).filter(Boolean);
  return recordingStem(`${parts.join('-')}-${compactStamp(date)}`);
}

/**
 * Sanitize a (possibly user-overwritten) name into a filesystem-safe stem: keep
 * `[A-Za-z0-9_-]` (so an uppercase `T` in the timestamp survives), turn any run
 * of other characters — dots included, to keep the `stem.role.ext` structure
 * unambiguous — into a single dash, and trim leading/trailing separators. Falls
 * back to `recording` for an empty result.
 */
export function recordingStem(name: string): string {
  return (
    name
      .trim()
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-_]+|[-_]+$/g, '') || 'recording'
  );
}

/**
 * Compose one file name from a stem: `{stem}.{role?}.{ext}`. The role is the
 * secondary extension that disambiguates streams sharing a primary ext (three
 * `.webm` videos → `.overlay.webm` / `.camera.webm` / `.alpha.webm`); omit it
 * for a stream whose primary ext is already unique (native audio `.webm`,
 * `.wav`). `ext` is given without a leading dot.
 */
export function fileName(stem: string, { role, ext }: { role?: string; ext: string }): string {
  return `${stem}${role ? `.${role}` : ''}.${ext}`;
}
