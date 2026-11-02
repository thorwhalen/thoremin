/**
 * Who owns an instrument's scale, and what the music's key makes of it. The `music-context` node
 * hands `store-controls` a {@link ScaleOverride} on the port {@link SCALE_OVERRIDE_PORT} while the
 * instrument's scale follows the music (`scaleFrom: music`); `store-controls` then emits the
 * melody scales and the chord-source scale in the music's key instead of the dials', and the dials
 * themselves are never written.
 *
 * The override carries the key in force and, when a change is close, the next key with the engine
 * time it takes effect: the port reaches `store-controls` a tick late (it is a delayed edge), so the
 * reader picks between the two by its own tick time ({@link keyInForce}) and the change lands on the
 * first tick at or after its beat, not a tick after it.
 *
 * Fitting a scale to a key:
 * - `flavour` keeps the instrument's kind of scale and moves it to the key: a major pentatonic
 *   stays a pentatonic, as the major or the minor one by the key's mode; a chromatic stays chromatic.
 * - `key` plays the key's own seven-note scale.
 * A church mode is read as its parent major key (D dorian plays the notes of C major), since the
 * instruments' scales are major and minor kinds; the pitch set is exact, the root is the parent's.
 *
 * Pure.
 */
import { defaultChordSpecFor, type ScaleTypeId } from '../music/theory';
import { majorTonicOf, type KeyMode } from '../score/schema';

/** The input port `store-controls` reads the override on. */
export const SCALE_OVERRIDE_PORT = { name: 'scaleOverride', kind: 'scale-override' } as const;

export const SCALE_FITS = ['flavour', 'key'] as const;
export type ScaleFit = (typeof SCALE_FITS)[number];

/** A key as the music states it. */
export interface MusicKey {
  tonic: number;
  mode: KeyMode;
}

export interface ScaleOverride {
  key: MusicKey;
  /** The next key and the engine time (seconds) it takes effect at; absent: none close. */
  next?: { key: MusicKey; at: number };
  fit: ScaleFit;
}

/** The key the override puts in force at engine time `now`. */
export function keyInForce(o: ScaleOverride, now: number): MusicKey {
  return o.next && now >= o.next.at ? o.next.key : o.key;
}

/** A key as a major or a minor scale on a root (a church mode as its parent major). */
export function keyAsScale(key: MusicKey): { root: number; type: 'major' | 'minor' } {
  if (key.mode === 'minor' || key.mode === 'aeolian') return { root: key.tonic, type: 'minor' };
  return { root: majorTonicOf(key), type: 'major' };
}

const MAJOR_KINDS: readonly ScaleTypeId[] = ['major', 'pentatonic'];
/** A scale kind's counterpart in the other mode. */
const COUNTERPART: Readonly<Record<ScaleTypeId, ScaleTypeId>> = {
  major: 'minor',
  minor: 'major',
  pentatonic: 'minorPentatonic',
  minorPentatonic: 'pentatonic',
  minorHarmonic: 'major',
  blues: 'pentatonic',
  chromatic: 'chromatic',
};

/** An instrument scale (its root and kind) in the music's key. */
export function scaleInKey(dial: { type: ScaleTypeId }, key: MusicKey, fit: ScaleFit): { root: number; type: ScaleTypeId } {
  const { root, type: keyType } = keyAsScale(key);
  if (fit === 'key') return { root, type: keyType };
  if (dial.type === 'chromatic') return { root, type: 'chromatic' };
  const dialMajor = MAJOR_KINDS.includes(dial.type);
  return { root, type: dialMajor === (keyType === 'major') ? dial.type : COUNTERPART[dial.type] };
}

/** The chord-source scale in the music's key: the key's seven-note scale. */
export function chordScaleInKey(key: MusicKey): { root: number; type: ScaleTypeId } {
  return defaultChordSpecFor(keyAsScale(key));
}
