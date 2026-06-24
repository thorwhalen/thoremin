/**
 * `store-controls` source node — bridges the live UI control store into the DAG.
 * Each tick it reads a snapshot getter (injected via `ctx.resources.controls`)
 * and emits the derived scale arrays and instruments as port values, which wire
 * into `voice-mapping`'s live override ports. No graph rebuild on UI change.
 *
 * The injected getter returns a {@link ControlSnapshot}; if absent the node
 * emits nothing (safe in tests / before the host wires it up).
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';
import { generateScale, type ScaleSpec, type ScaleTypeId } from '@/music/theory';
import type { InstrumentId } from '@/music/instruments';
import { legacyFaceToMapping, type FaceMapping } from '@/nodes/domain';
import type { FaceChord } from '@/settings/schema';
import type { OverlayParams } from '@/nodes/output/canvas_overlay';

export interface VoiceControlSnapshot {
  root: number;
  type: ScaleTypeId;
  octaves: number;
  baseOctave: number;
  instrument: InstrumentId;
}
export interface ControlSnapshot {
  right: VoiceControlSnapshot;
  left: VoiceControlSnapshot;
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
}

const Params = z.object({});

export const storeControlsNode = defineNode<Record<string, never>>({
  type: 'store-controls',
  roles: ['source', 'control'],
  title: 'UI Controls',
  description: 'Reads the live UI control store → scale + instrument + overlay port values.',
  inputs: [],
  outputs: [
    { name: 'scaleRight', kind: 'number[]' },
    { name: 'scaleLeft', kind: 'number[]' },
    { name: 'instrumentRight', kind: 'instrument' },
    { name: 'instrumentLeft', kind: 'instrument' },
    { name: 'overlay', kind: 'overlay-config' },
    // The right voice's scale spec + the face mode, for the expression→chord path.
    { name: 'rightSpec', kind: 'scale-spec' },
    { name: 'faceMapping', kind: 'face-mapping' },
    // Live chord settings (instrument / volume / voicing / rendering / tempo).
    { name: 'chordConfig', kind: 'chord-config' },
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
        const out: Record<string, unknown> = {
          scaleRight: generateScale(c.right),
          scaleLeft: generateScale(c.left),
          instrumentRight: c.right.instrument,
          instrumentLeft: c.left.instrument,
          rightSpec,
          faceMapping: c.faceMapping ?? legacyFaceToMapping(c.faceEnabled),
        };
        if (c.faceChord) {
          out.chordConfig = {
            instrument: c.faceChord.instrument,
            gain: c.faceChord.volume,
            voicing: c.faceChord.voicing,
            rendering: c.faceChord.rendering,
            bpm: c.faceChord.bpm,
          };
        }
        if (c.overlay) out.overlay = c.overlay;
        return out;
      },
    };
  },
});
