/**
 * The default Thoremin instrument graph — the wiring that makes hand gestures
 * play tonal audio with overlays, steerable live by keyboard + UI.
 *
 *   webcam ─┬─▶ hand-features ─┬─▶ voice-mapping ─▶ webaudio-synth
 *           │                  │        ▲ ▲ ▲
 *           └────────▶ overlay ◀┘        │ │ └── store-controls (scale/instrument)
 *                       (video+guides)   │ └──── keyboard-control (magnetism/octave/mute)
 *                                        └────── keyboard-source ─▶ keyboard-control
 *
 * One output may fan OUT to several inputs (webcam→features & overlay); only
 * fan-IN to a single input port is disallowed.
 */
import type { GraphSpec } from '@/dag';

export function defaultGraph(): GraphSpec {
  return {
    nodes: [
      { id: 'cam', type: 'webcam-hands', params: { modelType: 'full', maxHands: 2 } },
      { id: 'feat', type: 'hand-features', params: { mirrorX: true, mirrorHandedness: true } },
      { id: 'kbd', type: 'keyboard-source' },
      { id: 'kctrl', type: 'keyboard-control', params: { magnetismStart: 0.8 } },
      { id: 'ui', type: 'store-controls' },
      { id: 'map', type: 'voice-mapping', params: { magnetism: 0.8, maxGain: 0.5 } },
      { id: 'synth', type: 'webaudio-synth' },
      // Overlay elements default on (video/scaleGuide/landmarks/markers); the
      // opt-in index-finger guide is off by default. See canvas_overlay.ts.
      { id: 'overlay', type: 'canvas-overlay', params: {} },
    ],
    edges: [
      { from: { node: 'cam', port: 'hands' }, to: { node: 'feat', port: 'hands' } },
      { from: { node: 'cam', port: 'hands' }, to: { node: 'overlay', port: 'hands' } },
      { from: { node: 'feat', port: 'features' }, to: { node: 'map', port: 'features' } },
      { from: { node: 'feat', port: 'features' }, to: { node: 'overlay', port: 'features' } },
      { from: { node: 'kbd', port: 'pressed' }, to: { node: 'kctrl', port: 'pressed' } },
      { from: { node: 'kctrl', port: 'magnetism' }, to: { node: 'map', port: 'magnetism' } },
      { from: { node: 'kctrl', port: 'octaveShift' }, to: { node: 'map', port: 'octaveShift' } },
      { from: { node: 'kctrl', port: 'mute' }, to: { node: 'map', port: 'mute' } },
      { from: { node: 'ui', port: 'scaleRight' }, to: { node: 'map', port: 'scaleRight' } },
      { from: { node: 'ui', port: 'scaleLeft' }, to: { node: 'map', port: 'scaleLeft' } },
      { from: { node: 'ui', port: 'instrumentRight' }, to: { node: 'map', port: 'instrumentRight' } },
      { from: { node: 'ui', port: 'instrumentLeft' }, to: { node: 'map', port: 'instrumentLeft' } },
      { from: { node: 'map', port: 'params' }, to: { node: 'synth', port: 'params' } },
      // Also feed params to the overlay so it can label each hand's note.
      { from: { node: 'map', port: 'params' }, to: { node: 'overlay', port: 'params' } },
      // And both hands' scales + octave shift, for the overlay pitch guides.
      { from: { node: 'ui', port: 'scaleRight' }, to: { node: 'overlay', port: 'scale' } },
      { from: { node: 'ui', port: 'scaleLeft' }, to: { node: 'overlay', port: 'scaleLeft' } },
      { from: { node: 'kctrl', port: 'octaveShift' }, to: { node: 'overlay', port: 'octaveShift' } },
      // Live overlay element config from the UI store (toggle elements without rebuild).
      { from: { node: 'ui', port: 'overlay' }, to: { node: 'overlay', port: 'overlayConfig' } },
    ],
  };
}
