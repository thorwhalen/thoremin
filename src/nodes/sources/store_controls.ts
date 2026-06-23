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
import { generateScale, type ScaleTypeId } from '@/music/theory';
import type { InstrumentId } from '@/music/instruments';
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
}

const Params = z.object({});

export const storeControlsNode = defineNode<Record<string, never>>({
  type: 'store-controls',
  title: 'UI Controls',
  description: 'Reads the live UI control store → scale + instrument + overlay port values.',
  inputs: [],
  outputs: [
    { name: 'scaleRight', kind: 'number[]' },
    { name: 'scaleLeft', kind: 'number[]' },
    { name: 'instrumentRight', kind: 'instrument' },
    { name: 'instrumentLeft', kind: 'instrument' },
    { name: 'overlay', kind: 'overlay-config' },
  ],
  params: Params,
  make() {
    return {
      process(_inputs, ctx: NodeContext) {
        const getter = ctx.resources.controls as (() => ControlSnapshot) | undefined;
        if (!getter) return {};
        const c = getter();
        const out: Record<string, unknown> = {
          scaleRight: generateScale(c.right),
          scaleLeft: generateScale(c.left),
          instrumentRight: c.right.instrument,
          instrumentLeft: c.left.instrument,
        };
        if (c.overlay) out.overlay = c.overlay;
        return out;
      },
    };
  },
});
