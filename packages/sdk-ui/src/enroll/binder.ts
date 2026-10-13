/**
 * The command-binding target of a carved categorizer (#385 E8), as a HOST seam: an extension's
 * tool ("Your hand shapes") hands a categorizer's model to the host's category bindings (the
 * Gestures tool's "Your categories", `src/app/enroll/categoryBinding.ts`), where each category
 * gets a command. The host installs the binder when its bindings module loads; the extension
 * never imports the app.
 *
 * The set carries how it reads the live vector (`read`: the modality, and a hand's side), so
 * the dispatcher reads it the way the tool that carved it did.
 */
import type { CategoryRead } from '@thoremin/sdk/enroll/bind';
import type { TrainedModel } from '@thoremin/sdk/enroll/types';

export interface CategoryBinder {
  /** Save `model` as a bindable set under `name` (a set of that name is replaced, its bindings
   *  carried over by category name), make it the active one, and show its bindings. */
  bind(set: { name: string; model: TrainedModel; read?: CategoryRead }): Promise<void>;
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
