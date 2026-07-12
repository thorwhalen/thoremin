/**
 * `canvas-overlay` node (browser-only) — the visual output + guides + cues.
 *
 * The overlay is composed of an ordered list of independent **overlay elements**
 * (see `OVERLAY_ELEMENTS`): the mirrored webcam backdrop, a per-scale-note pitch
 * guide, finger guides, hand/face landmark dots, per-hand control markers, the
 * finger→thumb effect lines, and HUD "cue" readouts (the face-expression bar graph
 * and the finger bar graph).
 *
 * Two kinds of element:
 *  - **in-scene** elements draw at a feature's location (markers on the hand, lines
 *    from fingertip to thumb, guides across the frame);
 *  - **cue** elements are HUD boxes (bar graphs) placed on a screen EDGE and
 *    auto-stacked when several share one — a cue declares `cue:true` + `measure()`
 *    + `positionOf()`, and reads its computed origin from `view.layout[name]`.
 *
 * Each element is drawn in list order (= z-order), reads only what it needs, and is
 * toggled/parameterized by its own sub-object in `Params`. This is the worked
 * example of the "sub-components are toggled functions inside one node" rule. To
 * reflect the actual mapping, elements read the live **hand map** (note source +
 * finger routing) and the expression→degree map via `ctx.resources.controls`.
 *
 * Canvas + video are injected via `ctx.resources`. Pure drawing; no port output.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';
import {
  chordName,
  classifyChord,
  freqToMidi,
  midiToName,
  nashvilleNumber,
  NOTES,
  romanNumeral,
  scaleDegreeOf,
  scaleGuide,
} from '@/music/theory';
import { EMOTIONS, type ExpressionScores } from '@/music/expression';
import { clamp01 } from '@/features/math';
import { createLabMeterComputer, type FeatureMeters } from '@/features/labMeters';
import {
  DEFAULT_LAB_GROUPS,
  DERIVED_GROUP,
  FEATURE_BY_ID,
  FEATURE_GROUPS,
  type FeatureVector,
} from '@/features/catalog';
import { computeTagOverlay, type TagOverlayFrame, type TagOverlaySnapshot } from '@/taglog/presentation';
import { EFFECT_SHORT, type HandMap } from '../mapping/hand_map';
import {
  FINGER_NAMES,
  kp,
  LM,
  type FingerName,
  type FaceFrame,
  type HandFeatures,
  type HandsFrame,
  type SingleHandFeatures,
  type SynthParams,
} from '../domain';

/** Which screen edge a HUD cue is placed on. */
const CuePositionEnum = z.enum(['left', 'right', 'top', 'bottom']);
export type CuePosition = z.infer<typeof CuePositionEnum>;

/**
 * Per-element configuration. Each element has its own sub-object so it can be
 * toggled and parameterized independently.
 */
const Params = z.object({
  /** Mirrored webcam backdrop. `alpha` is the "grey-out" amount (0 = hidden). */
  video: z.object({ show: z.boolean().default(true), alpha: z.number().min(0).max(1).default(0.35) }).prefault({}),
  /** Faint vertical guide at each scale note (a "fretboard"), with note labels. */
  scaleGuide: z.object({ show: z.boolean().default(true), showLabels: z.boolean().default(true) }).prefault({}),
  /** Highlight the face-driven chord's tones on the pitch guide (face chord mode). */
  chordGuide: z.object({ show: z.boolean().default(true) }).prefault({}),
  /** Dashed vertical line from each index fingertip to the frame edge. Opt-in. */
  indexGuide: z.object({ show: z.boolean().default(false), dashed: z.boolean().default(true) }).prefault({}),
  /** Hand landmark dots + a ring around each hand's active note source. */
  landmarks: z.object({ show: z.boolean().default(true) }).prefault({}),
  /** Per-hand control marker at the note source (openness = ring size, pinch = fill). */
  markers: z.object({ show: z.boolean().default(true), showNotes: z.boolean().default(true) }).prefault({}),
  /** Lines from each ROUTED fingertip to the thumb, labelled value + effect. Opt-in. */
  fingerLines: z.object({ show: z.boolean().default(false), showLabels: z.boolean().default(true) }).prefault({}),
  /** The detected face mesh (input feature) — available when a face mapping is on. */
  faceLandmarks: z.object({ show: z.boolean().default(true) }).prefault({}),
  /** Per-hand brightness/vibrato level bars (output feature). Opt-in. */
  timbreLevels: z.object({ show: z.boolean().default(false) }).prefault({}),
  /**
   * Face-expression bar graph (HUD cue): a bar + firing tick per emotion; the winner
   * is highlighted. Optional vertical x-axis labels (the expression name and/or the
   * chord each maps to) replace the old top label.
   */
  faceExpression: z
    .object({
      show: z.boolean().default(true),
      position: CuePositionEnum.default('left'),
      /** The big winning-label text above the bars (superseded by the highlight). */
      topLabel: z.boolean().default(false),
      /** x-axis: the expression name under each bar (vertical). */
      exprLabels: z.boolean().default(true),
      /** x-axis: the chord each expression maps to, under each bar (vertical). */
      chordLabels: z.boolean().default(true),
    })
    .prefault({}),
  /** Finger→effect bar graph (HUD cue): a bar per routed finger, effect-labelled. Opt-in. */
  fingerBars: z
    .object({ show: z.boolean().default(false), position: CuePositionEnum.default('left') })
    .prefault({}),
  /**
   * Chord-name HUD cue: the sounding chord's jazz symbol (e.g. `Am7`) plus an
   * optional function line — the Roman numeral (`vi7`) or, with `nashville`, the
   * Nashville number (`6m7`) of the chord within the current scale. Only shows
   * while a chord actually sounds (face chord / pose modes).
   */
  chordName: z
    .object({
      show: z.boolean().default(true),
      position: CuePositionEnum.default('top'),
      /** Show the secondary function line (Roman / Nashville) under the symbol. */
      roman: z.boolean().default(true),
      /** Use Nashville numbers instead of Roman numerals for the function line. */
      nashville: z.boolean().default(false),
    })
    .prefault({}),
  /**
   * Keyboard strip (bottom-edge): a thin piano/scale ribbon showing, with a
   * shape+brightness hierarchy, the chord root (gold diamond) ▸ voiced-now (glow)
   * ▸ chord-tone set (faint gold) ▸ scale root (blue ring) over the in-scale keys.
   * `scaleMode` swaps the standard chromatic piano for a decluttered scale-only
   * ribbon. Opt-in (it's a large element).
   */
  keyboardStrip: z
    .object({
      show: z.boolean().default(false),
      /** false = standard chromatic piano; true = scale-only equal cells. */
      scaleMode: z.boolean().default(false),
      /** Strip height as a fraction of the canvas height. */
      height: z.number().min(0.05).max(0.2).default(0.1),
      showLabels: z.boolean().default(false),
      showChordTones: z.boolean().default(true),
      showScaleRoot: z.boolean().default(true),
    })
    .prefault({}),
  /**
   * Feature Instrumentation Lab (#119): a dense grid of grouped, online-normalized
   * meters for the raw face/hand feature vectors, so heterogeneous ranges read as
   * comparable levels. `groups` is the display + compute selection (the vector
   * nodes read it too via the control snapshot, so it drives what is measured, not
   * only what is drawn); `normalizer` picks the level mapping. Opt-in (a large,
   * exploratory panel). Group/derived state that can't live here (arbitrary derived
   * formulas, reset) rides the separate lab store (ctx.resources.lab).
   */
  featureLab: z
    .object({
      show: z.boolean().default(false),
      groups: z.array(z.string()).default([...DEFAULT_LAB_GROUPS]),
      normalizer: z.enum(['minmax', 'quantile', 'zscore']).default('minmax'),
      /** Number of newspaper-flow columns in the meter grid. */
      columns: z.number().int().min(1).max(8).default(3),
      /** Draw the percentile-band reference ticks on each meter. */
      showMarkers: z.boolean().default(true),
      /** Print the raw value beside each meter. */
      showValues: z.boolean().default(false),
      /** User-defined derived features: a safe formula (jsep whitelist) over feature
       *  safe-names (`face.geom.mouth.openness` → `face_geom_mouth_openness`) + the
       *  helper set. Evaluated over the merged face+hand vector; shown under the
       *  `derived` group. An invalid formula is skipped (the editor shows the error). */
      derived: z
        .array(z.object({ id: z.string(), formula: z.string() }))
        .default([]),
      /** Bump to re-zero the online statistics (a manual "recalibrate"). */
      resetNonce: z.number().default(0),
    })
    .prefault({}),
  /**
   * Live-tagging burned-in corner HUD (#92): while a take is recording with tagging
   * on, paints the open tags + a media timecode + a ~1 Hz REC blink into the
   * composited (and alpha) frames — the in-band "second opinion" that makes stream
   * alignment verifiable in the very pixels a model trains on. A no-op (draws
   * nothing) whenever no take is recording, so it costs nothing the rest of the time.
   */
  tagHud: z
    .object({
      show: z.boolean().default(true),
      /** Which top corner the chip stack anchors to. */
      position: z.enum(['left', 'right']).default('right'),
    })
    .prefault({}),
});
type Params = z.infer<typeof Params>;

/**
 * The overlay's per-element params schema, exported so it is the single source of
 * truth for the overlay portion of saved settings and for the overlay settings panel.
 */
export const OverlayParamsSchema = Params;
export type OverlayParams = Params;

const RIGHT_COLOR = '#10b981';
const LEFT_COLOR = '#3b82f6';
const FACE_COLOR = '#22d3ee'; // cyan — distinct from hands (emerald/blue) + chord (gold)
const CHORD_COLOR = '#f5d142'; // warm gold

/** Everything an overlay element needs to draw a frame. */
export interface OverlayView {
  W: number;
  H: number;
  video?: HTMLVideoElement;
  /** Feature-lab meters, computed by {@link createLabMeterComputer} (present only
   *  while the lab is shown). The overlay only DRAWS them. */
  featureMeters?: FeatureMeters;
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
    expression?: ExpressionScores;
    /** Live hand map (note source + finger routing), for feature-accurate cues. */
    handMap?: HandMap;
    /** Live expression→scale-degree map, to name each expression's chord. */
    faceDegrees?: Record<string, number>;
    /** Live face mapping mode ('chord'/'timbre'/…); chord labels show only in 'chord'. */
    faceMapping?: string;
    /** Burned-in tag HUD frame (#92): open tags + timecode + blink; null unless a
     *  take is recording. Computed in `process` from `ctx.resources.tagOverlay`. */
    tagOverlay?: TagOverlayFrame | null;
  };
  params: Params;
  /** Computed top-left origin per cue element name (set by the layout pass). */
  layout: Record<string, { x: number; y: number }>;
}

export type OverlayCategory = 'input' | 'output' | 'guide' | 'backdrop';

export const OVERLAY_CATEGORIES: { id: OverlayCategory; label: string; blurb: string }[] = [
  { id: 'input', label: 'Input features', blurb: 'What the camera detected.' },
  { id: 'output', label: 'Output features', blurb: 'What your gestures are mapped to.' },
  { id: 'guide', label: 'Guides', blurb: 'Reference overlays.' },
  { id: 'backdrop', label: 'Backdrop', blurb: 'The video feed.' },
];

/**
 * One composable piece of the overlay. In-scene elements implement `draw`. A HUD
 * `cue` also sets `cue:true`, `measure()` (its box size, or null when idle) and
 * `positionOf()` (its edge); the layout pass computes `view.layout[name]` and `draw`
 * reads that origin.
 */
export interface OverlayElement {
  name: string;
  category: OverlayCategory;
  cue?: boolean;
  measure?(view: OverlayView): { w: number; h: number } | null;
  positionOf?(view: OverlayView): CuePosition;
  draw(g: CanvasRenderingContext2D, view: OverlayView): void;
}

function mirrorX(xPx: number, frameW: number, W: number): number {
  return W - (xPx / frameW) * W;
}
function isDisplayedRight(handedness: string): boolean {
  return handedness === 'Left';
}

const videoBackdrop: OverlayElement = {
  name: 'video',
  category: 'backdrop',
  draw(g, { W, H, video, params }) {
    if (!params.video.show) return;
    if (!video || video.readyState < 2) return;
    g.save();
    g.globalAlpha = params.video.alpha;
    g.scale(-1, 1);
    g.translate(-W, 0);
    g.drawImage(video, 0, 0, W, H);
    g.restore();
  },
};

const arrEq = (a?: number[], b?: number[]) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);

const scaleGuideElement: OverlayElement = {
  name: 'scaleGuide',
  category: 'guide',
  draw(g, { W, H, inputs, params }) {
    if (!params.scaleGuide.show) return;
    const scaleR = inputs.scale;
    if (!Array.isArray(scaleR) || scaleR.length <= 1) return;
    const shift = inputs.octaveShift;
    const drawGuide = (s: number[], color: string, alpha: number, labelY: number) => {
      g.save();
      g.font = '11px monospace';
      g.textAlign = 'center';
      for (const { midi, x } of scaleGuide(s)) {
        const sx = x * W;
        g.globalAlpha = alpha;
        g.strokeStyle = color;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(sx, H * 0.12);
        g.lineTo(sx, H * 0.86);
        g.stroke();
        if (params.scaleGuide.showLabels) {
          g.globalAlpha = Math.min(1, alpha * 4);
          g.fillStyle = color;
          g.fillText(midiToName(midi + shift * 12), sx, labelY);
        }
      }
      g.restore();
    };
    drawGuide(scaleR, '#ffffff', 0.1, H * 0.82);
    const scaleL = inputs.scaleLeft;
    if (Array.isArray(scaleL) && scaleL.length > 1 && !arrEq(scaleL, scaleR)) {
      drawGuide(scaleL, LEFT_COLOR, 0.12, H * 0.18);
    }
  },
};

const chordGuideElement: OverlayElement = {
  name: 'chordGuide',
  category: 'output',
  draw(g, { W, H, inputs, params }) {
    if (!params.chordGuide.show) return;
    const chord = inputs.chord;
    const scale = inputs.scale;
    if (!Array.isArray(chord) || chord.length === 0) return;
    if (!Array.isArray(scale) || scale.length <= 1) return;
    const pitchClass = (m: number) => (((m % 12) + 12) % 12);
    const chordPcs = new Set(chord.map(pitchClass));
    g.save();
    g.globalAlpha = 0.28;
    g.strokeStyle = CHORD_COLOR;
    g.lineWidth = 2;
    for (const { midi, x } of scaleGuide(scale)) {
      if (!chordPcs.has(pitchClass(midi))) continue;
      const sx = x * W;
      g.beginPath();
      g.moveTo(sx, H * 0.12);
      g.lineTo(sx, H * 0.86);
      g.stroke();
    }
    g.restore();
  },
};

const indexFingerGuide: OverlayElement = {
  name: 'indexGuide',
  category: 'guide',
  draw(g, { W, H, inputs, params }) {
    if (!params.indexGuide.show) return;
    const frame = inputs.hands;
    if (!frame) return;
    for (const hand of frame.hands) {
      const tip = kp(hand, LM.index_tip);
      if (!tip) continue;
      const sx = mirrorX(tip.x, frame.width, W);
      const sy = (tip.y / frame.height) * H;
      const right = isDisplayedRight(hand.handedness);
      g.save();
      g.globalAlpha = 0.4;
      g.strokeStyle = right ? RIGHT_COLOR : LEFT_COLOR;
      g.lineWidth = 2;
      if (params.indexGuide.dashed) g.setLineDash([5, 5]);
      g.beginPath();
      g.moveTo(sx, sy);
      g.lineTo(sx, right ? 0 : H);
      g.stroke();
      g.restore();
    }
  },
};

/** The landmark used as the "note source" ring, per the hand map. */
const sourceLm = (view: OverlayView): number =>
  view.inputs.handMap?.positionSource === 'wrist' ? LM.wrist : LM.index_tip;

const landmarkDots: OverlayElement = {
  name: 'landmarks',
  category: 'input',
  draw(g, view) {
    const { W, H, inputs, params } = view;
    if (!params.landmarks.show) return;
    const frame = inputs.hands;
    if (!frame) return;
    const srcLm = sourceLm(view);
    for (const hand of frame.hands) {
      const color = hand.handedness === 'Left' ? RIGHT_COLOR : LEFT_COLOR; // mirrored
      g.fillStyle = color;
      for (const k of hand.keypoints) {
        const sx = mirrorX(k.x, frame.width, W);
        const sy = (k.y / frame.height) * H;
        g.beginPath();
        g.arc(sx, sy, 3, 0, Math.PI * 2);
        g.fill();
      }
      // Ring the ACTIVE note source (wrist or index), matching what plays the note.
      const src = hand.keypoints[srcLm];
      if (src) {
        const sx = mirrorX(src.x, frame.width, W);
        const sy = (src.y / frame.height) * H;
        g.beginPath();
        g.arc(sx, sy, 10, 0, Math.PI * 2);
        g.strokeStyle = '#fff';
        g.lineWidth = 2;
        g.stroke();
      }
    }
  },
};

const controlMarkers: OverlayElement = {
  name: 'markers',
  category: 'output',
  draw(g, view) {
    const { W, H, inputs, params } = view;
    if (!params.markers.show) return;
    const feats = inputs.features;
    if (!feats) return;
    const sp = inputs.params;
    const wrist = inputs.handMap?.positionSource === 'wrist';
    const noteFor = (voiceId: number): string | null => {
      const v = sp?.voices?.[voiceId];
      if (!v || !v.present || v.freq <= 0) return null;
      return midiToName(freqToMidi(v.freq));
    };
    const drawMarker = (f: SingleHandFeatures, color: string, note: string | null) => {
      if (!f.present) return;
      // The marker sits at the ACTIVE note source (wrist or index fingertip).
      const sx = (wrist ? f.wristX : f.x) * W;
      const sy = (wrist ? f.wristY : f.y) * H;
      const ring = 14 + f.openness * 26;
      g.beginPath();
      g.arc(sx, sy, ring, 0, Math.PI * 2);
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.stroke();
      g.globalAlpha = 0.3 + 0.7 * f.pinch;
      g.fillStyle = color;
      g.beginPath();
      g.arc(sx, sy, 8, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      if (params.markers.showNotes && note) {
        g.fillStyle = color;
        g.font = 'bold 22px monospace';
        g.textAlign = 'center';
        g.fillText(note, sx, sy - ring - 10);
        g.textAlign = 'left';
      }
    };
    drawMarker(feats.right, RIGHT_COLOR, noteFor(0));
    drawMarker(feats.left, LEFT_COLOR, noteFor(1));
  },
};

/**
 * Finger→thumb effect lines (in-scene): for each ROUTED finger, a line from the
 * fingertip to the thumb tip, labelled with the normalized closeness value and a very
 * short effect name (brt/vib/pan/bnd/oct/gate). Shows exactly which distances drive
 * which sound aspect. Opt-in; nothing without a hand map that routes fingers.
 */
const fingerLinesElement: OverlayElement = {
  name: 'fingerLines',
  category: 'output',
  draw(g, view) {
    const { W, H, inputs, params } = view;
    if (!params.fingerLines.show) return;
    const frame = inputs.hands;
    const feats = inputs.features;
    const routes = inputs.handMap?.fingers;
    if (!frame || !feats || !routes) return;
    const TIP: Record<FingerName, number> = {
      index: LM.index_tip,
      middle: LM.middle_tip,
      ring: LM.ring_tip,
      pinky: LM.pinky_tip,
    };
    g.save();
    g.font = 'bold 11px monospace';
    g.textAlign = 'center';
    for (const hand of frame.hands) {
      const right = isDisplayedRight(hand.handedness);
      const f = right ? feats.right : feats.left;
      if (!f.present) continue;
      const color = right ? RIGHT_COLOR : LEFT_COLOR;
      const thumb = kp(hand, LM.thumb_tip);
      if (!thumb) continue;
      const tx = mirrorX(thumb.x, frame.width, W);
      const ty = (thumb.y / frame.height) * H;
      for (const name of FINGER_NAMES) {
        const r = routes[name];
        if (!r || r.target === 'none') continue;
        const tip = kp(hand, TIP[name]);
        if (!tip) continue;
        const fx = mirrorX(tip.x, frame.width, W);
        const fy = (tip.y / frame.height) * H;
        const value = f.fingers[name];
        g.globalAlpha = 0.35 + 0.55 * value;
        g.strokeStyle = color;
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(fx, fy);
        g.lineTo(tx, ty);
        g.stroke();
        if (params.fingerLines.showLabels) {
          g.globalAlpha = 0.9;
          g.fillStyle = color;
          g.fillText(`${EFFECT_SHORT[r.target]} ${value.toFixed(2)}`, (fx + tx) / 2, (fy + ty) / 2 - 3);
        }
      }
    }
    g.restore();
  },
};

const faceMesh: OverlayElement = {
  name: 'faceLandmarks',
  category: 'input',
  draw(g, { W, H, inputs, params }) {
    if (!params.faceLandmarks.show) return;
    const face = inputs.faceFrame;
    if (!face?.present || !face.landmarks?.length) return;
    g.save();
    g.globalAlpha = 0.45;
    g.fillStyle = FACE_COLOR;
    const r = 1.1;
    g.beginPath();
    for (const lm of face.landmarks) {
      const sx = (1 - lm.x) * W;
      const sy = lm.y * H;
      g.moveTo(sx + r, sy);
      g.arc(sx, sy, r, 0, Math.PI * 2);
    }
    g.fill();
    g.restore();
  },
};

const timbreLevels: OverlayElement = {
  name: 'timbreLevels',
  category: 'output',
  draw(g, { W, H, inputs, params }) {
    if (!params.timbreLevels.show) return;
    const sp = inputs.params;
    const feats = inputs.features;
    if (!sp || !feats) return;
    const drawLevels = (f: SingleHandFeatures, voiceId: number, color: string) => {
      if (!f.present) return;
      const v = sp.voices?.[voiceId];
      if (!v) return;
      const sx = f.x * W;
      const sy = f.y * H;
      const side = f.x > 0.5 ? -1 : 1;
      const bar = (offset: number, value: number, c: string) => {
        const bx = sx + side * (32 + offset);
        g.globalAlpha = 0.8;
        g.strokeStyle = c;
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(bx, sy + 18);
        g.lineTo(bx, sy + 18 - (3 + clamp01(value) * 32));
        g.stroke();
      };
      bar(0, v.brightness ?? 1, color);
      bar(9, v.vibrato ?? 0, CHORD_COLOR);
    };
    g.save();
    drawLevels(feats.right, 0, RIGHT_COLOR);
    drawLevels(feats.left, 1, LEFT_COLOR);
    g.restore();
  },
};

// ---- Bar-graph HUD cue helper ----------------------------------------------------

interface BarSpec {
  value: number; // 0..1
  threshold?: number; // 0..1, drawn as a white tick
  color: string;
  highlight?: boolean; // winner → gold
  /** Bright (fired) vs dim; defaults to value-cleared-its-threshold. */
  fired?: boolean;
  /** Up-to-two vertical x-axis labels (drawn rotated), e.g. expression / chord. */
  labels?: string[];
}
interface BarGraphOpts {
  title?: string; // optional top label
  barW?: number;
  gap?: number;
  maxH?: number;
  labelColor?: string;
}
const BAR_W = 14;
const BAR_GAP = 6;
const BAR_MAXH = 34;
const PAD = 8;
const LABEL_LINE_H = 44; // vertical label column height per label line

/** Box size of a bar graph (only the bar count + label lines matter for sizing). */
function measureBarGraph(bars: { labels?: string[] }[], opts: BarGraphOpts): { w: number; h: number } {
  const barW = opts.barW ?? BAR_W;
  const gap = opts.gap ?? BAR_GAP;
  const maxH = opts.maxH ?? BAR_MAXH;
  const n = bars.length;
  const barsW = n * (barW + gap) - gap + PAD * 2;
  // A short title (bold 14px monospace ≈ 8.4px/char) can be wider than a 1-bar box;
  // take the max so horizontally-stacked (top/bottom) cues don't overlap.
  const titleW = opts.title ? opts.title.length * 8.4 + PAD * 2 : 0;
  const w = Math.max(barsW, titleW);
  const labelLines = Math.max(0, ...bars.map((b) => b.labels?.filter(Boolean).length ?? 0));
  const h = (opts.title ? 18 : 0) + maxH + 6 + labelLines * LABEL_LINE_H + PAD;
  return { w, h };
}

/** Draw a bar graph with its top-left at (x0, y0). */
function drawBarGraph(g: CanvasRenderingContext2D, x0: number, y0: number, bars: BarSpec[], opts: BarGraphOpts): void {
  const barW = opts.barW ?? BAR_W;
  const gap = opts.gap ?? BAR_GAP;
  const maxH = opts.maxH ?? BAR_MAXH;
  const labelColor = opts.labelColor ?? FACE_COLOR;
  g.save();
  let topY = y0 + PAD;
  if (opts.title) {
    g.globalAlpha = 1;
    g.fillStyle = labelColor;
    g.font = 'bold 14px monospace';
    g.textAlign = 'left';
    g.fillText(opts.title, x0 + PAD, topY + 12);
    topY += 18;
  }
  const baseY = topY + maxH;
  bars.forEach((b, i) => {
    const cx = x0 + PAD + i * (barW + gap) + barW / 2;
    const bright = b.fired ?? b.value >= (b.threshold ?? 0.001);
    g.globalAlpha = bright ? 0.9 : 0.4;
    g.strokeStyle = b.highlight ? CHORD_COLOR : b.color;
    g.lineWidth = barW;
    g.beginPath();
    g.moveTo(cx, baseY);
    g.lineTo(cx, baseY - (2 + clamp01(b.value) * maxH));
    g.stroke();
    if (b.threshold !== undefined) {
      const ty = baseY - (2 + clamp01(b.threshold) * maxH);
      g.globalAlpha = 0.85;
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(cx - barW / 2, ty);
      g.lineTo(cx + barW / 2, ty);
      g.stroke();
    }
    // Vertical x-axis labels (rotated 90°), one line per label.
    const labels = b.labels?.filter(Boolean) ?? [];
    labels.forEach((text, li) => {
      g.save();
      g.globalAlpha = b.highlight ? 1 : 0.75;
      g.fillStyle = b.highlight ? CHORD_COLOR : labelColor;
      g.font = '10px monospace';
      g.textAlign = 'left';
      g.translate(cx + 3, baseY + 6 + li * LABEL_LINE_H);
      g.rotate(Math.PI / 2);
      g.fillText(text, 0, 0);
      g.restore();
    });
  });
  g.restore();
}

/**
 * Diatonic triad tones for a scale degree, by stacking thirds WITHIN the scale's own
 * octave and wrapping high degrees up an octave (so `vi`/`vii` don't run off a
 * single-octave array). `per` = notes per octave, detected from the scale — so it
 * generalizes to a non-seven-note chord source (#75), matching {@link diatonicChord}.
 * Fed the CHORD-SOURCE scale (not the melody), so the label agrees with the audio.
 */
function triadForDegree(scale: number[] | undefined, degree: number): number[] {
  if (!Array.isArray(scale) || scale.length < 3 || degree < 0) return [];
  const per = scale.filter((m) => m < scale[0] + 12).length || scale.length;
  const at = (d: number): number | undefined => {
    const base = scale[((d % per) + per) % per];
    return typeof base === 'number' ? base + Math.floor(d / per) * 12 : undefined;
  };
  return [at(degree), at(degree + 2), at(degree + 4)].filter((n): n is number => typeof n === 'number');
}

const faceExpressionCue: OverlayElement = {
  name: 'faceExpression',
  category: 'output',
  cue: true,
  positionOf: (view) => view.params.faceExpression.position,
  measure(view) {
    const expr = view.inputs.expression;
    if (!view.params.faceExpression.show || !expr?.present || !expr.scores?.length) return null;
    const p = view.params.faceExpression;
    // Chord labels are only meaningful (and correct) in chord mode — that's where a
    // chord actually plays and the app enforces a seven-note scale.
    const chordMode = view.inputs.faceMapping === 'chord';
    const labelLines = (p.exprLabels ? 1 : 0) + (p.chordLabels && chordMode ? 1 : 0);
    return measureBarGraph(
      expr.scores.map(() => ({ value: 0, labels: new Array(labelLines).fill('x') })),
      { title: p.topLabel ? expr.label : undefined },
    );
  },
  draw(g, view) {
    const expr = view.inputs.expression;
    const origin = view.layout['faceExpression'];
    if (!expr?.present || !expr.scores?.length || !origin) return;
    const p = view.params.faceExpression;
    const chordMode = view.inputs.faceMapping === 'chord';
    const bars: BarSpec[] = expr.scores.map((score, i) => {
      const name = EMOTIONS[i];
      const isWinner = name === expr.label;
      const labels: string[] = [];
      if (p.exprLabels) labels.push(name ?? '');
      if (p.chordLabels && chordMode) {
        const deg = view.inputs.faceDegrees?.[name] ?? -1;
        // Name each expression's chord from the CHORD-SOURCE scale (#75), not the
        // melody — so the printed name matches the audible chord for a pentatonic melody.
        const chordScale = view.inputs.chordScale ?? view.inputs.scale;
        labels.push(deg >= 0 ? chordName(triadForDegree(chordScale, deg)) : '—');
      }
      return {
        value: clamp01(score),
        threshold: clamp01(expr.thresholds?.[i] ?? 0),
        color: FACE_COLOR,
        highlight: isWinner,
        fired: expr.fired?.[i] ?? false,
        labels,
      };
    });
    drawBarGraph(g, origin.x, origin.y, bars, { title: p.topLabel ? expr.label : undefined, labelColor: FACE_COLOR });
  },
};

const fingerBarsCue: OverlayElement = {
  name: 'fingerBars',
  category: 'output',
  cue: true,
  positionOf: (view) => view.params.fingerBars.position,
  measure(view) {
    if (!view.params.fingerBars.show) return null;
    const { items } = routedFingers(view);
    if (!items.length) return null;
    return measureBarGraph(
      items.map(() => ({ value: 0, labels: ['x'] })),
      { title: 'fingers' },
    );
  },
  draw(g, view) {
    const origin = view.layout['fingerBars'];
    if (!origin) return;
    const { side, items } = routedFingers(view);
    if (!items.length) return;
    // Colour by the hand actually being read (right preferred), not always emerald.
    const color = side === 'left' ? LEFT_COLOR : RIGHT_COLOR;
    const bars: BarSpec[] = items.map(({ name, target, value }) => ({
      value: clamp01(value),
      color,
      labels: [`${name[0]}·${EFFECT_SHORT[target]}`],
    }));
    drawBarGraph(g, origin.x, origin.y, bars, { title: 'fingers', labelColor: color });
  },
};

/** The routed fingers + the closeness of the present hand (right preferred), plus which
 *  hand was read (so the bar graph can colour-match it). */
function routedFingers(view: OverlayView): {
  side: 'right' | 'left' | null;
  items: { name: FingerName; target: keyof typeof EFFECT_SHORT; value: number }[];
} {
  const routes = view.inputs.handMap?.fingers;
  const feats = view.inputs.features;
  if (!routes || !feats) return { side: null, items: [] };
  const side: 'right' | 'left' | null = feats.right.present ? 'right' : feats.left.present ? 'left' : null;
  const hand = side === 'right' ? feats.right : side === 'left' ? feats.left : null;
  if (!hand) return { side: null, items: [] };
  const items: { name: FingerName; target: keyof typeof EFFECT_SHORT; value: number }[] = [];
  for (const name of FINGER_NAMES) {
    const r = routes[name];
    if (!r || r.target === 'none') continue;
    items.push({ name, target: r.target, value: hand.fingers[name] });
  }
  return { side, items };
}

// ---- Chord overlays (#89): a chord-name cue + a keyboard strip ------------------

const NAME_PRIMARY_PX = 40;
const NAME_SECONDARY_PX = 20;
/** Monospace glyph advance ≈ this × font px (used to size the cue box headlessly). */
const NAME_CHAR_W = 0.62;

/** Pitch class of a MIDI note (0..11). */
const pcOf = (m: number) => (((m % 12) + 12) % 12);

/** The actually-sounding MIDI notes (rounded), read from the synth voices — the
 *  "what is rendering right now" layer for the keyboard strip. */
function voicedNotes(view: OverlayView): number[] {
  const voices = view.inputs.params?.voices;
  if (!voices) return [];
  return voices.filter((v) => v.present && v.freq > 0).map((v) => Math.round(freqToMidi(v.freq)));
}

/** The Roman/Nashville function line for the current chord within the current
 *  scale, or '' when off / unavailable / non-diatonic. */
function chordFunctionLabel(view: OverlayView): string {
  const p = view.params.chordName;
  if (!p.roman) return '';
  const chord = view.inputs.chord;
  // Analyze the chord's function against the CHORD-SOURCE scale (#75): the chord root
  // is a degree of the scale it was built from, which need not be the melody scale.
  const scale = view.inputs.chordScale ?? view.inputs.scale;
  if (!Array.isArray(chord) || !chord.length || !Array.isArray(scale) || scale.length < 2) return '';
  const info = classifyChord(chord);
  if (!info) return '';
  const degree = scaleDegreeOf(info.root, scale);
  if (degree < 0) return '';
  return p.nashville ? nashvilleNumber(degree, info.quality) : romanNumeral(degree, info.quality);
}

/** The chord-name cue's rendered text + box size, or null when nothing to show.
 *  Shared by `measure` (layout) and `draw`, so the two never disagree. */
function chordNameBox(view: OverlayView): { symbol: string; secondary: string; w: number; h: number } | null {
  const p = view.params.chordName;
  if (!p.show) return null;
  const chord = view.inputs.chord;
  if (!Array.isArray(chord) || chord.length === 0) return null;
  const info = classifyChord(chord);
  if (!info) return null;
  const secondary = chordFunctionLabel(view);
  const primaryW = info.symbol.length * NAME_PRIMARY_PX * NAME_CHAR_W;
  const secondaryW = secondary ? secondary.length * NAME_SECONDARY_PX * NAME_CHAR_W : 0;
  const w = Math.max(primaryW, secondaryW) + PAD * 2;
  const h = NAME_PRIMARY_PX + (secondary ? NAME_SECONDARY_PX + 4 : 0) + PAD * 2;
  return { symbol: info.symbol, secondary, w, h };
}

const chordNameCue: OverlayElement = {
  name: 'chordName',
  category: 'output',
  cue: true,
  positionOf: (view) => view.params.chordName.position,
  measure(view) {
    const box = chordNameBox(view);
    return box ? { w: box.w, h: box.h } : null;
  },
  draw(g, view) {
    const origin = view.layout['chordName'];
    const box = chordNameBox(view);
    if (!origin || !box) return;
    g.save();
    // Dark backing plate so gold/white glyphs read over any (dimmed) video.
    g.globalAlpha = 0.4;
    g.fillStyle = '#000000';
    g.fillRect(origin.x, origin.y, box.w, box.h);
    const cx = origin.x + box.w / 2;
    g.textAlign = 'center';
    // Primary: the jazz chord symbol, large + gold.
    g.globalAlpha = 1;
    g.fillStyle = CHORD_COLOR;
    g.font = `bold ${NAME_PRIMARY_PX}px monospace`;
    g.fillText(box.symbol, cx, origin.y + PAD + NAME_PRIMARY_PX * 0.78);
    // Secondary: the function line (Roman / Nashville), smaller + dimmer.
    if (box.secondary) {
      g.globalAlpha = 0.8;
      g.fillStyle = '#ffffff';
      g.font = `${NAME_SECONDARY_PX}px monospace`;
      g.fillText(box.secondary, cx, origin.y + PAD + NAME_PRIMARY_PX + NAME_SECONDARY_PX * 0.9);
    }
    g.textAlign = 'left';
    g.restore();
  },
};

/** The natural (white-key) pitch classes; the rest are the black keys. */
const NATURAL_PCS = new Set([0, 2, 4, 5, 7, 9, 11]);
const STRIP_MARGIN = 8;

/** One drawable key of the keyboard strip. */
interface StripKey {
  midi: number;
  x: number;
  w: number;
  h: number;
  isWhite: boolean;
}

/** Standard chromatic piano keys spanning the scale's MIDI range: equal-width
 *  whites first (full height), then the narrower/shorter blacks on top. The range
 *  is snapped OUT to natural keys (down at the bottom, up at the top) so a black
 *  key never leads the row — otherwise a sharp root (C#/D#/F#/G#/A#) would place
 *  the first black key at a negative x, off the left edge. */
function standardStripKeys(scale: number[], W: number, stripH: number): StripKey[] {
  let lo = scale[0];
  while (!NATURAL_PCS.has(pcOf(lo))) lo -= 1; // snap down to a white key
  let hi = scale[scale.length - 1];
  while (!NATURAL_PCS.has(pcOf(hi))) hi += 1; // snap up to a white key
  const whites: number[] = [];
  const blacks: { midi: number; afterWhite: number }[] = [];
  for (let m = lo; m <= hi; m++) {
    if (NATURAL_PCS.has(pcOf(m))) whites.push(m);
    else blacks.push({ midi: m, afterWhite: whites.length }); // boundary = whites drawn so far
  }
  if (!whites.length) return [];
  const whiteW = (W - 2 * STRIP_MARGIN) / whites.length;
  const blackW = whiteW * 0.62;
  const blackH = stripH * 0.6;
  const keys: StripKey[] = whites.map((midi, i) => ({
    midi,
    x: STRIP_MARGIN + i * whiteW,
    w: whiteW,
    h: stripH,
    isWhite: true,
  }));
  for (const b of blacks) {
    keys.push({ midi: b.midi, x: STRIP_MARGIN + b.afterWhite * whiteW - blackW / 2, w: blackW, h: blackH, isWhite: false });
  }
  return keys;
}

/** Scale-only keys: one equal-width cell per scale note (a decluttered ribbon). */
function scaleStripKeys(scale: number[], W: number, stripH: number): StripKey[] {
  const cellW = (W - 2 * STRIP_MARGIN) / scale.length;
  return scale.map((midi, i) => ({ midi, x: STRIP_MARGIN + i * cellW, w: cellW, h: stripH, isWhite: true }));
}

/**
 * The keyboard strip (#89): a thin bottom-edge piano/scale ribbon that shows what
 * is playing, with a shape+brightness cue hierarchy (never hue alone) so it reads
 * over the dimmed video and survives colour-blindness:
 *   chord ROOT (gold filled diamond) ▸ VOICED-now (bright gold base band) ▸
 *   CHORD-tone set (faint gold tint) ▸ SCALE root (hollow blue ring) ▸
 *   in-scale (light tint) ▸ out-of-scale (greyed).
 * Not a HUD cue — it owns a fixed bottom rectangle and draws in list order.
 */
const keyboardStripElement: OverlayElement = {
  name: 'keyboardStrip',
  category: 'guide',
  draw(g, view) {
    const p = view.params.keyboardStrip;
    if (!p.show) return;
    const scale = view.inputs.scale;
    if (!Array.isArray(scale) || scale.length < 2) return;
    const { W, H } = view;
    const stripH = Math.round(H * p.height);
    const y0 = H - stripH;

    const scalePcs = new Set(scale.map(pcOf));
    const scaleRoot = pcOf(scale[0]); // generateScale starts on the root, so scale[0] IS the tonic
    const chord = Array.isArray(view.inputs.chord) ? view.inputs.chord : [];
    const chordPcs = new Set(chord.map(pcOf));
    const chordRootPc = chord.length ? pcOf(Math.min(...chord)) : -1;
    const voicedPcs = new Set(voicedNotes(view).map(pcOf)); // what's actually sounding now
    const keys = p.scaleMode ? scaleStripKeys(scale, W, stripH) : standardStripKeys(scale, W, stripH);

    g.save();
    // Dark backing plate: a stable substrate so keys read over any video frame.
    g.globalAlpha = 0.4;
    g.fillStyle = '#000000';
    g.fillRect(0, y0, W, stripH);

    for (const k of keys) {
      const pc = pcOf(k.midi);
      const inScale = scalePcs.has(pc);
      // Base fill: in-scale keys tinted, out-of-scale greyed; whites light, blacks dark.
      g.globalAlpha = k.isWhite ? (inScale ? 0.16 : 0.06) : inScale ? 0.4 : 0.55;
      g.fillStyle = k.isWhite ? '#ffffff' : '#000000';
      g.fillRect(k.x, y0, k.w, k.h);
      // Chord-tone set: the chord's footprint, recessive (matches chordGuide alpha).
      if (p.showChordTones && chordPcs.has(pc)) {
        g.globalAlpha = 0.28;
        g.fillStyle = CHORD_COLOR;
        g.fillRect(k.x, y0, k.w, k.h);
      }
      // Voiced-now: a bright gold band at the key base — the strongest cue.
      if (voicedPcs.has(pc)) {
        g.globalAlpha = 0.9;
        g.fillStyle = CHORD_COLOR;
        g.fillRect(k.x, y0 + k.h * 0.55, k.w, k.h * 0.45);
      }
      // Scale root: a hollow cool-blue ring (different shape + temperature than the
      // warm filled chord-root diamond, so the two roots never blur together).
      if (p.showScaleRoot && pc === scaleRoot) {
        g.globalAlpha = 0.9;
        g.strokeStyle = LEFT_COLOR;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(k.x + k.w / 2, y0 + k.h * 0.72, Math.min(k.w * 0.3, 6), 0, Math.PI * 2);
        g.stroke();
      }
      // Chord root: a filled gold diamond marker at the key top — highest salience.
      if (pc === chordRootPc) {
        g.globalAlpha = 1;
        g.fillStyle = CHORD_COLOR;
        const dx = k.x + k.w / 2;
        const dy = y0 + k.h * 0.26;
        const r = Math.min(k.w * 0.32, 7);
        g.beginPath();
        g.moveTo(dx, dy - r);
        g.lineTo(dx + r, dy);
        g.lineTo(dx, dy + r);
        g.lineTo(dx - r, dy);
        g.fill();
      }
      if (p.showLabels) {
        g.globalAlpha = 0.85;
        g.fillStyle = k.isWhite ? '#111111' : '#ffffff';
        g.font = '9px monospace';
        g.textAlign = 'center';
        g.fillText(NOTES[pc], k.x + k.w / 2, y0 + k.h - 3);
      }
    }
    g.textAlign = 'left';
    g.restore();
  },
};

// ---- Feature Instrumentation Lab (#119) ------------------------------------

const LAB_COL_W = 168; // px per newspaper column
const LAB_ROW_H = 22; // px per meter row (label + bar)
const LAB_HEADER_H = 16; // px per group header
const LAB_TITLE_H = 22;
const LAB_BAR_H = 6;
const LAB_TOP = 68; // == CUE_TOP_INSET: clear the top-left brand / top-right panel

/** Terse meter label: the feature id with its group (or the `face.`/`hand.`
 *  prefix) stripped, so the group header carries the context. */
function labFeatureLabel(id: string, group: string): string {
  if (id.startsWith(group + '.')) return id.slice(group.length + 1);
  return id.replace(/^(face|hand)\./, '');
}

/** Truncate text to fit `maxChars` with an ellipsis (monospace-approximate). */
function labClip(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : text.slice(0, Math.max(1, maxChars - 1)) + '…';
}

/** Draw one meter (label + normalized bar + percentile ticks + optional value). */
function drawLabMeter(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  label: string,
  level: number,
  markers: number[],
  color: string,
  value: number | undefined,
): void {
  const valueW = value !== undefined ? 34 : 0;
  const barW = Math.max(20, w - valueW);
  // Label.
  g.globalAlpha = 0.85;
  g.fillStyle = '#d1d5db';
  g.font = '9px monospace';
  g.textAlign = 'left';
  g.fillText(labClip(label, Math.floor(w / 5.4)), x, y + 8);
  // Track.
  const barY = y + 11;
  g.globalAlpha = 0.22;
  g.fillStyle = '#ffffff';
  g.fillRect(x, barY, barW, LAB_BAR_H);
  // Fill to the normalized level (skip when un-warmed / NaN).
  if (Number.isFinite(level)) {
    g.globalAlpha = 0.85;
    g.fillStyle = color;
    g.fillRect(x, barY, barW * clamp01(level), LAB_BAR_H);
  }
  // Percentile-band ticks.
  if (markers.length) {
    g.globalAlpha = 0.7;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1;
    for (const m of markers) {
      const mx = x + barW * clamp01(m);
      g.beginPath();
      g.moveTo(mx, barY - 1);
      g.lineTo(mx, barY + LAB_BAR_H + 1);
      g.stroke();
    }
  }
  // Raw value.
  if (value !== undefined) {
    g.globalAlpha = 0.7;
    g.fillStyle = '#9ca3af';
    g.textAlign = 'right';
    g.fillText(value.toFixed(2), x + w, y + 8);
    g.textAlign = 'left';
  }
}

/**
 * The Feature Lab panel (#119): a right-anchored, newspaper-column grid of
 * grouped, online-normalized meters over the raw face + hand feature vectors. The
 * statistics are computed by {@link createLabMeterComputer} (which owns the
 * normalizer + the derived formulas) and handed in as
 * {@link OverlayView.featureMeters}; this element is a pure renderer. Group headers repeat at the top of
 * a continued column; a "+N more" note is drawn if features overflow the panel, so
 * nothing is silently dropped. Opt-in (a large panel).
 */
const featureLabElement: OverlayElement = {
  name: 'featureLab',
  category: 'input',
  draw(g, view) {
    const p = view.params.featureLab;
    if (!p.show) return;
    const meters = view.featureMeters;
    if (!meters) return;
    const { W, H } = view;
    const columns = Math.max(1, Math.min(p.columns, Math.floor((W - 2 * PAD) / LAB_COL_W) || 1));
    const panelW = columns * LAB_COL_W + 2 * PAD;
    const panelLeft = W - panelW;
    const panelTop = LAB_TOP;
    const panelBottom = H - 16;
    const contentTop = panelTop + LAB_TITLE_H;

    g.save();
    // Backdrop.
    g.globalAlpha = 0.55;
    g.fillStyle = '#000000';
    g.fillRect(panelLeft, panelTop, panelW, panelBottom - panelTop);
    // Title.
    g.globalAlpha = 1;
    g.fillStyle = FACE_COLOR;
    g.font = 'bold 13px monospace';
    g.textAlign = 'left';
    g.fillText('Feature Lab', panelLeft + PAD, panelTop + 15);

    // Shown but nothing to measure (no face/hands, or the enabled groups are empty
    // this frame): keep the panel + a hint so the lab doesn't read as "broken".
    if (!meters.order.length) {
      g.globalAlpha = 0.7;
      g.fillStyle = '#9ca3af';
      g.font = 'italic 11px monospace';
      g.textAlign = 'left';
      g.fillText('No features in view (adjust groups)', panelLeft + PAD, contentTop + 8);
      g.restore();
      return;
    }

    let col = 0;
    let y = contentTop;
    let lastGroup: string | null = null;
    let drawn = 0;
    const colX = (c: number) => panelLeft + PAD + c * LAB_COL_W;
    const cellW = LAB_COL_W - PAD;
    const nextColumn = (): boolean => {
      col += 1;
      if (col >= columns) return false;
      y = contentTop;
      lastGroup = null;
      return true;
    };

    for (const id of meters.order) {
      // Catalog features resolve via FEATURE_BY_ID; derived features (not in the
      // static registry) fall back to the `derived` group + a gold accent.
      const feat = FEATURE_BY_ID[id];
      const group = feat?.group ?? DERIVED_GROUP;
      const color = !feat ? CHORD_COLOR : feat.source === 'face' ? FACE_COLOR : RIGHT_COLOR;
      // Group header (repeats when a group continues into a new column).
      if (group !== lastGroup) {
        if (y + LAB_HEADER_H + LAB_ROW_H > panelBottom && !nextColumn()) break;
        const info = FEATURE_GROUPS.find((gr) => gr.id === group);
        g.globalAlpha = 0.9;
        g.fillStyle = color;
        g.font = 'bold 10px monospace';
        g.textAlign = 'left';
        g.fillText(labClip(info?.label ?? group, Math.floor(cellW / 6)), colX(col), y + 10);
        y += LAB_HEADER_H;
        lastGroup = group;
      }
      if (y + LAB_ROW_H > panelBottom && !nextColumn()) break;
      drawLabMeter(
        g,
        colX(col),
        y,
        cellW,
        labFeatureLabel(id, group),
        meters.levels[id],
        p.showMarkers ? meters.markers[id] ?? [] : [],
        color,
        p.showValues ? meters.raw[id] : undefined,
      );
      y += LAB_ROW_H;
      drawn += 1;
    }
    // Honest overflow note (no silent truncation).
    const remaining = meters.order.length - drawn;
    if (remaining > 0) {
      g.globalAlpha = 0.8;
      g.fillStyle = '#9ca3af';
      g.font = 'italic 10px monospace';
      g.textAlign = 'right';
      g.fillText(`+${remaining} more (widen / fewer groups)`, panelLeft + panelW - PAD, panelBottom - 4);
      g.textAlign = 'left';
    }
    g.restore();
  },
};

// ---- Live-tagging burned-in corner HUD (#92) ------------------------------------
// A self-contained additive block (first mover; keep it isolated so a concurrent
// OVERLAY_ELEMENTS addition merges cleanly). Draws only when a take is recording.
const TAG_HUD_CHAR_W = 7.6; // approx width of a 13px monospace glyph (no measureText,
//                              so the headless recording-canvas test needs no extra API)
const TAG_HUD_PAD = 8;
const TAG_HUD_ROW = 18;
const TAG_HUD_DOT = 7;

/** Paint the burned-in tag HUD: a REC-dot + timecode header, then one blinking chip
 *  per open tag, anchored to a top corner. Uses only fillRect/arc/fill/fillText so it
 *  matches the elements the settings panel + tests already exercise. */
function drawTagHud(g: CanvasRenderingContext2D, view: OverlayView, frame: TagOverlayFrame): void {
  const rows: { text: string; color: string }[] = [
    { text: `REC ${frame.timecode}`, color: '#ef4444' },
    ...frame.chips.map((c) => ({ text: c.label, color: c.color })),
  ];
  const textW = Math.max(...rows.map((r) => r.text.length)) * TAG_HUD_CHAR_W;
  const boxW = TAG_HUD_PAD + TAG_HUD_DOT + 6 + textW + TAG_HUD_PAD;
  const boxH = TAG_HUD_PAD * 2 + TAG_HUD_ROW * rows.length;
  const x0 = view.params.tagHud.position === 'left' ? 12 : view.W - boxW - 12;
  const y0 = 12;

  g.save();
  g.globalAlpha = 1;
  g.fillStyle = 'rgba(0, 0, 0, 0.55)';
  g.fillRect(x0, y0, boxW, boxH);
  g.font = '600 13px ui-monospace, SFMono-Regular, Menlo, monospace';
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  rows.forEach((row, i) => {
    const cy = y0 + TAG_HUD_PAD + TAG_HUD_ROW * i + TAG_HUD_ROW / 2;
    const dx = x0 + TAG_HUD_PAD;
    // The dot pulses with the blink phase (a REC light), so a dropped frame shows.
    g.globalAlpha = frame.blinkOn ? 1 : 0.35;
    g.beginPath();
    g.arc(dx + TAG_HUD_DOT / 2, cy, TAG_HUD_DOT / 2, 0, Math.PI * 2);
    g.fillStyle = row.color;
    g.fill();
    g.globalAlpha = 1;
    g.fillStyle = '#ffffff';
    g.fillText(row.text, dx + TAG_HUD_DOT + 6, cy);
  });
  g.restore();
}

const tagHud: OverlayElement = {
  name: 'tagHud',
  category: 'output',
  draw(g, view) {
    const frame = view.inputs.tagOverlay;
    if (!frame || !view.params.tagHud.show) return;
    drawTagHud(g, view, frame);
  },
};

/**
 * The overlay elements, in draw (z) order. In-scene first, HUD cues last (on top).
 * Each has a `category` and a `<name>` sub-object in `Params`. Append here to add one.
 */
export const OVERLAY_ELEMENTS: readonly OverlayElement[] = [
  videoBackdrop,
  scaleGuideElement,
  chordGuideElement,
  // The keyboard strip is an in-scene bottom-edge element: above the video/guides,
  // below the landmarks/markers (so hands read over it) and the HUD cues.
  keyboardStripElement,
  indexFingerGuide,
  faceMesh,
  landmarkDots,
  controlMarkers,
  fingerLinesElement,
  timbreLevels,
  // The Feature Lab panel (#119): above the in-scene elements, below the HUD cues
  // so the chord/finger readouts stay legible over it.
  featureLabElement,
  // HUD cues last (on top). chordName sits before the others so `fingerBars`
  // stays the topmost cue; cues on different edges don't overlap regardless.
  chordNameCue,
  faceExpressionCue,
  // The burned-in tag HUD sits above the cues (its own top corner); fingerBars stays
  // the array's last element so the z-order invariant + concurrent additions hold.
  tagHud,
  fingerBarsCue,
];

// ---- Cue layout: stack the active cues along their chosen edges ------------------
const CUE_MARGIN = 12;
const CUE_GAP = 10;
const CUE_TOP_INSET = 68; // leave room for the top-left brand / top-right panel

/** Compute each active cue's top-left origin, auto-stacking cues that share an edge. */
function layoutCues(view: OverlayView): Record<string, { x: number; y: number }> {
  const layout: Record<string, { x: number; y: number }> = {};
  const active = OVERLAY_ELEMENTS.filter((e) => e.cue).map((e) => ({
    e,
    pos: e.positionOf!(view),
    size: e.measure!(view),
  }));
  for (const edge of ['left', 'right', 'top', 'bottom'] as CuePosition[]) {
    const cues = active.filter((c) => c.size && c.pos === edge) as {
      e: OverlayElement;
      size: { w: number; h: number };
    }[];
    let off = edge === 'left' || edge === 'right' ? CUE_TOP_INSET : CUE_MARGIN;
    // Center a horizontal (top/bottom) group of cues so a lone cue reads centered
    // and away from the top-left brand / top-right panel.
    if (edge === 'top' || edge === 'bottom') {
      const totalW = cues.reduce((s, c) => s + c.size.w, 0) + Math.max(0, cues.length - 1) * CUE_GAP;
      off = Math.max(CUE_MARGIN, (view.W - totalW) / 2);
    }
    for (const { e, size } of cues) {
      let x = CUE_MARGIN;
      let y = CUE_MARGIN;
      if (edge === 'left') {
        x = CUE_MARGIN;
        y = off;
        off += size.h + CUE_GAP;
      } else if (edge === 'right') {
        x = view.W - size.w - CUE_MARGIN;
        y = off;
        off += size.h + CUE_GAP;
      } else if (edge === 'top') {
        x = off;
        y = CUE_MARGIN;
        off += size.w + CUE_GAP;
      } else {
        x = off;
        y = view.H - size.h - CUE_MARGIN;
        off += size.w + CUE_GAP;
      }
      layout[e.name] = { x, y };
    }
  }
  return layout;
}

export const canvasOverlayNode = defineNode<Params>({
  type: 'canvas-overlay',
  roles: ['overlay'],
  title: 'Canvas Overlay',
  description: 'Mirrored video + composable overlay elements (guides, landmarks, markers, cues).',
  inputs: [
    { name: 'hands', kind: 'hands-frame' },
    { name: 'features', kind: 'hand-features' },
    { name: 'params', kind: 'synth-params' },
    { name: 'scale', kind: 'number[]' },
    { name: 'scaleLeft', kind: 'number[]' },
    { name: 'chordScale', kind: 'number[]' },
    { name: 'chord', kind: 'number[]' },
    { name: 'faceFrame', kind: 'face-frame' },
    { name: 'expression', kind: 'face-expression' },
    { name: 'octaveShift', kind: 'number', default: 0 },
    { name: 'overlayConfig', kind: 'overlay-config' },
    // Raw feature vectors for the Feature Lab (#119). Additive: the vector nodes
    // tap the existing camFace/cam edges; the lab element normalizes + draws them.
    { name: 'faceVector', kind: 'feature-vector' },
    { name: 'handVector', kind: 'feature-vector' },
  ],
  outputs: [],
  params: Params,
  make(p) {
    // The Feature Lab's statistics (#119) are a stateful online computation, not a
    // drawing concern: one opaque handle owns the normalizer + the derived formulas
    // (see @/features/labMeters), so this node stays a pure RENDERER.
    const computeLabMeters = createLabMeterComputer();

    return {
      process(inputs, ctx: NodeContext) {
        const canvas = ctx.resources.canvas as HTMLCanvasElement | undefined;
        const video = ctx.resources.video as HTMLVideoElement | undefined;
        if (!canvas) return {};
        const g = canvas.getContext('2d');
        if (!g) return {};

        const W = canvas.width;
        const H = canvas.height;
        g.clearRect(0, 0, W, H);

        // Live control store: the hand map (note source + finger routing) and the
        // expression→degree map, so cues reflect the ACTUAL mapping. Read like
        // voice-mapping (ctx.resources.controls); absent in headless tests.
        const controls = (
          ctx.resources.controls as
            | (() => {
                handMap?: HandMap;
                faceExpr?: { degrees?: Record<string, number> };
                faceMapping?: string;
              })
            | undefined
        )?.();

        // Burned-in tag HUD (#92): read the runtime snapshot (null unless a take is
        // recording) and derive this tick's frame from the engine clock. A no-op
        // resource means frame === null and the tagHud element draws nothing.
        const tagOverlayFn = ctx.resources.tagOverlay as (() => TagOverlaySnapshot | null) | undefined;
        const tagOverlay = computeTagOverlay(tagOverlayFn?.() ?? null, ctx.time);

        const liveConfig = inputs.overlayConfig as OverlayParams | undefined;
        const view: OverlayView = {
          W,
          H,
          video,
          params: liveConfig ?? p,
          layout: {},
          inputs: {
            hands: inputs.hands as HandsFrame | undefined,
            features: inputs.features as HandFeatures | undefined,
            params: inputs.params as SynthParams | undefined,
            scale: inputs.scale as number[] | undefined,
            scaleLeft: inputs.scaleLeft as number[] | undefined,
            chordScale: inputs.chordScale as number[] | undefined,
            octaveShift: typeof inputs.octaveShift === 'number' ? inputs.octaveShift : 0,
            chord: inputs.chord as number[] | undefined,
            faceFrame: inputs.faceFrame as FaceFrame | undefined,
            expression: inputs.expression as ExpressionScores | undefined,
            handMap: controls?.handMap,
            faceDegrees: controls?.faceExpr?.degrees,
            faceMapping: controls?.faceMapping,
            tagOverlay,
          },
        };

        // Compute the Feature Lab meters once per tick (the normalizer observes here);
        // the featureLab element and the alpha pass both draw from this.
        view.featureMeters = computeLabMeters(
          view.params.featureLab,
          inputs.faceVector as FeatureVector | undefined,
          inputs.handVector as FeatureVector | undefined,
          ctx.dt,
        );

        view.layout = layoutCues(view);
        for (const element of OVERLAY_ELEMENTS) element.draw(g, view);

        // Overlay-only (alpha) pass (#88): when a transparent overlay canvas is
        // injected via resources (only while the overlay-alpha stream is being
        // recorded — Chromium alpha-WebM), redraw the SAME elements onto it with
        // the webcam backdrop suppressed, so the landmarks/cues sit on
        // transparency. Reuses the exact element draw list (no duplicated drawing
        // logic, no drift) and is a no-op — zero cost — whenever the resource is
        // absent (i.e. always, except during an alpha take).
        const alphaCanvas = ctx.resources.overlayAlphaCanvas as HTMLCanvasElement | undefined;
        if (alphaCanvas) {
          const ga = alphaCanvas.getContext('2d');
          if (ga) {
            ga.clearRect(0, 0, alphaCanvas.width, alphaCanvas.height);
            const alphaView: OverlayView = {
              ...view,
              W: alphaCanvas.width,
              H: alphaCanvas.height,
              params: { ...view.params, video: { ...view.params.video, show: false } },
            };
            for (const element of OVERLAY_ELEMENTS) element.draw(ga, alphaView);
          }
        }

        return {};
      },
    };
  },
});
