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
import {
  kp,
  LM,
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
  };
  params: Params;
}

/**
 * One composable piece of the overlay. `draw` is responsible for honoring its
 * own `view.params.<name>.show` toggle. Elements are plain functions held inside
 * this node — deliberately NOT DAG nodes (see the module docstring).
 */
export interface OverlayElement {
  name: string;
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
 * The "old" overlay the player remembers: a dashed vertical line from each index
 * fingertip up to the top edge (displayed-right hand) or down to the bottom edge
 * (displayed-left hand), in the hand's colour. Reconstructed from the legacy
 * `src/components/Theremin.tsx` (which used `keypoint.name`; here we use the
 * MediaPipe index `LM.index_tip` via `kp()`). Opt-in alongside the marker/guide.
 */
const indexFingerGuide: OverlayElement = {
  name: 'indexGuide',
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

/**
 * The overlay elements, in draw (z) order. Append here to add a new element;
 * give it a `<name>` sub-object in `Params` with at least a `show` toggle.
 */
export const OVERLAY_ELEMENTS: readonly OverlayElement[] = [
  videoBackdrop,
  scaleGuideElement,
  indexFingerGuide,
  landmarkDots,
  controlMarkers,
];

export const canvasOverlayNode = defineNode<Params>({
  type: 'canvas-overlay',
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
          },
        };

        for (const element of OVERLAY_ELEMENTS) element.draw(g, view);

        return {};
      },
    };
  },
});
