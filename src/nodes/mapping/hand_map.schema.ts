/**
 * The `hand_map` node's CONTRACT (#600 S6, the `<node>.schema.ts` pattern): its settings schema,
 * defaults and types, importable without the node's implementation. The node imports them from
 * here and re-exports them, so existing imports of the node keep working; code outside
 * `src/nodes` imports this module.
 */
import { type FingerName } from '@thoremin/sdk/nodes/domain';

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
