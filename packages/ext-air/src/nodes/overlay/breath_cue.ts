/**
 * The air flute's breath cue (#249), an overlay HUD cue this extension contributes (#600 S10; it
 * was the core element `mouthCue`): while the flute breathes through the mouth, one bar that says
 * whether the breath is sounding, laid out on its edge with the other cues.
 *
 * Inputs: `config` (the `airFlute` dial, delivered by the host: `breathCue.show` and `.position`)
 * and `status` (the flute's live status: `enabled`, `breath`, `face`, `mouthReady`, `sounding`).
 */
import type { OverlayElementImpl } from '@thoremin/sdk/instruments/extension';
import { BAR_LABEL_COLOR, drawBarGraph, measureBarGraph, type BarSpec } from '@thoremin/sdk/overlay/bar_graph';

export const BREATH_CUE_ELEMENT = 'mouthCue';

/** What the cue reads of the flute's status (any status with these fields draws). */
export interface BreathStatus {
  enabled: boolean;
  breath: string;
  face: boolean;
  mouthReady: boolean;
  sounding: boolean;
}

interface FluteConfig {
  breathCue?: { show?: boolean; position?: 'left' | 'right' | 'top' | 'bottom' };
}

const breathing = (st: BreathStatus | undefined): st is BreathStatus => !!st?.enabled && st.breath === 'mouth';

export const breathCueElement: OverlayElementImpl = {
  name: BREATH_CUE_ELEMENT,
  positionOf: (_frame, inputs) => (inputs.config as FluteConfig | undefined)?.breathCue?.position ?? 'left',
  measure(_frame, inputs) {
    const show = (inputs.config as FluteConfig | undefined)?.breathCue?.show !== false;
    if (!show || !breathing(inputs.status as BreathStatus | undefined)) return null;
    return measureBarGraph([{ labels: ['breath'] }], { title: 'flute' });
  },
  draw(g, frame, inputs) {
    const st = inputs.status as BreathStatus | undefined;
    if (!breathing(st) || !frame.origin) return;
    const bar: BarSpec = {
      value: st.sounding ? 1 : st.face ? 0.15 : 0,
      color: BAR_LABEL_COLOR,
      highlight: st.sounding,
      fired: st.sounding,
      labels: [st.mouthReady ? 'breath' : 'enrol mouth'],
    };
    drawBarGraph(g, frame.origin.x, frame.origin.y, [bar], { title: 'flute' });
  },
};
