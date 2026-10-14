/**
 * The conductor's expression shaping (#378, #457; split from `conductor.ts`, #557): the
 * dynamics and articulation of a tick, from the beat's own source or the other one. It owns
 * the state that reading needs (the other source's follower, the body's channel meter and
 * per-player blend, the shaping hand's gesture and the crossfade between its two readings),
 * and exposes one step plus the two resets the node's lifecycle calls.
 */
import type { NodeContext } from '@thoremin/dag';
import { createExpressionBlend, createHandGesture, createIctus, createImpactDetector, type DynamicsEstimate, type ExpressionBlend, type HandGesture, type Ictus, type IctusState } from '@thoremin/ictus';
import type { BodyFrame, HandsFrame } from '@thoremin/sdk/nodes/domain';
import { captureTime } from '@thoremin/sdk/timing/tracker';
import { handGestureFrame } from './conductor_gesture';
import { bodyChannelFrame, conductorBodyJoints, createBodyExpressionMeter, type BodyExpressionMeter } from './conductor_body';
import { handPoint, isFresh, MIN_SAMPLE_SPACING, shapingHand } from './conductor_hands';
import type { ConductorDialParams as Params } from './conductor';

/** What the shaping of one tick reads from the beat's follower. */
export type ShapingInput = Pick<IctusState, 'dynamics' | 'articulation' | 'anchor'>;

export interface ExpressionShaper {
  /** The dynamics and articulation for this tick (see `expression` in the node's header). */
  shape(inputs: Record<string, unknown>, ctx: NodeContext, c: Params, s: ShapingInput): DynamicsEstimate;
  /** The beat's follower restarted (a replay from the top): the expression's own frame
   *  clocks and its crossfade restart with it; the other source's follower stays. */
  restartClocks(): void;
  /** The conductor is off: everything the shaping holds is let go. */
  reset(): void;
}

export function createExpressionShaper(): ExpressionShaper {
  /** A follower of the OTHER source when the expression is not the beat's (only its
   *  strokes' dynamics and articulation are read), the body's per-frame channels, and
   *  their per-player blend while the body shapes. */
  let exprIctus: Ictus | null = null;
  let exprKey = '';
  let exprMeter: BodyExpressionMeter | null = null;
  let blend: ExpressionBlend | null = null;
  let lastExprBody: BodyFrame | undefined;
  let lastExprBodyT = -Infinity;
  let lastExprHands: HandsFrame | undefined;
  let lastExprPtT = -Infinity;
  /** The shaping hand's gesture (#457) and the time of its last stroke: while it makes
   *  none, the gesture shapes. */
  let gesture: HandGesture | null = null;
  let lastShapeStrokeT = -Infinity;
  let prevShapeStrokeT = -Infinity;
  /** The crossfade between the strokes' reading and the gesture's (`handGesture.fadeS`). */
  let shapeMode: 'strokes' | 'gesture' | null = null;
  let fadeFrom = NaN;
  let fadeT0 = -Infinity;
  let lastShapedDyn = NaN;

  const resetFade = (): void => {
    shapeMode = null;
    fadeFrom = NaN;
    fadeT0 = -Infinity;
    lastShapedDyn = NaN;
  };

  const reset = (): void => {
    exprIctus = null;
    exprKey = '';
    exprMeter = null;
    blend = null;
    gesture = null;
    resetFade();
    lastExprBodyT = -Infinity;
    lastExprPtT = -Infinity;
    lastShapeStrokeT = -Infinity;
    prevShapeStrokeT = -Infinity;
  };

  const restartClocks = (): void => {
    lastExprBodyT = -Infinity;
    lastExprPtT = -Infinity;
    lastShapeStrokeT = -Infinity;
    prevShapeStrokeT = -Infinity;
    resetFade();
  };

  /** The dynamics and articulation for this tick (#378; see `expression`). A dancer's own
   *  expression is the body's (#380): its motion and reach, read once per pulse cycle
   *  (`s.anchor` is the cycle), with no stroke excursion. */
  const shape = (inputs: Record<string, unknown>, ctx: NodeContext, c: Params, s: Pick<IctusState, 'dynamics' | 'articulation' | 'anchor'>): DynamicsEstimate => {
    const source = c.expression === 'same' ? (c.source === 'dancer' ? 'body' : c.source) : c.expression;
    const beat: DynamicsEstimate = { dynamics: s.dynamics, articulation: s.articulation };
    const ownBody = c.source === 'dancer' && source === 'body';
    // The hand conductor's other hand, named to shape (#457): the hands alone split the role.
    const beatingHand = c.hand === 'auto' ? 'right' : c.hand;
    const otherHand = source === 'hands' && c.source === 'hands' && c.expressionHand !== 'auto' && c.expressionHand !== beatingHand;
    const now = followOtherSource(inputs, ctx, c, source, (source === c.source && !otherHand) || ownBody);
    // The shaping source's strokes, once it has shown one; until then (the pose model
    // loading, nobody's other hand in frame) the beat's own.
    const shaped = (): DynamicsEstimate => {
      const e = exprIctus?.state();
      return e && e.anchors > 0 ? e : beat;
    };
    return source !== 'body' ? shapeFromHands(c, shaped(), now) : shapeFromBody(inputs, ctx, c, s, ownBody, shaped);
  };

  /** The follower of the OTHER source (`own`: the beat's own source shapes, so there is
   *  none): built when the source or its settings change, fed the hands' frame here (the
   *  body's is fed by {@link shapeFromBody}). Returns the time the shaping reads at. */
  const followOtherSource = (inputs: Record<string, unknown>, ctx: NodeContext, c: Params, source: string, own: boolean): number => {
    let now = ctx.time;
    if (own) {
      exprIctus = null;
      return now;
    }
    // The other source's follower: its prior only paces its detector.
    const key = source === 'body' ? `body:${c.bodyPoint}:${c.hand}:${c.mirrorX}` : `hands:${c.source}:${c.bodyPoint}:${c.hand}:${c.expressionHand}:${c.handGesture.minStroke}:${c.mirrorX}:${c.mirrorHandedness}`;
    if (!exprIctus || key !== exprKey) {
      exprIctus = createIctus({
        // A shaping hand's stroke is at least `minStroke` frame heights: a hand held
        // still is quiet (its tremor is no stroke), so its gesture shapes (#457).
        detector: source === 'body' ? createImpactDetector({ joints: conductorBodyJoints(c.bodyPoint, c.hand), mirrorX: c.mirrorX }) : { mirrorX: c.mirrorX, minAmplitude: c.handGesture.minStroke },
        prior: c.prior,
      });
      exprKey = key;
      lastExprPtT = -Infinity;
      lastShapeStrokeT = -Infinity;
      prevShapeStrokeT = -Infinity;
      gesture = null;
      resetFade();
    }
    if (source === 'hands') {
      const frame = inputs.hands as HandsFrame | undefined;
      const fresh = isFresh(frame, lastExprHands);
      lastExprHands = frame;
      const hand = frame && fresh ? shapingHand(frame, c) : undefined;
      const t = captureTime(frame, ctx);
      now = t;
      if (hand && frame && frame.height > 0 && t >= lastExprPtT + MIN_SAMPLE_SPACING) {
        if (exprIctus.feed(handPoint(hand, frame, c, t)).anchor) {
          prevShapeStrokeT = lastShapeStrokeT;
          lastShapeStrokeT = t;
        }
        gesture ??= createHandGesture();
        gesture.push(handGestureFrame(hand, frame, inputs.body as BodyFrame | undefined, t));
        lastExprPtT = t;
      }
    }
    return now;
  };

  /** Shaping read from the hands (#457): the shaping source's strokes, or, while its hand
   *  makes no stroke, the gesture (its height and palm), continuously; a change of reading
   *  crossfades from where the dynamics were (no step in CC11). `shapedNow` is the
   *  strokes the shaping source has shown (the beat's own until it shows one). */
  const shapeFromHands = (c: Params, shapedNow: DynamicsEstimate, now: number): DynamicsEstimate => {
    exprMeter = null;
    blend = null;
    let strokes = shapedNow;
    // A shaping hand that makes no stroke (#457): its height and palm say the loudness,
    // continuously; its strokes' articulation (or the beat's) stands. A hand not seen for
    // a moment reads as before.
    // Stroking is two strokes in a row, each within `quietS` of the next (and of now):
    // one turn, a hand lowered to hush and stopping, is not a beat.
    const stroking = lastShapeStrokeT - prevShapeStrokeT <= c.handGesture.quietS && now - lastShapeStrokeT <= c.handGesture.quietS;
    if (exprIctus) {
      let mode: 'strokes' | 'gesture' = 'strokes';
      if (gesture && !stroking) {
        gesture.setWeights({ height: c.handGesture.height, palm: c.handGesture.palm });
        const g = gesture.read(now);
        if (Number.isFinite(g)) {
          strokes = { dynamics: g, articulation: strokes.articulation };
          mode = 'gesture';
        }
      }
      // A change of reading crossfades from where the dynamics were (no step in CC11).
      if (shapeMode !== null && mode !== shapeMode) {
        fadeFrom = lastShapedDyn;
        fadeT0 = now;
      }
      shapeMode = mode;
      const u = c.handGesture.fadeS > 0 ? Math.min(1, Math.max(0, (now - fadeT0) / c.handGesture.fadeS)) : 1;
      if (Number.isFinite(fadeFrom) && u < 1) strokes = { dynamics: fadeFrom + (strokes.dynamics - fadeFrom) * u, articulation: strokes.articulation };
      lastShapedDyn = strokes.dynamics;
    }
    return strokes;
  };

  /** Shaping read from the body: the strokes' dynamics blended with its motion and its
   *  arm's reach, each per player (`shaped` is read at the end, after this tick's frame). */
  const shapeFromBody = (inputs: Record<string, unknown>, ctx: NodeContext, c: Params, s: Pick<IctusState, 'anchor'>, ownBody: boolean, shaped: () => DynamicsEstimate): DynamicsEstimate => {
    exprMeter ??= createBodyExpressionMeter();
    // A dancer's cycle has no braking sharpness: its articulation is the body's flow.
    const articulation = ownBody ? 'flow' : c.articulationFrom;
    blend ??= createExpressionBlend({ articulation });
    blend.setArticulation(articulation);
    const body = inputs.body as BodyFrame | undefined;
    const fresh = isFresh(body, lastExprBody);
    lastExprBody = body;
    const t = captureTime(body, ctx);
    if (body && fresh && t >= lastExprBodyT + MIN_SAMPLE_SPACING) {
      lastExprBodyT = t;
      // The channels are read per stroke (a hold or a fermata changes nothing).
      blend.push(exprMeter.push(body, t, c.hand));
      if (exprIctus) {
        const a = exprIctus.feedFrame(bodyChannelFrame(body, t, c.hand)).anchor;
        if (a) blend.pushStroke(a);
      }
    }
    // The beat's own stroke this tick, when the body both beats and shapes.
    if (!exprIctus && s.anchor) blend.pushStroke(s.anchor);
    return blend.read(ownBody ? null : shaped());
  };

  return { shape, restartClocks, reset };
}
