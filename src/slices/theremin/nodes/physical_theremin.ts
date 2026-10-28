/**
 * `physical-theremin` node: a theremin played the way a real one is, through the physics of its
 * two antennas (`../lib/physics.ts`; the model in `docs/research/theremin-physics.md`).
 *
 * The player's right hand is a capacitor plate facing a virtual vertical rod: its capacitance, a
 * sum over the palm and the five fingers of area over distance, detunes an LC oscillator, and the
 * heterodyne beat against a fixed one is the pitch. So moving the hand plays a glide, and opening
 * or closing fingers at a fixed hand position plays the intervals of aerial fingering. The left
 * hand's capacitance to a virtual horizontal loop detunes the volume circuit: nearer is quieter.
 * Then the assistance chain (`../lib/assist.ts`): nothing at level 0.
 *
 * Output: one continuous voice (`params`, the synth's continuous path, so a glide is a glide),
 * and a `status` the overlay and the editor read. Off by default; pure and Node-safe. The pitch is
 * computed once per NEW hand frame (a repeated frame is not new motion: it would read as a held
 * hand to the vibrato detector).
 */
import { z } from 'zod';
import { defineNode } from '@thoremin/dag';
import type { NodeContext } from '@thoremin/dag';
import type { Hand, HandsFrame, SynthParams, VoiceParams } from '@thoremin/sdk/nodes/domain';
import { labelFor } from '@thoremin/sdk/nodes/player_hands';
import { DEFAULT_PHYSICAL_THEREMIN, PhysicalThereminSchema, type PhysicalThereminSettings } from '../schema';
import {
  DEFAULT_HAND_AREAS,
  DEFAULT_PLATE_OPTIONS,
  handCapacitance,
  handPlates,
  loopVolume,
  midiToHz,
  pitchFromCapacitance,
  type Plate,
  type PlateOptions,
  type Segment,
} from '../lib/physics';
import { createAssistChain, effectiveAssist } from '../lib/assist';

/** The voice id: past the hands (0-1), the chords (2-10), any score (11 + n), the air flute (1e6),
 *  the ASL chords (2e6), the categorizer chords (3e6), the chord map (4e6), wheel (5e6) and chart
 *  (6e6); `test/app_graph.test.ts` keeps the blocks disjoint. */
export const PHYSICAL_THEREMIN_VOICE_ID = 7_000_000;

/** The sounding range, Hz: the beat is clamped to what a synth voice plays. */
const MIN_HZ = 20;
const MAX_HZ = 8000;
/** How long a lost pitch hand keeps its last pitch, s: a real hand never vanishes, so a tracker
 *  dropout of a few frames must not cut the note (or restart the assistance's smoothing). */
export const DROPOUT_HOLD_S = 0.3;

/** What the overlay and the editor read. */
export interface PhysicalThereminStatus {
  enabled: boolean;
  /** Whether the pitch (right) and volume (left) hands are in view. */
  pitchHand: boolean;
  volumeHand: boolean;
  /** The pitch hand's capacitance to the rod and the volume hand's to the loop, pF. */
  pitchPf: number;
  loopPf: number;
  /** The raw heterodyne pitch and the assisted one, fractional MIDI; the sounding Hz. */
  rawMidi: number | null;
  midi: number | null;
  hz: number | null;
  /** The volume, 0..1, before the master volume. */
  volume: number;
  /** How sure the vibrato detector is, 0..1, and the note the correction pulls toward. */
  vibrato: number;
  target: number | null;
  /** The plate nearest each electrode, in DISPLAYED fractions, for the field line on the video. */
  pitchPoint: { x: number; y: number } | null;
  loopPoint: { x: number; y: number } | null;
  sounding: boolean;
}

export const IDLE_PHYSICAL_THEREMIN_STATUS: PhysicalThereminStatus = {
  enabled: false,
  pitchHand: false,
  volumeHand: false,
  pitchPf: 0,
  loopPf: 0,
  rawMidi: null,
  midi: null,
  hz: null,
  volume: 0,
  vibrato: 0,
  target: null,
  pitchPoint: null,
  loopPoint: null,
  sounding: false,
};

/** The pitch rod and the volume loop as segments. */
export const pitchRod = (s: PhysicalThereminSettings): Segment => ({ x0: s.pitchAntenna.x, y0: s.pitchAntenna.top, x1: s.pitchAntenna.x, y1: s.pitchAntenna.bottom });
export const volumeLoop = (s: PhysicalThereminSettings): Segment => ({ x0: s.volumeLoop.left, y0: s.volumeLoop.y, x1: s.volumeLoop.right, y1: s.volumeLoop.y });

const plateOptions = (s: PhysicalThereminSettings, mirror: boolean): PlateOptions => ({
  ...DEFAULT_PLATE_OPTIONS,
  mirror,
  standoff: s.pitch.standoffCm / 100,
  areas: DEFAULT_HAND_AREAS,
});

/** The pitch, fractional MIDI, and the capacitance, F, of a right hand (the raw physics). */
export function rawPitchOf(hand: Hand, frame: HandsFrame, s: PhysicalThereminSettings, mirror = true): { midi: number; capacitance: number; plates: Plate[] } {
  const plates = handPlates(hand, frame, pitchRod(s), 'x', plateOptions(s, mirror));
  const capacitance = handCapacitance(plates, s.pitch.sensitivity);
  const midi = pitchFromCapacitance(capacitance, {
    circuit: { carrierHz: s.pitch.carrierKHz * 1000, tankC: s.pitch.tankPf * 1e-12, nullHz: s.pitch.nullHz },
    linearity: s.pitch.linearity,
    kappa: s.pitch.sensitivity,
    standoff: s.pitch.standoffCm / 100,
  });
  return { midi, capacitance, plates };
}

/** The volume, 0..1, and the capacitance, F, of a left hand over the loop. */
export function volumeOf(hand: Hand, frame: HandsFrame, s: PhysicalThereminSettings, mirror = true): { volume: number; capacitance: number } {
  const plates = handPlates(hand, frame, volumeLoop(s), 'y', plateOptions(s, mirror));
  // The loop shares the pitch antenna's coupling factor: one hand, one geometry.
  const capacitance = handCapacitance(plates, s.pitch.sensitivity);
  return { volume: loopVolume(capacitance, { tankC: s.loop.tankPf * 1e-12, q: s.loop.q, floor: s.loop.floor }), capacitance };
}

/** The point of a hand nearest an electrode, as displayed fractions (the field line's end). */
function nearestPoint(hand: Hand, frame: HandsFrame, seg: Segment, mirror: boolean): { x: number; y: number } {
  let best = { x: 0, y: 0 };
  let bestD = Infinity;
  for (const k of hand.keypoints) {
    const x = mirror ? 1 - k.x / frame.width : k.x / frame.width;
    const y = k.y / frame.height;
    const d = seg.x0 === seg.x1 ? Math.abs(x - seg.x0) : Math.abs(y - seg.y0);
    if (d < bestD) {
      bestD = d;
      best = { x, y };
    }
  }
  return best;
}

const silentVoice = (sound: VoiceParams['sound']): VoiceParams => ({ id: PHYSICAL_THEREMIN_VOICE_ID, present: false, freq: 440, gain: 0, sound });

/** The settings a config input carries, over the defaults (a partial or a bad value falls back). */
function resolveSettings(raw: unknown): PhysicalThereminSettings {
  const parsed = PhysicalThereminSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_PHYSICAL_THEREMIN;
}

/** No static params: everything is the dial, delivered live on `config`. */
const Params = z.object({});

export const physicalThereminNode = defineNode<z.infer<typeof Params>>({
  type: 'physical-theremin',
  roles: ['feature', 'mapping'],
  title: 'Physical theremin',
  description:
    "A theremin played through its physics: the right hand's capacitance to a virtual pitch rod (palm and fingers, area over distance) detunes an LC oscillator and the heterodyne beat is the pitch, so finger openings play intervals (aerial fingering); the left hand over a virtual loop sets the volume; an assistance level adds pitch correction, smoothing and a vibrato aid. Off by default.",
  inputs: [
    { name: 'hands', kind: 'hands-frame' },
    { name: 'config', kind: 'physical-theremin-config' },
    { name: 'scale', kind: 'number[]' },
    { name: 'octaveShift', kind: 'number' },
  ],
  outputs: [
    { name: 'params', kind: 'synth-params' },
    { name: 'status', kind: 'physical-theremin-status' },
  ],
  params: Params,
  make() {
    let lastConfigRef: unknown = Symbol('none');
    let s: PhysicalThereminSettings = DEFAULT_PHYSICAL_THEREMIN;
    let lastFrame: HandsFrame | undefined;
    let lastT: number | null = null;
    let lastPitchSeen = -Infinity;
    const chain = createAssistChain();
    let status: PhysicalThereminStatus = { ...IDLE_PHYSICAL_THEREMIN_STATUS };
    let voice: VoiceParams = silentVoice(s.sound);

    const reset = () => {
      chain.reset();
      lastFrame = undefined;
      lastT = null;
      lastPitchSeen = -Infinity;
      status = { ...IDLE_PHYSICAL_THEREMIN_STATUS };
    };

    return {
      process(inputs, ctx: NodeContext) {
        if (inputs.config !== lastConfigRef) {
          lastConfigRef = inputs.config;
          s = resolveSettings(inputs.config);
        }
        if (!s.enabled) {
          if (status.enabled) reset();
          // The silent voice, not an empty list: the synth fades only a voice it SEES absent.
          return { params: { voices: [silentVoice(s.sound)] } satisfies SynthParams, status };
        }
        const frame = inputs.hands as HandsFrame | undefined;
        const repeated = !frame || frame === lastFrame || (frame.t !== undefined && lastFrame?.t !== undefined && frame.t === lastFrame.t);
        if (!repeated) {
          const t = typeof frame.t === 'number' ? frame.t : ctx.time;
          const dt = lastT === null ? 1 / 30 : t - lastT;
          lastT = t;
          lastFrame = frame;
          const mirror = s.mirrorHandedness;
          const right = frame.hands.find((h) => h.handedness === labelFor('right', mirror) && h.keypoints.length >= 21);
          const left = frame.hands.find((h) => h.handedness === labelFor('left', mirror) && h.keypoints.length >= 21);
          const shift = typeof inputs.octaveShift === 'number' && Number.isFinite(inputs.octaveShift) ? Math.round(inputs.octaveShift) : 0;
          const scale = Array.isArray(inputs.scale) ? (inputs.scale as number[]).map((m) => ((Math.round(m) % 12) + 12) % 12) : [];
          let next: PhysicalThereminStatus = { ...IDLE_PHYSICAL_THEREMIN_STATUS, enabled: true };
          const vol = left ? volumeOf(left, frame, s, mirror) : null;
          const volume = vol ? vol.volume : s.loop.leftAbsent === 'full' ? 1 : 0;
          next = {
            ...next,
            volumeHand: !!left,
            volume,
            loopPf: vol ? vol.capacitance * 1e12 : 0,
            loopPoint: left ? nearestPoint(left, frame, volumeLoop(s), mirror) : null,
          };
          if (right) lastPitchSeen = t;
          if (right) {
            const raw = rawPitchOf(right, frame, s, mirror);
            const reading = chain.step(raw.midi, dt, effectiveAssist(s.assist), [...new Set(scale)]);
            const hz = Math.min(MAX_HZ, Math.max(MIN_HZ, midiToHz(reading.pitch + 12 * shift)));
            const gain = s.volume * volume;
            next = {
              ...next,
              pitchHand: true,
              pitchPf: raw.capacitance * 1e12,
              rawMidi: raw.midi,
              midi: reading.pitch,
              hz,
              vibrato: reading.vibrato,
              target: reading.target,
              pitchPoint: nearestPoint(right, frame, pitchRod(s), mirror),
              sounding: gain > 0,
            };
            voice = { id: PHYSICAL_THEREMIN_VOICE_ID, present: true, freq: hz, gain, sound: s.sound, brightness: 1, vibrato: 0, pan: 0 };
          } else if (t - lastPitchSeen <= DROPOUT_HOLD_S && voice.present) {
            // A dropout: the last pitch and status hold, the volume still follows the left hand.
            voice = { ...voice, gain: s.volume * volume };
            next = { ...status, ...next, pitchHand: status.pitchHand, rawMidi: status.rawMidi, midi: status.midi, hz: status.hz, pitchPf: status.pitchPf, pitchPoint: status.pitchPoint, vibrato: status.vibrato, target: status.target, sounding: voice.gain > 0 };
          } else {
            // No pitch hand: no sound (a camera has no far field to drone in), and the chain
            // starts over when the hand returns.
            chain.reset();
            voice = silentVoice(s.sound);
          }
          status = next;
        }
        if (!frame) voice = silentVoice(s.sound);
        return { params: { voices: [voice] } satisfies SynthParams, status };
      },
      dispose() {
        reset();
      },
    };
  },
});
