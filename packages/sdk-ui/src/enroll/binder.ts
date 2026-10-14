/**
 * The command-binding target of a carved categorizer (#385 E8), as a HOST seam: an extension's
 * tool ("Your faces", "Your hand shapes", "Your poses") asks the host's category bindings (the
 * Gestures tool's "Your categories", `src/app/enroll/categoryBinding.ts`) to bind one of its saved
 * categorizers, where each category gets a command. The host installs the binder when its
 * bindings module loads; the extension never imports the app.
 *
 * Since #371 a categorizer is bound BY ID: the bindings ride its record in the one collection
 * (`./categorizers.ts`) and the host derives the playable model from the record itself, so an edit
 * in the tool reaches the bindings with no re-bind (it handed over a copy of the model before).
 */
export interface CategoryBinder {
  /** Make the saved categorizer `id` the active bound set, and show its bindings. Rejects when
   *  the collection has no such record. */
  bind(set: { id: string }): Promise<void>;
}

let current: CategoryBinder | null = null;

/** Provide (or with null, withdraw) the host's binder. Returns a withdraw that only removes this
 *  one. */
export function provideCategoryBinder(binder: CategoryBinder | null): () => void {
  current = binder;
  return () => {
    if (current === binder) current = null;
  };
}

/** The host's binder, or null in a host with no category bindings (a headless test). */
export function categoryBinder(): CategoryBinder | null {
  return current;
}
