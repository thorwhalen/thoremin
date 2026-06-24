/**
 * `canvas-overlay` node (browser-only) — the visual output + guides.
 *
 * The overlay is composed of an ordered list of independent **overlay elements**
 * (see `OVERLAY_ELEMENTS`): the mirrored webcam backdrop, a per-scale-note pitch
 * guide ("fretboard"), an index-finger guide (a dashed line from the fingertip to
 * the frame edge), hand landmark dots, and a per-hand control marker (openness =
 * ring size, pinch = fill) with the sounding note name.
 *
 * Each element is drawn in list order (= z-order), reads only the inputs/params
 * it needs, and is toggled/parameterized by its own sub-object in `Params`. This
 * is the worked example of the project's "sub-components are toggled functions
 * inside one node, never separate DAG nodes" rule (the engine forbids fan-in to
 * the single canvas, and the elements share the 2D context, mirror transform, and
 * z-order). See `docs/design/component-model.md`.
 *
 * Canvas + video are injected via `ctx.resources`. Pure drawing; produces no
 * port output.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';
import { freqToMidi, midiToName, scaleGuide } from '@/music/theory';
import { EXPRESSIONS, type ExpressionScores } from '@/music/expression';
import {
  kp,
  LM,
  type FaceFrame,
  type HandFeatures,
  type HandsFrame,
  type SingleHandFeatures,
  type SynthParams,
} from '../domain';

/**
 * Per-element configuration. Each element has its own sub-object so it can be
 * toggled and parameterized independently — and so a settings panel can be
 * generated one collapsible section per element.
 */
const Params = z.object({
  /** Mirrored webcam backdrop. `alpha` is the "grey-out" amount (0 = hidden). */
  video: z
    .object({
      show: z.boolean().default(true),
      alpha: z.number().min(0).max(1).default(0.35),
    })
    .default({}),
  /** Faint vertical guide at each scale note (a "fretboard"), with note labels. */
  scaleGuide: z
    .object({
      show: z.boolean().default(true),
      /** Draw the note-name labels (split from the lines so each toggles alone). */
      showLabels: z.boolean().default(true),
    })
    .default({}),
  /** Highlight the face-driven chord's tones on the pitch guide (face chord mode). */
  chordGuide: z
    .object({
      show: z.boolean().default(true),
    })
    .default({}),
  /** Dashed vertical line from each index fingertip to the frame edge. Opt-in. */
  indexGuide: z
    .object({
      show: z.boolean().default(false),
      dashed: z.boolean().default(true),
    })
    .default({}),
  /** Hand landmark dots + a ring around each index fingertip. */
  landmarks: z
    .object({
      show: z.boolean().default(true),
    })
    .default({}),
  /** Per-hand control marker (openness = ring size, pinch = fill). */
  markers: z
    .object({
      show: z.boolean().default(true),
      /** Show the note name each hand is sounding, above its marker. */
      showNotes: z.boolean().default(true),
    })
    .default({}),
  /** The detected face mesh (input feature) — available when a face mapping is on. */
  faceLandmarks: z
    .object({
      show: z.boolean().default(true),
    })
    .default({}),
  /** Live readout of the classified facial expression (output feature). */
  faceExpression: z
    .object({
      show: z.boolean().default(true),
    })
    .default({}),
  /** Per-hand brightness/vibrato level bars (output feature). Opt-in. */
  timbreLevels: z
    .object({
      show: z.boolean().default(false),
    })
    .default({}),
});
type Params = z.infer<typeof Params>;

/**
 * The overlay's per-element params schema, exported so it is the single source
 * of truth for the overlay portion of saved settings (see src/settings/schema.ts)
 * and for the overlay settings panel. Reuse this rather than redeclaring shapes.
 */
export const OverlayParamsSchema = Params;
export type OverlayParams = Params;

const RIGHT_COLOR = '#10b981';
const LEFT_COLOR = '#3b82f6';

/**
 * Everything an overlay element needs to draw a frame. `inputs` mirrors the
 * node's input ports; `video` is the optional backdrop resource. All x are drawn
 * mirrored to match the flipped webcam (helpers below).
 */
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
    /** The face-driven chord's tones (MIDI), to highlight on the pitch guide. */
    chord?: number[];
    /** The raw face frame (blendshapes + landmark geometry), for the face mesh. */
    faceFrame?: FaceFrame;
    /** The classified facial expression, for the live expression readout. */
    expression?: ExpressionScores;
  };
  params: Params;
}

/**
 * The category an overlay element belongs to — the "target space" framing the
 * settings panel groups by (extensible; add more as the mapping space grows):
 *  - `input`    : raw features the camera detected (hand/face landmarks).
 *  - `output`   : what those inputs are mapped to (sounding note, chord, expression,
 *                 timbre levels).
 *  - `guide`    : reference overlays (the pitch fretboard, finger guides).
 *  - `backdrop` : the video itself.
 */
export type OverlayCategory = 'input' | 'output' | 'guide' | 'backdrop';

/** Category display order + labels for the settings panel (the grouping UI). */
export const OVERLAY_CATEGORIES: { id: OverlayCategory; label: string; blurb: string }[] = [
  { id: 'input', label: 'Input features', blurb: 'What the camera detected.' },
  { id: 'output', label: 'Output features', blurb: 'What your gestures are mapped to.' },
  { id: 'guide', label: 'Guides', blurb: 'Reference overlays.' },
  { id: 'backdrop', label: 'Backdrop', blurb: 'The video feed.' },
];

/**
 * One composable piece of the overlay. `draw` is responsible for honoring its
 * own `view.params.<name>.show` toggle. `category` groups it in the settings
 * panel (see {@link OVERLAY_CATEGORIES}). Elements are plain functions held inside
 * this node — deliberately NOT DAG nodes (see the module docstring).
 */
export interface OverlayElement {
  name: string;
  category: OverlayCategory;
  draw(g: CanvasRenderingContext2D, view: OverlayView): void;
}

/** Mirror a source-frame x (pixels) into mirrored canvas x. */
function mirrorX(xPx: number, frameW: number, W: number): number {
  return W - (xPx / frameW) * W;
}

/** The displayed-right hand is the detected 'Left' (the video is mirrored). */
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

const arrEq = (a?: number[], b?: number[]) =>
  !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);

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

/**
 * Highlights the face-driven chord (issue #64): when the player is in face "chord"
 * mode, the chord's tones light up on the existing pitch guide so the player sees
 * which notes their expression is playing. The highlight reflects the chord's
 * PITCH CLASSES (with octave repetition) — for a C chord {C, E, G}, every visible
 * C, E and G guide line lights up — NOT the specific rendered voicing (which may
 * add a bass octave, doublings, etc.). It is a subtle tint over the guide lines.
 * Idle (no chord) → draws nothing.
 */
const CHORD_COLOR = '#f5d142'; // warm gold, distinct from the white/blue scale guides
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
    g.globalAlpha = 0.28; // subtle: a visible tint, not a hard band
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

/**
 * The "old" overlay the player remembers: a dashed vertical line from each index
 * fingertip up to the top edge (displayed-right hand) or down to the bottom edge
 * (displayed-left hand), in the hand's colour. Reconstructed from the legacy
 * `src/components/Theremin.tsx` (which used `keypoint.name`; here we use the
 * MediaPipe index `LM.index_tip` via `kp()`). Opt-in alongside the marker/guide.
 */
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

const landmarkDots: OverlayElement = {
  name: 'landmarks',
  category: 'input',
  draw(g, { W, H, inputs, params }) {
    if (!params.landmarks.show) return;
    const frame = inputs.hands;
    if (!frame) return;
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
      const tip = hand.keypoints[LM.index_tip];
      if (tip) {
        const sx = mirrorX(tip.x, frame.width, W);
        const sy = (tip.y / frame.height) * H;
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
  draw(g, { W, H, inputs, params }) {
    if (!params.markers.show) return;
    const feats = inputs.features;
    if (!feats) return;
    const sp = inputs.params;
    const noteFor = (voiceId: number): string | null => {
      const v = sp?.voices?.[voiceId];
      if (!v || !v.present || v.freq <= 0) return null;
      return midiToName(freqToMidi(v.freq));
    };
    const drawMarker = (f: SingleHandFeatures, color: string, note: string | null) => {
      if (!f.present) return;
      const sx = f.x * W;
      const sy = f.y * H;
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

const FACE_COLOR = '#22d3ee'; // cyan — distinct from hands (emerald/blue) + chord (gold)

/**
 * The detected face mesh (input feature) — the raw face landmarks, drawn as dots,
 * so the player can SEE that face detection is working. Only present when a face
 * mapping is active (the model is loaded); otherwise the face frame is absent.
 */
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
    // One path for all ~478 dots, filled once (moveTo separates the sub-paths so
    // they don't connect) — far cheaper than a fill per landmark each frame.
    const r = 1.1;
    g.beginPath();
    for (const lm of face.landmarks) {
      // Landmarks are normalized (0..1) in the source frame; mirror x like the video.
      const sx = (1 - lm.x) * W;
      const sy = lm.y * H;
      g.moveTo(sx + r, sy);
      g.arc(sx, sy, r, 0, Math.PI * 2);
    }
    g.fill();
    g.restore();
  },
};

/**
 * Live readout of the classified facial expression (output feature) — the argmax
 * label plus a small bar per class, so the player sees what their face is being
 * mapped to. Top-centre; absent when no face is detected.
 */
const faceExpressionReadout: OverlayElement = {
  name: 'faceExpression',
  category: 'output',
  draw(g, { W, H, inputs, params }) {
    if (!params.faceExpression.show) return;
    const expr = inputs.expression;
    if (!expr?.present || !expr.probs?.length) return;
    const argmax = EXPRESSIONS.indexOf(expr.label);
    g.save();
    g.textAlign = 'center';
    g.font = 'bold 15px monospace';
    g.fillStyle = FACE_COLOR;
    g.fillText(expr.label, W * 0.5, H * 0.05);
    // A small bar per expression class; the winning class glows gold.
    const n = expr.probs.length;
    const barW = 14;
    const gap = 5;
    const baseY = H * 0.05 + 30;
    const startX = W * 0.5 - (n * (barW + gap) - gap) / 2 + barW / 2;
    for (let i = 0; i < n; i++) {
      const p = expr.probs[i];
      const cx = startX + i * (barW + gap);
      g.globalAlpha = 0.25 + 0.65 * p;
      g.strokeStyle = i === argmax ? CHORD_COLOR : FACE_COLOR;
      g.lineWidth = barW;
      g.beginPath();
      g.moveTo(cx, baseY);
      g.lineTo(cx, baseY - (2 + p * 26));
      g.stroke();
    }
    g.restore();
  },
};

/**
 * Per-hand brightness/vibrato level bars (output feature) — the timbre values the
 * hand (and, in timbre mode, the face) maps to. NOT the index x/y, which the
 * marker already cues. Opt-in. Drawn as two thin bars beside each hand's marker.
 */
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
      const bar = (offset: number, value: number, c: string) => {
        const bx = sx + 32 + offset;
        g.globalAlpha = 0.8;
        g.strokeStyle = c;
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(bx, sy + 18);
        g.lineTo(bx, sy + 18 - (3 + Math.max(0, Math.min(1, value)) * 32));
        g.stroke();
      };
      bar(0, v.brightness ?? 1, color); // brightness (from openness / smile)
      bar(9, v.vibrato ?? 0, CHORD_COLOR); // vibrato (from pinch / open mouth)
    };
    g.save();
    drawLevels(feats.right, 0, RIGHT_COLOR);
    drawLevels(feats.left, 1, LEFT_COLOR);
    g.restore();
  },
};

/**
 * The overlay elements, in draw (z) order (backdrop first, readouts on top). Each
 * has a `category` (the settings panel groups by it) and a `<name>` sub-object in
 * `Params` with at least a `show` toggle. Append here to add an element.
 */
export const OVERLAY_ELEMENTS: readonly OverlayElement[] = [
  videoBackdrop,
  scaleGuideElement,
  chordGuideElement,
  indexFingerGuide,
  faceMesh,
  landmarkDots,
  controlMarkers,
  timbreLevels,
  faceExpressionReadout,
];

export const canvasOverlayNode = defineNode<Params>({
  type: 'canvas-overlay',
  roles: ['overlay'],
  title: 'Canvas Overlay',
  description: 'Mirrored video + composable overlay elements (guides, landmarks, markers).',
  inputs: [
    { name: 'hands', kind: 'hands-frame' },
    { name: 'features', kind: 'hand-features' },
    // Optional: the synth params (voice 0 = right, 1 = left) so the overlay can
    // label each hand with the note it is sounding. Unconnected → no labels.
    { name: 'params', kind: 'synth-params' },
    // Optional: the right hand's scale (MIDI notes) to draw a pitch guide.
    { name: 'scale', kind: 'number[]' },
    // Optional: the left hand's scale, drawn as a second guide when it differs.
    { name: 'scaleLeft', kind: 'number[]' },
    // Optional: the face-driven chord's tones (MIDI), highlighted on the guide.
    { name: 'chord', kind: 'number[]' },
    // Optional: the raw face frame (blendshapes + landmarks), for the face mesh.
    { name: 'faceFrame', kind: 'face-frame' },
    // Optional: the classified expression, for the live expression readout.
    { name: 'expression', kind: 'face-expression' },
    // Optional: the live octave shift, so guide labels match the sounding pitch.
    { name: 'octaveShift', kind: 'number', default: 0 },
    // Optional: a live overlay element config (from the UI store) that overrides
    // the static `params`, so toggling elements never rebuilds the graph.
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

        // A live config on the overlayConfig input overrides the static params,
        // so UI toggles take effect each tick without rebuilding the graph.
        const liveConfig = inputs.overlayConfig as OverlayParams | undefined;
        const view: OverlayView = {
          W,
          H,
          video,
          params: liveConfig ?? p,
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
          },
        };

        for (const element of OVERLAY_ELEMENTS) element.draw(g, view);

        return {};
      },
    };
  },
});
