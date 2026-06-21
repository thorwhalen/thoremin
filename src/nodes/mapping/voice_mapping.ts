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
  type ScaleTypeId,
} from '@/music/theory';
import { InstrumentSchema, INSTRUMENT_IDS } from '@/music/instruments';
import { ABSENT_HAND, type HandFeatures, type SynthParams, type VoiceParams } from '../domain';

const ScaleParams = z.object({
  root: z.number().int().min(0).max(11).default(0),
  type: z
    .enum(['major', 'minor', 'pentatonic', 'minorPentatonic', 'minorHarmonic', 'blues', 'chromatic'])
    .default('major'),
  octaves: z.number().int().min(1).max(4).default(2),
  baseOctave: z.number().int().min(0).max(7).default(3),
});

const Instrument = InstrumentSchema;

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
  right: z.object({ scale: ScaleParams, instrument: Instrument.default('sine') }).default({
    scale: ScaleParams.parse({}),
    instrument: 'sine',
  }),
  left: z.object({ scale: ScaleParams, instrument: Instrument.default('triangle') }).default({
    scale: ScaleParams.parse({}),
    instrument: 'triangle',
  }),
});
type Params = z.infer<typeof Params>;

/** Live control overrides fed via input ports (override static params). */
interface Control {
  magnetism: number;
  octaveShift: number;
  mute: boolean;
}

function voiceFor(
  id: number,
  feat: typeof ABSENT_HAND,
  scaleMidis: number[],
  instrument: VoiceParams['instrument'],
  p: Params,
  ctrl: Control,
): VoiceParams {
  if (!feat.present || ctrl.mute) {
    return { id, present: false, freq: midiToFreq(scaleMidis[0] ?? 60), gain: 0, instrument, brightness: 1, vibrato: 0 };
  }
  const midi = magneticPitch(feat.x, scaleMidis, ctrl.magnetism) + ctrl.octaveShift * 12;
  const freq = midiToFreq(midi);
  let gain = (1 - feat.y) * p.maxGain;
  if (p.opennessGatesGain) gain *= feat.openness;
  // Openness shapes brightness: closed hand stays mellow (0.3) but never fully
  // muffled; open hand is fully present (1.0). Off → neutral (fully open).
  const brightness = p.opennessControlsBrightness ? 0.3 + 0.7 * feat.openness : 1;
  // Pinch adds vibrato (0 = none .. 1 = full wobble). Off → none.
  const vibrato = p.pinchControlsVibrato ? Math.max(0, Math.min(1, feat.pinch)) : 0;
  return { id, present: true, freq, gain, instrument, brightness, vibrato };
}

export const voiceMappingNode = defineNode<Params>({
  type: 'voice-mapping',
  title: 'Voice Mapping',
  description: 'Hand features → tonal synth parameters (x→pitch w/ scale snap, y→volume).',
  inputs: [
    { name: 'features', kind: 'hand-features' },
    // Optional live control. When unconnected, the static params are used.
    { name: 'magnetism', kind: 'number', description: 'Override magnetism 0..1' },
    { name: 'octaveShift', kind: 'number', default: 0, description: 'Transpose by N octaves' },
    { name: 'mute', kind: 'boolean', default: false },
    // Optional live scale override (list of MIDI notes). Lets the UI change
    // scale/key without rebuilding the graph or reloading the ML model.
    { name: 'scaleRight', kind: 'number[]' },
    { name: 'scaleLeft', kind: 'number[]' },
    { name: 'instrumentRight', kind: 'instrument' },
    { name: 'instrumentLeft', kind: 'instrument' },
  ],
  outputs: [{ name: 'params', kind: 'synth-params' }],
  params: Params,
  process(inputs, p) {
    const f = (inputs.features as HandFeatures | undefined) ?? {
      left: { ...ABSENT_HAND },
      right: { ...ABSENT_HAND },
    };
    const ctrl: Control = {
      magnetism: typeof inputs.magnetism === 'number' ? inputs.magnetism : p.magnetism,
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

    const instR = ((INSTRUMENT_IDS as string[]).includes(inputs.instrumentRight as string)
      ? (inputs.instrumentRight as VoiceParams['instrument'])
      : p.right.instrument);
    const instL = ((INSTRUMENT_IDS as string[]).includes(inputs.instrumentLeft as string)
      ? (inputs.instrumentLeft as VoiceParams['instrument'])
      : p.left.instrument);

    const voices: VoiceParams[] = [
      voiceFor(0, f.right, rightScale, instR, p, ctrl),
      voiceFor(1, f.left, leftScale, instL, p, ctrl),
    ];
    const out: SynthParams = { voices };
    return { params: out };
  },
});
