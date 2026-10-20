/**
 * Saved categories and their bindings (#160), over the ONE collection of categorizers (#371).
 *
 * A model the player keeps is a record of `thoremin.categorizers` (`@thoremin/sdk-ui/enroll/
 * categorizers`): a carved categorizer of any modality (Your faces, Your hand shapes, Your poses)
 * or a trained model kept as it is (the Trainer's "Save and bind"). What each of its categories
 * does, a command binding per category id (the gesture binding's shape), rides the same record.
 * This store is the host's view of that collection: every kind is listed, one is ACTIVE, and the
 * dispatcher (`categoryDispatch.ts`) plays the active one.
 *
 * ## Bindings are keyed by categorizer id
 *
 * Before #371 a carved categorizer was bound by handing a COPY of its model to a second
 * collection (`thoremin-categories`), so an edit in its tool needed a re-bind. Now the bindings
 * sit on the categorizer's own record and the playable model is DERIVED from the record (its
 * samples, its tuning, its modality and hand; `playable`), so a correction, a re-cut or a tuning
 * change in the tool reaches the bindings at once, carried by name across a re-cut by the
 * collection. A carved categorizer is played through the same live model its tool tests it with
 * (`@thoremin/sdk/enroll/live`), sensitivity and distance included (#453).
 *
 * The old collection is migrated once per device (`./boundSets.ts`) and kept readable; the
 * contract step (#385 E10) removes it.
 *
 * ## Where a binding lives, and why there
 *
 * On the categorizer's record, on this device, never in its exported file. A model is a
 * per-player, per-device artefact like a keymap, and a binding means nothing without the model
 * whose ids it names, so the two travel together. Whether a trained model should ride an
 * instrument profile (#82's configuration calculus) is left open.
 *
 * ## Hot path
 *
 * The dispatcher reads `active` SYNCHRONOUSLY each tick from this store. The collection is only
 * awaited on human actions (save, activate, remove, a tool's edit), never in the frame loop. A
 * binding edit updates `active` in memory first, keeping the same MODEL object (the dispatcher
 * keys its tracker on it, so editing a binding never resets what the player is holding), then
 * persists; a tool's edit that leaves the model as it was does not replace it either.
 *
 * The per-device prefs (which set is active, whether binding is on, the hold) persist on
 * their own key, like the trainer's prefs, so the main store's version is untouched.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { hostValues, noopValues } from '@thoremin/sdk-ui/storage';
import { z } from 'zod';
import { appFeatureDemand } from '@thoremin/sdk-ui/featureDemand';
import { FEATURE_BY_ID } from '@thoremin/sdk/features/catalog';
import { modalityById } from '@thoremin/sdk/features/modalities';
import { provideCategoryBinder } from '@thoremin/sdk-ui/enroll/binder';
import { createCategorizerIndex, onCategorizersChanged, type CategorizerIndex, type CategorizerStoreOptions, type CategorizerSummary } from '@thoremin/sdk-ui/enroll/categorizers';
import { TRAINED_KIND, isTrainedRecord, recordBindings, trainedId, type AnyCategorizerRecord } from '@thoremin/sdk/enroll/record';
import { liveModel, tuneVector } from '@thoremin/sdk/enroll/live';
import { useTools } from '../tools/toolsStore';
import { useToasts } from '../shell/toasts';
import {
  CATEGORY_EDGE_DEFAULTS,
  carryBindings,
  type BoundCategories,
  type CategoryBinding,
  type CategoryRead,
  type TrainedModel,
  type FeatureVector,
} from '@thoremin/sdk/enroll';
import { createReader } from '@thoremin/sdk/enroll/modality';
import { migrateBoundSetsOnce, resetBoundSetsMigration, type BoundSetsMigrationOptions } from './boundSets';

/** One saved categorizer, ready to play: its model (derived from a carved categorizer's record,
 *  or kept as is), its bindings and how it reads the live vector. */
export interface SavedCategories {
  id: string;
  name: string;
  createdAt: number;
  /** The record's kind: a modality (`face`, `hand`, `body`) or `trained` (absent: `trained`). */
  kind?: string;
  categories: BoundCategories;
  /** A carved categorizer's live tuning (sensitivity, distance), applied to the vector `read`
   *  gives before it is classified; absent when the tuning leaves the vector as it is. */
  tune?: (vector: FeatureVector) => FeatureVector;
}

/** The host's view of the one collection (every kind). */
export type SavedCategoriesStore = CategorizerIndex;

/** The per-device prefs' localStorage key. */
export const CATEGORY_PREFS_STORAGE_KEY = 'thoremin-category-binding';

/** The id a model the Trainer saves under `name` gets (`trained:<slug>`). */
export const savedCategoriesId = (name: string): string => trainedId(name);

/** The host's index over the collection (`provider`: where it lives; localStorage by default). */
export function createSavedCategoriesStore(provider?: CategorizerStoreOptions['provider']): SavedCategoriesStore {
  return createCategorizerIndex(provider ? { provider } : {});
}

let collection: SavedCategoriesStore | null = null;
let migration: BoundSetsMigrationOptions = {};
const getCollection = (): SavedCategoriesStore => (collection ??= createSavedCategoriesStore());
/** Retarget storage (tests pass an index over an in-memory provider; null: the default). The old
 *  bound sets are migrated into it from `options.legacy` (none for an injected index, unless given). */
export function setSavedCategoriesStore(store: SavedCategoriesStore | null, options: BoundSetsMigrationOptions = {}): void {
  collection = store;
  migration = store ? { legacy: null, ...options } : options;
  resetBoundSetsMigration();
}

/**
 * The playable view of a record. A carved categorizer is read the way its tool reads it: the live
 * model of its samples under its tuning (per-category sizes, the floored reject radius), through
 * its modality with its hand and mirror, the sensitivity and distance tuning applied to each
 * frame. A trained model is played as kept. Throws if a carved categorizer cannot be derived.
 */
export function playable(record: AnyCategorizerRecord): SavedCategories {
  const base = { id: record.id, name: record.name, createdAt: record.createdAt };
  const bindings = recordBindings(record);
  if (isTrainedRecord(record)) {
    const { trained, read } = record.model;
    return { ...base, kind: TRAINED_KIND, categories: { model: trained, bindings, ...(read ? { read } : {}) } };
  }
  const { categorizer, tuning } = record.model;
  const kind = categorizer.modality ?? 'face';
  const modality = modalityById(kind);
  const live = liveModel(categorizer, tuning ?? {}, modality ? { modality } : {});
  const read: CategoryRead = { modality: kind, ...(categorizer.hand && categorizer.hand !== 'either' ? { hand: categorizer.hand } : {}), ...(categorizer.mirror ? { mirror: true } : {}) };
  const tunes = live.tuning.sensitivity !== 1 || live.tuning.distance > 0;
  return { ...base, kind, categories: { model: live.model, bindings, read }, ...(tunes ? { tune: (v: FeatureVector) => tuneVector(live, v) } : {}) };
}

/** What the playable model is made of: a record whose key is unchanged plays the same model. */
function modelKey(record: AnyCategorizerRecord): string {
  return JSON.stringify(isTrainedRecord(record) ? [record.model.trained, record.model.read] : [record.model.categorizer, record.model.tuning]);
}

/** The playable view of `record`, or null (with a warning) when it cannot be derived. */
function tryPlayable(record: AnyCategorizerRecord | null): SavedCategories | null {
  if (!record) return null;
  try {
    return playable(record);
  } catch (e) {
    console.warn(`category bindings: "${record.name}" cannot be played:`, e);
    return null;
  }
}

/** How long a binding that could not be saved is announced (ms). */
const BINDING_ERROR_TOAST_MS = 5000;

/** The tool whose panel holds the bindings (the readout runs while it is open). */
export const CATEGORY_PANEL_TOOL = 'gestures';
/** The longest hold the panel offers. */
export const MAX_CATEGORY_HOLD_MS = 1000;
/** The feature-demand owner while binding is live. */
export const CATEGORY_DEMAND_OWNER = 'category-binding';

/** A hold in range: [0, MAX_CATEGORY_HOLD_MS] (NaN reads as the default hold). */
function clampHoldMs(ms: number): number {
  const n = Number.isNaN(ms) ? (CATEGORY_EDGE_DEFAULTS.holdMs as number) : ms;
  return Math.max(0, Math.min(MAX_CATEGORY_HOLD_MS, n));
}

/** The persisted prefs healed field by field (a hand-edited or older blob must not put a
 *  string or a ten-second hold into the dispatcher's tick): a field that does not parse
 *  keeps the current value, and the hold is clamped like `setHoldMs` clamps it. */
function healPrefs(
  persisted: unknown,
  current: Pick<CategoryBindingState, 'activeId' | 'enabled' | 'holdMs'>,
): Pick<CategoryBindingState, 'activeId' | 'enabled' | 'holdMs'> {
  const p = persisted && typeof persisted === 'object' ? (persisted as Record<string, unknown>) : {};
  const activeId = z.string().nullable().safeParse(p.activeId);
  const enabled = z.boolean().safeParse(p.enabled);
  return {
    activeId: activeId.success ? activeId.data : current.activeId,
    enabled: enabled.success ? enabled.data : current.enabled,
    holdMs: typeof p.holdMs === 'number' && !Number.isNaN(p.holdMs) ? clampHoldMs(p.holdMs) : current.holdMs,
  };
}

interface CategoryBindingState {
  /** Every saved categorizer (metadata and kind), newest first. */
  saved: CategorizerSummary[];
  /** The active one, ready to play, or null. What the dispatcher reads each tick. */
  active: SavedCategories | null;
  /** Persisted: the active one's id. */
  activeId: string | null;
  /** Persisted: whether entering a category dispatches its binding. */
  enabled: boolean;
  /** Persisted: how long a new category must be held before its entry fires. */
  holdMs: number;

  /** Read the collection and the active one (idempotent; the panel and the engine call it). The
   *  old bound sets are migrated first, once. */
  load(): Promise<void>;
  /** Keep a trained model (the Trainer's) under `name`, carry bindings over by category name
   *  (from the trained model of that name, else the active one), make it active. */
  saveModel(name: string, model: TrainedModel): Promise<SavedCategories>;
  /** Make a saved categorizer active (null: none). */
  activate(id: string | null): Promise<void>;
  /** Delete a saved record (the panel offers it for a trained model only: a carved categorizer
   *  is deleted in its own tool). */
  remove(id: string): Promise<void>;
  /** Bind (or, with undefined, unbind) one category of the active one. */
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
      // The last REQUESTED switch of the active set wins, not the last to resolve: every
      // switch (activate, save) takes a ticket, and a load that returns after a newer
      // ticket was taken is dropped (a slow read of A must not undo a later pick of B).
      let ticket = 0;
      /** The record key the active model was derived from (a re-read that finds it unchanged keeps
       *  the model object, so the dispatcher's tracker survives). */
      let activeKey = '';
      const show = (record: AnyCategorizerRecord | null): void => {
        const next = tryPlayable(record);
        activeKey = record && next ? modelKey(record) : '';
        set(next ? { active: next, activeId: next.id } : { active: null, activeId: null });
      };

      // A tool saved or deleted a categorizer: list again, and re-read the active one. Same model:
      // keep it, take the stored bindings (a re-cut moved them by name); deleted: none is active.
      onCategorizersChanged(() => {
        void (async () => {
          await refreshList();
          const active = get().active;
          if (!active) return;
          const mine = ticket;
          const record = await getCollection().load(active.id);
          if (mine !== ticket || get().active?.id !== active.id) return;
          if (record && modelKey(record) === activeKey) {
            const bindings = recordBindings(record);
            if (JSON.stringify(bindings) !== JSON.stringify(active.categories.bindings)) set({ active: { ...active, categories: { ...active.categories, bindings } } });
            return;
          }
          show(record);
        })().catch((e: unknown) => console.warn('category bindings: could not re-read the active categorizer:', e));
      });

      return {
        saved: [],
        active: null,
        activeId: null,
        enabled: true,
        holdMs: CATEGORY_EDGE_DEFAULTS.holdMs as number,

        async load() {
          const remap = await migrateBoundSetsOnce(getCollection(), migration);
          const persisted = get().activeId;
          if (persisted && remap.has(persisted) && !get().active) set({ activeId: remap.get(persisted)! });
          await refreshList();
          const id = get().activeId;
          if (!id) {
            set({ active: null });
            return;
          }
          if (get().active?.id === id) return;
          const store = getCollection();
          // An id kept from before #371 that no migration remapped (another tab ran it): the
          // Trainer's sets are `trained:<id>` now.
          const rec = (await store.load(id)) ?? (id.includes(':') ? null : await store.load(trainedId(id)));
          // A save or a switch that landed while this read was in flight wins.
          if (get().activeId !== id || get().active?.id === id) return;
          show(rec);
        },

        async saveModel(name, model) {
          const store = getCollection();
          const mine = ++ticket;
          // The record this save overwrites is the one with the same SLUG (the collection's
          // id), not the same spelling: "faces" replaces "Faces".
          const previous = tryPlayable(await store.load(savedCategoriesId(name))) ?? get().active;
          const rec = await store.saveTrained(name, { trained: model, bindings: carryBindings(previous?.categories, model) });
          const out = playable(rec);
          // Saved either way; it becomes active only if no newer switch was asked for.
          if (mine === ticket) show(rec);
          await refreshList();
          return out;
        },

        async activate(id) {
          const mine = ++ticket;
          if (!id) {
            activeKey = '';
            set({ active: null, activeId: null });
            return;
          }
          const rec = await getCollection().load(id);
          if (mine !== ticket) return;
          show(rec);
        },

        async remove(id) {
          await getCollection().remove(id);
          if (get().activeId === id) {
            activeKey = '';
            set({ active: null, activeId: null });
          }
          await refreshList();
        },

        async setBinding(categoryId, binding) {
          const active = get().active;
          if (!active) return;
          const bindings = { ...active.categories.bindings };
          if (binding) bindings[categoryId] = binding;
          else delete bindings[categoryId];
          // Same `model` object: the dispatcher's tracker survives a binding edit.
          set({ active: { ...active, categories: { ...active.categories, bindings } } });
          const saved = await getCollection().setBindings(active.id, bindings).catch((e: unknown) => {
            console.warn('category bindings: the binding was not saved:', e);
            return null;
          });
          if (saved) return;
          // Not kept (the record was deleted, or a newer build wrote it): show what is stored, and say so.
          const now = get().active;
          if (now?.id === active.id) set({ active: { ...now, categories: { ...now.categories, bindings: active.categories.bindings } } });
          useToasts.getState().push(`"${active.name}" could not be saved: the binding was not kept`, BINDING_ERROR_TOAST_MS, 'error');
        },

        setEnabled(on) {
          set({ enabled: on });
        },
        setHoldMs(ms) {
          set({ holdMs: clampHoldMs(ms) });
        },
      };
    },
    {
      name: CATEGORY_PREFS_STORAGE_KEY,
      // The host's key-value target (the storage seam, #659: localStorage in the browser, as
      // zustand's default was); a no-op where the host has none (Node).
      storage: createJSONStorage(() => hostValues(noopValues)),
      partialize: (s) => ({ activeId: s.activeId, enabled: s.enabled, holdMs: s.holdMs }),
      merge: (persisted, current) => ({ ...current, ...healPrefs(persisted, current) }),
    },
  ),
);

/** The catalog groups a model's features belong to (what must be computed to classify). A set
 *  read through a carve modality (#385 E8) claims that modality's groups: its features are the
 *  modality's own keys (a hand's side-relative ids), which the catalog does not name. */
export function modelGroups(model: Pick<TrainedModel, 'features'>, read?: CategoryRead): string[] {
  const modality = read ? modalityById(read.modality) : undefined;
  if (modality) return [...modality.groups];
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
    const groups = wanted ? modelGroups(s.active!.categories.model, s.active!.categories.read) : [];
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

/** The live vector as `read` says (#385 E8: a carved hand categorizer's one hand, side-relative;
 *  #382: a mirrored pose set reads each frame on the side nearer `model`'s categories); as is
 *  without one, or for a modality this build does not know. */
export function readFor(read: CategoryRead | undefined, model?: TrainedModel): (vector: FeatureVector) => FeatureVector {
  const modality = read ? modalityById(read.modality) : undefined;
  if (!modality) return (v) => v;
  return createReader(modality, { hand: read!.hand ?? 'either', mirror: read!.mirror === true }, model);
}

/** The share of a bound set's features a reading needs to count (#382): the modality's own bar
 *  (a body's `minCoverage`, the bar its live test reads with), else the edge's default. */
export function presenceFor(read: CategoryRead | undefined): number | undefined {
  return read ? modalityById(read.modality)?.minCoverage : undefined;
}

// The host's binder (#385 E8; by id since #371): an extension's carve tool binds one of its saved
// categorizers here, and the Gestures tool shows it for the player to give each category a command.
// The Trainer keeps its model through the same seam (#600 S16c): save, the default name, the list.
provideCategoryBinder({
  async bind({ id }) {
    const state = useCategoryBinding.getState();
    await state.load();
    await state.activate(id);
    if (useCategoryBinding.getState().activeId !== id) throw new Error('that categorizer is not in the collection');
    useTools.getState().openTool(CATEGORY_PANEL_TOOL);
  },
  load: () => useCategoryBinding.getState().load(),
  saveModel: async (name, model) => ({ id: (await useCategoryBinding.getState().saveModel(name, model)).id }),
  active: () => {
    const active = useCategoryBinding.getState().active;
    return active ? { name: active.name, kind: active.kind ?? TRAINED_KIND } : null;
  },
  useSaved: () => useCategoryBinding((s) => s.saved),
});
