/**
 * Chord realization: how a chord becomes sounding notes, as a pipeline with one seam per aspect
 * (`docs/design/harmonic-layers.md` §2.6, step H2 of #613):
 *
 *   tones in register
 *     -> COLORATION  (extensions and alterations: which tones the chord has)
 *     -> REDUCTION   (omissions and density: which of them sound)
 *     -> BASS        (inversion: which tone is lowest)
 *     -> VOICING     (vertical spacing and register, with voice-leading memory)
 *     -> FIGURATION  (temporal rendering: block, strum, arpeggio, pulse, broken patterns)
 *     -> synth voices (and, for an event-based figuration, timed notes)
 *
 * Each seam is a registry of named strategies (a keyed map an extension can add to). The
 * defaults are exactly what thoremin played before the pipeline existed: no coloration, no
 * reduction, the root in the bass, the five voicing idioms of `music/voicing` (`voiceTriad`) and
 * its seven renderings (`renderGains`). `music/chord_render` is now a facade over this module,
 * and `test/harmony/renderer_golden.test.ts` holds its output sample for sample.
 *
 * Stateful only where a realization must remember: the voicing memory (the last voicing and bass,
 * for voice leading) and the figuration clock (the beat and the time since the chord changed).
 * Deterministic given the ticks, so it replays exactly. Pure: no DOM, no audio.
 */
import { midiToFreq } from '../music/theory';
import { RENDERINGS, VOICINGS, renderGains, voiceTriad } from '../music/voicing';
import type { VoiceParams } from '../nodes/domain';
import { EXTENSION_ROLE, QUALITIES, qualityOfIntervals, type ToneRole } from './qualities';

/** One chord tone, in register, with its role above the root. */
export interface Tone {
  midi: number;
  role: ToneRole;
}

/** The live controls a realization reads (a gesture, a dial, a face may set them). */
export interface RealizationControls {
  /** Octaves the whole realization is shifted (the instrument's octave shift). */
  register: number;
  /** 0..1: how many extensions a coloration may add (unused by the defaults). */
  tension: number;
  /** 0..1: how many tones a reduction keeps (unused by the defaults). */
  density: number;
  /** 0..1: close to open spacing (unused by the defaults). */
  spread: number;
}

export const DEFAULT_CONTROLS: RealizationControls = { register: 0, tension: 0, density: 1, spread: 0.5 };

/** What a voicer remembers: the PREVIOUS chord's voicing and bass (voice leading). It changes
 *  only when the chord to realize changes (its tones, the strategies or the controls), so within
 *  a held chord a voicer always sees the same memory and voices it the same way; it is forgotten
 *  after a silence of `resetAfterS`, so the first chord after a rest is voiced afresh. */
export interface VoicingMemory {
  last: readonly number[];
  bass: number | null;
}

/** The figuration's clock: the beat position (quarter notes) and the seconds since the chord changed. */
export interface FigurationClock {
  beat: number;
  sinceChange: number;
}

/** A timed note an event figuration emits (a strum's strings, a broken pattern's steps), in
 *  engine seconds; the shape a note scheduler (`pluck-out`, MIDI) consumes. */
export interface FigureEvent {
  t: number;
  midi: number;
  velocity: number;
  voice?: number;
}

export interface Coloration {
  id: string;
  color(tones: readonly Tone[], controls: RealizationControls): Tone[];
}
export interface Reduction {
  id: string;
  reduce(tones: readonly Tone[], controls: RealizationControls): Tone[];
}
export interface BassRule {
  id: string;
  /** The tone that should sound lowest (an index into `tones`). */
  bass(tones: readonly Tone[], memory: VoicingMemory): number;
}
export interface Voicer {
  id: string;
  /** MIDI notes, ascending, with `tones[bass]` lowest when the voicer honours the bass rule. */
  voice(tones: readonly Tone[], bass: number, controls: RealizationControls, memory: VoicingMemory): number[];
}
export interface Figuration {
  id: string;
  /** Per-voice gains for this tick (continuous voices), and/or timed events. */
  render(n: number, clock: FigurationClock): { gains?: number[]; events?: FigureEvent[] };
}

/** Which strategy each seam uses, by id. */
export interface RealizationSpec {
  coloration: string;
  reduction: string;
  bass: string;
  voicing: string;
  figuration: string;
}

export const DEFAULT_SPEC: RealizationSpec = { coloration: 'asIs', reduction: 'none', bass: 'root', voicing: 'spread', figuration: 'sustained' };

export interface RealizationRegistry {
  coloration: Map<string, Coloration>;
  reduction: Map<string, Reduction>;
  bass: Map<string, BassRule>;
  voicing: Map<string, Voicer>;
  figuration: Map<string, Figuration>;
}

/** The strategies thoremin has always played: a registry an extension may add to (its own copy). */
export function createRealizationRegistry(): RealizationRegistry {
  const byId = <T extends { id: string }>(items: T[]) => new Map(items.map((x) => [x.id, x]));
  return {
    coloration: byId<Coloration>([{ id: 'asIs', color: (tones) => [...tones] }]),
    reduction: byId<Reduction>([{ id: 'none', reduce: (tones) => [...tones] }]),
    bass: byId<BassRule>([{ id: 'root', bass: () => 0 }]),
    // The five idioms put the root in the bass an octave below the chord's register; they read
    // the first three tones as root, second and third tone (`voiceTriad`).
    voicing: byId<Voicer>(VOICINGS.map((id) => ({ id, voice: (tones, _bass, c) => voiceTriad(tones.map((t) => t.midi), id, c.register) }))),
    figuration: byId<Figuration>(RENDERINGS.map((id) => ({ id, render: (n, clock) => ({ gains: renderGains(n, id, clock.beat, clock.sinceChange) }) }))),
  };
}

export const DEFAULT_REALIZATION_REGISTRY: RealizationRegistry = createRealizationRegistry();

/** Chord tones in register (root first) with their roles: each note's role is the role its
 *  interval above the root has in the chord's quality (any octave, so a ninth stacked above the
 *  octave is still not the root), else the extension that interval is (`EXTENSION_ROLE`: a '9',
 *  a '13'), which is also how a shape the quality table does not detect is read. */
export function tonesInRegister(notes: readonly number[]): Tone[] {
  if (notes.length === 0) return [];
  const q = qualityOfIntervals(notes.map((n) => n - notes[0]));
  return notes.map((midi) => {
    const iv = (((midi - notes[0]) % 12) + 12) % 12;
    const k = q ? (QUALITIES[q].intervals as readonly number[]).indexOf(iv) : -1;
    return { midi, role: k >= 0 ? QUALITIES[q!].roles[k] : EXTENSION_ROLE[iv] };
  });
}

export interface RealizeInput {
  /** The chord's tones in register, root first; empty for silence. */
  tones: readonly Tone[];
  spec: RealizationSpec;
  controls: RealizationControls;
  /** The figuration's tempo. */
  bpm: number;
  /** The chord's volume, 0..1. */
  gain: number;
  sound: VoiceParams['sound'];
  /** The sound a silent voice carries (so idle voices never re-key). */
  silentSound: VoiceParams['sound'];
  /** Seconds since the last tick (a non-finite one counts as 0). */
  dt: number;
}

export interface RealizeOutput {
  /** Exactly `maxVoices` voices on stable ids: the synth releases a voice it still sees. */
  voices: VoiceParams[];
  /** The voiced notes, ascending ([] when silent). */
  voiced: number[];
  /** Timed events from an event figuration (none from the defaults). */
  events: FigureEvent[];
}

export interface Realizer {
  render(input: RealizeInput): RealizeOutput;
}

const NO_MEMORY: VoicingMemory = { last: [], bass: null };
/** The default silence after which the voicing memory is forgotten, seconds. */
const MEMORY_RESET_S = 4;

/** A strategy by id, the seam's default when the id is unknown (a stored id from a newer build). */
function pick<T>(map: Map<string, T>, id: string, fallback: string): T {
  return map.get(id) ?? map.get(fallback)!;
}

/**
 * A realizer: one per chord producer, owning a block of voice ids (`idBase` + slot) so several
 * can sound together. The figuration restarts (a strum rolls again) whenever the sounding pitches
 * change, never on a control tweak.
 */
export function createRealizer({
  idBase,
  maxVoices,
  registry = DEFAULT_REALIZATION_REGISTRY,
  resetAfterS = MEMORY_RESET_S,
}: {
  idBase: number;
  maxVoices: number;
  registry?: RealizationRegistry;
  /** Seconds of silence after which the voicing memory is forgotten. */
  resetAfterS?: number;
}): Realizer {
  let beat = 0;
  let sinceChange = 0;
  let lastKey = '';
  /** What the voicer is given (the previous chord's voicing), and the current chord's. */
  let memory: VoicingMemory = NO_MEMORY;
  let current: VoicingMemory = NO_MEMORY;
  let inputKey = '';
  let silentFor = 0;

  const silent = (sound: VoiceParams['sound']): VoiceParams[] =>
    Array.from({ length: maxVoices }, (_, i) => ({ id: idBase + i, present: false, freq: midiToFreq(60), gain: 0, sound }));

  return {
    render({ tones, spec, controls, bpm, gain, sound, silentSound, dt }) {
      let voiced: number[] = [];
      const step = Number.isFinite(dt) ? dt : 0;
      if (tones.length === 0) {
        silentFor += step;
        if (silentFor >= resetAfterS) memory = current = NO_MEMORY;
      } else {
        silentFor = 0;
        // A new chord to realize: the one sounding until now becomes the memory it is voiced from.
        const key = `${tones.map((t) => t.midi).join(',')}|${spec.coloration}|${spec.reduction}|${spec.bass}|${spec.voicing}|${controls.register}|${controls.tension}|${controls.density}|${controls.spread}`;
        if (key !== inputKey) {
          inputKey = key;
          memory = current;
        }
        const colored = pick(registry.coloration, spec.coloration, DEFAULT_SPEC.coloration).color(tones, controls);
        const reduced = pick(registry.reduction, spec.reduction, DEFAULT_SPEC.reduction).reduce(colored, controls);
        const bass = pick(registry.bass, spec.bass, DEFAULT_SPEC.bass).bass(reduced, memory);
        voiced = pick(registry.voicing, spec.voicing, DEFAULT_SPEC.voicing).voice(reduced, bass, controls, memory).sort((a, b) => a - b);
        if (voiced.length) current = { last: voiced, bass: voiced[0] };
      }
      beat += (bpm / 60) * step;
      // The key is the sounding pitches, so any genuine chord change restarts the figuration.
      const key = voiced.length ? voiced.join(',') : '';
      if (key !== lastKey) {
        sinceChange = 0;
        lastKey = key;
      } else {
        sinceChange += step;
      }
      if (voiced.length === 0) return { voices: silent(silentSound), voiced: [], events: [] };
      const out = pick(registry.figuration, spec.figuration, DEFAULT_SPEC.figuration).render(voiced.length, { beat, sinceChange });
      const gains = out.gains ?? [];
      const voices: VoiceParams[] = [];
      for (let i = 0; i < maxVoices; i++) {
        const midi = voiced[i];
        const raw = gains[i];
        const g = midi !== undefined && Number.isFinite(raw) ? gain * raw : 0;
        voices.push({ id: idBase + i, present: g > 0, freq: midiToFreq(midi ?? 60), gain: g, sound });
      }
      return { voices, voiced, events: out.events ?? [] };
    },
  };
}
