/**
 * The realization pipeline's strategy contracts (`./realize`), on their own so a module of
 * strategies (`./voice_leading`) can implement them without importing the pipeline that
 * registers it. Types only.
 */
import type { ToneRole } from './qualities';

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

/** What a realization may know about where the chord is heard. */
export interface RealizationContext {
  /** The key's pitch classes (a coloration adds the key's own seventh from them). */
  scale?: readonly number[];
}

export interface Coloration {
  id: string;
  color(tones: readonly Tone[], controls: RealizationControls, context?: RealizationContext): Tone[];
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

