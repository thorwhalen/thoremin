/**
 * Who owns an instrument's scale, and what the music's key makes of it.
 *
 * The instrument's scales are five ports of the bridge (`store-controls`): both hands' melody
 * scales, the right hand's spec, and the chord-source spec and its notes, all computed by
 * {@link scalePorts} from the dials. While the instrument follows the music (`scaleFrom: music`),
 * an interposer (the `music-scale` node) stands on those five ports: it receives the
 * {@link ScaleOverride} the `music-context` node reads at the playing position IN THE SAME TICK,
 * and emits the five ports computed from the dials with the music's key in place of theirs
 * ({@link scalePortsInKey}). Nothing is predicted: a key change is heard on the first tick whose
 * position has reached it, and the dials are never written.
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
import { defaultChordSpecFor, generateScale, type ScaleSpec, type ScaleTypeId } from '../music/theory';
import { majorTonicOf, type KeyMode } from '../score/schema';

/** The bridge ports the scales travel on (what an interposer stands on). */
export const SCALE_PORTS = ['scaleRight', 'scaleLeft', 'rightSpec', 'chordSpec', 'chordScale'] as const;
export type ScalePortName = (typeof SCALE_PORTS)[number];

export const SCALE_FITS = ['flavour', 'key'] as const;
export type ScaleFit = (typeof SCALE_FITS)[number];

/** A key as the music states it. */
export interface MusicKey {
  tonic: number;
  mode: KeyMode;
}

/** The music's key for the instrument's scale, now (null: the dials own it). */
export interface ScaleOverride {
  key: MusicKey;
  fit: ScaleFit;
}

/** The dials the scales are made from (the bridge's snapshot has them all). */
export interface ScaleDials {
  right: ScaleSpec;
  left: ScaleSpec;
  /** The chord source (#75): `custom` pins its root and kind; `auto` derives it from the melody. */
  faceChord?: { chordSource: 'auto' | 'custom'; chordRoot: number; chordType: ScaleTypeId };
}

export interface ScalePortValues {
  scaleRight: number[];
  scaleLeft: number[];
  rightSpec: ScaleSpec;
  chordSpec: ScaleSpec;
  chordScale: number[];
}

/** The five scale ports from the dials. The chord source's register (octaves, base octave) tracks
 *  the melody: the chords build their bass from it. */
export function scalePorts(c: ScaleDials): ScalePortValues {
  const rightSpec: ScaleSpec = { root: c.right.root, type: c.right.type, octaves: c.right.octaves, baseOctave: c.right.baseOctave };
  const cs = c.faceChord;
  const resolved = cs && cs.chordSource === 'custom' ? { root: cs.chordRoot, type: cs.chordType } : defaultChordSpecFor(rightSpec);
  const chordSpec: ScaleSpec = { root: resolved.root, type: resolved.type, octaves: c.right.octaves, baseOctave: c.right.baseOctave };
  return { scaleRight: generateScale(c.right), scaleLeft: generateScale(c.left), rightSpec, chordSpec, chordScale: generateScale(chordSpec) };
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

/** The dials with the music's key in place of their scales: both hands' root and kind fitted to
 *  the key (their register kept), the chord source pinned to the key's seven-note scale. */
export function dialsInKey<C extends ScaleDials>(c: C, o: ScaleOverride): C {
  const chord = chordScaleInKey(o.key);
  return {
    ...c,
    right: { ...c.right, ...scaleInKey(c.right, o.key, o.fit) },
    left: { ...c.left, ...scaleInKey(c.left, o.key, o.fit) },
    faceChord: { ...(c.faceChord ?? {}), chordSource: 'custom', chordRoot: chord.root, chordType: chord.type },
  };
}

/** The five scale ports from the dials, in the music's key. */
export const scalePortsInKey = (c: ScaleDials, o: ScaleOverride): ScalePortValues => scalePorts(dialsInKey(c, o));
