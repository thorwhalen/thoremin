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
import { chordName, freqToMidi, midiToName, scaleGuide } from '@/music/theory';
import { EMOTIONS, type ExpressionScores } from '@/music/expression';
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
  inputs: {
    hands?: HandsFrame;
    features?: HandFeatures;
    params?: SynthParams;
    scale?: number[];
    scaleLeft?: number[];
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
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

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
 * single-octave array). `per` = notes per octave, detected from the scale. Only used
 * for chord-mode labels, where the app enforces a seven-note scale — the same shape
 * `diatonicTriad` plays, so the label agrees with the audio.
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
        labels.push(deg >= 0 ? chordName(triadForDegree(view.inputs.scale, deg)) : '—');
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

/**
 * The overlay elements, in draw (z) order. In-scene first, HUD cues last (on top).
 * Each has a `category` and a `<name>` sub-object in `Params`. Append here to add one.
 */
export const OVERLAY_ELEMENTS: readonly OverlayElement[] = [
  videoBackdrop,
  scaleGuideElement,
  chordGuideElement,
  indexFingerGuide,
  faceMesh,
  landmarkDots,
  controlMarkers,
  fingerLinesElement,
  timbreLevels,
  faceExpressionCue,
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
    { name: 'chord', kind: 'number[]' },
    { name: 'faceFrame', kind: 'face-frame' },
    { name: 'expression', kind: 'face-expression' },
    { name: 'octaveShift', kind: 'number', default: 0 },
    { name: 'overlayConfig', kind: 'overlay-config' },
  ],
  outputs: [],
  params: Params,
  make(p) {
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
            octaveShift: typeof inputs.octaveShift === 'number' ? inputs.octaveShift : 0,
            chord: inputs.chord as number[] | undefined,
            faceFrame: inputs.faceFrame as FaceFrame | undefined,
            expression: inputs.expression as ExpressionScores | undefined,
            handMap: controls?.handMap,
            faceDegrees: controls?.faceExpr?.degrees,
            faceMapping: controls?.faceMapping,
          },
        };

        view.layout = layoutCues(view);
        for (const element of OVERLAY_ELEMENTS) element.draw(g, view);

        return {};
      },
    };
  },
});
