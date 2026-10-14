/**
 * The player's pinned feature bars (#402; design C.4.1, C.3.1): per carve modality, the features
 * the live bars always show, above the ones the bars choose. A per-DEVICE preference (which
 * features this player watches on this camera), not part of a categorizer or an instrument.
 *
 * The bars read the pins synchronously at UI rate, so the live state is a zustand store; it
 * persists through a `DataProvider` (localStorage by default), hydrated once and written through
 * on every change, as the tool pins are (`src/app/toolPins.ts`): zustand for what renders, zodal
 * for what persists. A write never waits, and a failed save is logged, not surfaced.
 */
import { z } from 'zod';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { createInMemoryProvider, type DataProvider } from '@zodal/store';
import { createLocalStorageProvider } from '@zodal/store-localstorage';
import { BARS_DEFAULTS } from '@thoremin/sdk/enroll/bars';

export const BAR_PINS_DEFAULTS = {
  /** The most features pinned per modality: one fewer than the bars show, so at least one bar
   *  is always the bars' own choice. */
  max: BARS_DEFAULTS.count - 1,
} as const;

/** One modality's pins: the record's id is the modality id (`face`, `hand`, `body`). */
export const BarPinsSchema = z.object({
  id: z.string().min(1),
  pinned: z.array(z.string().min(1)).max(BAR_PINS_DEFAULTS.max),
});
export type BarPins = z.infer<typeof BarPinsSchema>;

/** localStorage key (the browser default target). */
export const BAR_PINS_STORAGE_KEY = 'thoremin.barPins';

/** The pins' provider: localStorage in the browser, in memory where there is none. */
export function createBarPinsProvider(): DataProvider<BarPins> {
  return typeof localStorage === 'undefined'
    ? createInMemoryProvider<BarPins>([], { idField: 'id' })
    : createLocalStorageProvider<BarPins>({ storageKey: BAR_PINS_STORAGE_KEY, idField: 'id' });
}

const NONE: readonly string[] = Object.freeze([]);

export interface BarPinsState {
  /** The pinned feature ids by modality id. */
  pins: Readonly<Record<string, readonly string[]>>;
  hydrated: boolean;
  /** Read the stored pins (idempotent). Pins set before it resolves win. */
  hydrate(): Promise<void>;
  /** Set a modality's pins (deduplicated, at most {@link BAR_PINS_DEFAULTS.max}), and persist them. */
  setPinned(modality: string, ids: readonly string[]): void;
}

/** A modality's pins in `state` (the same empty array when it has none: a stable selector). */
export function pinsOf(state: Pick<BarPinsState, 'pins'>, modality: string): readonly string[] {
  return state.pins[modality] ?? NONE;
}

async function save(provider: DataProvider<BarPins>, record: BarPins): Promise<void> {
  if (provider.upsert) {
    await provider.upsert(record);
    return;
  }
  const exists = await provider.getOne(record.id).then(
    () => true,
    () => false,
  );
  if (exists) await provider.update(record.id, record);
  else await provider.create(record);
}

/** A pins store over `provider` (tests pass an in-memory one). */
export function createBarPinsStore(provider: DataProvider<BarPins> = createBarPinsProvider()): UseBoundStore<StoreApi<BarPinsState>> {
  let hydrating: Promise<void> | null = null;
  return create<BarPinsState>()((set) => ({
    pins: {},
    hydrated: false,
    hydrate() {
      hydrating ??= provider
        .getList({})
        .then(({ data }) => {
          const stored: Record<string, readonly string[]> = {};
          for (const raw of data) {
            const r = BarPinsSchema.safeParse(raw);
            if (r.success) stored[r.data.id] = r.data.pinned;
          }
          set((s) => ({ pins: { ...stored, ...s.pins }, hydrated: true }));
        })
        .catch((err) => {
          console.warn('[thoremin] could not read the pinned bars', err);
          set({ hydrated: true });
        });
      return hydrating;
    },
    setPinned(modality, ids) {
      const pinned = [...new Set(ids)].slice(0, BAR_PINS_DEFAULTS.max);
      set((s) => ({ pins: { ...s.pins, [modality]: pinned } }));
      save(provider, BarPinsSchema.parse({ id: modality, pinned })).catch((err) =>
        console.warn(`[thoremin] could not save the pinned bars for '${modality}'`, err),
      );
    },
  }));
}

/** The app's pinned bars, persisted to localStorage. */
export const useBarPins = createBarPinsStore();
