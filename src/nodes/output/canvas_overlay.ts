/**
 * `canvas-overlay` node (browser-only) — the visual output + guides. Draws the
 * mirrored webcam frame, hand landmark dots, a control marker per hand (with
 * openness as ring size, pinch as fill), and a small HUD of feature values.
 *
 * Canvas + video are injected via `ctx.resources`. Pure drawing; produces no
 * port output. This is the "video with overlaid visual artifacts/guides" output.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';
import { freqToMidi, midiToName, scaleGuide } from '@/music/theory';
import { LM, type HandFeatures, type HandsFrame, type SingleHandFeatures, type SynthParams } from '../domain';

const Params = z.object({
  showLandmarks: z.boolean().default(true),
  showVideo: z.boolean().default(true),
  videoAlpha: z.number().min(0).max(1).default(0.35),
  /** Show the note name each hand is currently playing, above its marker. */
  showNotes: z.boolean().default(true),
  /** Show a faint vertical guide at each scale note (a "fretboard"). */
  showScaleGuide: z.boolean().default(true),
});
type Params = z.infer<typeof Params>;

const RIGHT_COLOR = '#10b981';
const LEFT_COLOR = '#3b82f6';

export const canvasOverlayNode = defineNode<Params>({
  type: 'canvas-overlay',
  title: 'Canvas Overlay',
  description: 'Draws mirrored video + landmarks + control markers + per-hand note names.',
  inputs: [
    { name: 'hands', kind: 'hands-frame' },
    { name: 'features', kind: 'hand-features' },
    // Optional: the synth params (voice 0 = right, 1 = left) so the overlay can
    // label each hand with the note it is sounding. Unconnected → no labels.
    { name: 'params', kind: 'synth-params' },
    // Optional: the right hand's scale (MIDI notes) to draw a pitch guide.
    { name: 'scale', kind: 'number[]' },
    // Optional: the live octave shift, so guide labels match the sounding pitch.
    { name: 'octaveShift', kind: 'number', default: 0 },
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

        // Mirrored faint video backdrop.
        if (p.showVideo && video && video.readyState >= 2) {
          g.save();
          g.globalAlpha = p.videoAlpha;
          g.scale(-1, 1);
          g.translate(-W, 0);
          g.drawImage(video, 0, 0, W, H);
          g.restore();
        }

        // Pitch guide: a faint vertical line + note name at each note of the
        // RIGHT hand's scale, drawn at the x where that note sounds. The line
        // positions match the x→pitch mapping for both hands while synced
        // (default); when hands are unsynced with different scales, the guide
        // reflects the right hand. Labels include the live octave shift so they
        // agree with the per-hand note labels (which read the actual frequency).
        const scale = inputs.scale as number[] | undefined;
        if (p.showScaleGuide && Array.isArray(scale) && scale.length > 1) {
          const shift = typeof inputs.octaveShift === 'number' ? inputs.octaveShift : 0;
          g.save();
          g.font = '11px monospace';
          g.textAlign = 'center';
          for (const { midi, x } of scaleGuide(scale)) {
            const sx = x * W;
            g.strokeStyle = 'rgba(255,255,255,0.10)';
            g.lineWidth = 1;
            g.beginPath();
            g.moveTo(sx, H * 0.12);
            g.lineTo(sx, H * 0.86);
            g.stroke();
            g.fillStyle = 'rgba(255,255,255,0.4)';
            g.fillText(midiToName(midi + shift * 12), sx, H * 0.82);
          }
          g.restore();
        }

        const frame = inputs.hands as HandsFrame | undefined;
        const feats = inputs.features as HandFeatures | undefined;

        // Landmark dots (mirror x to match the mirrored video).
        if (p.showLandmarks && frame) {
          for (const hand of frame.hands) {
            const color = hand.handedness === 'Left' ? RIGHT_COLOR : LEFT_COLOR; // mirrored
            g.fillStyle = color;
            for (const k of hand.keypoints) {
              const sx = W - (k.x / frame.width) * W;
              const sy = (k.y / frame.height) * H;
              g.beginPath();
              g.arc(sx, sy, 3, 0, Math.PI * 2);
              g.fill();
            }
            const tip = hand.keypoints[LM.index_tip];
            if (tip) {
              const sx = W - (tip.x / frame.width) * W;
              const sy = (tip.y / frame.height) * H;
              g.beginPath();
              g.arc(sx, sy, 10, 0, Math.PI * 2);
              g.strokeStyle = '#fff';
              g.lineWidth = 2;
              g.stroke();
            }
          }
        }

        // The synth params let us label each hand with the note it's sounding
        // (voice 0 = right, 1 = left, by convention).
        const sp = inputs.params as SynthParams | undefined;
        const noteFor = (voiceId: number): string | null => {
          const v = sp?.voices?.[voiceId];
          if (!v || !v.present || v.freq <= 0) return null;
          return midiToName(freqToMidi(v.freq));
        };

        // Control markers from features (x already mirrored, matches video),
        // with the current note drawn above each present hand.
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
          if (p.showNotes && note) {
            g.fillStyle = color;
            g.font = 'bold 22px monospace';
            g.textAlign = 'center';
            g.fillText(note, sx, sy - ring - 10);
            g.textAlign = 'left';
          }
        };
        if (feats) {
          drawMarker(feats.right, RIGHT_COLOR, noteFor(0));
          drawMarker(feats.left, LEFT_COLOR, noteFor(1));
        }

        return {};
      },
    };
  },
});
