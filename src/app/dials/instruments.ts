/**
 * Instruments — named saved settings configs (the word freed by the timbre
 * "instrument" → "sound" rename). An instrument is a dials profile: a NAME + a full
 * {@link Layer} (a complete settings snapshot). Persisted to localStorage via
 * dials-ui's `createProfileStore`, falling back to in-memory storage where
 * localStorage is unavailable (the Node test runtime), so importing this never throws.
 *
 * This module owns the instruments orchestration over the dials store: seeding the
 * shipped instruments on first run, selecting an instrument (load it as the clean
 * dirty-baseline, so editing dirties and re-selecting reverts), committing the working
 * layer into a named instrument (Save / Save-as-new), and restoring the session.
 *
 * RESUME comes from the synchronous hot store, NOT a separate autosave: the dials store
 * is seeded at module init from the persisted `useControls` (localStorage key
 * thoremin-controls, written synchronously on every edit), so the working layer already
 * reflects the last session — including unsaved edits — with no debounce window to lose
 * edits across a reload. {@link restoreSession} keeps that working layer and only sets
 * the dirty baseline to the selected instrument. {@link LAST_MODIFIED} is a reserved
 * name kept solely so any legacy autosave profile is filtered out of the visible list.
 */
import {
  createProfileStore,
  createLocalStorageProfileStorage,
  createMemoryProfileStorage,
} from '@zodal/dials-ui';
import type { ProfileStorage } from '@zodal/dials-ui';
import type { Layer } from '@zodal/dials-core';
import { thoreminDials, settingsToLayer, layerToSettings } from '@/settings/dials';
import type { Settings } from '@/settings/schema';
import { dialsStore } from './settingsStore';

/** Reserved profile name (a legacy autosave) — filtered out of the visible list. */
export const LAST_MODIFIED = 'Last modified';

/** The canonical default settings (the dials defaults mapped to a nested Settings),
 *  the base each seed overrides. */
const DEFAULTS: Settings = layerToSettings(thoreminDials.defaults as Record<string, unknown>);

/** A seeded instrument: a name + the full layer of a settings snapshot. */
export interface SeedInstrument {
  name: string;
  layer: Layer;
}

/** Build a seed from a partial override of the default settings (nested fields are
 *  spread explicitly — these are shallow merges over the small Settings shape). */
function seed(name: string, s: Settings): SeedInstrument {
  return { name, layer: settingsToLayer(s) };
}

/**
 * The shipped instruments. A spread of variety to exercise the stack: a forgiving
 * pentatonic default, two face-chord configs (sustained pad vs strummed), a punchy
 * organ lead, and a shimmery arpeggiated ambient patch. Face-chord instruments use a
 * 7-note scale (today's requirement; see issue #75 for relaxing it).
 */
export const SEED_INSTRUMENTS: SeedInstrument[] = [
  // Forgiving + consonant out of the box — the gentle default (≈ the dials defaults).
  seed('Pentatonic', { ...DEFAULTS }),

  // The face-chord showcase: a major scale, expression plays a sustained triad.
  seed('Major + face chords', {
    ...DEFAULTS,
    right: { ...DEFAULTS.right, type: 'major' },
    left: { ...DEFAULTS.left, type: 'major' },
    faceMapping: 'chord',
  }),

  // Bossa-ish: major pads, gently strummed chords from the face. (strum is staggered
  // by a fixed onset, not BPM — see isTempoRendering in music/voicing.ts — so no bpm.)
  seed('Bossa Pads', {
    ...DEFAULTS,
    right: { ...DEFAULTS.right, type: 'major', sound: 'warmPad' },
    left: { ...DEFAULTS.left, type: 'major', sound: 'strings' },
    faceMapping: 'chord',
    faceChord: { ...DEFAULTS.faceChord, sound: 'strings', voicing: 'spread', rendering: 'strum' },
  }),

  // A punchy blues lead on organ, no face mapping — immediate and hands-only.
  seed('Blues Organ', {
    ...DEFAULTS,
    right: { ...DEFAULTS.right, type: 'blues', sound: 'organ' },
    left: { ...DEFAULTS.left, type: 'blues', sound: 'organ' },
    masterVolume: 0.45,
  }),

  // Shimmery ambient: higher register, glass/bell, expression arpeggiates a chord
  // (arpUp IS a tempo rendering, so bpm 90 is audible — paired with a crisp bell).
  seed('Glass Bells', {
    ...DEFAULTS,
    right: { ...DEFAULTS.right, type: 'major', sound: 'glass', baseOctave: 4 },
    left: { ...DEFAULTS.left, type: 'major', sound: 'bell', baseOctave: 4 },
    faceMapping: 'chord',
    faceChord: { ...DEFAULTS.faceChord, sound: 'bell', voicing: 'spread', rendering: 'arpUp', bpm: 90 },
    masterVolume: 0.35,
  }),
];

function instrumentStorage(): ProfileStorage {
  try {
    return createLocalStorageProfileStorage('thoremin.instruments');
  } catch {
    return createMemoryProfileStorage();
  }
}

/** The instruments profile store (named layers persisted to localStorage). */
export const instruments = createProfileStore(instrumentStorage());

/** Seed the shipped instruments on first run (when no named instrument exists yet).
 *  Idempotent: a no-op once any named instrument is present. */
export async function ensureSeeded(): Promise<void> {
  const list = await instruments.list();
  const named = list.filter((p) => p.name !== LAST_MODIFIED);
  if (named.length > 0) return;
  for (const s of SEED_INSTRUMENTS) await instruments.save(s.name, s.layer);
}

const SELECTED_KEY = 'thoremin.instruments.selected';

/** The persisted name of the selected instrument (null if none / unavailable). */
export function getSelectedName(): string | null {
  try {
    return localStorage.getItem(SELECTED_KEY) || null;
  } catch {
    return null;
  }
}

/** Persist (or clear, with an empty string) the selected instrument name. */
export function setSelectedName(name: string): void {
  try {
    if (name) localStorage.setItem(SELECTED_KEY, name);
    else localStorage.removeItem(SELECTED_KEY);
  } catch {
    /* non-browser / disabled storage — selection is in-memory only */
  }
}

// --- Orchestration over the dials store (framework-agnostic, unit-tested) ---------

/**
 * Load an instrument's layer into the dials store as the clean dirty-baseline
 * (setLayer + markSaved), so subsequent edits read as dirty and re-selecting reverts.
 * Returns the layer, or null if the instrument is gone (the caller reverts its UI).
 */
export async function selectInstrument(name: string): Promise<Layer | null> {
  const layer = await instruments.load(name);
  if (!layer) return null;
  dialsStore.setLayer(layer);
  dialsStore.markSaved();
  return layer;
}

/** Overwrite a named instrument with the current working layer, then clear dirty. */
export async function commitToInstrument(name: string): Promise<void> {
  await instruments.save(name, dialsStore.getState().layer);
  dialsStore.markSaved();
}

/**
 * Restore the session on load: keep the current working layer (already seeded from the
 * synchronous hot store, so unsaved edits survived the reload) and set the dirty
 * baseline to the selected instrument, so the dirty set reflects edits-since-that-
 * instrument. Clears a stale selected name whose instrument was deleted. Returns the
 * (possibly cleared) selected name.
 */
export async function restoreSession(): Promise<string | null> {
  await ensureSeeded();
  const workingLayer = dialsStore.getState().layer; // current working state (from the hot store)
  let sel = getSelectedName();
  const selLayer = sel ? (await instruments.load(sel)) ?? null : null;
  if (sel && !selLayer) {
    sel = null;
    setSelectedName(''); // the selected instrument was deleted — clear the stale name
  }
  if (selLayer) {
    dialsStore.setLayer(selLayer);
    dialsStore.markSaved(); // baseline = the selected instrument
    dialsStore.setLayer(workingLayer); // working layer on top → dirty reflects unsaved edits
  } else {
    dialsStore.markSaved(); // no selected instrument — the current working layer is clean
  }
  return sel;
}
