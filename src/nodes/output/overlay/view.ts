/**
 * What every overlay element sees (`OverlayView`), the element contract (`OverlayElement`), the shared colours and the mirroring helpers.
 *
 * Part of the `canvas-overlay` node (`../canvas_overlay.ts` is its public face; split into these
 * files by #600 S19a, the drawing unchanged).
 */
import type { CuePosition, OverlayCategory, OverlayParams } from '../canvas_overlay.schema';
import type { ExpressionScores } from '@/music/expression';
import type { TagOverlayFrame } from '@thoremin/taglog/presentation';
import type { HandMap } from '../../mapping/hand_map';
import type { BodyFrame, BodyStatus, CategoryScores, FaceFrame, HandFeatures, HandsFrame, SynthParams } from '@thoremin/sdk/nodes/domain';

// The params schemas (the overlay's settings contract) live in `../canvas_overlay.schema`.
export type Params = OverlayParams;

export const RIGHT_COLOR = '#10b981';
export const LEFT_COLOR = '#3b82f6';
export const FACE_COLOR = '#22d3ee'; // cyan — distinct from hands (emerald/blue) + chord (gold)
/** The body skeleton's colour (#186): distinct from hands/face/chord. */
export const BODY_COLOR = '#7dd3fc';
export const CHORD_COLOR = '#f5d142'; // warm gold

/** A HUD cue's distance from the canvas edge (the cue layout's, and the trainer HUD's own box). */
export const CUE_MARGIN = 12;

/** Everything an overlay element needs to draw a frame. */
export interface OverlayView {
  W: number;
  H: number;
  video?: HTMLVideoElement;
  inputs: {
    hands?: HandsFrame;
    features?: HandFeatures;
    params?: SynthParams;
    scale?: number[];
    scaleLeft?: number[];
    /** The chord-SOURCE scale note array (#75), decoupled from the melody `scale`. Used
     *  to NAME/analyze the sounding chord (chord-name function line, expression chord
     *  labels) against the scale it was actually built from. Falls back to `scale`. */
    chordScale?: number[];
    octaveShift: number;
    chord?: number[];
    faceFrame?: FaceFrame;
    /** The latest full-body pose (#186), for the skeleton element. */
    bodyFrame?: BodyFrame;
    /** The body model's lifecycle, so the skeleton element can say 'loading'. */
    bodyStatus?: BodyStatus;
    expression?: ExpressionScores;
    /** Live hand map (note source + finger routing), for feature-accurate cues. */
    handMap?: HandMap;
    /** Live expression→scale-degree map, to name each expression's chord. */
    faceDegrees?: Record<string, number>;
    /** Live expression targets (H6 of #613): a bar names its move or function instead. */
    faceTargets?: Record<string, string>;
    /** A personal categorizer's per-category degrees (#330 P4), to name each category's chord. */
    categoryDegrees?: Record<string, number>;
    /** A personal categorizer's per-category targets (H6 of #613), which win over its degrees. */
    categoryTargets?: Record<string, string>;
    /** Live face mapping mode ('chord'/'timbre'/…); chord labels show only in 'chord'. */
    faceMapping?: string;
    /** Burned-in tag HUD frame (#92): open tags + timecode + blink; null unless a
     *  take is recording. Computed in `process` from `ctx.resources.tagOverlay`. */
    tagOverlay?: TagOverlayFrame | null;
    /** A classifier's reading (the ASL sign reader), for the category cues. */
    categories?: CategoryScores | null;
    /** Second bar labels aligned with `categories.labels` ('' for none): the chord a sign plays. */
    categoryCaptions?: readonly string[] | null;
  };
  params: Params;
  /** Computed top-left origin per cue element name (set by the layout pass). */
  layout: Record<string, { x: number; y: number }>;
  /** The engine time of this frame (seconds). */
  t: number;
  /**
   * The elements the composed graph's branches asked for (the ADR, §3.2 rule 4), or
   * undefined for "every element" (no host, or a pre-composition frame). Each element's
   * own `show` dial still applies: this is an intersection, never an override.
   */
  elements?: readonly OverlayElement[];
  /** True on the overlay-only (alpha) pass (#88), so a contributed element can leave a backdrop out. */
  overlayOnly?: boolean;
  /** The contributed elements' state in this overlay instance (#600 S10), by element id. */
  elementState?: Record<string, { memo: Record<string, unknown>; broken: boolean }>;
  /** Each contributed element's inputs this tick, by element id (#600 S5): what its impl sees. */
  contributed?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}


/**
 * One composable piece of the overlay. In-scene elements implement `draw`. A HUD
 * `cue` also sets `cue:true`, `measure()` (its box size, or null when idle) and
 * `positionOf()` (its edge); the layout pass computes `view.layout[name]` and `draw`
 * reads that origin.
 */
export interface OverlayElement {
  name: string;
  /**
   * The `Params` sub-object this element reads, when it is not the element's own name.
   *
   * Almost every element owns a params key called after itself, and that identity used to
   * be assumed outright. It stops holding as soon as an element's config lives on a
   * TOOLING surface rather than the instrument: the correlation matrix (#150) is drawn as
   * its own element but configured by the per-device `featureLab` block (#136 — the Lab
   * measures the instrument, so its settings must not ride an instrument dial). Naming the
   * key explicitly keeps the "no element is silently un-configurable" invariant true and
   * checkable, instead of quietly excluding the elements it no longer fits.
   */
  configKey?: string;
  category: OverlayCategory;
  cue?: boolean;
  measure?(view: OverlayView): { w: number; h: number } | null;
  positionOf?(view: OverlayView): CuePosition;
  draw(g: CanvasRenderingContext2D, view: OverlayView): void;
  /** Once per tick, before every pass draws: a contributed element's `update` (#600 S16b). */
  update?(view: OverlayView): void;
}

export function mirrorX(xPx: number, frameW: number, W: number): number {
  return W - (xPx / frameW) * W;
}
export function isDisplayedRight(handedness: string): boolean {
  return handedness === 'Left';
}
