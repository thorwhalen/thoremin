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
 *
 * The Trainer keeps what it trained through the same seam (#600 S16c): it saves a trained model
 * under a name (`saveModel`, which carries the bindings over by category name), offers the
 * active Trainer set's name as the default, and warns when a name overwrites a saved one.
 */
export interface CategoryBinder {
  /** Make the saved categorizer `id` the active bound set, and show its bindings. Rejects when
   *  the collection has no such record. */
  bind(set: { id: string }): Promise<void>;
  /** Read the collection and the active set (idempotent). */
  load(): Promise<void>;
  /** Keep a trained model under `name` and make it the active set; resolves with its id. */
  saveModel(name: string, model: TrainedModel): Promise<{ id: string }>;
  /** The active set's name and kind, or null. */
  active(): { name: string; kind: string } | null;
  /** Every saved categorizer (id, name, kind), newest first: a React hook, re-rendering on change. */
  useSaved(): readonly { id: string; name: string; kind: string }[];
}

import type { TrainedModel } from '@thoremin/sdk/enroll';

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
