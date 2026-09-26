/**
 * Featurizers for the flute and the bass, built on the guitar's chord-shape vector.
 *
 * **Flute** (`fluteFeaturizer`): both hands matter (three fingers of the left, four of
 * the right, the thumbs on keys) and the face carries the embouchure. The two detected
 * hands are told apart by image x (`leftHand`: the player's left is the one nearer the
 * mouth, on the viewer's right for a flautist facing the camera), each is featurized
 * with the chord-shape vector, and the ids are prefixed `L.` and `R.`. When the bundle
 * carries a face, the mouth, cheek and jaw blendshapes are appended as `face.<name>`.
 * A frame needs both hands to be a fingering sample.
 *
 * **Bass** (`bassFeaturizer`): the fretting hand's shape plus WHERE it is along the neck,
 * which the chord-shape vector deliberately drops. The neck runs from the plucking hand
 * (at the bridge, nearly still) to the nut, so the fretting hand's offset from the
 * plucking hand, in units of the fretting hand's own palm span, is a camera-invariant
 * position: `neck.distance` (how far up the neck), `neck.dx` / `neck.dy` (its image
 * direction, which encodes the neck angle). With one hand in frame those three are
 * `NaN` and the standardizer imputes them.
 *
 * Both are `Featurize<FrameBundle>` for the generic join; the bass one also works on a
 * plain hands stream through `bassHandsFeaturizer`.
 */
import type { FeatureVector } from '@/features/catalog';
import type { FaceFrame, Hand, HandsFrame } from '@/nodes/domain';
import { LM } from '@/nodes/domain';
import { NO_CHORD, labelAt, pitchClassOf, type ChordSegment, type FrameBundle } from './lib_chord_shape_dataset';
import { chordShapeVector, frettingHand, type FeatureSelection } from './lib_chord_shape_features';
import type { FrettingHandPick } from './lib_sources';

/** The blendshapes that describe an embouchure (MediaPipe FaceLandmarker names). */
export const EMBOUCHURE_BLENDSHAPES = [
  'jawOpen',
  'jawForward',
  'mouthClose',
  'mouthFunnel',
  'mouthPucker',
  'mouthPressLeft',
  'mouthPressRight',
  'mouthRollLower',
  'mouthRollUpper',
  'mouthShrugLower',
  'mouthShrugUpper',
  'mouthStretchLeft',
  'mouthStretchRight',
  'mouthLowerDownLeft',
  'mouthLowerDownRight',
  'mouthUpperUpLeft',
  'mouthUpperUpRight',
  'cheekPuff',
  'cheekSquintLeft',
  'cheekSquintRight',
] as const;

const prefixed = (prefix: string, v: FeatureVector): FeatureVector => {
  const out: FeatureVector = {};
  for (const [k, x] of Object.entries(v)) out[`${prefix}.${k}`] = x;
  return out;
};

function meanX(hand: Hand): number {
  let s = 0;
  for (const k of hand.keypoints) s += k.x;
  return hand.keypoints.length ? s / hand.keypoints.length : NaN;
}

/** The embouchure part of a face frame: every listed blendshape, `NaN` when absent. */
export function embouchureVector(face: FaceFrame | undefined): FeatureVector {
  const out: FeatureVector = {};
  for (const name of EMBOUCHURE_BLENDSHAPES) {
    const v = face?.present ? face.blendshapes[name] : undefined;
    out[`face.${name}`] = typeof v === 'number' && Number.isFinite(v) ? v : NaN;
  }
  return out;
}

export interface FluteOptions {
  /** Which detected hand is the player's left, by image x. */
  leftHand: 'min' | 'max';
  /** Append the embouchure blendshapes (default true). */
  withFace?: boolean;
  features?: FeatureSelection;
}

/** Both hands' shapes (+ the face): `undefined` unless two hands are in frame. */
export const fluteFeaturizer =
  (o: FluteOptions) =>
  (frame: FrameBundle): FeatureVector | undefined => {
    const hands = frame.hands;
    if (!hands) return undefined;
    const usable = hands.hands.filter((h) => h.keypoints.length >= 21);
    if (usable.length < 2) return undefined;
    const sorted = [...usable].sort((a, b) => meanX(a) - meanX(b));
    const left = o.leftHand === 'min' ? sorted[0] : sorted[sorted.length - 1];
    const right = o.leftHand === 'min' ? sorted[sorted.length - 1] : sorted[0];
    const out: FeatureVector = {
      ...prefixed('L', chordShapeVector(left, hands, o.features)),
      ...prefixed('R', chordShapeVector(right, hands, o.features)),
    };
    if (o.withFace !== false) Object.assign(out, embouchureVector(frame.face));
    return out;
  };

/** The bass features on a plain hands frame. */
export const bassHandsFeaturizer =
  (pick: FrettingHandPick, sel: FeatureSelection = {}) =>
  (frame: HandsFrame): FeatureVector | undefined => {
    const fret = frettingHand(frame, pick);
    if (!fret) return undefined;
    const out = chordShapeVector(fret, frame, sel);
    const other = frame.hands.find((h) => h !== fret && h.keypoints.length >= 21);
    const span = (() => {
      const a = fret.keypoints[LM.index_mcp];
      const b = fret.keypoints[LM.pinky_mcp];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : NaN;
    })();
    if (other && span > 0) {
      const fw = fret.keypoints[LM.wrist];
      const pw = other.keypoints[LM.wrist];
      const dx = (fw.x - pw.x) / span;
      const dy = (fw.y - pw.y) / span;
      out['neck.distance'] = Math.hypot(dx, dy);
      out['neck.dx'] = dx;
      out['neck.dy'] = dy;
    } else {
      out['neck.distance'] = NaN;
      out['neck.dx'] = NaN;
      out['neck.dy'] = NaN;
    }
    return out;
  };

/** The bass features on a bundle (hands stream only). */
export const bassFeaturizer =
  (pick: FrettingHandPick, sel: FeatureSelection = {}) =>
  (frame: FrameBundle): FeatureVector | undefined =>
    frame.hands ? bassHandsFeaturizer(pick, sel)(frame.hands) : undefined;

/** The ordered feature ids each featurizer emits (for the standardizer). */
export function fluteFeatureIds(shapeIds: readonly string[], withFace = true): string[] {
  const ids = [...shapeIds.map((id) => `L.${id}`), ...shapeIds.map((id) => `R.${id}`)];
  if (withFace) ids.push(...EMBOUCHURE_BLENDSHAPES.map((n) => `face.${n}`));
  return ids;
}

export function bassFeatureIds(shapeIds: readonly string[]): string[] {
  return [...shapeIds, 'neck.distance', 'neck.dx', 'neck.dy'];
}

/**
 * The flute's FINGERING class of a note name. On the Boehm flute the first and second
 * octaves share their fingerings (the second is overblown, the difference is in the
 * embouchure) except D5 and D#5, played with the left index lifted; the third octave
 * uses different fingerings again and is out of this model's range. So: C4..C#5 and
 * E5..C6 map to their pitch class, D5 and D#5 keep their octave (`D5`, `D#5`), and
 * anything else (including `N`) is `N`.
 */
export function fluteFingeringClass(note: string): string {
  if (note === NO_CHORD) return NO_CHORD;
  const m = /^([A-G][#b]?)(-?\d)$/.exec(note);
  if (!m) throw new Error(`not a note name: ${note}`);
  const pc = pitchClassOf(note);
  const octave = Number(m[2]);
  const order = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const midi = 12 * (octave + 1) + order.indexOf(pc);
  if (midi < 60 || midi > 84) return NO_CHORD; // C4..C6
  if (midi === 74 || midi === 75) return `${pc}5`;
  return pc;
}

/** The `labelOf` seam for flute fingering classes over note segments. */
export const fluteFingeringLabeller =
  (segments: readonly ChordSegment[], marginSeconds = 0.08) =>
  (t: number): string | null => {
    const l = labelAt(segments, t, marginSeconds);
    if (l === null) return null;
    const c = fluteFingeringClass(l);
    return c === NO_CHORD ? null : c;
  };
