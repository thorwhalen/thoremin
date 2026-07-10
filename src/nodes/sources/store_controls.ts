/**
 * `store-controls` source node — bridges the live UI control store into the DAG.
 * Each tick it reads a snapshot getter (injected via `ctx.resources.controls`)
 * and emits the derived scale arrays and sounds as port values, which wire
 * into `voice-mapping`'s live override ports. No graph rebuild on UI change.
 *
 * The injected getter returns a {@link ControlSnapshot}; if absent the node
 * emits nothing (safe in tests / before the host wires it up).
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';
import { generateScale, defaultChordSpecFor, type ScaleSpec, type ScaleTypeId } from '@/music/theory';
import type { SoundId } from '@/music/sounds';
import { legacyFaceToMapping, type FaceMapping } from '@/nodes/domain';
import type { FaceChord, FaceExpr } from '@/settings/schema';
import type { OverlayParams } from '@/nodes/output/canvas_overlay';

export interface VoiceControlSnapshot {
  root: number;
  type: ScaleTypeId;
  octaves: number;
  baseOctave: number;
  sound: SoundId;
  /** #63 octave RANGE (fractional octaves below/above the middle octave). When present,
   *  `generateScale` uses the range span; absent → the legacy `octaves` span. */
  rangeLow?: number;
  rangeHigh?: number;
}
export interface ControlSnapshot {
  right: VoiceControlSnapshot;
  left: VoiceControlSnapshot;
  /** Global octave transpose (−2..+2), read by voice-mapping / chords / overlay
   *  (#90 — keyboard shortcuts now write this dial instead of the retired
   *  `keyboard-control` node). */
  octaveShift?: number;
  /** Scale-snap magnetism (0..1), read by voice-mapping (#90). */
  magnetism?: number;
  /** Master mute, read by voice-mapping + synth-merge (#90 — the `m` key toggles
   *  `store.muted`, which flows here instead of through `keyboard-control`). */
  muted?: boolean;
  /** Live overlay element config; forwarded to canvas-overlay's overlayConfig. */
  overlay?: OverlayParams;
  /** Legacy face on/off flag; superseded by {@link faceMapping}. Kept so older
   *  hosts / saved data still gate the `webcam-face` model load. */
  faceEnabled?: boolean;
  /** What the face controls: none / timbre / chord. Read by `webcam-face` (model
   *  gating) and fed to `expression-chord` (chord-mode gating) as a port. */
  faceMapping?: FaceMapping;
  /** How the face chord sounds; fed to `expression-chord` as the chordConfig port. */
  faceChord?: FaceChord;
  /** Per-emotion sensitivity + per-expression degree map; the sensitivity feeds
   *  `face-expression` and the degree map feeds `expression-chord`. */
  faceExpr?: FaceExpr;
  /** Per-DEVICE calibration: a per-emotion sensitivity override (from the calibration
   *  wizard) that wins over the per-instrument `faceExpr.sensitivity`, so a user's
   *  calibration applies to EVERY instrument. Null/absent = use faceExpr.sensitivity. */
  faceCalibration?: Partial<Record<string, number>> | null;
}

const Params = z.object({});

export const storeControlsNode = defineNode<Record<string, never>>({
  type: 'store-controls',
  roles: ['source', 'control'],
  title: 'UI Controls',
  description: 'Reads the live UI control store → scale + sound + overlay port values.',
  inputs: [],
  outputs: [
    { name: 'scaleRight', kind: 'number[]' },
    { name: 'scaleLeft', kind: 'number[]' },
    { name: 'soundRight', kind: 'sound' },
    { name: 'soundLeft', kind: 'sound' },
    // Keyboard-driven globals (#90) — now sourced from the store, not the retired
    // keyboard-control node. Same downstream ports (octaveShift / magnetism / mute).
    { name: 'octaveShift', kind: 'number' },
    { name: 'magnetism', kind: 'number' },
    { name: 'mute', kind: 'boolean' },
    { name: 'overlay', kind: 'overlay-config' },
    // The right voice's melody scale spec (kept for reference/back-compat).
    { name: 'rightSpec', kind: 'scale-spec' },
    // The CHORD-SOURCE scale spec (#75), decoupled from the melody: auto → derived
    // from the melody via `defaultChordSpecFor`; custom → the faceChord chord scale.
    // Both chord instruments (expression-chord, pose-chord) read this instead of
    // rightSpec, so a pentatonic melody still gets (seven-note) chords. `chordScale`
    // is its note array, for the overlay's chord-name/degree labels.
    { name: 'chordSpec', kind: 'scale-spec' },
    { name: 'chordScale', kind: 'number[]' },
    { name: 'faceMapping', kind: 'face-mapping' },
    // Live chord settings (sound / volume / voicing / rendering / tempo).
    { name: 'chordConfig', kind: 'chord-config' },
    // Per-emotion firing sensitivity (→ face-expression) and the per-expression
    // scale-degree map (→ expression-chord).
    { name: 'expressionSensitivity', kind: 'expression-sensitivity' },
    { name: 'expressionDegrees', kind: 'expression-degrees' },
  ],
  params: Params,
  make() {
    return {
      process(_inputs, ctx: NodeContext) {
        const getter = ctx.resources.controls as (() => ControlSnapshot) | undefined;
        if (!getter) return {};
        const c = getter();
        const rightSpec: ScaleSpec = {
          root: c.right.root,
          type: c.right.type,
          octaves: c.right.octaves,
          baseOctave: c.right.baseOctave,
        };
        // Resolve the chord-source scale (#75): custom pins root/type, auto derives
        // the smart default from the melody. Register (baseOctave/octaves) tracks the
        // melody — diatonicChord builds its bass from baseOctave, so it is load-bearing.
        const cs = c.faceChord;
        const resolved =
          cs && cs.chordSource === 'custom'
            ? { root: cs.chordRoot, type: cs.chordType }
            : defaultChordSpecFor(rightSpec);
        const chordSpec: ScaleSpec = {
          root: resolved.root,
          type: resolved.type,
          octaves: c.right.octaves,
          baseOctave: c.right.baseOctave,
        };
        const out: Record<string, unknown> = {
          scaleRight: generateScale(c.right),
          scaleLeft: generateScale(c.left),
          soundRight: c.right.sound,
          soundLeft: c.left.sound,
          octaveShift: c.octaveShift ?? 0,
          magnetism: c.magnetism ?? 0.8,
          mute: c.muted ?? false,
          rightSpec,
          chordSpec,
          chordScale: generateScale(chordSpec),
          faceMapping: c.faceMapping ?? legacyFaceToMapping(c.faceEnabled),
        };
        if (c.faceChord) {
          out.chordConfig = {
            sound: c.faceChord.sound,
            gain: c.faceChord.volume,
            voicing: c.faceChord.voicing,
            rendering: c.faceChord.rendering,
            bpm: c.faceChord.bpm,
          };
        }
        if (c.faceExpr) {
          // The per-device calibration overrides the per-instrument sensitivity
          // (per-emotion), so a calibrated user keeps their bars across instruments.
          out.expressionSensitivity = c.faceCalibration
            ? { ...c.faceExpr.sensitivity, ...c.faceCalibration }
            : c.faceExpr.sensitivity;
          out.expressionDegrees = c.faceExpr.degrees;
        }
        if (c.overlay) out.overlay = c.overlay;
        return out;
      },
    };
  },
});
