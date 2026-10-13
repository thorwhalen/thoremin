/**
 * Saved categories and their bindings (#160) — the trainer's model made durable and
 * playable.
 *
 * Until this module the trainer's model lived in one in-memory zustand field that a
 * reload erased and no sound path read. Now a model the player keeps is SAVED under a name
 * in a zodal collection (the {@link createNamedCollectionStore} facade: localStorage by
 * default, any `DataProvider` in tests or later), together with what each of its
 * categories does: a command binding per category id, the gesture binding's shape.
 *
 * ## Where a binding lives, and why there
 *
 * On the saved set, not on an instrument. A model is a per-player, per-device artefact
 * like a keymap (the trainer panel's own rule), and a binding means nothing without the
 * model whose ids it names, so the two travel together. Whether a trained model should
 * ride an instrument profile (#82's configuration calculus) is left open; moving the
 * bindings into a dial later is a migration of this one record, not a redesign.
 *
 * ## Hot path
 *
 * The dispatcher (`categoryDispatch.ts`) reads `active` SYNCHRONOUSLY each tick from this
 * store. The provider is only awaited on human actions (save, activate, remove), never in
 * the frame loop. A binding edit updates `active` in memory first, keeping the same MODEL
 * object (the dispatcher keys its tracker on it, so editing a binding never resets what
 * the player is holding), then persists.
 *
 * The per-device prefs (which set is active, whether binding is on, the hold) persist on
 * their own key, like the trainer's prefs, so the main store's version is untouched.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';
import { createNamedCollectionStore, type NamedCollectionStore, type NamedSummary } from '@thoremin/sdk-ui/namedCollection';
import { appFeatureDemand } from '@thoremin/sdk-ui/featureDemand';
import { FEATURE_BY_ID } from '@thoremin/sdk/features/catalog';
import { slugId } from '@thoremin/sdk/util/ids';
import { useTools } from '../toolsStore';
import {
  BoundCategoriesSchema,
  CATEGORY_EDGE_DEFAULTS,
  carryBindings,
  type BoundCategories,
  type CategoryBinding,
  type TrainedModel,
} from '@thoremin/sdk/enroll';

export const SavedCategoriesSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  categories: BoundCategoriesSchema,
});
export type SavedCategories = z.infer<typeof SavedCategoriesSchema>;
export type SavedCategoriesStore = NamedCollectionStore<SavedCategories, BoundCategories>;

/** localStorage keys (the browser default target, and the per-device prefs). */
export const SAVED_CATEGORIES_STORAGE_KEY = 'thoremin-categories';
export const CATEGORY_PREFS_STORAGE_KEY = 'thoremin-category-binding';

const CATEGORIES_ID_FALLBACK = 'categories';

/** The id a set saved under `name` gets (the collection slugs names into ids). */
export const savedCategoriesId = (name: string): string => slugId(name, CATEGORIES_ID_FALLBACK);

export const createSavedCategoriesStore = createNamedCollectionStore<SavedCategories, 'categories'>({
  schema: SavedCategoriesSchema,
  storageKey: SAVED_CATEGORIES_STORAGE_KEY,
  payloadKey: 'categories',
  idFallback: CATEGORIES_ID_FALLBACK,
});

let collection: SavedCategoriesStore | null = null;
const getCollection = (): SavedCategoriesStore => (collection ??= createSavedCategoriesStore());
/** Retarget storage (tests pass an in-memory provider's store). */
export function setSavedCategoriesStore(store: SavedCategoriesStore | null): void {
  collection = store;
}

/** The tool whose panel holds the bindings (the readout runs while it is open). */
export const CATEGORY_PANEL_TOOL = 'gestures';
/** The longest hold the panel offers. */
export const MAX_CATEGORY_HOLD_MS = 1000;
/** The feature-demand owner while binding is live. */
export const CATEGORY_DEMAND_OWNER = 'category-binding';

interface CategoryBindingState {
  /** Saved sets (metadata), newest first. */
  saved: NamedSummary[];
  /** The loaded active set, or null. What the dispatcher reads each tick. */
  active: SavedCategories | null;
  /** Persisted: the active set's id. */
  activeId: string | null;
  /** Persisted: whether entering a category dispatches its binding. */
  enabled: boolean;
  /** Persisted: how long a new category must be held before its entry fires. */
  holdMs: number;

  /** Read the collection and the active set (idempotent; the panel and the engine call it). */
  load(): Promise<void>;
  /** Save a trained model under `name`, carry bindings over by category name, make it active. */
  saveModel(name: string, model: TrainedModel): Promise<SavedCategories>;
  /** Make a saved set active (null: none). */
  activate(id: string | null): Promise<void>;
  remove(id: string): Promise<void>;
  /** Bind (or, with undefined, unbind) one category of the active set. */
  setBinding(categoryId: string, binding: CategoryBinding | undefined): Promise<void>;
  setEnabled(on: boolean): void;
  setHoldMs(ms: number): void;
}

export const useCategoryBinding = create<CategoryBindingState>()(
  persist(
    (set, get) => {
      const refreshList = async (): Promise<void> => {
        set({ saved: await getCollection().list() });
      };
      return {
        saved: [],
        active: null,
        activeId: null,
        enabled: true,
        holdMs: CATEGORY_EDGE_DEFAULTS.holdMs as number,

        async load() {
          await refreshList();
          const id = get().activeId;
          if (!id) {
            set({ active: null });
            return;
          }
          if (get().active?.id === id) return;
          const rec = await getCollection().load(id);
          // A save or a switch that landed while this read was in flight wins.
          if (get().activeId !== id || get().active?.id === id) return;
          set(rec ? { active: rec } : { active: null, activeId: null });
        },

        async saveModel(name, model) {
          const store = getCollection();
          // The record this save overwrites is the one with the same SLUG (the collection's
          // id), not the same spelling: "faces" replaces "Faces".
          const id = savedCategoriesId(name);
          const slugTwin = (await store.list()).find((s) => s.id === id);
          const previous = (slugTwin ? await store.load(slugTwin.id) : null) ?? get().active;
          const rec = await store.save(name, { model, bindings: carryBindings(previous?.categories, model) });
          set({ active: rec, activeId: rec.id });
          await refreshList();
          return rec;
        },

        async activate(id) {
          if (!id) {
            set({ active: null, activeId: null });
            return;
          }
          const rec = await getCollection().load(id);
          set({ active: rec, activeId: rec ? rec.id : null });
        },

        async remove(id) {
          await getCollection().remove(id);
          if (get().activeId === id) set({ active: null, activeId: null });
          await refreshList();
        },

        async setBinding(categoryId, binding) {
          const active = get().active;
          if (!active) return;
          const bindings = { ...active.categories.bindings };
          if (binding) bindings[categoryId] = binding;
          else delete bindings[categoryId];
          // Same `model` object: the dispatcher's tracker survives a binding edit.
          const next: SavedCategories = { ...active, categories: { ...active.categories, bindings } };
          set({ active: next });
          await getCollection().save(active.name, next.categories, active.createdAt);
        },

        setEnabled(on) {
          set({ enabled: on });
        },
        setHoldMs(ms) {
          set({ holdMs: Math.max(0, Math.min(MAX_CATEGORY_HOLD_MS, ms)) });
        },
      };
    },
    {
      name: CATEGORY_PREFS_STORAGE_KEY,
      partialize: (s) => ({ activeId: s.activeId, enabled: s.enabled, holdMs: s.holdMs }),
    },
  ),
);

/** The catalog groups a model's features belong to (what must be computed to classify). */
export function modelGroups(model: Pick<TrainedModel, 'features'>): string[] {
  const out: string[] = [];
  for (const f of model.features) {
    const g = FEATURE_BY_ID[f]?.group;
    if (g && !out.includes(g)) out.push(g);
  }
  return out;
}

/**
 * Keep the feature demand in step with binding: claim the active set's groups (so the
 * vector nodes, and the face model, compute them with the Lab and the trainer closed) only
 * while something will use them: binding is on AND at least one category is bound, or the
 * bindings panel is open (its readout). An active set with nothing bound costs nothing.
 * Returns the uninstaller (which releases the claim).
 */
export function installCategoryDemand(): () => void {
  let key = '';
  const sync = () => {
    const s = useCategoryBinding.getState();
    const bound = !!s.active && Object.keys(s.active.categories.bindings).length > 0;
    const wanted = !!s.active && ((s.enabled && bound) || useTools.getState().open === CATEGORY_PANEL_TOOL);
    const groups = wanted ? modelGroups(s.active!.categories.model) : [];
    const next = groups.join(',');
    if (next === key) return;
    key = next;
    if (groups.length) appFeatureDemand.claim(CATEGORY_DEMAND_OWNER, groups);
    else appFeatureDemand.release(CATEGORY_DEMAND_OWNER);
  };
  sync();
  const unsubscribers = [useCategoryBinding.subscribe(sync), useTools.subscribe(sync)];
  return () => {
    for (const u of unsubscribers) u();
    appFeatureDemand.release(CATEGORY_DEMAND_OWNER);
  };
}
