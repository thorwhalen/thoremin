/**
 * The air drum's pads over the video (#245), an overlay element this extension contributes
 * (#600 S10; it was a core element): each pad in its colour where the player strikes it (pad
 * coordinates are fractions of the DISPLAYED, mirrored frame, which is the canvas), labelled with
 * its drum, brightening when it is hit; and the virtual sticks while the drum tracks the stick tip.
 *
 * Inputs: `config` (the `airDrum` dial, delivered by the host: `enabled`, `pads`, `point`,
 * `stickLength`, and `padsOnVideo.show`), `hits` (the drum's hits, for the flash) and `hands` (the
 * camera's hands frame, for the sticks).
 */
import type { OverlayElementImpl } from '@thoremin/sdk/instruments/extension';
import type { HandsFrame } from '@thoremin/sdk/nodes/domain';
import { PAD_IDS, anyPadOn, type PadId, type Pads } from '@thoremin/sdk/nodes/music/drum_pads';
import { gripFulcrum, stickTip } from '@thoremin/sdk/nodes/music/drum_anchor';

export const DRUM_PADS_ELEMENT = 'drumPads';

/** How long a struck pad flashes, seconds. */
const PAD_FLASH_SECONDS = 0.25;

/** The colour of the virtual sticks. */
const DRUM_STICK_COLOR = '#f5deb3';

interface DrumConfig {
  enabled?: boolean;
  pads?: Pads;
  point?: string;
  stickLength?: number;
  padsOnVideo?: { show?: boolean };
}

/** The pads to draw: the air drum's, while it is on with at least one pad. */
function drumPadsOf(c: DrumConfig | undefined): Pads | null {
  return c?.enabled && c.pads && anyPadOn(c.pads) ? c.pads : null;
}

/** The virtual sticks' length while the air drum is on and tracks the stick tip. */
function drumStickLengthOf(c: DrumConfig | undefined): number | null {
  return c?.enabled && c.point === 'stickTip' && typeof c.stickLength === 'number' ? c.stickLength : null;
}

const mirrorX = (xPx: number, frameW: number, W: number): number => W - (xPx / frameW) * W;

/** How bright each pad flashes now, 0..1, from the hits seen so far (`lastHit`: when each pad was
 *  last struck, in engine seconds; kept in the element's memo between frames). */
function padFlash(lastHit: Partial<Record<PadId, number>>, raw: unknown, now: number): Partial<Record<PadId, number>> {
  if (Array.isArray(raw)) for (const h of raw as { pad?: PadId | null; t?: number }[]) if (h?.pad) lastHit[h.pad] = Math.max(now, h.t ?? now);
  const out: Partial<Record<PadId, number>> = {};
  for (const id of PAD_IDS) {
    const t = lastHit[id];
    if (t === undefined) continue;
    // Flash from the moment the hit SOUNDS (a predicted hit is scheduled ahead).
    const age = now - t;
    if (age >= 0 && age < PAD_FLASH_SECONDS) out[id] = 1 - age / PAD_FLASH_SECONDS;
  }
  return out;
}

export const drumPadsElement: OverlayElementImpl = {
  name: DRUM_PADS_ELEMENT,
  draw(g, { W, H, t }, inputs, memo) {
    const config = inputs.config as DrumConfig | undefined;
    const lastHit = (memo.lastHit ??= {}) as Partial<Record<PadId, number>>;
    // The flash's clock runs whether or not the pads are shown, as it did in core.
    const flash = padFlash(lastHit, inputs.hits, t);
    if (config?.padsOnVideo?.show === false) return;
    // The virtual sticks: the point the air drum tracks, drawn from the grip's fulcrum to
    // the estimated tip (mirrored like every in-scene element), so the pads are aimed
    // with what actually strikes them.
    const stickLength = drumStickLengthOf(config);
    const frame = inputs.hands as HandsFrame | undefined;
    if (stickLength != null && frame && frame.width > 0) {
      g.globalAlpha = 0.9;
      g.strokeStyle = DRUM_STICK_COLOR;
      g.lineWidth = 4;
      for (const hand of frame.hands) {
        if (hand.keypoints.length < 21) continue;
        const f = gripFulcrum(hand.keypoints);
        const tip = stickTip(hand.keypoints, stickLength);
        g.beginPath();
        g.moveTo(mirrorX(f.x, frame.width, W), (f.y / frame.height) * H);
        g.lineTo(mirrorX(tip.x, frame.width, W), (tip.y / frame.height) * H);
        g.stroke();
      }
    }
    const pads = drumPadsOf(config);
    if (!pads) return;
    for (const id of PAD_IDS) {
      const p = pads[id];
      if (!p.on) continue;
      const lit = flash[id] ?? 0;
      const cx = p.x * W;
      const cy = p.y * H;
      const rw = (p.w * W) / 2;
      const rh = (p.h * H) / 2;
      g.beginPath();
      if (p.shape === 'circle') g.ellipse(cx, cy, rw, rh, 0, 0, Math.PI * 2);
      else g.rect(cx - rw, cy - rh, 2 * rw, 2 * rh);
      g.globalAlpha = 0.15 + 0.45 * lit;
      g.fillStyle = p.color;
      g.fill();
      g.globalAlpha = 0.8;
      g.lineWidth = 2 + 3 * lit;
      g.strokeStyle = p.color;
      g.stroke();
      g.globalAlpha = 0.85;
      g.fillStyle = '#ffffff';
      g.font = '12px monospace';
      g.textAlign = 'center';
      g.fillText(p.sound, cx, cy + 4);
    }
    g.textAlign = 'left';
  },
};
