/**
 * The conductor's beat on the video (#187), an overlay element this slice contributes (#600 S18c; it
 * was core's `conductorHud`): a ring at the top centre that fills through the beat (the phase),
 * flashes white on the beat, and carries the beat-in-bar count with the tempo under it; "waiting for
 * your first beat" and "holding" as words when the follower is not running. The same information
 * the Conductor panel shows, on the video, so a player conducting with the panel closed still sees
 * the follower answer.
 *
 * Inputs: `config` (the `conductor` dial, delivered by the host: `hudOnVideo.show`), `time` (the
 * conductor's musical time) and `enabled` (whether the follower runs).
 */
import type { OverlayElementImpl } from '@thoremin/sdk/instruments/extension';
import type { MusicalTime } from '@thoremin/ictus';

export const CONDUCTOR_HUD_ELEMENT = 'conductorHud';

/** The ring's colour. */
const CONDUCTOR_COLOR = '#34d399';
/** The ring's centre height and radius, in canvas pixels. */
const RING_Y = 44;
const RING_R = 18;
/** The share of the beat the on-beat flash lasts. */
const FLASH = 0.1;

export const conductorHudElement: OverlayElementImpl = {
  name: CONDUCTOR_HUD_ELEMENT,
  draw(g, { W }, inputs) {
    if ((inputs.config as { hudOnVideo?: { show?: boolean } } | undefined)?.hudOnVideo?.show === false) return;
    if (inputs.enabled !== true) return;
    const t = inputs.time as MusicalTime | undefined;
    if (!t) return;
    const cx = W / 2;
    const cy = RING_Y;
    const r = RING_R;
    const running = t.state === 'running' && t.tempo > 0;
    g.save();
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
    if (running) {
      // The phase arc, and a flash in the first tenth of the beat.
      const phase = Math.max(0, Math.min(1, t.phase));
      g.strokeStyle = CONDUCTOR_COLOR;
      g.beginPath();
      g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + phase * Math.PI * 2);
      g.stroke();
      if (phase < FLASH) {
        g.globalAlpha = 1 - phase / FLASH;
        g.fillStyle = 'white';
        g.beginPath();
        g.arc(cx, cy, r - 4, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
      }
    }
    g.fillStyle = 'white';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 13px system-ui, sans-serif';
    const beat = ((Math.floor(t.beat) % t.beatsPerBar) + t.beatsPerBar) % t.beatsPerBar + 1;
    g.fillText(running ? `${beat}` : t.state === 'hold' ? '||' : '…', cx, cy);
    g.font = '11px system-ui, sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.75)';
    const label = running
      ? `${Math.round(t.tempo)} bpm · ${beat}/${t.beatsPerBar}`
      : t.anchors === 0
        ? 'waiting for your first beat'
        : t.state === 'hold'
          ? 'holding'
          : 'finding your tempo';
    g.fillText(label, cx, cy + r + 12);
    g.restore();
  },
};
