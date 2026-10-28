/**
 * The physics of a real theremin, as pure functions over a tracked hand (the model section of
 * `docs/research/theremin-physics.md`; the equations there are the ones written here).
 *
 * A theremin's pitch antenna is one plate of a capacitor whose other plate is the player's hand
 * (grounded through the body). That capacitance sits in the LC tank of a radio-frequency
 * oscillator, whose frequency `1 / (2 pi sqrt(L C))` therefore drops as the hand comes closer; a
 * fixed oscillator tuned to the same frequency is mixed with it, and the difference (the beat)
 * is the audible pitch. The volume loop is a second capacitor in a tuned circuit: the nearer the
 * left hand, the further that circuit is detuned from resonance, and the quieter the sound.
 *
 * Why the SHAPE of the hand plays, not only its position: the hand's capacitance to the antenna
 * is a sum over the parts of the hand, each weighted by its area over its distance. Opening a
 * finger adds its area (a curled finger lies folded on the palm, shielded by it) and, when it
 * points at the antenna, brings that area closer: the pitch rises. That is Clara Rockmore's
 * "aerial fingering", and it falls out of {@link handCapacitance} rather than being added to it.
 *
 * Units: metres, farads, hertz. Landmarks: MediaPipe's 21 points; the world landmarks (metres)
 * give the hand's own scale, the image landmarks its place in the frame.
 */
import type { Hand, HandsFrame, Keypoint } from '@thoremin/sdk/nodes/domain';

/** The vacuum permittivity, F/m. */
export const EPS0 = 8.854e-12;

/** A part of the hand, as a capacitor plate: its area (m^2) and its distance to the electrode (m). */
export interface Plate {
  area: number;
  distance: number;
}

/** A straight electrode in the DISPLAYED (mirrored) frame, as fractions of its width and height. */
export interface Segment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The finger chains, base to tip (MediaPipe indices); the thumb from its CMC joint. */
const FINGERS = {
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
} as const;
export type FingerId = keyof typeof FINGERS;
export const FINGER_IDS = Object.keys(FINGERS) as FingerId[];

/** The palm: the wrist and the four finger bases. */
const PALM = [0, 5, 9, 13, 17] as const;

/** The hand's areas, m^2, one side of an adult hand (palm about 80 cm^2, the fingers 6 to 18). */
export interface HandAreas {
  palm: number;
  fingers: Record<FingerId, number>;
}

export const DEFAULT_HAND_AREAS: HandAreas = {
  palm: 0.008,
  fingers: { thumb: 0.0014, index: 0.0016, middle: 0.0018, ring: 0.0016, pinky: 0.0011 },
};

/** The options of {@link handPlates}. */
export interface PlateOptions {
  /** Whether the display mirrors the camera frame (the webcam view does). */
  mirror: boolean;
  /** The antenna's distance out of the hand's plane, m: a virtual antenna has no depth, so the hand
   *  never touches it, and the near field stays finite (the real hand's closest approach). */
  standoff: number;
  /** How much of a palm seen edge-on still couples (fringing), 0..1. */
  edgeCoupling: number;
  /** How much of a curled finger still couples, folded on the palm, 0..1. */
  curledCoupling: number;
  /** The palm length (wrist to middle-finger base) assumed without world landmarks, m. */
  palmLength: number;
  areas: HandAreas;
}

export const DEFAULT_PLATE_OPTIONS: PlateOptions = {
  mirror: true,
  standoff: 0.03,
  edgeCoupling: 0.4,
  curledCoupling: 0.3,
  palmLength: 0.09,
  areas: DEFAULT_HAND_AREAS,
};

type V3 = { x: number; y: number; z: number };
const v3 = (k: Keypoint, zScale = 1): V3 => ({ x: k.x, y: k.y, z: (k.z ?? 0) * zScale });
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (a: V3): number => Math.hypot(a.x, a.y, a.z);
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const mean = (ps: V3[]): V3 => ({
  x: ps.reduce((s, p) => s + p.x, 0) / ps.length,
  y: ps.reduce((s, p) => s + p.y, 0) / ps.length,
  z: ps.reduce((s, p) => s + p.z, 0) / ps.length,
});
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The landmarks that measure the hand's own shape: world (metres) when present, else the image
 *  points with MediaPipe's relative depth brought to pixel scale. */
function shapePoints(hand: Hand, frame: Pick<HandsFrame, 'width'>): V3[] {
  if (hand.worldKeypoints && hand.worldKeypoints.length >= 21) return hand.worldKeypoints.map((k) => v3(k));
  return hand.keypoints.map((k) => v3(k, frame.width));
}

/**
 * How extended a finger is, 0 (curled) to 1 (straight): the chain's straight span over its
 * length, mapped from 0.5 (folded) to 0.95 (straight). Scale-free, so world or image points do.
 */
export function fingerExtension(points: readonly V3[], finger: FingerId): number {
  const chain = FINGERS[finger].map((i) => points[i]);
  let path = 0;
  for (let i = 1; i < chain.length; i++) path += len(sub(chain[i], chain[i - 1]));
  if (!(path > 0)) return 0;
  const ratio = len(sub(chain[chain.length - 1], chain[0])) / path;
  return clamp01((ratio - 0.5) / 0.45);
}

/** The palm's unit normal (wrist, index base, pinky base), in the camera's axes. */
export function palmNormal(points: readonly V3[]): V3 {
  const n = cross(sub(points[5], points[0]), sub(points[17], points[0]));
  const l = len(n);
  return l > 0 ? { x: n.x / l, y: n.y / l, z: n.z / l } : { x: 0, y: 0, z: 1 };
}

/** The distance in pixels from a point to a segment given in pixels. */
function pointToSegmentPx(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? clamp01(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** A displayed-frame point to camera-frame pixels. */
function toPx(x: number, y: number, frame: Pick<HandsFrame, 'width' | 'height'>, mirror: boolean): { x: number; y: number } {
  return { x: (mirror ? 1 - x : x) * frame.width, y: y * frame.height };
}

/** Metres per image pixel at the hand: its world palm length over its image palm length. */
export function metresPerPixel(hand: Hand, palmLength: number): number {
  const k = hand.keypoints;
  const imagePalm = (Math.hypot(k[9].x - k[0].x, k[9].y - k[0].y) + Math.hypot(k[5].x - k[17].x, k[5].y - k[17].y)) / 2;
  const w = hand.worldKeypoints;
  // Without world points: the palm length assumed, its width (index to pinky base) about 0.85 of it.
  const worldPalm =
    w && w.length >= 21 ? (len(sub(v3(w[9]), v3(w[0]))) + len(sub(v3(w[5]), v3(w[17])))) / 2 : (palmLength * (1 + 0.85)) / 2;
  return imagePalm > 0 ? worldPalm / imagePalm : 0;
}

/**
 * The hand as capacitor plates facing one electrode: the palm (its area seen from the electrode,
 * `edgeCoupling` of it even edge-on) and each finger (its area times its extension, at its own
 * distance; the curled remainder at the palm's, `curledCoupling` of it). `facing` is the camera
 * axis the electrode lies along from the hand: `x` for the vertical pitch rod beside the hand,
 * `y` for the horizontal loop under it. Empty for a hand with fewer than 21 points.
 */
export function handPlates(
  hand: Hand,
  frame: Pick<HandsFrame, 'width' | 'height'>,
  electrode: Segment,
  facing: 'x' | 'y',
  opts: PlateOptions = DEFAULT_PLATE_OPTIONS,
): Plate[] {
  if (hand.keypoints.length < 21) return [];
  const scale = metresPerPixel(hand, opts.palmLength);
  if (!(scale > 0)) return [];
  const a = toPx(electrode.x0, electrode.y0, frame, opts.mirror);
  const b = toPx(electrode.x1, electrode.y1, frame, opts.mirror);
  const dist = (p: { x: number; y: number }) => Math.hypot(pointToSegmentPx(p, a, b) * scale, opts.standoff);
  const img = hand.keypoints;
  const shape = shapePoints(hand, frame);
  const n = palmNormal(shape);
  const facingCos = Math.abs(facing === 'x' ? n.x : n.y);
  const palmPx = mean(PALM.map((i) => v3(img[i])));
  const palmD = dist(palmPx);
  const plates: Plate[] = [{ area: opts.areas.palm * (opts.edgeCoupling + (1 - opts.edgeCoupling) * facingCos), distance: palmD }];
  for (const f of FINGER_IDS) {
    const e = fingerExtension(shape, f);
    const chain = FINGERS[f];
    // The finger's middle, between its second joint and its tip: where its area is.
    const mid = mean([v3(img[chain[1]]), v3(img[chain[2]]), v3(img[chain[3]])]);
    const area = opts.areas.fingers[f];
    if (e > 0) plates.push({ area: area * e, distance: dist(mid) });
    if (e < 1) plates.push({ area: area * (1 - e) * opts.curledCoupling, distance: palmD });
  }
  return plates;
}

/** The hand's capacitance to the electrode, F: `kappa eps0 sum(a_i / d_i)` (a plate model with a
 *  geometry factor). */
export function handCapacitance(plates: readonly Plate[], kappa: number): number {
  let s = 0;
  for (const p of plates) if (p.distance > 0 && p.area > 0) s += p.area / p.distance;
  return kappa * EPS0 * s;
}

/** The pitch circuit's calibration: what a real instrument's tuning knobs set. */
export interface PitchCircuit {
  /** Both oscillators' frequency with no hand near, Hz (RCA and Moog designs: 170 kHz to 1 MHz). */
  carrierHz: number;
  /** The variable oscillator's tank capacitance with no hand (antenna included), F. */
  tankC: number;
  /** The beat with no hand near, Hz: the "zero beat" the pitch knob tunes (0 = silent far away). */
  nullHz: number;
}

export const DEFAULT_PITCH_CIRCUIT: PitchCircuit = { carrierHz: 260_000, tankC: 120e-12, nullHz: 30 };

/**
 * The heterodyne beat, Hz: the fixed oscillator (`carrierHz + nullHz`) less the variable one,
 * `carrierHz / sqrt(1 + C_hand / C_tank)` (the LC frequency with the hand's capacitance added).
 * For a small `C_hand` it is about `nullHz + carrierHz * C_hand / (2 C_tank)`: the pitch is
 * proportional to the capacitance, so to one over the distance, and each octave up the hand
 * covers half the distance of the octave below (the compressed near field).
 */
export function beatFrequency(cHand: number, c: PitchCircuit = DEFAULT_PITCH_CIRCUIT): number {
  const variable = c.carrierHz / Math.sqrt(1 + Math.max(0, cHand) / c.tankC);
  return c.carrierHz + c.nullHz - variable;
}

/** Hz to fractional MIDI (69 = A4 = 440 Hz); a floor keeps a zero beat finite. */
export const hzToMidi = (hz: number): number => 69 + 12 * Math.log2(Math.max(hz, 1) / 440);
export const midiToHz = (m: number): number => 440 * 2 ** ((m - 69) / 12);

/** The capacitance a reference open hand facing the antenna has at `d` metres in the image plane
 *  (one plate of {@link DEFAULT_HAND_AREAS}' total area, at the same standoff as the plates). */
export function referenceCapacitance(d: number, kappa: number, standoff: number, areas: HandAreas = DEFAULT_HAND_AREAS): number {
  const total = areas.palm + Object.values(areas.fingers).reduce((s, a) => s + a, 0);
  return (kappa * EPS0 * total) / Math.hypot(d, standoff);
}

/** Where the linearised field is anchored: the near and far ends of the playing range, m. */
export interface LinearField {
  near: number;
  far: number;
}

export const DEFAULT_LINEAR_FIELD: LinearField = { near: 0.05, far: 0.5 };

/**
 * The pitch, fractional MIDI, from the hand's capacitance, with the field linearised by
 * `linearity` (0 = the raw LC curve). The raw curve is close to a LOG law in distance (the beat is
 * nearly proportional to `C`, so to `1 / d`: each octave down doubles the distance). A real
 * instrument straightens it with a coil in series with the antenna; here the same end is reached
 * directly: the capacitance is read back as the distance a reference hand would have (`d_eq`), and
 * the pitch taken as a power law in it, `d_eq ^ gamma` with `gamma = linearity`, between the raw
 * curve's own values at `near` and `far` (gamma 1 is equal intervals for equal distances, gamma
 * toward 0 the log law again), blended with the raw curve by the same amount so 0 is exactly raw.
 * A finger opened still raises `C`, so lowers `d_eq`: aerial fingering survives linearisation.
 */
export function pitchFromCapacitance(
  cHand: number,
  {
    circuit = DEFAULT_PITCH_CIRCUIT,
    linearity = 0,
    field = DEFAULT_LINEAR_FIELD,
    kappa = 1,
    standoff = 0,
  }: { circuit?: PitchCircuit; linearity?: number; field?: LinearField; kappa?: number; standoff?: number } = {},
): number {
  const raw = hzToMidi(beatFrequency(cHand, circuit));
  const g = clamp01(linearity);
  if (g === 0 || !(cHand > 0)) return raw;
  const top = hzToMidi(beatFrequency(referenceCapacitance(field.near, kappa, standoff), circuit));
  const bottom = hzToMidi(beatFrequency(referenceCapacitance(field.far, kappa, standoff), circuit));
  const hyp = referenceCapacitance(0, kappa, 1) / cHand;
  const dEq = Math.sqrt(Math.max(0, hyp * hyp - standoff * standoff));
  const u = (dEq ** g - field.near ** g) / (field.far ** g - field.near ** g);
  // Past the far end the curve keeps falling; it stops at the zero beat, as the raw curve does.
  const warped = Math.max(hzToMidi(circuit.nullHz), top + (bottom - top) * u);
  return (1 - g) * raw + g * warped;
}

/** The volume circuit's calibration. */
export interface VolumeCircuit {
  /** The volume oscillator's tank capacitance, F. */
  tankC: number;
  /** The tuned circuit's quality factor: how sharply a detuning silences. */
  q: number;
  /** The resonance level below which the control voltage gives silence, 0..1. */
  floor: number;
}

export const DEFAULT_VOLUME_CIRCUIT: VolumeCircuit = { tankC: 100e-12, q: 150, floor: 0.25 };

/**
 * The volume, 0..1, from the left hand's capacitance to the loop: the volume oscillator,
 * detuned by the hand (`r = 1 / sqrt(1 + C / C_tank)`), drives a circuit tuned to its free
 * frequency; the circuit's response `1 / sqrt(1 + Q^2 (r - 1/r)^2)` is rectified into the control
 * voltage, of which the part above `floor` opens the amplifier. Full with no hand, silent with
 * the hand on the loop.
 */
export function loopVolume(cHand: number, c: VolumeCircuit = DEFAULT_VOLUME_CIRCUIT): number {
  const r = 1 / Math.sqrt(1 + Math.max(0, cHand) / c.tankC);
  const h = 1 / Math.sqrt(1 + c.q * c.q * (r - 1 / r) ** 2);
  return clamp01((h - c.floor) / (1 - c.floor));
}
