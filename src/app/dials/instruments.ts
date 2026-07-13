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
import { DEFAULT_HAND_MAP, RECOMMENDED_FINGER_ROUTES, type HandMap, type FingerRoute, type FingerTarget } from '@/nodes/mapping/hand_map';
import { OverlayDialSchema } from '@/nodes/output/canvas_overlay';
import type { FingerName } from '@/nodes/domain';
import { dialsStore } from './settingsStore';

// --- Hand-map builders for the feature-demo seeds ---------------------------------
const route = (target: FingerTarget, over: Partial<FingerRoute> = {}): FingerRoute => ({
  target,
  sensitivity: 1,
  mode: 'continuous',
  invert: false,
  ...over,
});
/** A finger route set with the named fingers overridden, the rest off. */
const fingerRoutes = (r: Partial<Record<FingerName, FingerRoute>>): HandMap['fingers'] => ({
  index: route('none'),
  middle: route('none'),
  ring: route('none'),
  pinky: route('none'),
  ...r,
});
/** A hand map = the default (index source, no routing, classic knobs) with overrides. */
const handMap = (over: Partial<HandMap>): HandMap => ({ ...structuredClone(DEFAULT_HAND_MAP), ...over });
/** An overlay config = the defaults with a few element sub-objects overridden (to
 *  demo cues like the finger→effect lines / bars). Parsed through the schema so a
 *  partial sub-object override still ships a COMPLETE, valid overlay layer. */
const overlay = (over: Record<string, unknown>): Settings['overlay'] =>
  OverlayDialSchema.parse({ ...DEFAULTS.overlay, ...over }) as Settings['overlay'];

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
 * The shipped instruments — a dozen, each demoing a feature of the stack:
 *  - the gentle default;
 *  - WRIST note-tracking + open/closed-hand effects (fist-mute, open-brightness);
 *  - FINGER→effect routing (per-finger closeness → brightness / vibrato / pan / bend /
 *    octave / gate), continuous and discrete-trigger;
 *  - different sound in the left vs right hand;
 *  - face-chord arpeggio and pulse renderings.
 * Face-chord instruments use a 7-note scale (today's requirement; see issue #75).
 * See discussion #80 for the research behind the finger→effect defaults.
 */
export const SEED_INSTRUMENTS: SeedInstrument[] = [
  // --- The gentle default (index note source, no finger routing) ------------------
  seed('Pentatonic', { ...DEFAULTS }),

  // --- Wrist tracking + open/closed hand (6) --------------------------------------
  // Play with your whole hand (steadier than the fingertip); a closed fist silences.
  seed('Wrist Theremin', {
    ...DEFAULTS,
    right: { ...DEFAULTS.right, sound: 'warmPad' },
    left: { ...DEFAULTS.left, sound: 'warmPad' },
    handMap: handMap({ positionSource: 'wrist', opennessGatesGain: true }),
  }),

  // Wrist notes; opening the hand opens the tone (open = brighter).
  seed('Open Air Pad', {
    ...DEFAULTS,
    right: { ...DEFAULTS.right, sound: 'glass' },
    left: { ...DEFAULTS.left, sound: 'glass' },
    handMap: handMap({ positionSource: 'wrist', opennessControlsBrightness: true }),
  }),

  // The finger-routing showcase: index→brightness, middle→vibrato, ring→pan,
  // pinky→pitch-bend (the research-grounded default; discussion #80).
  seed('Finger FX', {
    ...DEFAULTS,
    right: { ...DEFAULTS.right, type: 'major', sound: 'warmPad' },
    left: { ...DEFAULTS.left, type: 'major', sound: 'warmPad' },
    handMap: handMap({ positionSource: 'wrist', fingers: { ...RECOMMENDED_FINGER_ROUTES } }),
    // Show the finger→effect lines (fingertip→thumb, labelled value + effect).
    overlay: overlay({ fingerLines: { show: true, showLabels: true } }),
  }),

  // Bend the pitch by pinching the index toward the thumb (a whole-tone bend).
  seed('Pitch Bender', {
    ...DEFAULTS,
    right: { ...DEFAULTS.right, sound: 'softLead' },
    left: { ...DEFAULTS.left, sound: 'softLead' },
    handMap: handMap({
      positionSource: 'wrist',
      fingers: fingerRoutes({ index: route('pitchBend', { sensitivity: 1.5 }) }),
    }),
  }),

  // The index finger gates the voice on/off (touch the thumb to sound); middle brightens.
  seed('Finger Gate', {
    ...DEFAULTS,
    right: { ...DEFAULTS.right, sound: 'glass' },
    left: { ...DEFAULTS.left, sound: 'glass' },
    handMap: handMap({
      positionSource: 'wrist',
      fingers: fingerRoutes({ index: route('gate'), middle: route('brightness') }),
    }),
  }),

  // Discrete triggers: pinch the index for +1 octave, the middle to sustain (gate).
  seed('Trigger Octaves', {
    ...DEFAULTS,
    right: { ...DEFAULTS.right, sound: 'bell' },
    left: { ...DEFAULTS.left, sound: 'bell' },
    handMap: handMap({
      positionSource: 'wrist',
      fingers: fingerRoutes({
        index: route('octave', { mode: 'trigger' }),
        middle: route('gate', { mode: 'trigger' }),
      }),
    }),
  }),

  // --- Different sound in each hand (2) -------------------------------------------
  seed('Split Voices', {
    ...DEFAULTS,
    syncHands: false,
    right: { ...DEFAULTS.right, type: 'major', sound: 'organ' },
    left: { ...DEFAULTS.left, type: 'minor', sound: 'glass' },
  }),

  seed('Bell & Strings', {
    ...DEFAULTS,
    syncHands: false,
    right: { ...DEFAULTS.right, type: 'major', sound: 'bell' },
    left: { ...DEFAULTS.left, type: 'major', sound: 'strings' },
  }),

  // --- Face-chord renderings (2) --------------------------------------------------
  // Shimmery ambient: expression arpeggiates a chord (arpUp is tempo-driven → bpm 90).
  seed('Glass Bells', {
    ...DEFAULTS,
    right: { ...DEFAULTS.right, type: 'major', sound: 'glass', baseOctave: 4 },
    left: { ...DEFAULTS.left, type: 'major', sound: 'bell', baseOctave: 4 },
    faceMapping: 'chord',
    faceChord: { ...DEFAULTS.faceChord, sound: 'bell', voicing: 'spread', rendering: 'arpUp', bpm: 90 },
    masterVolume: 0.35,
  }),

  // Rhythmic re-articulated chords from the face (pulse, tempo-driven).
  seed('Pulse Organ', {
    ...DEFAULTS,
    right: { ...DEFAULTS.right, type: 'major', sound: 'organ' },
    left: { ...DEFAULTS.left, type: 'major', sound: 'organ' },
    faceMapping: 'chord',
    faceChord: { ...DEFAULTS.faceChord, sound: 'organ', voicing: 'close', rendering: 'pulse', bpm: 110 },
  }),

  // --- Cue demo: wrist source + all fingers routed + BOTH the lines and the bar graph.
  seed('Finger Cues', {
    ...DEFAULTS,
    right: { ...DEFAULTS.right, type: 'major', sound: 'glass' },
    left: { ...DEFAULTS.left, type: 'major', sound: 'glass' },
    handMap: handMap({ positionSource: 'wrist', fingers: { ...RECOMMENDED_FINGER_ROUTES } }),
    overlay: overlay({
      fingerLines: { show: true, showLabels: true },
      fingerBars: { show: true, position: 'left' },
    }),
  }),

  // --- Maximalist: wrist notes + all fingers routed + face timbre + both finger cues.
  seed('Everything', {
    ...DEFAULTS,
    right: { ...DEFAULTS.right, type: 'major', sound: 'warmPad' },
    left: { ...DEFAULTS.left, type: 'major', sound: 'warmPad' },
    faceMapping: 'timbre',
    handMap: handMap({
      positionSource: 'wrist',
      opennessControlsBrightness: true,
      fingers: fingerRoutes({
        index: route('brightness'),
        middle: route('vibrato'),
        ring: route('pan'),
        pinky: route('octave', { mode: 'trigger' }),
      }),
    }),
    overlay: overlay({
      fingerLines: { show: true, showLabels: true },
      fingerBars: { show: true, position: 'right' },
    }),
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

/** Bump when SEED_INSTRUMENTS changes, so a returning user gets the NEW shipped
 *  instruments added (by name) without re-seeding or clobbering their own. */
const SEED_VERSION = 3;
const SEED_VERSION_KEY = 'thoremin.instruments.seedVersion';

const readSeedVersion = (): number => {
  try {
    return Number(localStorage.getItem(SEED_VERSION_KEY)) || 0;
  } catch {
    return 0;
  }
};
const writeSeedVersion = (): void => {
  try {
    localStorage.setItem(SEED_VERSION_KEY, String(SEED_VERSION));
  } catch {
    /* non-browser / disabled storage */
  }
};

/**
 * Ensure the shipped instruments are present. First run seeds them all; a later run
 * whose stored SEED_VERSION is behind ADDS any shipped instrument whose name isn't
 * already saved (so an existing user gains the new demos without losing their own or
 * having edits/deletions of same-named ones clobbered). Idempotent once up to date.
 */
export async function ensureSeeded(): Promise<void> {
  const list = await instruments.list();
  const named = new Set(list.filter((p) => p.name !== LAST_MODIFIED).map((p) => p.name));
  if (named.size > 0 && readSeedVersion() >= SEED_VERSION) return;
  for (const s of SEED_INSTRUMENTS) {
    if (!named.has(s.name)) await instruments.save(s.name, s.layer);
  }
  writeSeedVersion();
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

const DEFAULT_KEY = 'thoremin.instruments.default';

/** The user's default instrument (loaded on a fresh session), or null. Per-browser
 *  (thoremin is single-tenant), so "each user" = each browser. */
export function getDefaultName(): string | null {
  try {
    return localStorage.getItem(DEFAULT_KEY) || null;
  } catch {
    return null;
  }
}

/** Set (or clear, with an empty string) the default instrument name. */
export function setDefaultName(name: string): void {
  try {
    if (name) localStorage.setItem(DEFAULT_KEY, name);
    else localStorage.removeItem(DEFAULT_KEY);
  } catch {
    /* non-browser / disabled storage */
  }
}

/** True on a genuinely fresh browser — no persisted working state yet. The hot store
 *  (zustand persist, key 'thoremin-controls') writes only on the first edit/selection,
 *  so its absence marks a first-ever visit (when the default instrument should open). */
function isFreshBrowser(): boolean {
  try {
    return !localStorage.getItem('thoremin-controls');
  } catch {
    return false;
  }
}

// --- Orchestration over the dials store (framework-agnostic, unit-tested) ---------

/**
 * Normalize a layer loaded from storage before it reaches the dials store.
 *
 * `dialsStore.setLayer` stores a layer VERBATIM (no schema parse), and the dirty check is
 * a structural compare against the baseline. So a stale key inside a whole-object dial is
 * not harmless: an instrument saved before #136 carries `overlay.featureLab`, while the
 * working layer (seeded from the hot store, whose overlay no longer has it) does not — and
 * every returning player's instrument would read DIRTY on load, forever, having changed
 * nothing. Re-parsing `overlay` through the lab-free {@link OverlayDialSchema} drops the
 * stale key on the way in, which is exactly what the schema is for.
 */
export function normalizeLayer(layer: Layer): Layer {
  if (!layer.overlay) return layer;
  try {
    return { ...layer, overlay: OverlayDialSchema.parse(layer.overlay) };
  } catch {
    return layer; // unparseable → leave it; the dials validation surface reports it
  }
}

/**
 * Load an instrument's layer into the dials store as the clean dirty-baseline
 * (setLayer + markSaved), so subsequent edits read as dirty and re-selecting reverts.
 * Returns the layer, or null if the instrument is gone (the caller reverts its UI).
 */
export async function selectInstrument(name: string): Promise<Layer | null> {
  const raw = await instruments.load(name);
  if (!raw) return null;
  const layer = normalizeLayer(raw);
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
  const selRaw = sel ? (await instruments.load(sel)) ?? null : null;
  const selLayer = selRaw ? normalizeLayer(selRaw) : null;
  if (sel && !selLayer) {
    sel = null;
    setSelectedName(''); // the selected instrument was deleted — clear the stale name
  }
  // Open on the user's default instrument ONLY on a genuinely fresh browser (no
  // persisted working state). On later runs we resume the working layer instead, so
  // unsaved edits are never discarded by the default. StrictMode-safe: the first
  // restore writes the hot-store key, so a re-mount takes the resume path.
  if (!selLayer && isFreshBrowser()) {
    const def = getDefaultName();
    const defRaw = def ? (await instruments.load(def)) ?? null : null;
    const defLayer = defRaw ? normalizeLayer(defRaw) : null;
    if (def && !defLayer) setDefaultName(''); // the default instrument was deleted — clear it
    if (defLayer) {
      setSelectedName(def!);
      dialsStore.setLayer(defLayer);
      dialsStore.markSaved();
      return def;
    }
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
