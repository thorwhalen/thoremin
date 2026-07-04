/**
 * `voice-mapping` node — the heart of the *direct* mapping + tonal guidance.
 * Turns per-hand features into per-voice synthesis parameters:
 *
 *   x        → pitch, snapped toward a scale by `magnetism` (tonal guidance)
 *   y        → volume (higher hand = louder), gated by presence
 *   openness → optional brightness/gain shaping (kept simple in v0)
 *
 * Two voices: voice 0 = right hand, voice 1 = left hand. Each hand has its own
 * scale spec so the two hands can play different ranges/scales.
 *
 * Pure and deterministic — testable from a recorded `hand-features` stream.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import {
  generateScale,
  magneticPitch,
  midiToFreq,
  clamp01,
  type ScaleTypeId,
} from '@/music/theory';
import { SoundSchema, SOUND_IDS } from '@/music/sounds';
import { ABSENT_HAND, type FaceFeatures, type HandFeatures, type SynthParams, type VoiceParams } from '../domain';
import { MAPPING_SLOT_INPUTS, MAPPING_SLOT_OUTPUT } from './mapping_contract';
import { BEND_SEMITONES, DEFAULT_HAND_MAP, fingerEffects, type HandMap } from './hand_map';

/** How much a full smile / open mouth add to brightness / vibrato (0..1). */
const FACE_SMILE_BRIGHTNESS = 0.5;
const FACE_MOUTH_VIBRATO = 0.6;

/** Additive expression boosts contributed by the face (0 when no face). */
interface FaceMod {
  brightness: number;
  vibrato: number;
}
const NO_FACE_MOD: FaceMod = { brightness: 0, vibrato: 0 };

const ScaleParams = z.object({
  root: z.number().int().min(0).max(11).default(0),
  type: z
    .enum(['major', 'minor', 'pentatonic', 'minorPentatonic', 'minorHarmonic', 'blues', 'chromatic'])
    .default('major'),
  octaves: z.number().int().min(1).max(4).default(2),
  baseOctave: z.number().int().min(0).max(7).default(3),
});

const Instrument = SoundSchema;

const Params = z.object({
  /** 0 = free glide, 1 = hard snap to scale notes. */
  magnetism: z.number().min(0).max(1).default(0.8),
  /** Max output volume (0..1) at the top of the frame. */
  maxGain: z.number().min(0).max(1).default(0.5),
  /** If true, a closed fist mutes the voice (openness gates gain). */
  opennessGatesGain: z.boolean().default(false),
  /** If true, hand openness shapes tone brightness (open = brighter). */
  opennessControlsBrightness: z.boolean().default(true),
  /** If true, pinch (thumb-index) adds vibrato (pinch = more wobble). */
  pinchControlsVibrato: z.boolean().default(true),
  /** If true, a connected face adds expression (smile→brighter, mouth→vibrato). */
  faceControlsExpression: z.boolean().default(true),
  /** If true, hand x position pans the voice in stereo (left→left, right→right). */
  panByPosition: z.boolean().default(true),
  /** Max stereo spread (0..1) at the edges of the frame when panByPosition is on. */
  panSpread: z.number().min(0).max(1).default(0.5),
  right: z.object({ scale: ScaleParams, sound: Instrument.default('sine') }).default({
    scale: ScaleParams.parse({}),
    sound: 'sine',
  }),
  left: z.object({ scale: ScaleParams, sound: Instrument.default('triangle') }).default({
    scale: ScaleParams.parse({}),
    sound: 'triangle',
  }),
});
type Params = z.infer<typeof Params>;

/** Live control overrides fed via input ports (override static params). */
interface Control {
  magnetism: number;
  octaveShift: number;
  mute: boolean;
}

const clampPan = (v: number): number => Math.max(-1, Math.min(1, v));

/**
 * A live hand map (from the control store) wins; otherwise one is built from the
 * static node params (finger routing off, index note source) — byte-identical to the
 * classic behavior, so headless graphs/tests are unchanged.
 */
function resolveHandMap(live: HandMap | undefined, p: Params): HandMap {
  if (live) return live;
  return {
    ...DEFAULT_HAND_MAP,
    magnetism: p.magnetism,
    maxGain: p.maxGain,
    opennessGatesGain: p.opennessGatesGain,
    opennessControlsBrightness: p.opennessControlsBrightness,
    pinchControlsVibrato: p.pinchControlsVibrato,
    panByPosition: p.panByPosition,
    panSpread: p.panSpread,
  };
}

function voiceFor(
  id: number,
  feat: typeof ABSENT_HAND,
  scaleMidis: number[],
  sound: VoiceParams['sound'],
  hm: HandMap,
  ctrl: Control,
  faceMod: FaceMod,
): VoiceParams {
  if (!feat.present || ctrl.mute) {
    return { id, present: false, freq: midiToFreq(scaleMidis[0] ?? 60), gain: 0, sound, brightness: 1, vibrato: 0, pan: 0 };
  }
  // Note source: the index fingertip (classic) or the steadier wrist. The chosen
  // position drives pitch (x) and volume (y); the fingers are then free for effects.
  const px = hm.positionSource === 'wrist' ? feat.wristX : feat.x;
  const py = hm.positionSource === 'wrist' ? feat.wristY : feat.y;

  // Finger→effect routing (averaged per shared target — the "combined spread").
  const fx = fingerEffects(feat.fingers, hm.fingers);

  // Pitch: scale-snapped position, plus keyboard octave shift, plus finger octave
  // and pitch-bend contributions folded into the note.
  const midi =
    magneticPitch(px, scaleMidis, ctrl.magnetism) +
    ctrl.octaveShift * 12 +
    fx.octave * 12 +
    fx.pitchBend * BEND_SEMITONES;
  const freq = midiToFreq(midi);

  let gain = (1 - py) * hm.maxGain;
  if (hm.opennessGatesGain) gain *= feat.openness;
  gain *= fx.gate; // finger gate (1 when no finger routes to gate)

  // Openness shapes brightness: closed hand stays mellow (0.3) but never fully
  // muffled; open hand is fully present (1.0). Off → neutral (fully open). A smile
  // (face) and any finger→brightness routing brighten further.
  const baseBright = hm.opennessControlsBrightness ? 0.3 + 0.7 * feat.openness : 1;
  const brightness = clamp01(baseBright + faceMod.brightness + fx.brightness);
  // Pinch adds vibrato (0 = none .. 1 = full wobble); an open mouth / finger add more.
  const baseVib = hm.pinchControlsVibrato ? clamp01(feat.pinch) : 0;
  const vibrato = clamp01(baseVib + faceMod.vibrato + fx.vibrato);
  // Hand x places the voice in stereo; a finger→pan routing pushes it further.
  const basePan = hm.panByPosition ? clampPan((px - 0.5) * 2 * hm.panSpread) : 0;
  const pan = clampPan(basePan + fx.pan);
  return { id, present: true, freq, gain, sound, brightness, vibrato, pan };
}

export const voiceMappingNode = defineNode<Params>({
  type: 'voice-mapping',
  roles: ['mapping'],
  title: 'Voice Mapping',
  description: 'Hand features → tonal synth parameters (x→pitch w/ scale snap, y→volume).',
  // The reference implementation of the mapping slot: declares exactly the
  // shared input/output contract (src/nodes/mapping/mapping_contract.ts), so any
  // future hand-features→synth-params mapping is an edge-stable drop-in.
  inputs: [...MAPPING_SLOT_INPUTS],
  outputs: [MAPPING_SLOT_OUTPUT],
  params: Params,
  process(inputs, p, ctx) {
    const f = (inputs.features as HandFeatures | undefined) ?? {
      left: { ...ABSENT_HAND },
      right: { ...ABSENT_HAND },
    };
    // Live control store: the face mode (to suppress timbre in chord mode) and the
    // hand map (note source + finger→effect routing + the once-static knobs).
    const controls = (
      ctx?.resources?.controls as (() => { faceMapping?: string; handMap?: HandMap }) | undefined
    )?.();
    const hm = resolveHandMap(controls?.handMap, p);
    const ctrl: Control = {
      magnetism: typeof inputs.magnetism === 'number' ? inputs.magnetism : hm.magnetism,
      octaveShift: typeof inputs.octaveShift === 'number' ? inputs.octaveShift : 0,
      mute: inputs.mute === true,
    };
    const isNumArr = (v: unknown): v is number[] => Array.isArray(v) && v.every((n) => typeof n === 'number');
    const rightScale = isNumArr(inputs.scaleRight)
      ? inputs.scaleRight
      : generateScale({ ...p.right.scale, type: p.right.scale.type as ScaleTypeId });
    const leftScale = isNumArr(inputs.scaleLeft)
      ? inputs.scaleLeft
      : generateScale({ ...p.left.scale, type: p.left.scale.type as ScaleTypeId });

    const instR = ((SOUND_IDS as string[]).includes(inputs.soundRight as string)
      ? (inputs.soundRight as VoiceParams['sound'])
      : p.right.sound);
    const instL = ((SOUND_IDS as string[]).includes(inputs.soundLeft as string)
      ? (inputs.soundLeft as VoiceParams['sound'])
      : p.left.sound);

    // Face expression is global (one face modulates both hands). The face→timbre
    // mapping only applies in the 'timbre' face mode: in 'chord' mode the face
    // drives chords instead (via `expression-chord`), so suppress timbre here.
    // The mode is read live from the control store; when it is absent (pure
    // headless tests, or a host that predates the chooser) timbre applies as
    // before — preserving the original face→brightness behaviour.
    const faceMapping = controls?.faceMapping;
    const timbreMode = faceMapping === undefined || faceMapping === 'timbre';
    const face = inputs.face as FaceFeatures | undefined;
    const faceMod: FaceMod =
      timbreMode && p.faceControlsExpression && face?.present
        ? {
            brightness: clamp01(face.smile) * FACE_SMILE_BRIGHTNESS,
            vibrato: clamp01(face.mouthOpen) * FACE_MOUTH_VIBRATO,
          }
        : NO_FACE_MOD;

    const voices: VoiceParams[] = [
      voiceFor(0, f.right, rightScale, instR, hm, ctrl, faceMod),
      voiceFor(1, f.left, leftScale, instL, hm, ctrl, faceMod),
    ];
    const out: SynthParams = { voices };
    return { params: out };
  },
});
