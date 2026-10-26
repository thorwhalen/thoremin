/**
 * `chord-map` node — play a key's chords by pointing at them: the seven diatonic chords laid
 * out on the screen (`../lib/chord_map.ts`: by default the hexagonal harmonic map of Pur
 * Pasteur's "Motion Capture Harmonic Map", whose three axes are moves by a fourth, a third
 * and a second), the chord hand choosing the chord it is over. The research and the design
 * are `docs/research/chord-layouts.md`.
 *
 * Two ways to sound the chord (`play`):
 *
 * - `hold` (the video's tool): the chord sounds while the chord hand is over it, voiced and
 *   rendered by the SDK's chord renderer with the instrument's chord settings (the face
 *   chords' sound, voicing and rendering: sustained, arpeggios, a pulse), so it sounds like
 *   every other chord thoremin plays. The other hand plays a melody on the chord's tones: its
 *   height over a ladder of them (from an octave above the chord's register), a continuous voice.
 * - `strum`: the other hand strums, and the chord under the chord hand at the moment the
 *   strum is decided is strummed as a guitarist voices it, on its strum sink (`chord-strum-out`, the
 *   SDK's plucked-string sink). The decision is the air guitar's (`@thoremin/sdk/gesture/strum`): predicted before the frame that shows it, committed with
 *   the lead the output needs plus the frame's age, late strums sounded at once and softer.
 *
 * A cell is chosen with hysteresis (a new cell's centre must be nearer than the sounding one's
 * by a margin) and a dwell of a few camera frames, and kept a moment after the hand leaves the
 * grid or is lost, so tracking jitter at a border never flickers the harmony. The grid, the
 * melody ladder and the moves around the sounding chord are drawn by the harmony slice's own
 * overlay element (`harmonic-layers/chordMap`), from the `grid` output.
 *
 * A MIDI keyboard can choose the chord instead of the pointing hand (`follow` = `midi`, H8 of
 * #613, "MIDI chooses, the camera performs"): the chord the keys hold, in any inversion and after
 * a short dwell, lights its cell; the hands then play the melody over it or strum it (a chord
 * outside the key is strummed by its name and named in the status). So can a signed letter
 * (`follow` = `signs`, ASL's reading on the `signs` input): a letter A..G held a moment lights the
 * chord of the key spelled on it (the ASL chords' rule, `letterDegree`: in D major F is F#m), the
 * harmony stays while other shapes pass, and the other hand plays the melody over it or strums it.
 *
 * It keeps time with the Chord sound's tempo or with the loaded song (`clock`, H9 of #613): the
 * arpeggio steps on the song's beats, and with `commit` = `beat` a held change waits for the
 * next beat (a change made just after one takes it), so the harmony moves where the music does
 * rather than when the camera frame arrived (#610 item 3).
 *
 * The face can colour it (`face`, H7 of #613, `docs/design/harmonic-layers.md` §5.4): valence
 * (a smile against a furrowed brow) moves the key to its parallel major or minor after a dwell,
 * so a passing smile does not modulate, and arousal (an open mouth, raised brows) adds the key's
 * tensions to the chord (the seventh, then the ninth), never choosing it: the hands choose.
 *
 * Off by default; pure and Node-safe.
 */
import { z } from 'zod';
import { defineNode } from '@thoremin/dag';
import type { NodeContext } from '@thoremin/dag';
import { createChordRenderer } from '@thoremin/sdk/music/chord_render';
import { createChordFollower, type ChordFollower } from '@thoremin/sdk/harmony/chord_in';
import { CLOCKS, createBeatQuantizer, createClockReader, type BeatSource } from '@thoremin/sdk/harmony/clock';
import { chordName, diatonicChords as keyChords, keyOf, pitchClasses, type Chord } from '@thoremin/sdk/harmony/chord';
import { arousalOf, createLevelTracker, createRestBaseline, parallelSpec, valenceOf, VALENCE_LEVELS, type LevelTracker } from '@thoremin/sdk/harmony/affect';
import { letterChordSpec, letterDegree, midiToFreq, midiToName, keyName, NOTE_LETTERS, type NoteLetter, type ScaleSpec } from '@thoremin/sdk/music/theory';
import { SoundSchema } from '@thoremin/sdk/music/sounds';
import { RENDERINGS, VOICINGS, type RenderingId, type VoicingId } from '@thoremin/sdk/music/voicing';
import { LM, type CategoryScores, type FaceFeatures, type Hand, type HandsFrame, type SynthParams, type VoiceParams } from '@thoremin/sdk/nodes/domain';
import { EMPTY_CELL_GRID, type CellGrid } from '@thoremin/sdk/nodes/cell_grid';
import { captureTime } from '@thoremin/sdk/timing/tracker';
import {
  CHORD_MAP_ANCHORS,
  CHORD_MAP_LAYOUTS,
  LAYOUTS,
  keyedCells,
  scaleChords,
  hasOwnChords,
  DEGREES,
  letterChordNames,
  chordMapGrid,
  nearestOfDegree,
  createCellTracker,
  createBandGate,
  handTilt,
  diatonicChords,
  ladderBand,
  layoutCells,
  melodyNotesFor,
  MELODY_SETS,
  setForTilt,
  type MelodySet,
  type CellChoice,
  type CellTracker,
  type DiatonicChord,
  type MapCell,
  type Region,
} from '../lib/chord_map';
import { createStrumDetector, type StrumDetector } from '@thoremin/sdk/gesture/strum';
import { heardChordTones, samePitchClasses, strummable } from '../lib/heard_chord';
import type { RatingsTable } from '@thoremin/sdk/harmony/ratings';
import { createPathFollower, type IdiomStatus } from '../lib/map_paths';
import { CAPTION_SET_IDS } from '@thoremin/sdk/harmony/captions';
import { IDIOM_IDS } from '@thoremin/sdk/harmony/idioms';
import type { MidiHeld } from '../lib/midi_held';
import type { AudioHeard } from '../lib/audio_heard';
import { CHROMA_QUALITIES, matchChord } from '@thoremin/sdk/harmony/chroma';
import { NoteEventsSchema, type NoteEvent } from '@thoremin/sdk/nodes/note_events';
import { PLAYER_HANDS, labelFor, type PlayerHand } from '@thoremin/sdk/nodes/player_hands';
import { LATE_VELOCITY, strumNotes } from '@thoremin/sdk/gesture/strum';

export const CHORD_MAP_PLAY = ['hold', 'strum'] as const;
export type ChordMapPlay = (typeof CHORD_MAP_PLAY)[number];
export { handTilt };
export const CHORD_MAP_POINTS = ['palm', 'indexTip'] as const;
/** The melody hand's note choice: a set (`MELODY_SETS`), or the hand's tilt choosing one. */
export const MELODY_NOTES = [...MELODY_SETS, 'tilt'] as const;
export const STRUM_MAP_POINTS = ['wrist', 'indexTip'] as const;

/** The chord's voices: a block of their own, far from the hand voices, the score (from 11),
 *  the air flute (1_000_000), ASL's chords (2_000_000) and the categorizer chords (3_000_000). */
export const CHORD_MAP_VOICE_ID_BASE = 4_000_000;
/** The largest voicing is five notes (the open voicing of a seventh chord). */
export const MAX_CHORD_MAP_VOICES = 5;
/** The melody hand's voice, in the same block. */
export const CHORD_MAP_MELODY_VOICE_ID = CHORD_MAP_VOICE_ID_BASE + 100;

/** The grid and the ladder keep this far from the frame's top and bottom (the shell's bars). */
const REGION_TOP = 0.1;
const REGION_BOTTOM = 0.9;
/** The face's valence levels: below -0.3 the darker parallel, above 0.3 the brighter, crossed by
 *  0.08 (a held smile on the face fixture reads 0.9, a resting face about 0). */
const VALENCE_EDGES = [-0.3, 0.3] as const;
const VALENCE_MARGIN = 0.08;
/** The face's arousal levels, each a tension step (the seventh, then the ninth): a closed smile
 *  reads about 0.1 on the face fixture, a resting face 0.25, an open-mouthed one with the brows
 *  up 0.6. Quicker than a modulation: a colour, not a key. */
const AROUSAL_EDGES = [0.35, 0.55] as const;
/** The same, read from the player's own rest (#673): a resting face reads 0 there (before and
 *  after the expressions), a closed smile about 0.15, an open-mouthed one with the brows up 0.47 to
 *  0.5 (the face fixture), so the ninth (past 0.4 and the margin) is reached with room to spare. */
const AROUSAL_EDGES_FROM_REST = [0.25, 0.4] as const;
const AROUSAL_MARGIN = 0.05;
const AROUSAL_DWELL_S = 0.25;
/** The microphone (H8): the template fit a chord must reach, and its lead over the best different
 *  chord. Whether anything is sounding is the listener's (the room's noise floor plus a margin). */
const AUDIO_MIN_SCORE = 0.8;
const AUDIO_MIN_MARGIN = 0.02;
/** Seconds the cells a modulation changed stay marked (the letters map). */
const RELIGHT_S = 2;
/** The tension steps of `byTension` (seventh, ninth, eleventh or thirteenth). */
const TENSION_STEPS = 3;

/** The palm's centre: the wrist and the four knuckles. */
const PALM_POINTS = [LM.wrist, LM.index_mcp, LM.middle_mcp, LM.ring_mcp, LM.pinky_mcp] as const;

/** The idiom whose way ahead the map draws as a ghost trail (#713), or none. */
export const CHORD_MAP_IDIOMS = ['none', ...IDIOM_IDS] as [string, ...string[]];

/** What chooses the map's chord. */
export const CHORD_MAP_FOLLOW = ['hands', 'midi', 'audio', 'signs'] as const;

const isLetter = (label: string | null | undefined): label is NoteLetter => !!label && (NOTE_LETTERS as readonly string[]).includes(label);

const Params = z.object({
  /** Off by default: a player who never chooses the chord map hears nothing new. */
  enabled: z.boolean().default(false),
  layout: z.enum(CHORD_MAP_LAYOUTS).default('harmonic'),
  /** Hold the chord while pointing at it, or strum it with the other hand. */
  play: z.enum(CHORD_MAP_PLAY).default('hold'),
  /** The hand that points at the chords; the other one plays the melody or strums. */
  chordHand: z.enum(PLAYER_HANDS).default('left'),
  /** The chord hand's point that chooses: the palm's centre or the index fingertip. */
  point: z.enum(CHORD_MAP_POINTS).default('palm'),
  /** The share of the screen's width the chords take, on the chord hand's side. */
  split: z.number().min(0.3).max(0.9).default(0.65),
  /** A hexagon's width, in frame heights (the harmonic map; a row's strips fill their share). */
  cellSize: z.number().min(0.1).max(0.45).default(0.2),
  /** Camera frames a new chord must be pointed at in a row before it takes over. */
  enterFrames: z.number().int().min(1).max(10).default(2),
  /** How much nearer a new chord's centre must be than the sounding one's, in cell widths. */
  hysteresis: z.number().min(0).max(0.45).default(0.12),
  /** Seconds a chord keeps sounding after the hand leaves the chords or is lost. */
  releaseS: z.number().min(0).max(2).default(0.3),
  /** Show what each move from the sounding chord does, on its edges. */
  captions: z.boolean().default(true),
  /** The words on those moves (#714): the interval in scale steps, or what the move does (the
   *  tones it keeps, its colour, how expected it is after the Piston prior). */
  captionSet: z.enum(CAPTION_SET_IDS).default('interval'),
  /** A named path (Pachelbel, the Romanesca, the circle of fifths...) drawn ahead of the chord in
   *  force as a ghost trail that follows the player along it (#713); `none` draws nothing. */
  idiom: z.enum(CHORD_MAP_IDIOMS).default('none'),
  /** With an idiom: how many of its next chords the trail shows. */
  trailSteps: z.number().int().min(1).max(8).default(3),
  /** Hold mode: the other hand plays a melody. */
  melody: z.boolean().default(true),
  /** Which notes the melody hand plays: the chord's tones, the key's pentatonic, the whole
   *  scale, or (`tilt`, the video's right hand) the tilt of the hand chooses: upright the chord's
   *  tones, tilted the pentatonic, tilted further the scale. */
  melodyNotes: z.enum(MELODY_NOTES).default('chord'),
  /** The key's seventh chords (Cmaj7, Dm7, G7, Bø7) instead of its triads: neighbours a third
   *  apart then share three tones. */
  sevenths: z.boolean().default(false),
  melodyVolume: z.number().min(0).max(1).default(0.45),
  melodyOctaves: z.number().int().min(1).max(3).default(2),
  melodySound: SoundSchema.default('triangle'),
  /** The chord's volume when the instrument's chord settings say none. */
  gain: z.number().min(0).max(1).default(0.22),
  sound: SoundSchema.default('warmPad'),
  voicing: z.enum(VOICINGS).default('spread'),
  rendering: z.enum(RENDERINGS).default('sustained'),
  bpm: z.number().min(40).max(200).default(100),
  /** Strum mode: the strumming hand's tracked point. */
  strumPoint: z.enum(STRUM_MAP_POINTS).default('wrist'),
  /** Strum mode: seconds between one string and the next (low string first). */
  strumSpread: z.number().min(0).max(0.05).default(0.012),
  /** Strum mode: how far ahead of the strum it is committed, seconds. */
  minLead: z.number().min(0).max(0.2).default(0.05),
  /** Strum mode: the smallest strum that counts, as a fraction of the frame height. */
  minStroke: z.number().min(0.005).max(0.2).default(0.03),
  /** Strum mode: the slowest approach that is a strum, frame heights per second. */
  minSpeed: z.number().min(0).max(5).default(0.5),
  /** Strum mode: loudness, 0..1 (the stroke's own strength scales it). */
  volume: z.number().min(0).max(1).default(0.7),
  /** The mirrored webcam reports the opposite hand label. Off for a third-person video. */
  mirrorHandedness: z.boolean().default(true),
  /** Where the beat comes from: the Chord sound's tempo, or the loaded song while it plays. */
  clock: z.enum(CLOCKS).default('tempo'),
  /** Hold mode: a new chord sounds at once, or on the next beat of the clock. */
  commit: z.enum(['now', 'beat']).default('now'),
  /** With commit on the beat: beats between the moments a change may land (2 = every other beat). */
  commitBeats: z.number().int().min(1).max(4).default(1),
  /** What chooses the chord: the pointing hand, the chord a MIDI keyboard holds, the chord
   *  the microphone hears (a guitar, a piano, a band), or a signed letter A..G (ASL's reading). */
  follow: z.enum(CHORD_MAP_FOLLOW).default('hands'),
  /** With signs: seconds a letter must be read before its chord is the harmony (a passing
   *  shape between two letters passes). */
  signDwellS: z.number().min(0).max(1).default(0.2),
  /** With MIDI: seconds a new chord must be held before it is the harmony (passing tones pass). */
  midiDwellS: z.number().min(0).max(0.5).default(0.08),
  /** With the microphone: seconds a new chord must be heard before it is the harmony (a strum's
   *  attack and a passing note pass). */
  audioDwellS: z.number().min(0).max(1).default(0.25),
  /** The chords laid out: the key's seven (a pentatonic read through its parent major), or the
   *  scale's own (a pentatonic's five, stacks of its own thirds; #671). */
  chordsFrom: z.enum(['key', 'scale']).default('key'),
  /** Where the map keeps its place: the key's home in the middle, or the seven letters fixed
   *  (a key's home where its tonic sits, a modulation relighting the chords it changes). */
  anchor: z.enum(CHORD_MAP_ANCHORS).default('home'),
  /** The face colours the chords (composes the face model): its valence and its arousal. */
  face: z.boolean().default(false),
  /** With the face: a smile turns the key to its parallel major, a frown to its parallel minor. */
  faceMode: z.boolean().default(true),
  /** With the face: an open mouth and raised brows add the seventh, then the ninth. */
  faceTension: z.boolean().default(true),
  /** With the face: read it from the player's own rest (learned as they play: what each control
   *  reads at rest and how much it wanders), not against fixed levels (#673). */
  faceFromRest: z.boolean().default(true),
  /** With the face: seconds a smile or a frown must last before the key changes. */
  modeDwellS: z.number().min(0).max(4).default(1),
});
type Params = z.infer<typeof Params>;

export const ChordMapDialSchema = Params;
export type ChordMapDialParams = Params;
export const DEFAULT_CHORD_MAP_DIAL: ChordMapDialParams = ChordMapDialSchema.parse({});

/** The instrument's chord settings (the face chords' too), the `chord-config` port. */
interface ChordConfig {
  sound?: VoiceParams['sound'];
  gain?: number;
  voicing?: VoicingId;
  rendering?: RenderingId;
  bpm?: number;
}

/** What the settings section shows. */
export interface ChordMapStatus {
  enabled: boolean;
  play: ChordMapPlay;
  /** The key the chords are in ("C", "F#m"). */
  key: string;
  /** Whether the chord hand is in view. */
  pointing: boolean;
  /** The chord in force (its name and numeral), or null. */
  chord: string | null;
  numeral: string | null;
  /** The melody note sounding, or null. */
  melody: string | null;
  /** The note set the melody hand is playing. */
  melodySet: MelodySet;
  strums: number;
  predicted: number;
  /** The last strum's lead in seconds (negative = late). */
  lastLead: number;
  /** Whether the strumming hand's stroke floor has been learned. */
  ready: boolean;
  /** With MIDI: whether a keyboard can be heard, and the chord it holds (null: none yet). */
  midi: 'off' | 'waiting' | 'denied' | 'unavailable' | 'no-input' | 'listening';
  /** With the microphone: whether it can be heard, and whether anything is sounding. */
  audio: 'off' | 'waiting' | 'denied' | 'unavailable' | 'quiet' | 'listening';
  /** With signs: whether a hand is read, and the sign it makes (null: none). */
  signs: 'off' | 'waiting' | 'reading';
  sign: string | null;
  /** The chord the keyboard, the microphone or the signed letter holds (null: none yet). */
  inputChord: string | null;
  /** With the face: the key's mode in force ('key': the key's own) and the tension steps added. */
  mode: 'key' | 'darker' | 'brighter';
  tension: number;
  /** With an idiom: where the player is on it (null: no idiom drawn). */
  idiom: IdiomStatus | null;
  /** The chord in force's degree on a seven-chord map (the torus marks it), or null. */
  degree: number | null;
}

export const IDLE_CHORD_MAP_STATUS: ChordMapStatus = {
  enabled: false,
  play: 'hold',
  key: '',
  pointing: false,
  chord: null,
  numeral: null,
  melody: null,
  melodySet: 'chord',
  strums: 0,
  predicted: 0,
  lastLead: 0,
  ready: false,
  midi: 'off',
  audio: 'off',
  signs: 'off',
  sign: null,
  inputChord: null,
  mode: 'key',
  tension: 0,
  idiom: null,
  degree: null,
};

/** The point a hand chooses with, in display fractions (the mirrored frame). */
export function displayPoint(hand: Hand, frame: HandsFrame, point: (typeof CHORD_MAP_POINTS)[number] | (typeof STRUM_MAP_POINTS)[number]): { x: number; y: number } {
  const pts = point === 'palm' ? PALM_POINTS.map((i) => hand.keypoints[i]) : [hand.keypoints[point === 'wrist' ? LM.wrist : LM.index_tip]];
  const x = pts.reduce((s, k) => s + k.x, 0) / pts.length;
  const y = pts.reduce((s, k) => s + k.y, 0) / pts.length;
  return { x: 1 - x / frame.width, y: y / frame.height };
}

/** The chords' region and the other hand's, by the chord hand's side of the (mirrored) screen. */
export function chordMapRegions(chordHand: PlayerHand, split: number): { chords: Region; other: Region } {
  const v = { y0: REGION_TOP, y1: REGION_BOTTOM };
  return chordHand === 'left'
    ? { chords: { x0: 0, x1: split, ...v }, other: { x0: split, x1: 1, ...v } }
    : { chords: { x0: 1 - split, x1: 1, ...v }, other: { x0: 0, x1: 1 - split, ...v } };
}

const silentMelody = (sound: VoiceParams['sound']): VoiceParams => ({ id: CHORD_MAP_MELODY_VOICE_ID, present: false, freq: midiToFreq(60), gain: 0, sound });

export const chordMapNode = defineNode<Params>({
  type: 'chord-map',
  roles: ['feature', 'mapping', 'music'],
  title: 'Chord map',
  description:
    "Play a key's chords by pointing at them: the seven diatonic chords laid out on the screen (by default a hexagonal map whose axes are moves by a fourth, a third and a second), the chord hand choosing one; it sounds while held, with a melody on its tones from the other hand, or is strummed by the other hand, predicted before the frame that shows the strum. Off by default.",
  inputs: [
    { name: 'hands', kind: 'hands-frame' },
    { name: 'config', kind: 'chord-map-config' },
    // The chord-source scale: the key the chords are in.
    { name: 'spec', kind: 'scale-spec' },
    { name: 'chordConfig', kind: 'chord-config' },
    { name: 'octaveShift', kind: 'number', default: 0 },
    // The song's musical time, while the map keeps time with the song (`clock`).
    { name: 'time', kind: 'musical-time' },
    // The conductor's musical time, while it keeps time with the conductor (`clock`).
    { name: 'conductorTime', kind: 'musical-time' },
    // The notes a MIDI keyboard holds, while the map follows MIDI (`follow`).
    { name: 'midi', kind: 'held-notes' },
    // The microphone's chroma, while the map follows the microphone (`follow`).
    { name: 'audio', kind: 'audio-chroma' },
    // The player's ratings of the moves (#715): what the `mine` caption set says.
    { name: 'ratings', kind: 'move-ratings' },
    // The face's smoothed controls, while the face colours the map (`face`).
    { name: 'face', kind: 'face-features' },
    // ASL's sign reading, while the map follows signs (`follow`): an optional edge.
    { name: 'signs', kind: 'category-scores' },
  ],
  outputs: [
    { name: 'params', kind: 'synth-params' },
    { name: 'notes', kind: 'note-events', schema: NoteEventsSchema },
    { name: 'grid', kind: 'cell-grid' },
    { name: 'status', kind: 'chord-map-status' },
    // The chord in force, un-voiced: its triad, or its four tones with sevenths ([] for none).
    { name: 'triad', kind: 'number[]' },
  ],
  params: Params,
  make(p) {
    const clockReader = createClockReader();
    const renderer = createChordRenderer({ idBase: CHORD_MAP_VOICE_ID_BASE, maxVoices: MAX_CHORD_MAP_VOICES });
    let cfg: Params = p;
    let lastConfigRef: unknown = undefined;
    let cells: MapCell[] = [];
    let cellsKey = '';
    let tracker: CellTracker | null = null;
    let trackerKey = '';
    let choice: CellChoice = { active: null, candidate: null };
    let strummer: StrumDetector | null = null;
    let strummerKey = '';
    let lastFrame: HandsFrame | undefined;
    let chordPoint: { x: number; y: number } | null = null;
    let otherPoint: { x: number; y: number } | null = null;
    /** The cell last held (its chord is read in the current key, so a key change follows it). */
    let lastCell = -1;
    let melodySet: MelodySet = 'chord';
    const melodyGate = createBandGate();
    let otherTilt: number | null = null;
    const paths = createPathFollower();
    let status: ChordMapStatus = { ...IDLE_CHORD_MAP_STATUS };
    let valence: LevelTracker | null = null;
    const quantizer = createBeatQuantizer(-1);
    let follower: ChordFollower | null = null;
    let followerKey = '';
    /** The letters map: the anchor it was read under, each letter's chord as shown, what changed. */
    let letterAnchor = '';
    let letterNames: string[] = [];
    let changedLetters = new Set<number>();
    let changedUntil = -Infinity;
    let arousal = createLevelTracker({ edges: AROUSAL_EDGES, hysteresis: AROUSAL_MARGIN, dwellS: AROUSAL_DWELL_S, rest: 0 });
    let arousalFromRest = false;
    const restBaseline = createRestBaseline();

    const resolveConfig = (raw: unknown): Params => {
      if (raw === lastConfigRef) return cfg;
      lastConfigRef = raw;
      if (raw && typeof raw === 'object') {
        const parsed = Params.partial().safeParse(raw);
        if (parsed.success) {
          const overrides = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
          cfg = { ...p, ...overrides } as Params;
          return cfg;
        }
      }
      cfg = p;
      return cfg;
    };

    const reset = () => {
      cells = [];
      cellsKey = '';
      tracker = null;
      trackerKey = '';
      choice = { active: null, candidate: null };
      strummer = null;
      strummerKey = '';
      lastFrame = undefined;
      chordPoint = null;
      otherPoint = null;
      melodyGate.reset();
      lastCell = -1;
      quantizer.reset(-1);
      follower = null;
      followerKey = '';
      letterAnchor = '';
      letterNames = [];
      changedLetters = new Set();
      changedUntil = -Infinity;
      melodySet = 'chord';
      otherTilt = null;
      paths.reset();
      status = { ...IDLE_CHORD_MAP_STATUS };
      valence?.reset();
      arousal.reset();
      restBaseline.reset();
    };

    return {
      process(inputs, ctx: NodeContext) {
        const c = resolveConfig(inputs.config);
        const chordCfg = (inputs.chordConfig as ChordConfig | undefined) ?? {};
        const shift = typeof inputs.octaveShift === 'number' && Number.isFinite(inputs.octaveShift) ? Math.round(inputs.octaveShift) : 0;
        // The face's affect (H7): the mode in force and the tension steps, both levels with a dwell.
        const now = typeof ctx?.time === 'number' ? ctx.time : 0;
        const rawFace = c.enabled && c.face ? (inputs.face as FaceFeatures | undefined) : undefined;
        // From the player's own rest (#673): the face as it differs from this player's resting face.
        if (!rawFace || !c.faceFromRest) restBaseline.reset();
        const face = c.faceFromRest ? restBaseline.push(rawFace, typeof ctx?.dt === 'number' ? ctx.dt : 0) : rawFace;
        if (c.faceFromRest !== arousalFromRest) {
          // Another scale: both levels start again from the key and no tension.
          arousal = createLevelTracker({ edges: c.faceFromRest ? AROUSAL_EDGES_FROM_REST : AROUSAL_EDGES, hysteresis: AROUSAL_MARGIN, dwellS: AROUSAL_DWELL_S, rest: 0 });
          valence?.reset();
          arousalFromRest = c.faceFromRest;
        }
        valence ??= createLevelTracker({ edges: VALENCE_EDGES, hysteresis: VALENCE_MARGIN, dwellS: c.modeDwellS, rest: VALENCE_LEVELS.key });
        valence.setDwell(c.modeDwellS);
        // A gate turned off forgets its level, so turning it back on starts from the key. Tensions
        // colour a held chord only: a strum plays the guitar's voicing of the chord's name.
        // Following a keyboard or the microphone, what it plays is the mode: the face's parallel stays off.
        // A scale's own chords (a pentatonic's five, #671): no parallel key and no letters to keep.
        const specIn = inputs.spec as ScaleSpec | undefined;
        const ownScale = c.chordsFrom === 'scale' && !!specIn && hasOwnChords(specIn);
        const modeOn = c.enabled && c.face && c.faceMode && c.follow === 'hands' && !ownScale;
        const tensionOn = c.enabled && c.face && c.faceTension && c.play === 'hold';
        if (!modeOn) valence.reset();
        if (!tensionOn) arousal.reset();
        const modeLevel = modeOn ? valence.push(valenceOf(face), now) : VALENCE_LEVELS.key;
        const tensionLevel = tensionOn ? arousal.push(arousalOf(face), now) : 0;
        const tension = Math.max(c.sevenths ? 1 : 0, tensionLevel);
        const rawSpec = inputs.spec as ScaleSpec | undefined;
        // The parallel of the key's seven-note form, so every scale (a pentatonic, the blues) has one.
        const ownSpec = rawSpec ? letterChordSpec(rawSpec) : undefined;
        const spec = ownSpec ? parallelSpec(ownSpec, modeLevel) : undefined;
        // The song's beat now, while the map keeps time with it and the song plays (else the tempo's).
        const outsideBeat = clockReader.read(c.clock, { song: inputs.time as BeatSource | undefined, conductor: inputs.conductorTime as BeatSource | undefined }, typeof ctx?.time === 'number' ? ctx.time : 0);
        const render = (degree: number) =>
          renderer.render({
            beat: outsideBeat ?? undefined,
            degree,
            spec: ownScale ? rawSpec : spec,
            voicing: chordCfg.voicing ?? c.voicing,
            rendering: chordCfg.rendering ?? c.rendering,
            coloration: tensionOn ? 'byTension' : c.sevenths ? 'diatonicSeventh' : undefined,
            tension: tension / TENSION_STEPS,
            bpm: chordCfg.bpm ?? c.bpm,
            octaveShift: shift,
            gain: chordCfg.gain ?? c.gain,
            sound: chordCfg.sound ?? c.sound,
            silentSound: p.sound,
            dt: typeof ctx?.dt === 'number' ? ctx.dt : 0,
          });
        if (!c.enabled || !spec) {
          if (status.enabled) reset();
          const { voices } = render(-1);
          return { params: { voices: [...voices, silentMelody(p.melodySound)] } satisfies SynthParams, notes: [], grid: EMPTY_CELL_GRID, status, triad: [] };
        }
        const chords: DiatonicChord[] = ownScale && rawSpec ? scaleChords(rawSpec, true, c.sevenths ? 4 : 3) : diatonicChords(spec, c.sevenths ? 4 : 3);
        const degreeCount = chords.length;
        const anchor = degreeCount === DEGREES ? c.anchor : 'home';
        // The letters map keeps its cells across keys; a change of what a letter shows (a key, the
        // face's parallel, sevenths) marks the letters whose chord changed. Read through the key's
        // own spelling, so the face's parallel never moves the letters (C#m and Db spell apart).
        const letterSpec = ownSpec ?? spec;
        if (anchor === 'letters') {
          const names = letterChordNames(chords, letterSpec);
          if (letterAnchor === 'letters' && names.some((n, i) => n !== letterNames[i])) {
            changedLetters = new Set(names.flatMap((n, i) => (n !== letterNames[i] ? [i] : [])));
            changedUntil = now + RELIGHT_S;
          }
          letterNames = names;
        } else {
          changedLetters = new Set();
          changedUntil = -Infinity;
        }
        letterAnchor = anchor;
        const regions = chordMapRegions(c.chordHand, c.split);
        const shape = LAYOUTS[c.layout].shape;
        const notes: NoteEvent[] = [];
        const frame = inputs.hands as HandsFrame | undefined;
        const aspect = frame && frame.height > 0 && frame.width > 0 ? frame.width / frame.height : 0;

        const key = `${c.layout}|${c.chordHand}|${c.split}|${c.cellSize}|${aspect}|${degreeCount}`;
        if (key !== cellsKey && aspect > 0) {
          cells = layoutCells(c.layout, regions.chords, { aspect, cellSize: c.cellSize, degrees: degreeCount });
          cellsKey = key;
          lastCell = -1;
          quantizer.reset(-1);
          tracker?.reset();
          choice = { active: null, candidate: null };
        }
        const tKey = `${c.enterFrames}|${c.hysteresis}|${c.releaseS}`;
        if (!tracker || tKey !== trackerKey) {
          tracker = createCellTracker({ enterFrames: c.enterFrames, hysteresis: c.hysteresis, releaseS: c.releaseS });
          trackerKey = tKey;
          choice = { active: null, candidate: null };
        }
        // The lead is read live at each sample, so changing it keeps the learned stroke floor.
        const sKey = `${c.chordHand}|${c.strumPoint}|${c.mirrorHandedness}|${c.minStroke}|${c.minSpeed}`;
        if (c.play === 'strum' && (!strummer || sKey !== strummerKey)) {
          strummer = createStrumDetector({ minLead: c.minLead, minStroke: c.minStroke, minSpeed: c.minSpeed });
          strummerKey = sKey;
          status = { ...status, strums: 0, predicted: 0, lastLead: 0, ready: false };
        } else if (c.play !== 'strum' && strummer) {
          strummer = null;
          strummerKey = '';
        }

        // Each cell's degree in the key (the letters map reads its letter in the key).
        const placed = keyedCells(cells, anchor, letterSpec);

        // A keyboard or a microphone chooses (H8): the chord it holds lights its cell (the one
        // nearest the middle, or the one already lit); a chord outside the key lights none.
        const midi = c.follow === 'midi' ? ((inputs.midi as MidiHeld | null | undefined) ?? null) : null;
        const audio = c.follow === 'audio' ? ((inputs.audio as AudioHeard | null | undefined) ?? null) : null;
        const signs = c.follow === 'signs' ? ((inputs.signs as CategoryScores | null | undefined) ?? null) : null;
        let heard: Chord | null = null;
        if (c.follow === 'midi' || c.follow === 'audio' || c.follow === 'signs') {
          const dwell = c.follow === 'midi' ? c.midiDwellS : c.follow === 'audio' ? c.audioDwellS : c.signDwellS;
          const fKey = `${c.follow}|${dwell}`;
          if (!follower || followerKey !== fKey) {
            follower = createChordFollower({ dwellS: dwell });
            followerKey = fKey;
          }
          // The held notes are first matched against the map's own chords exactly (a pentatonic's
          // sus chords are in no detection table), then read as any chord.
          if (c.follow === 'midi') {
            const held = midi?.held ?? [];
            const exact = held.length ? chords.find((ch) => ch.chord && samePitchClasses(ch.triad, [...new Set(held.map((n) => ((n % 12) + 12) % 12))]))?.chord : undefined;
            heard = exact ? follower.pushChord(exact, now) : follower.push(held, now);
          } else if (c.follow === 'signs') {
            // A letter names the key's chord spelled on it; any other shape keeps the harmony.
            const letter = signs?.present && isLetter(signs.label) ? signs.label : null;
            heard = follower.pushChord(letter ? (keyChords(keyOf(spec))[letterDegree(spec, letter)] ?? null) : null, now);
          } else {
            // Only a clear reading counts: loud enough, close to a chord, and clearly that one.
            const match = audio?.available && audio.sounding && audio.chroma.length === 12 ? matchChord({ bins: audio.chroma, energy: 1 }, ownScale ? { qualities: [...CHROMA_QUALITIES, 'sus2', 'sus4', 'maj6'] } : {}) : null;
            heard = follower.pushChord(match && match.score >= AUDIO_MIN_SCORE && match.margin >= AUDIO_MIN_MARGIN ? match.chord : null, now);
          }
          const key = keyOf(spec);
          const d = !heard
            ? -1
            : ownScale
              ? chords.findIndex((ch) => samePitchClasses(ch.triad, pitchClasses(heard!)))
              : [keyChords(key), keyChords(key, 4)].reduce((found, set) => (found >= 0 ? found : set.findIndex((x) => x.root === heard!.root && x.quality === heard!.quality)), -1);
          const lit = choice.active !== null && placed[choice.active]?.degree === d ? choice.active : nearestOfDegree(placed, d, regions.chords);
          choice = { active: lit, candidate: null };
        } else if (follower) {
          follower = null;
          followerKey = '';
        }
        const midiStatus: ChordMapStatus['midi'] =
          c.follow !== 'midi' ? 'off' : !midi || midi.reason === 'pending' ? 'waiting' : midi.reason === 'denied' ? 'denied' : !midi.available ? 'unavailable' : midi.inputs === 0 ? 'no-input' : 'listening';
        const audioStatus: ChordMapStatus['audio'] =
          c.follow !== 'audio' ? 'off' : !audio || audio.reason === 'pending' ? 'waiting' : audio.reason === 'denied' ? 'denied' : !audio.available ? 'unavailable' : audio.sounding ? 'listening' : 'quiet';
        // A heard chord outside the key: no cell, but its own tones in the map's register.
        const outsideTones = heard && choice.active === null ? heardChordTones(heard, spec) : null;
        const heardName = heard ? chordName(heard, keyOf(spec)) : null;

        // One camera frame: choose the chord, then hear the other hand.
        const sameStamp = !!frame && !!lastFrame && frame.t !== undefined && frame.t === lastFrame.t;
        const fresh = frame !== lastFrame && !sameStamp;
        lastFrame = frame;
        if (frame && fresh && aspect > 0) {
          const t = captureTime(frame, ctx);
          const otherHand: PlayerHand = c.chordHand === 'left' ? 'right' : 'left';
          const chordHand = frame.hands.find((h) => h.handedness === labelFor(c.chordHand, c.mirrorHandedness));
          const other = frame.hands.find((h) => h.handedness === labelFor(otherHand, c.mirrorHandedness));
          chordPoint = chordHand ? displayPoint(chordHand, frame, c.point) : null;
          if (c.follow === 'hands') choice = tracker.push(cells, chordPoint, t, aspect, shape);
          otherPoint = other ? displayPoint(other, frame, c.play === 'strum' ? c.strumPoint : 'palm') : null;
          otherTilt = other ? handTilt(other) : null;
          status = { ...status, pointing: !!chordHand };
          if (c.play === 'strum' && strummer && other) {
            const kp = other.keypoints[c.strumPoint === 'wrist' ? LM.wrist : LM.index_tip];
            for (const s of strummer.push({ t, x: kp.x / frame.height, y: kp.y / frame.height }, ctx.time, c.minLead)) {
              // The chord is the one in force at the decision, about the lead plus the frame's age
              // before the strum sounds (the air guitar's rule): a chord reached later is heard on
              // the next strum. No chord, a strum of nothing.
              // A MIDI chord outside the key is strummed by its own name.
              const inKey = choice.active !== null ? chords[placed[choice.active].degree] : undefined;
              const chord = inKey ?? (heard ? { symbol: strummable(heard, keyOf(spec)) } : undefined);
              if (!chord) continue;
              const velocity = s.late ? s.strength * c.volume * LATE_VELOCITY : s.strength * c.volume;
              const strummed = strumNotes(chord.symbol, s.t, velocity, c.strumSpread, { predicted: s.predicted, lead: s.lead }, shift);
              if (strummed.length) {
                notes.push(...strummed);
                status = { ...status, strums: status.strums + 1, predicted: status.predicted + (s.predicted ? 1 : 0), lastLead: s.lead };
              }
            }
            if (!status.ready && strummer.ready()) status = { ...status, ready: true };
          }
        }

        const pointed = choice.active !== null && placed[choice.active] ? choice.active : -1;
        const degree = pointed >= 0 ? placed[pointed].degree : -1;
        // On the beat (H9): in hold mode the CELL that sounds waits for the clock's next beat (the
        // end of this tick's), so the melody and the grid follow what sounds; strumming holds nothing.
        const beatNow = outsideBeat ?? renderer.beat() + ((chordCfg.bpm ?? c.bpm) / 60) * (typeof ctx?.dt === 'number' ? ctx.dt : 0);
        let heldCell = -1;
        if (c.play !== 'hold') quantizer.reset(-1);
        else if (c.commit === 'beat') heldCell = quantizer.push(pointed, beatNow, c.commitBeats);
        else {
          quantizer.reset(pointed);
          heldCell = pointed;
        }
        const held = heldCell >= 0 && placed[heldCell] ? placed[heldCell].degree : -1;
        const sounding = c.play === 'hold' ? heldCell : pointed;
        if (sounding >= 0) lastCell = sounding;
        const waiting = quantizer.pending();
        const shownChoice: CellChoice = c.play === 'hold' && c.commit === 'beat' ? { active: heldCell >= 0 ? heldCell : null, candidate: waiting !== undefined && waiting >= 0 ? waiting : null } : choice;
        const { voices } = render(held);

        // The melody: the other hand's height over the chord's tones (the last chord's while
        // none is held, the tonic's before any).
        let melodyVoice = silentMelody(p.melodySound);
        let ladder: { region: Region; notes: number[]; band: number | null; set: MelodySet } | null = null;
        let melodyNote: string | null = null;
        if (c.play === 'hold' && c.melody) {
          const over = outsideTones ?? chords[lastCell >= 0 && placed[lastCell] ? placed[lastCell].degree : 0].tones;
          const base = (spec.baseOctave + 2) * 12;
          // The tilt chooses the set only while the hand is seen; a lost hand keeps the last one.
          melodySet = c.melodyNotes !== 'tilt' ? c.melodyNotes : otherTilt === null ? melodySet : setForTilt(otherTilt, melodySet);
          const ladderNotes = melodyNotesFor(melodySet, over, spec, base, c.melodyOctaves);
          const band = melodyGate.push(ladderBand(regions.other, ladderNotes.length, otherPoint), fresh, ladderNotes.length);
          ladder = { region: regions.other, notes: ladderNotes, band, set: melodySet };
          if (band !== null) {
            const midi = ladderNotes[band] + 12 * shift;
            melodyNote = midiToName(midi);
            melodyVoice = { id: CHORD_MAP_MELODY_VOICE_ID, present: true, freq: midiToFreq(midi), gain: c.melodyVolume, sound: c.melodySound, brightness: 1, vibrato: 0, pan: 0 };
          }
        }

        // What sounds (held on the beat) is what the status names; strumming, what is pointed at.
        const shown = c.play === 'hold' ? held : degree;
        const active = shown >= 0 ? chords[shown] : null;
        status = {
          ...status,
          enabled: true,
          play: c.play,
          key: keyName(spec) + (spec.type === 'major' ? '' : 'm'),
          chord: active?.name ?? null,
          numeral: active?.numeral ?? null,
          degree: active && degreeCount === DEGREES ? shown : null,
          melody: melodyNote,
          melodySet,
          // What changed, not what the face reads: a frown on a minor key changes nothing.
          midi: midiStatus,
          signs: c.follow !== 'signs' ? 'off' : signs?.present ? 'reading' : 'waiting',
          sign: c.follow === 'signs' && signs?.present ? signs.label : null,
          audio: audioStatus,
          inputChord: heardName && !active && heard ? `${heardName} (outside the key)` : heardName,
          mode: spec.type === ownSpec?.type ? 'key' : modeLevel === VALENCE_LEVELS.darker ? 'darker' : 'brighter',
          // A pentatonic's own chords take no seventh (its scale has none to add): no tension shown.
          tension: !ownScale && tensionLevel > (c.sevenths ? 1 : 0) ? tensionLevel : 0,
        };
        // The idiom's trail and the caption set's words (#713, #714; `lib/map_paths.ts`).
        const { trail, moveText, idiom: idiomStatus } = paths.push({ idiom: c.idiom, captionSet: c.captionSet, trailSteps: c.trailSteps, spec, chords, shown, ratings: (inputs.ratings as RatingsTable | null | undefined) ?? undefined });
        status = { ...status, idiom: idiomStatus };
        const marks =
          anchor === 'letters' ? cells.map((cell, i) => (placed[i].degree === 0 ? 'home' : now < changedUntil && changedLetters.has(cell.degree) ? 'changed' : undefined)) : undefined;
        const grid: CellGrid = chordMapGrid({
          layout: c.layout,
          cells: placed,
          laidOut: cells,
          marks,
          chords,
          choice: shownChoice,
          captions: c.captions,
          moveText,
          trail,
          ladder,
          pointers: [chordPoint, c.play === 'hold' && c.melody ? otherPoint : null].filter((x): x is { x: number; y: number } => x !== null),
        });
        return { params: { voices: [...voices, melodyVoice] } satisfies SynthParams, notes, grid, status, triad: active ? active.tones : [] };
      },
      dispose() {
        reset();
      },
    };
  },
});
