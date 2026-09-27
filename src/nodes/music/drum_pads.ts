/**
 * Drum pads (#245): shapes on the screen, each a drum. A stroke's landing point picks
 * the pad, where in the pad it landed shades the sound (centre vs rim), and how fast
 * the stick was travelling at the impact sets the volume and the tone.
 *
 * The data. A pad is a Zod record (shape, centre, size, colour, sound). The set of pads
 * is a fixed row of SLOTS (`p1`..`p8`), each with an `on` flag, rather than an array: it
 * lives inside the `airDrum` dial (so it persists with the dials, travels in a saved
 * instrument, and reaches the node live through its `config` input), and a fixed key set
 * is what makes every pad field an addressable scalar leaf of the command write path
 * (`airDrum.pads.p2.x`), which an array index is not. "A few shapes" is eight at most.
 * Every slot carries a sensible place, colour and drum, so switching a slot on puts a
 * usable pad on the screen; all are off by default, and with no pad on the air drum
 * behaves exactly as before (each hand plays its own sound).
 *
 * The space. Pad coordinates are fractions of the DISPLAYED frame: x from the left edge
 * of the mirrored view the player sees (the overlay always mirrors the webcam; see
 * `canvas_overlay.ts`'s `mirrorX`), y from the top. So a pad drawn at the player's left
 * is struck by the hand the player sees there. {@link toDisplay} is that map.
 *
 * Pure and Node-safe; the node and the overlay import it, the pad-layout collection
 * persists {@link PadsSchema}.
 */
import { z } from 'zod';

/** The drums a pad (or a hand) can sound. */
export const DRUM_SOUNDS = ['kick', 'snare', 'hihat', 'tom', 'crash', 'ride'] as const;
export type DrumSound = (typeof DRUM_SOUNDS)[number];

export const PAD_SHAPES = ['circle', 'rect'] as const;
export type PadShape = (typeof PAD_SHAPES)[number];

export const PAD_IDS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'] as const;
export type PadId = (typeof PAD_IDS)[number];

/** What a hit that lands on no pad plays: the striking hand's own sound, the nearest
 *  pad's, or nothing. */
export const OFF_PAD_MODES = ['hand', 'nearest', 'silent'] as const;
export type OffPadMode = (typeof OFF_PAD_MODES)[number];

/** Smallest pad side, as a fraction of the frame: a pad a stroke can still land in. */
export const MIN_PAD_SIZE = 0.03;

export const PadSchema = z.object({
  on: z.boolean(),
  shape: z.enum(PAD_SHAPES),
  /** Centre, fraction of the displayed frame's width from its left edge. */
  x: z.number().min(0).max(1),
  /** Centre, fraction of the displayed frame's height from its top. */
  y: z.number().min(0).max(1),
  /** Full width, fraction of the frame's width (a circle is the ellipse in its box). */
  w: z.number().min(MIN_PAD_SIZE).max(1),
  /** Full height, fraction of the frame's height. */
  h: z.number().min(MIN_PAD_SIZE).max(1),
  /** `#rrggbb`. */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sound: z.enum(DRUM_SOUNDS),
});
export type Pad = z.infer<typeof PadSchema>;

/** Where each slot sits when switched on: a small kit around where hands fall in a
 *  webcam frame, snare in the middle, cymbals high, kick and floor tom low; every pad
 *  inside the band a 4:3 camera keeps on a 16:9 screen (y from 0.125 to 0.875), which
 *  crops a camera's frame to fill the window. */
export const DEFAULT_PADS: Record<PadId, Pad> = {
  p1: { on: false, shape: 'circle', x: 0.5, y: 0.72, w: 0.18, h: 0.24, color: '#e11d48', sound: 'snare' },
  p2: { on: false, shape: 'circle', x: 0.26, y: 0.6, w: 0.16, h: 0.2, color: '#eab308', sound: 'hihat' },
  p3: { on: false, shape: 'circle', x: 0.74, y: 0.6, w: 0.16, h: 0.22, color: '#3b82f6', sound: 'tom' },
  p4: { on: false, shape: 'circle', x: 0.14, y: 0.3, w: 0.18, h: 0.22, color: '#14b8a6', sound: 'crash' },
  p5: { on: false, shape: 'circle', x: 0.86, y: 0.3, w: 0.18, h: 0.22, color: '#a855f7', sound: 'ride' },
  p6: { on: false, shape: 'rect', x: 0.5, y: 0.8, w: 0.3, h: 0.12, color: '#f97316', sound: 'kick' },
  p7: { on: false, shape: 'circle', x: 0.8, y: 0.76, w: 0.16, h: 0.2, color: '#22c55e', sound: 'tom' },
  p8: { on: false, shape: 'rect', x: 0.2, y: 0.78, w: 0.16, h: 0.14, color: '#64748b', sound: 'snare' },
};

/** The starter kit: the first five slots (snare, hi-hat, tom, crash, ride). */
export const STARTER_KIT: readonly PadId[] = ['p1', 'p2', 'p3', 'p4', 'p5'];

/** The pad slots, each defaulting to its own place. */
export const PadsSchema = z.object(
  Object.fromEntries(PAD_IDS.map((id) => [id, PadSchema.default(DEFAULT_PADS[id])])) as { [K in PadId]: z.ZodDefault<typeof PadSchema> },
);
export type Pads = z.infer<typeof PadsSchema>;
export const DEFAULT_PADS_SET: Pads = PadsSchema.parse({});

/** A pixel point of a source frame, in the displayed (mirrored) frame's fractions. */
export function toDisplay(xPx: number, yPx: number, width: number, height: number): { x: number; y: number } {
  return { x: 1 - xPx / width, y: yPx / height };
}

/** How far a point is from a pad's centre, in the pad's own half-sizes: 0 at the centre,
 *  1 on the edge (an ellipse for a circle, the box for a rect), above 1 outside. */
export function padDistance(pad: Pad, p: { x: number; y: number }): number {
  const u = (p.x - pad.x) / (pad.w / 2);
  const v = (p.y - pad.y) / (pad.h / 2);
  return pad.shape === 'circle' ? Math.hypot(u, v) : Math.max(Math.abs(u), Math.abs(v));
}

export interface PadHit {
  id: PadId;
  pad: Pad;
  /** 0 = the centre, 1 = the rim (clamped for a 'nearest' pick outside every pad). */
  radial: number;
}

/**
 * The pad a landing point struck. Overlapping pads: the later slot is drawn on top and
 * wins. Outside every pad, `offPad: 'nearest'` picks the pad whose edge is nearest (in
 * its own half-sizes) and reads the hit as a rim shot; anything else returns null.
 */
export function hitPad(pads: Pads, p: { x: number; y: number }, offPad: OffPadMode = 'hand'): PadHit | null {
  let best: PadHit | null = null;
  let nearest: { id: PadId; d: number } | null = null;
  for (const id of PAD_IDS) {
    const pad = pads[id];
    if (!pad.on) continue;
    const d = padDistance(pad, p);
    if (d <= 1) best = { id, pad, radial: d };
    if (!nearest || d < nearest.d) nearest = { id, d };
  }
  if (best) return best;
  if (offPad === 'nearest' && nearest) return { id: nearest.id, pad: pads[nearest.id], radial: 1 };
  return null;
}

/** Whether any pad is on (with none, the air drum is the per-hand instrument it was). */
export function anyPadOn(pads: Pads): boolean {
  return PAD_IDS.some((id) => pads[id].on);
}
