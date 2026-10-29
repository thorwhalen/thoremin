/**
 * Every key the app keeps in the browser, in one registry with its owner (#600 S12). Core's own
 * keys are listed here (the shell's, the SDK's app half's and taglog's: the packages core ships);
 * an extension declares its own (`Extension.stores`) and the contribution registry folds them in,
 * refusing a key two owners claim (`src/host/contributions.ts`). `test/storage_keys.test.ts` fails
 * on a key the code writes that is not listed, and on a listed key the code no longer writes.
 *
 * The keys are the ones shipped, verbatim: listing them moves no data. Renaming them (to
 * `thoremin.ext.<id>.<name>`, say) is optional and not scheduled, because a player would see
 * nothing for it but a migration.
 */

/** Where a key lives. */
export type StorageKind = 'localStorage' | 'indexedDB';

/** One registered key. */
export interface StorageKeyEntry {
  /** The localStorage key, IndexedDB database name, or (with `prefix`) the start of a family. */
  key: string;
  kind: StorageKind;
  /** Who writes it: `core` (the shell), `sdk-ui`, `taglog`, or an extension's id. */
  owner: string;
  /** One line: what it holds. */
  purpose: string;
  /** A family of keys sharing this start (one per AI provider), rather than one key. */
  prefix?: true;
}

const ls = (key: string, owner: string, purpose: string): StorageKeyEntry => ({ key, kind: 'localStorage', owner, purpose });
const idb = (key: string, owner: string, purpose: string): StorageKeyEntry => ({ key, kind: 'indexedDB', owner, purpose });

/** Core's keys: the shell's, the SDK app half's (`packages/sdk-ui`) and taglog's. */
export const CORE_STORAGE_KEYS: readonly StorageKeyEntry[] = [
  // The hot store and the shell's per-device stores.
  ls('thoremin-controls', 'core', 'the live controls: dials, device prefs and their slice versions'),
  ls('thoremin-category-binding', 'core', 'the category binding store'),
  // Named collections. Through the storage seam: every `createNamedCollectionStore` collection,
  // and since #659 the bar pins, the Instruments view, the library tags and the annotation tag
  // sets. Still their own localStorage provider: the tool pins, the categorizer copies, the bound
  // sets, the instrument meta, the profiles and the zustand persist stores (#659 lists them).
  ls('thoremin-presets', 'core', 'settings presets'),
  ls('thoremin.toolPins', 'core', 'which shell tools keep a bar button'),
  ls('thoremin.audio.inputStage', 'core', 'this device\'s measured microphone input stage (the audio-input hub)'),
  ls('thoremin.instrumentsView', 'core', 'the Instruments view\'s remembered choices'),
  // The instrument library.
  ls('thoremin.instruments', 'core', 'the saved instruments (profiles)'),
  ls('thoremin.instruments.seedVersion', 'core', 'which seed instruments were written'),
  ls('thoremin.instruments.selected', 'core', 'the selected instrument'),
  ls('thoremin.instruments.default', 'core', 'the default instrument'),
  ls('thoremin.library.tags', 'core', 'the library\'s tags'),
  ls('thoremin.library.instrumentMeta', 'core', 'favourites and tags per instrument'),
  // Category bindings: the old collection, read once by its migration, and its flag.
  ls('thoremin-categories', 'core', 'the old bound category sets (migrated from, kept readable)'),
  ls('thoremin.categorizers.boundSetsMigrated', 'core', 'whether the bound sets were migrated'),
  // Recording.
  ls('recording.session.last', 'core', 'the last recording session\'s settings'),
  idb('thoremin-recording', 'core', 'the chosen takes folder\'s handle'),
  // The AI assistant and the generative layer's provider keys.
  { key: 'thoremin:plugin:assistant:apiKey:', kind: 'localStorage', owner: 'core', purpose: 'an AI provider\'s API key, one per provider', prefix: true },
  ls('thoremin:plugin:assistant:history', 'core', 'the assistant\'s chat history'),
  ls('thoremin:plugin:assistant:settings', 'core', 'the assistant\'s settings'),
  // The SDK's app half (`packages/sdk-ui`).
  ls('thoremin-trainer-voice', 'sdk-ui', 'the trainer\'s spoken-cue voice'),
  ls('thoremin-sequences', 'sdk-ui', 'the trainer\'s scripted sequences'),
  ls('thoremin.barPins', 'sdk-ui', 'the carve bars\' pinned features'),
  ls('thoremin.categorizers', 'sdk-ui', 'the categorizers (the localStorage copy and fallback)'),
  idb('thoremin-categorizers', 'sdk-ui', 'the categorizers (the one collection)'),
  ls('thoremin.categorizers.idbMigrated', 'sdk-ui', 'whether the categorizers moved to IndexedDB'),
  ls('thoremin.faceCategorizers', 'sdk-ui', 'the old face categorizers (migrated from, kept readable)'),
  ls('thoremin.categorizers.migrated', 'sdk-ui', 'whether the face categorizers were migrated'),
  // taglog (`packages/taglog`).
  ls('taglog.tagsets', 'taglog', 'the annotation tag sets'),
];
