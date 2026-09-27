/**
 * The player's tool pins, live (Round 4, #271) — which tools have their own button in the
 * bar. The bar reads this synchronously every render; the choices persist through the
 * pins' `DataProvider` (`toolsCollection.ts`), which this store hydrates from once and
 * writes through on every change. A write never waits: the button moves at once, and a
 * failed save is logged, not surfaced (the pin still holds for the session).
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { DataProvider } from '@zodal/store';
import { createToolPinsProvider, loadPins, savePin, type ToolPin } from './toolsCollection';

export interface ToolPinsState {
  /** The player's choices by tool id; a tool absent here uses its `defaultPinned`. */
  choices: Record<string, boolean>;
  /** True once the stored choices have been read. */
  hydrated: boolean;
  /** Read the stored choices (idempotent). Choices made before it resolves win. */
  hydrate(): Promise<void>;
  /** Pin or unpin a tool, and persist it. */
  setPinned(id: string, pinned: boolean): void;
}

/** A pins store over `provider` (tests pass an in-memory one). */
export function createToolPinsStore(
  provider: DataProvider<ToolPin> = createToolPinsProvider(),
): UseBoundStore<StoreApi<ToolPinsState>> {
  let hydrating: Promise<void> | null = null;
  return create<ToolPinsState>()((set) => ({
    choices: {},
    hydrated: false,
    hydrate() {
      hydrating ??= loadPins(provider)
        .then((stored) => set((s) => ({ choices: { ...stored, ...s.choices }, hydrated: true })))
        .catch((err) => {
          console.warn('[thoremin] could not read the tool pins; using the defaults', err);
          set({ hydrated: true });
        });
      return hydrating;
    },
    setPinned(id, pinned) {
      set((s) => ({ choices: { ...s.choices, [id]: pinned } }));
      savePin(provider, { id, pinned }).catch((err) =>
        console.warn(`[thoremin] could not save the pin for '${id}'`, err),
      );
    },
  }));
}

/** The app's pins, persisted to localStorage. */
export const useToolPins = createToolPinsStore();
