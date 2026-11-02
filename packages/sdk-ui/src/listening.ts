/**
 * The listening gate: whether the page may listen now (the microphone, the audio analysers, a
 * recorded microphone track). A source whose rights forbid analysing what plays (an embedded
 * player) closes it, with a reason in words; every listener asks it before it opens and closes
 * when it shuts. The song slice installs the rule ({@link provideListeningGate}); with none
 * installed the page may always listen.
 */

export interface ListeningGate {
  /** Why the page must not listen now, or null when it may. */
  refusal(): string | null;
  /** Called whenever the answer may have changed; returns the unsubscribe. */
  subscribe(fn: () => void): () => void;
}

let gate: ListeningGate | null = null;
const listeners = new Set<() => void>();
let unsubscribeGate: (() => void) | null = null;

/** Install the rule (one per page); returns the previous one. */
export function provideListeningGate(next: ListeningGate | null): ListeningGate | null {
  const was = gate;
  unsubscribeGate?.();
  gate = next;
  unsubscribeGate = next ? next.subscribe(() => listeners.forEach((l) => l())) : null;
  listeners.forEach((l) => l());
  return was;
}

/** Why the page must not listen now, or null when it may. */
export function listeningRefusal(): string | null {
  return gate?.refusal() ?? null;
}

/** Called whenever the refusal may have changed (a source opened or closed). */
export function onListeningChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** A thrown refusal, so a caller tells it from a failure. */
export class ListeningRefused extends Error {
  readonly refused = true;
  constructor(reason: string) {
    super(reason);
    this.name = 'ListeningRefused';
  }
}
