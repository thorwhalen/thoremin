/**
 * The hand→sound mapping model — how wrist position and the per-finger→thumb
 * distances are routed to aspects of the sound. This is the configurable heart of an
 * "instrument" beyond scale/sound: the note SOURCE (index fingertip or the steadier
 * wrist), and a routing of each finger to a sound EFFECT from a small palette, each
 * with a sensitivity and a continuous/trigger mode.
 *
 * The design is grounded in the hand-control research (discussion #80): the most
 * controllable fingers (index) should drive the most perceptually salient sound
 * aspects (brightness), and coupled/coarse fingers (ring, pinky) the peripheral ones
 * (pan, pitch-bend) — so finger enslaving falls along congruent sonic dimensions.
 *
 * Pure + framework-agnostic (imports only domain types), so {@link fingerEffects} is
 * unit-tested directly; the {@link voiceMappingNode} applies its output, and the
 * settings layer builds a Zod schema over {@link EFFECTS} / {@link HandMap}.
 */
import { FINGER_NAMES, type FingerCloseness, type FingerName } from '../domain';

/** The sound aspects a finger can be routed to control. All are applied in the voice
 *  mapping (no synth changes): additive to brightness/vibrato/pan, folded into the
 *  pitch for pitchBend/octave, and a gain gate for `gate`. */
export const EFFECTS = ['brightness', 'vibrato', 'pan', 'pitchBend', 'octave', 'gate'] as const;
export type EffectId = (typeof EFFECTS)[number];

/** Very short effect names for on-canvas cue labels. */
export const EFFECT_SHORT: Record<EffectId, string> = {
  brightness: 'brt',
  vibrato: 'vib',
  pan: 'pan',
  pitchBend: 'bnd',
  octave: 'oct',
  gate: 'gate',
};

/** A finger route target: an effect, or `none` (the finger does nothing). */
export type FingerTarget = EffectId | 'none';

/** How a finger's closeness drives its target. `continuous` = proportional;
 *  `trigger` = a discrete on/off past a threshold (a pinch gesture). */
export const FINGER_MODES = ['continuous', 'trigger'] as const;
export type FingerMode = (typeof FINGER_MODES)[number];

export interface FingerRoute {
  target: FingerTarget;
  /** Gain on the finger closeness before it drives the effect (0..2). */
  sensitivity: number;
  mode: FingerMode;
  /** Flip the sense (closeness→0 drives the effect instead of closeness→1). */
  invert: boolean;
}

/** Where the note pitch/volume comes from: the index fingertip (classic) or the
 *  wrist (steadier, whole-hand — frees the fingers for effects). */
export const POSITION_SOURCES = ['index', 'wrist'] as const;
export type PositionSource = (typeof POSITION_SOURCES)[number];

/** The full hand→sound mapping config (per instrument). Beyond the finger routing it
 *  also exposes the voice-mapping knobs that used to be static graph params, so an
 *  instrument can vary them (fist→mute, open→brighter, pinch→vibrato, pan, magnetism). */
export interface HandMap {
  positionSource: PositionSource;
  fingers: Record<FingerName, FingerRoute>;
  /** 0 = free glide, 1 = hard snap to scale notes. */
  magnetism: number;
  /** Max output volume (0..1) at the top of the frame. */
  maxGain: number;
  /** A closed fist mutes the voice (openness gates gain). */
  opennessGatesGain: boolean;
  /** Hand openness shapes tone brightness (open = brighter). */
  opennessControlsBrightness: boolean;
  /** Thumb-index pinch adds vibrato. */
  pinchControlsVibrato: boolean;
  /** Hand x position pans the voice in stereo. */
  panByPosition: boolean;
  /** Max stereo spread (0..1) at the frame edges when panByPosition is on. */
  panSpread: number;
}

const OFF: FingerRoute = { target: 'none', sensitivity: 1, mode: 'continuous', invert: false };
const route = (target: FingerTarget): FingerRoute => ({ ...OFF, target });

/** No finger routing, index note source — byte-identical to the classic behavior.
 *  The base app and any instrument that doesn't configure a hand map use this. */
export const DEFAULT_HAND_MAP: HandMap = {
  positionSource: 'index',
  fingers: { index: { ...OFF }, middle: { ...OFF }, ring: { ...OFF }, pinky: { ...OFF } },
  magnetism: 0.8,
  maxGain: 0.5,
  opennessGatesGain: false,
  opennessControlsBrightness: true,
  pinchControlsVibrato: true,
  panByPosition: true,
  panSpread: 0.5,
};

/** The research-grounded starting routing (discussion #80): finest finger → most
 *  salient aspect (index→brightness), then vibrato, then the peripheral pan / pitch
 *  on the coarser, more-coupled fingers. */
export const RECOMMENDED_FINGER_ROUTES: Record<FingerName, FingerRoute> = {
  index: route('brightness'),
  middle: route('vibrato'),
  ring: route('pan'),
  pinky: route('pitchBend'),
};

/** Closeness above which a `trigger`-mode finger fires (with a little hysteresis room). */
export const TRIGGER_THRESHOLD = 0.6;
/** Max upward pitch bend a finger→pitchBend applies, in semitones. */
export const BEND_SEMITONES = 2;

/**
 * Combine the finger routes into a per-effect amount. Each routed finger contributes
 * its (mode/invert/sensitivity-shaped) closeness to its target; fingers sharing a
 * target are AVERAGED — so routing several fingers to one effect gives the "combined
 * spread" the user described. Additive effects default to 0; `gate` (multiplicative)
 * defaults to 1 (pass-through) when no finger drives it. Pure.
 */
export function fingerEffects(fingers: FingerCloseness, routes: Record<FingerName, FingerRoute>): Record<EffectId, number> {
  const bucket: Partial<Record<EffectId, number[]>> = {};
  for (const name of FINGER_NAMES) {
    const r = routes[name];
    if (!r || r.target === 'none') continue;
    let c = fingers[name];
    if (r.mode === 'trigger') c = c > TRIGGER_THRESHOLD ? 1 : 0;
    if (r.invert) c = 1 - c;
    const amount = Math.max(0, Math.min(1, c * r.sensitivity));
    (bucket[r.target] ??= []).push(amount);
  }
  const out = {} as Record<EffectId, number>;
  for (const e of EFFECTS) {
    const a = bucket[e];
    out[e] = a && a.length ? a.reduce((s, x) => s + x, 0) / a.length : e === 'gate' ? 1 : 0;
  }
  return out;
}
