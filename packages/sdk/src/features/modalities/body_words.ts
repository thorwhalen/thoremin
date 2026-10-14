/**
 * The body's pose features in a player's words (#382, #385 E9): what the quality hints of the
 * carve (#385 E6) say about a pose category that is too close to another ("raise your left
 * forearm more"). One entry per feature of the pose space (`../body_groups.ts`), built from the
 * id's parts, so a new segment or side needs no edit here.
 *
 * `left` and `right` are the PLAYER's (MediaPipe names pose landmarks by the subject, whatever
 * way the video is shown). Features that read one movement share `movement` (the shoulder angle
 * and the upper arm's elevation are both the arm's raise), so a hint says it once.
 */
import type { FeatureWords } from '../../enroll/modality';

/** A segment's name in words. */
const SEGMENT: Readonly<Record<string, string>> = { upperArm: 'upper arm', forearm: 'forearm', thigh: 'thigh', shank: 'lower leg' };

function dirWords(seg: string, side: string, axis: string): FeatureWords | undefined {
  const part = `${side} ${SEGMENT[seg] ?? seg}`;
  // The upper arm raised is the arm raised: one movement with the shoulder angle.
  const raise = seg === 'upperArm' ? `${side}-arm-raise` : undefined;
  if (axis === 'up') return { name: `${part} raised`, more: `raise your ${part} more`, less: `lower your ${part}`, ...(raise ? { movement: raise } : {}) };
  if (axis === 'out') return { name: `${part} out to the side`, more: `move your ${part} further out to the side`, less: `bring your ${part} in toward your body` };
  if (axis === 'fwd') return { name: `${part} forward`, more: `bring your ${part} further forward`, less: `take your ${part} back` };
  return undefined;
}

function angleWords(joint: string, side: string | undefined): FeatureWords | undefined {
  if (joint === 'torso' && side === 'lean') return { name: 'torso lean', more: 'lean further to the side', less: 'stand straighter', signed: true };
  if (joint === 'head' && side === 'tilt') return { name: 'head tilt', more: 'tilt your head more', less: 'hold your head level', signed: true };
  if (!side) return undefined;
  // Elbow, knee and hip angles are 180 when straight: the bend grows as they fall.
  if (joint === 'elbow' || joint === 'knee') return { name: `${side} ${joint} bend`, more: `bend your ${side} ${joint} more`, less: `straighten your ${side} ${joint}`, invert: true };
  if (joint === 'hip') return { name: `${side} hip bend`, more: `bend more at your ${side} hip`, less: `stand straighter at your ${side} hip`, invert: true };
  if (joint === 'shoulder') return { name: `${side} arm raised`, more: `raise your ${side} arm higher`, less: `lower your ${side} arm`, movement: `${side}-arm-raise` };
  return undefined;
}

const SHAPE: Readonly<Record<string, FeatureWords>> = {
  extension: { name: 'reach', more: 'stretch out further', less: 'draw in closer to your body' },
  openness: { name: 'hands apart', more: 'move your hands further apart', less: 'bring your hands closer together' },
  stance: { name: 'feet apart', more: 'put your feet further apart', less: 'bring your feet closer together' },
  // Head-to-ankle height falls in a crouch.
  height: { name: 'crouch', more: 'crouch lower', less: 'stand taller', invert: true },
};

/** A body pose feature in plain words, or undefined for one this table does not name. */
export function bodyWords(featureId: string): FeatureWords | undefined {
  const parts = featureId.split('.');
  if (parts[0] !== 'body') return undefined;
  const [, group, a, b, c] = parts;
  if (group === 'dir' && a && b && c) return dirWords(a, b, c);
  if (group === 'angle' && a) return angleWords(a, b);
  if (group === 'pos' && a === 'wrist' && b && c === 'rise') return { name: `${b} hand height`, more: `raise your ${b} hand higher`, less: `lower your ${b} hand` };
  if (group === 'shape' && a && Object.hasOwn(SHAPE, a)) return SHAPE[a];
  return undefined;
}
