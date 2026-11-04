/**
 * The song's STRETCHER SEAM (#976): how a song is played at a rate with its pitch preserved, and
 * how a host or an extension supplies the thing that plays it.
 *
 * The song slice's `song-player` node plays every song through one {@link Stretcher}. It obtains
 * it from a {@link StretcherFactory}: by default its own (Signalsmith Stretch, falling back to the
 * browser's media element), or the one a host puts in the engine's resources under
 * {@link SONG_STRETCHER_RESOURCE} (`ctx.resources.createStretcher`). That resource is the seam:
 *
 * - **An extension may wrap or replace the factory.** Wrapping (call the factory it found, or its
 *   own, with a `destination` of its choosing, and return that stretcher, maybe decorated) is how
 *   an extension puts the song through its own chain before the master bus while the instrument's
 *   voices stay dry (the DAW extension's song chain does exactly that). Replacing it plays the song
 *   through a stretcher of the extension's own.
 * - **`destination` is where the song goes**: the master bus as the song player passes it. A
 *   factory connects the stretcher's output there, or to a node of its own that ends there.
 * - **It is read when a song loads**: the first time a song player needs a stretcher (the first
 *   song after the node was made), and that stretcher then plays every later song until the node
 *   is disposed. A factory installed after a song loaded takes effect for the next song player
 *   (a page reload, or the graph rebuilding the node), not for the one already playing.
 *
 * The optional members are capabilities: a stretcher that lacks one, or answers `false`, does not
 * offer it (the media element fallback offers none of {@link Stretcher.setSemitones},
 * {@link Stretcher.setFormant} or {@link Stretcher.setLoop}), and a caller degrades instead of
 * assuming.
 *
 * Pure types and one constant: the factories themselves are browser code, in the song slice's app
 * half and in extensions.
 */

/** The resource key the song player reads a host's {@link StretcherFactory} from. */
export const SONG_STRETCHER_RESOURCE = 'createStretcher';

/** A formant shift, Signalsmith Stretch's `formantSemitones` / `formantCompensation` / `formantBaseHz`. */
export interface StretcherFormant {
  /** Shift of the formants (the vowel colour), semitones; 0 = none. */
  semitones: number;
  /** Keep the formants where they were while the pitch moves (a shifted voice keeps its timbre). */
  compensation?: boolean;
  /** A rough fundamental for the formant analysis, Hz (about 100 for a low voice, 400 for a high
   *  one); 0 lets the stretcher track it. */
  baseHz?: number;
}

/** How a song is played at a rate, pitch preserved. */
export interface Stretcher {
  /** Load a song by URL. Resolves when playable, rejects when it cannot be decoded. */
  load(url: string): Promise<void>;
  /** Start (or resume) playback; from the start when the song had ended. */
  play(): void;
  pause(): void;
  /** Playback rate, pitch preserved; 1 = the song's own tempo. */
  setRate(rate: number): void;
  /** The song's level, 0..1. Absent for a provider's player that offers no volume (an iframe with
   *  no API), which nothing of ours can silence, the player's mute included (#939). */
  setVolume?(volume: number): void;
  /** Ramp the fader (separate from the volume) to `level` (0..1) over `seconds`; 0 seconds
   *  is immediate (#366: the conductor's hold fades the song). Absent = cuts only. */
  fade?(level: number, seconds: number): void;
  /** The rate actually playing, when the player rounds what it is asked (a provider's own
   *  rates); absent = the rate asked. */
  appliedRate?(): number;
  /** The song's length as the player knows it now, when the handle's was not known at load (a
   *  provider's player learns it after it starts). */
  durationS?(): number;
  /** Position on the SONG's timeline, seconds: the audio leaving the stretcher now. Inside a loop
   *  ({@link setLoop}) it wraps with the loop. */
  position(): number;
  /** Move to a position on the song's timeline, seconds (#187 PR 7: the conductor's cue). */
  seek?(position: number): void;
  playing(): boolean;
  ended(): boolean;
  /** True after the browser refused the last `play()` (an autoplay policy: WebKit wants
   *  a gesture per media element); cleared by the next `play()`. */
  blocked?(): boolean;
  /** Called from inside a user gesture (the Play button's click) so a later `play()`
   *  from the engine tick is allowed; a no-op where nothing needs unlocking. */
  unlock?(): void;
  /** Shift the pitch by `semitones`, independent of the rate (a key shift). It belongs to the
   *  stretcher, not the song: it carries over to the next song loaded. True when applied (or kept
   *  for the song about to load); false when this stretcher cannot shift pitch, or `semitones` is
   *  not finite. */
  setSemitones?(semitones: number): boolean;
  /** Shift the formants ({@link StretcherFormant}); carries over like {@link setSemitones}. True when
   *  applied; false when this stretcher cannot, or the shift is not finite. */
  setFormant?(formant: StretcherFormant): boolean;
  /** Loop the song between `startS` and `endS` (song seconds; the read wraps forward from `endS`
   *  to `startS`), or end the loop with `endS = null`. It belongs to the song: loading another
   *  clears it. True when applied; false when this stretcher cannot loop, nothing is loaded, or
   *  the range is empty, negative or not finite. */
  setLoop?(startS: number, endS: number | null): boolean;
  dispose(): void;
}

/** What a {@link StretcherFactory} is given: the song player's audio context, and where the song goes. */
export interface StretcherOptions {
  audioContext: AudioContext;
  /** Where the song goes: the master bus as the song player passes it. */
  destination: AudioNode;
}

/** Makes the song's {@link Stretcher}: the seam (see the module header). */
export type StretcherFactory = (opts: StretcherOptions) => Stretcher;
