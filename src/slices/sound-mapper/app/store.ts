/**
 * The sound mapper's live state and its one lease on the audio-input hub
 * (`@thoremin/sdk-ui/audio/hub`; `docs/design/audio-input.md`).
 *
 * The player's map (classes, their kit sounds, their taught taps) is the zustand state the panel
 * renders, persisted through a zodal named collection (one record, "My sounds", saved a moment
 * after every change). While the mapper is ON (playing) or a class is being TAUGHT, the store
 * holds a lease running the `sound-mapper` analyser; everything that sounds happens on the audio
 * thread, and this store only configures it: the kit samples (synthesised at the context's rate),
 * the models trained from the taught taps, the class-to-sample mapping. While teaching, the
 * mapping is emptied so a tap sounds nothing and every onset's audio comes back as a snippet,
 * which becomes a taught tap of the class being taught.
 *
 * What the panel shows comes back as events: each hit (its class or "not taught", its confidence,
 * how long after the onset the sample started, whether the refining window corrected it).
 */
import { create } from 'zustand';
import { audioInput, type AudioInputLease, type HubStatus, type LeaseEvent } from '@thoremin/sdk-ui/audio/hub';
import { createNamedCollectionStore } from '@thoremin/sdk-ui/namedCollection';
import { synthKitSound, KIT_SOUNDS, type KitSound } from '@thoremin/sdk/audio/kit';
import { SOUND_MAPPER_DEFAULTS } from '@thoremin/sdk/audio/mapper';
import type { DataProvider } from '@zodal/store';
import { EMPTY_SOUND_MAP, SOUND_MAPPER_LIMITS, SoundMapRecordSchema, SoundMapSchema, type SoundClass, type SoundMap, type SoundMapRecord } from '../schema';
import { SOUND_MAPPER_STORES } from '../stores';
import { encodePcm16 } from '../lib/pcm';
import { kitSampleId, mapperConfig } from '../lib/model';

/** One hit as the panel shows it. */
export interface Hit {
  /** The onset's context frame (a hit's identity). */
  frame: number;
  classId: string | null;
  confidence: number;
  /** Onset to the first sample of the answer, ms (the mapper's own share). */
  latencyMs: number;
  /** The refining window changed the class. */
  revised: boolean;
}

const MAP_ID = 'my-sounds';
const MAP_NAME = 'My sounds';
const ANALYSER = 'mapper';
/** Hits kept for the readout. */
const HITS = 12;
/** How long after the last change the map is saved, ms. */
const SAVE_MS = 400;

export const createSoundMapStore = createNamedCollectionStore<SoundMapRecord, 'map'>({
  schema: SoundMapRecordSchema,
  storageKey: SOUND_MAPPER_STORES.maps.legacyKey,
  payloadKey: 'map',
  idFallback: 'sounds',
});

export interface SoundMapperState {
  map: SoundMap;
  hydrated: boolean;
  /** Playing: taps sound their classes' samples. */
  playing: boolean;
  /** The class being taught, or null. */
  teaching: string | null;
  hits: Hit[];
  status: HubStatus | null;
  /** The last thing that went wrong, in words. */
  error: string | null;

  hydrate(): Promise<void>;
  addClass(label?: string, sound?: KitSound): string | null;
  removeClass(id: string): void;
  renameClass(id: string, label: string): void;
  setSound(id: string, sound: KitSound): void;
  clearClass(id: string): void;
  setParams(p: Partial<Pick<SoundMap, 'windowMs' | 'refineMs' | 'velocity' | 'gain'>>): void;
  /** Teach `id` (null stops teaching). */
  teach(id: string | null): void;
  play(on: boolean): void;
}

export interface SoundMapperDeps {
  hub?: () => ReturnType<typeof audioInput>;
  provider?: DataProvider<SoundMapRecord>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

/** A default label for a new class: the first of these the map does not use yet. */
const LABELS = ['Table, middle', 'Table, edge', 'Pot', 'Mug', 'Knock', 'Tap', 'Slap', 'Click'];
/** A default sound for a new class: the first kit sound the map does not use yet. */
const SOUNDS: KitSound[] = ['kick', 'snare', 'cowbell', 'hat', 'clap', 'tom', 'woodblock', 'rim'];

export function createSoundMapperStore(deps: SoundMapperDeps = {}) {
  const hub = deps.hub ?? audioInput;
  const persist = createSoundMapStore(deps.provider);
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  let lease: AudioInputLease | null = null;
  /** The analyser params the lease was made with: a change re-makes it. */
  let leaseKey = '';
  let unlisten: (() => void) | null = null;
  let unstatus: (() => void) | null = null;
  /** The sample rate the samples were sent at (a new context re-sends). */
  let sentRate = 0;
  const sentSounds = new Set<KitSound>();
  let saveTimer: unknown = null;
  let nextId = 1;

  const store = create<SoundMapperState>()((set, get) => {
    const save = () => {
      if (saveTimer !== null) clearTimer(saveTimer);
      saveTimer = setTimer(() => {
        saveTimer = null;
        persist.save(MAP_NAME, get().map, now()).catch((e) => set({ error: `could not save the sounds: ${String((e as Error)?.message ?? e)}` }));
      }, SAVE_MS);
    };

    const configure = () => {
      if (!lease) return;
      const status = hub()?.status();
      const rate = status?.sampleRate ?? 0;
      if (!rate || status?.state !== 'live') return;
      const { map, teaching } = get();
      const cfg = mapperConfig(map, rate);
      if (rate !== sentRate) {
        sentSounds.clear();
        sentRate = rate;
      }
      for (const s of cfg.sounds) {
        if (sentSounds.has(s)) continue;
        lease.send(ANALYSER, { type: 'sample', id: kitSampleId(s), data: synthKitSound(s, rate) });
        sentSounds.add(s);
      }
      lease.send(ANALYSER, {
        type: 'model',
        fast: cfg.models?.fast ?? null,
        final: cfg.models?.final ?? null,
        refPeak: cfg.models?.refPeak ?? SOUND_MAPPER_DEFAULTS.refPeak,
        // While teaching, nothing sounds: the taps are examples, not notes.
        mapping: teaching ? {} : cfg.mapping,
      });
      lease.send(ANALYSER, { type: 'params', velocity: map.velocity, gain: map.gain });
      lease.send(ANALYSER, { type: 'capture', on: teaching !== null });
    };

    const onEvent = ({ event }: LeaseEvent) => {
      const rate = sentRate || hub()?.status().sampleRate || 48000;
      if (event.kind === 'snippet') {
        const { teaching, map } = get();
        if (!teaching) return;
        const tap = { id: `t${now().toString(36)}${(nextId++).toString(36)}`, sampleRate: event.sampleRate, onset: event.onset, pcm: encodePcm16(event.pcm) };
        set({
          map: {
            ...map,
            classes: map.classes.map((c) => (c.id === teaching ? { ...c, examples: [...c.examples, tap].slice(-SOUND_MAPPER_LIMITS.examples) } : c)),
          },
        });
        save();
        return;
      }
      if (event.kind !== 'class' || get().teaching) return;
      const latencyMs = ((event.decidedFrame - event.frame) / rate) * 1000;
      if (event.stage === 'fast') {
        const hit: Hit = { frame: event.frame, classId: event.label, confidence: event.confidence, latencyMs, revised: false };
        set({ hits: [hit, ...get().hits].slice(0, HITS) });
      } else if (event.revised) {
        set({ hits: get().hits.map((h) => (h.frame === event.frame ? { ...h, classId: event.label, confidence: event.confidence, revised: true } : h)) });
      }
    };

    /** Hold a lease exactly while playing or teaching; re-make it when the windows change. */
    const sync = () => {
      const { playing, teaching, map } = get();
      const want = playing || teaching !== null;
      const h = hub();
      const key = JSON.stringify({ windowMs: map.windowMs, refineMs: map.refineMs });
      if ((!want || key !== leaseKey) && lease) {
        unlisten?.();
        unlisten = null;
        lease.release();
        lease = null;
        sentRate = 0;
        sentSounds.clear();
      }
      if (want && !lease) {
        if (!h) {
          set({ error: 'no microphone in this page', playing: false, teaching: null });
          return;
        }
        leaseKey = key;
        lease = h.acquire({ analysers: [{ name: 'sound-mapper', id: ANALYSER, params: { windowMs: map.windowMs, refineMs: map.refineMs, levelEveryMs: 0 } }] });
        unlisten = lease.listen(onEvent);
        unstatus ??= h.subscribe((s) => {
          set({ status: s });
          if (s.state === 'live') configure();
        });
        set({ status: h.status() });
      }
      configure();
    };

    const editMap = (f: (m: SoundMap) => SoundMap) => {
      set({ map: SoundMapSchema.parse(f(get().map)) });
      save();
      configure();
    };
    const editClass = (id: string, f: (c: SoundClass) => SoundClass) => editMap((m) => ({ ...m, classes: m.classes.map((c) => (c.id === id ? f(c) : c)) }));

    return {
      map: EMPTY_SOUND_MAP,
      hydrated: false,
      playing: false,
      teaching: null,
      hits: [],
      status: null,
      error: null,
      async hydrate() {
        if (get().hydrated) return;
        const stored = await persist.load(MAP_ID).catch(() => null);
        // A map edited before the stored one arrived wins.
        if (stored && get().map === EMPTY_SOUND_MAP) set({ map: stored.map });
        set({ hydrated: true });
      },
      addClass(label, sound) {
        const { map } = get();
        if (map.classes.length >= SOUND_MAPPER_LIMITS.classes) return null;
        const used = new Set(map.classes.map((c) => c.label));
        const usedSounds = new Set(map.classes.map((c) => c.sound));
        const id = `c${now().toString(36)}${(nextId++).toString(36)}`;
        const cls: SoundClass = {
          id,
          label: label ?? LABELS.find((l) => !used.has(l)) ?? `Sound ${map.classes.length + 1}`,
          sound: sound ?? SOUNDS.find((s) => !usedSounds.has(s)) ?? KIT_SOUNDS[0],
          examples: [],
        };
        editMap((m) => ({ ...m, classes: [...m.classes, cls] }));
        return id;
      },
      removeClass(id) {
        if (get().teaching === id) get().teach(null);
        editMap((m) => ({ ...m, classes: m.classes.filter((c) => c.id !== id) }));
      },
      renameClass(id, label) {
        const l = label.trim().slice(0, 40);
        if (l) editClass(id, (c) => ({ ...c, label: l }));
      },
      setSound(id, sound) {
        editClass(id, (c) => ({ ...c, sound }));
      },
      clearClass(id) {
        editClass(id, (c) => ({ ...c, examples: [] }));
      },
      setParams(p) {
        editMap((m) => ({ ...m, ...p }));
        sync();
      },
      teach(id) {
        set({ teaching: id, error: null });
        sync();
      },
      play(on) {
        set({ playing: on, error: null, hits: on ? get().hits : [] });
        sync();
      },
    };
  });
  return store;
}

export const useSoundMapper = createSoundMapperStore();
