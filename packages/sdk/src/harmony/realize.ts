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
import { EXTENSION_ROLE, QUALITIES, qualityOfIntervals } from './qualities';
import type { BassRule, Coloration, Figuration, FigureEvent, RealizationContext, RealizationControls, RealizationSpec, Reduction, Tone, Voicer, VoicingMemory } from './strategies';
import { diatonicSeventh, smoothBass, voiceLedVoicer } from './voice_leading';
import { byTension } from './coloration';

export type {
  BassRule,
  Coloration,
  Figuration,
  FigurationClock,
  FigureEvent,
  RealizationContext,
  RealizationControls,
  RealizationSpec,
  Reduction,
  Tone,
  Voicer,
  VoicingMemory,
} from './strategies';

/** The voicing idioms of `music/voicing` that are stacking recipes (every id but `voiceLed`). */
const IDIOMS = VOICINGS.filter((v) => v !== 'voiceLed');

export const DEFAULT_CONTROLS: RealizationControls = { register: 0, tension: 0, density: 1, spread: 0.5 };

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
    coloration: byId<Coloration>([{ id: 'asIs', color: (tones) => [...tones] }, diatonicSeventh, byTension]),
    reduction: byId<Reduction>([{ id: 'none', reduce: (tones) => [...tones] }]),
    bass: byId<BassRule>([{ id: 'root', bass: () => 0 }, smoothBass]),
    // The five idioms put the root in the bass an octave below the chord's register; they read
    // the first three tones as root, second and third tone (`voiceTriad`) and keep any further
    // tone (a seventh) where it is, shifted with the register. `voiceLed` (H3) leads from the
    // previous chord, honouring the bass and any number of tones.
    voicing: byId<Voicer>([
      ...IDIOMS.map((id) => ({
        id,
        voice: (tones: readonly Tone[], _bass: number, c: RealizationControls) => {
          const voiced = voiceTriad(tones.map((t) => t.midi), id, c.register);
          return voiced.length ? [...voiced, ...tones.slice(3).map((t) => t.midi + 12 * c.register)] : voiced;
        },
      })),
      voiceLedVoicer,
    ]),
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
  /** Where the chord is heard (the key's pitch classes), for a coloration that reads it. */
  context?: RealizationContext;
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
  /** A live tone brightness the voices carry (the head-pose chord's smile), 0..1; absent: none. */
  brightness?: number;
  /** The figuration's beat from outside (a song's or the conductor's musical time, H9 of #613):
   *  when given, the clock is set to it instead of counting `bpm`, so an arpeggio steps on the
   *  music's beats; absent, the clock counts the tempo as before. */
  beat?: number;
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
  /** The figuration clock's beat count so far: what a navigator commits on so its changes land
   *  on the beat the figuration plays (the chord wheel's walk, H11). */
  beat(): number;
}

/**
 * A voicing longer than the voice block sheds its doublings before anything else (from the top,
 * never the bass), so a seventh added to an open triad keeps the seventh and drops the doubled
 * root. Only then is it cut to the block. A voicing that fits is returned as it is.
 */
export function fitVoices(voiced: number[], maxVoices: number): number[] {
  if (voiced.length <= maxVoices) return voiced;
  const out = [...voiced];
  for (let i = out.length - 1; i > 0 && out.length > maxVoices; i--) {
    const pc = ((out[i] % 12) + 12) % 12;
    if (out.slice(0, i).some((n) => ((n % 12) + 12) % 12 === pc)) out.splice(i, 1);
  }
  return out.slice(0, maxVoices);
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
  /** The register `current` was voiced in. */
  let currentRegister = 0;
  let inputKey = '';
  let silentFor = 0;

  const silent = (sound: VoiceParams['sound']): VoiceParams[] =>
    Array.from({ length: maxVoices }, (_, i) => ({ id: idBase + i, present: false, freq: midiToFreq(60), gain: 0, sound }));

  return {
    beat: () => beat,
    render({ tones, context, spec, controls, bpm, gain, sound, silentSound, dt, brightness, beat: outside }) {
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
          // Led from the chord sounding until now, moved with the register: an octave shift
          // transposes the whole voicing rather than leaving the upper voices behind.
          const shift = 12 * (controls.register - currentRegister);
          memory = shift === 0 || current.bass === null ? current : { last: current.last.map((n) => n + shift), bass: current.bass + shift };
        }
        const colored = pick(registry.coloration, spec.coloration, DEFAULT_SPEC.coloration).color(tones, controls, context);
        const reduced = pick(registry.reduction, spec.reduction, DEFAULT_SPEC.reduction).reduce(colored, controls);
        const bass = pick(registry.bass, spec.bass, DEFAULT_SPEC.bass).bass(reduced, memory);
        voiced = fitVoices(pick(registry.voicing, spec.voicing, DEFAULT_SPEC.voicing).voice(reduced, bass, controls, memory).sort((a, b) => a - b), maxVoices);
        if (voiced.length) {
          current = { last: voiced, bass: voiced[0] };
          currentRegister = controls.register;
        }
      }
      beat = outside !== undefined && Number.isFinite(outside) ? outside : beat + (bpm / 60) * step;
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
        voices.push(brightness === undefined ? { id: idBase + i, present: g > 0, freq: midiToFreq(midi ?? 60), gain: g, sound } : { id: idBase + i, present: g > 0, freq: midiToFreq(midi ?? 60), gain: g, sound, brightness });
      }
      return { voices, voiced, events: out.events ?? [] };
    },
  };
}
