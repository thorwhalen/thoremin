/**
 * Asking a carve tool for a take in a context (#383): the Conductor tool's "Teach my conducting
 * poses" opens "Your poses" with the conductor's default names (`ready`, `fermata`, `cut-off`,
 * `rest`). The host's panel cannot import an extension's session store, and the extension may not
 * be loaded yet (it is lazy), so the request waits HERE until the tool's session takes it: on its
 * creation, or at once when it already exists. One request per modality; a newer one replaces it.
 */

/** What a carve tool is asked for: the default-name vocabulary of its next take. */
export interface CarveRequest {
  /** The vocabulary id (the body's `conductor`); null: chosen by coverage. */
  vocabulary: string | null;
}

const pending = new Map<string, CarveRequest>();
const listeners = new Set<(modality: string) => void>();

/** Ask the carve tool of `modality` (`body`) for its next take's context. */
export function requestCarve(modality: string, request: CarveRequest): void {
  pending.set(modality, request);
  for (const l of [...listeners]) l(modality);
}

/** Take (and clear) the pending request for `modality`, if any. */
export function takeCarveRequest(modality: string): CarveRequest | null {
  const r = pending.get(modality) ?? null;
  pending.delete(modality);
  return r;
}

/** Be told when a request for some modality arrives; returns the unsubscribe. */
export function onCarveRequest(listener: (modality: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
