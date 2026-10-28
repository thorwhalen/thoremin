/**
 * The physical theremin's dial (`physicalTheremin`): where the two virtual antennas stand, the
 * circuits' calibration (what a real instrument's tuning knobs set), the sound, and the
 * assistance. One object, as a new extension's dial is (`docs/design/vertical-slices.md`, the two
 * dial shapes); every leaf is a scalar, so each is a command path (`physicalTheremin.assist.level`).
 *
 * Positions are fractions of the DISPLAYED (mirrored) frame, as the air drum's pads are: the pitch
 * antenna stands on the player's right, the volume loop lies under the left hand.
 */
import { z } from 'zod';
import { SoundSchema } from '@thoremin/sdk/music/sounds';
import { SNAP_SCALES } from './lib/assist';

const frac = (d: number) => z.number().min(0).max(1).default(d);

export const LEFT_ABSENT = ['full', 'silent'] as const;

export const PitchAntennaSchema = z.object({
  /** Where the vertical rod stands, across the displayed frame. */
  x: frac(0.88),
  /** Its top and bottom ends, down the frame. */
  top: frac(0.08),
  bottom: frac(0.95),
});

export const VolumeLoopSchema = z.object({
  /** The horizontal loop's height, down the frame. */
  y: frac(0.85),
  /** Its two ends, across the displayed frame. */
  left: frac(0.04),
  right: frac(0.42),
});

export const PitchCircuitSchema = z.object({
  /** Both oscillators' frequency with no hand near, kHz (RCA and Moog: 170 kHz to 1 MHz). */
  carrierKHz: z.number().min(50).max(1000).default(260),
  /** The variable oscillator's tank capacitance, antenna included, pF: the larger, the narrower
   *  the pitch range a hand sweeps. */
  tankPf: z.number().min(10).max(1000).default(120),
  /** The beat with no hand near (the zero beat), Hz. */
  nullHz: z.number().min(0).max(200).default(30),
  /** The coupling of the hand to the antenna (a geometry factor on the plate model): the pitch
   *  antenna's sensitivity. */
  sensitivity: z.number().min(0.1).max(10).default(1),
  /** 0 = the raw LC curve (the octaves crowd near the antenna); 1 = equal intervals for equal
   *  distances (what a modern instrument's series coil approaches). */
  linearity: frac(0.6),
  /** The hand's closest approach to the antenna, cm: a virtual rod has no depth. */
  standoffCm: z.number().min(0.5).max(20).default(3),
});

export const VolumeCircuitSchema = z.object({
  /** The volume oscillator's tank capacitance, pF. */
  tankPf: z.number().min(10).max(1000).default(100),
  /** How sharply a detuning silences: the tuned circuit's Q. */
  q: z.number().min(5).max(1000).default(150),
  /** The resonance level under which the sound is silent, 0..1. */
  floor: z.number().min(0).max(0.95).default(0.25),
  /** With the left hand out of view: full volume (a real loop with no hand near) or silent. */
  leftAbsent: z.enum(LEFT_ABSENT).default('full'),
});

export const AssistSchema = z.object({
  /** 0 = a pure theremin (no correction at all); up to 1. */
  level: frac(0.25),
  /** True once the player tuned a stage: the stages below are used, not the level's defaults. */
  custom: z.boolean().default(false),
  snap: z.enum(SNAP_SCALES).default('chromatic'),
  correction: frac(0.25),
  smoothing: frac(0.2),
  vibratoAid: frac(0.25),
});

export const PhysicalThereminSchema = z.object({
  /** Off by default: a player who never chooses the physical theremin hears nothing new. */
  enabled: z.boolean().default(false),
  sound: SoundSchema.default('sine'),
  /** Loudness at full volume, 0..1. */
  volume: frac(0.6),
  pitchAntenna: PitchAntennaSchema.default(PitchAntennaSchema.parse({})),
  volumeLoop: VolumeLoopSchema.default(VolumeLoopSchema.parse({})),
  pitch: PitchCircuitSchema.default(PitchCircuitSchema.parse({})),
  loop: VolumeCircuitSchema.default(VolumeCircuitSchema.parse({})),
  assist: AssistSchema.default(AssistSchema.parse({})),
  /** The antennas (and the field lines to the hands) on the video. */
  antennasOnVideo: z.object({ show: z.boolean().default(true) }).default({ show: true }),
  /** The note, cents and hertz beside the pitch antenna. */
  readout: z.object({ show: z.boolean().default(true) }).default({ show: true }),
  /** The mirrored webcam reports the opposite hand label. Off for a third-person video. */
  mirrorHandedness: z.boolean().default(true),
});
export type PhysicalThereminSettings = z.infer<typeof PhysicalThereminSchema>;
export const DEFAULT_PHYSICAL_THEREMIN: PhysicalThereminSettings = PhysicalThereminSchema.parse({});
