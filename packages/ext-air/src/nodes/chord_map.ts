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
 *   strum is decided is strummed as a guitarist voices it, on `pluck-out`. The decision is the
 *   air guitar's (`../lib/strum.ts`): predicted before the frame that shows it, committed with
 *   the lead the output needs plus the frame's age, late strums sounded at once and softer.
 *
 * A cell is chosen with hysteresis (a new cell's centre must be nearer than the sounding one's
 * by a margin) and a dwell of a few camera frames, and kept a moment after the hand leaves the
 * grid or is lost, so tracking jitter at a border never flickers the harmony. The grid, the
 * melody ladder and the moves around the sounding chord are drawn by the overlay's generic
 * `cellGrid` element, from the `grid` output.
 *
 * Off by default; pure and Node-safe.
 */
import { z } from 'zod';
import { defineNode } from '@thoremin/dag';
import type { NodeContext } from '@thoremin/dag';
import { createChordRenderer } from '@thoremin/sdk/music/chord_render';
import { letterChordSpec, midiToFreq, midiToName, keyName, type ScaleSpec } from '@thoremin/sdk/music/theory';
import { SoundSchema } from '@thoremin/sdk/music/sounds';
import { RENDERINGS, VOICINGS, type RenderingId, type VoicingId } from '@thoremin/sdk/music/voicing';
import { LM, type Hand, type HandsFrame, type SynthParams, type VoiceParams } from '@thoremin/sdk/nodes/domain';
import { EMPTY_CELL_GRID, type CellGrid } from '@thoremin/sdk/nodes/cell_grid';
import { captureTime } from '@thoremin/sdk/timing/tracker';
import {
  CHORD_MAP_LAYOUTS,
  LAYOUTS,
  chordMapGrid,
  createCellTracker,
  diatonicChords,
  ladderBand,
  layoutCells,
  melodyLadder,
  type CellChoice,
  type CellTracker,
  type DiatonicChord,
  type MapCell,
  type Region,
} from '../lib/chord_map';
import { createStrumDetector, type StrumDetector } from '../lib/strum';
import { NoteEventsSchema, type NoteEvent } from './note_events';
import { PLAYER_HANDS, labelFor, type PlayerHand } from './air_bass';
import { LATE_VELOCITY, strumNotes } from './air_guitar';

export const CHORD_MAP_PLAY = ['hold', 'strum'] as const;
export type ChordMapPlay = (typeof CHORD_MAP_PLAY)[number];
export const CHORD_MAP_POINTS = ['palm', 'indexTip'] as const;
export const STRUM_MAP_POINTS = ['wrist', 'indexTip'] as const;

/** The chord's voices: a block of their own, far from the hand voices, the score (from 11),
 *  the air flute (1_000_000), ASL's chords (2_000_000) and the categorizer chords (3_000_000). */
export const CHORD_MAP_VOICE_ID_BASE = 4_000_000;
/** The largest voicing is four notes. */
export const MAX_CHORD_MAP_VOICES = 4;
/** The melody hand's voice, in the same block. */
export const CHORD_MAP_MELODY_VOICE_ID = CHORD_MAP_VOICE_ID_BASE + 100;

/** The grid and the ladder keep this far from the frame's top and bottom (the shell's bars). */
const REGION_TOP = 0.1;
const REGION_BOTTOM = 0.9;
/** The palm's centre: the wrist and the four knuckles. */
const PALM_POINTS = [LM.wrist, LM.index_mcp, LM.middle_mcp, LM.ring_mcp, LM.pinky_mcp] as const;

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
  /** Hold mode: the other hand plays a melody on the chord's tones. */
  melody: z.boolean().default(true),
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
  strums: number;
  predicted: number;
  /** The last strum's lead in seconds (negative = late). */
  lastLead: number;
  /** Whether the strumming hand's stroke floor has been learned. */
  ready: boolean;
}

export const IDLE_CHORD_MAP_STATUS: ChordMapStatus = {
  enabled: false,
  play: 'hold',
  key: '',
  pointing: false,
  chord: null,
  numeral: null,
  melody: null,
  strums: 0,
  predicted: 0,
  lastLead: 0,
  ready: false,
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
  ],
  outputs: [
    { name: 'params', kind: 'synth-params' },
    { name: 'notes', kind: 'note-events', schema: NoteEventsSchema },
    { name: 'grid', kind: 'cell-grid' },
    { name: 'status', kind: 'chord-map-status' },
    // The un-voiced triad in force ([] for none).
    { name: 'triad', kind: 'number[]' },
  ],
  params: Params,
  make(p) {
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
    let lastDegree = -1;
    let status: ChordMapStatus = { ...IDLE_CHORD_MAP_STATUS };

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
      lastDegree = -1;
      status = { ...IDLE_CHORD_MAP_STATUS };
    };

    return {
      process(inputs, ctx: NodeContext) {
        const c = resolveConfig(inputs.config);
        const chordCfg = (inputs.chordConfig as ChordConfig | undefined) ?? {};
        const shift = typeof inputs.octaveShift === 'number' && Number.isFinite(inputs.octaveShift) ? Math.round(inputs.octaveShift) : 0;
        const rawSpec = inputs.spec as ScaleSpec | undefined;
        const spec = rawSpec ? letterChordSpec(rawSpec) : undefined;
        const render = (degree: number) =>
          renderer.render({
            degree,
            spec,
            voicing: chordCfg.voicing ?? c.voicing,
            rendering: chordCfg.rendering ?? c.rendering,
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
        const chords: DiatonicChord[] = diatonicChords(spec);
        const regions = chordMapRegions(c.chordHand, c.split);
        const shape = LAYOUTS[c.layout].shape;
        const notes: NoteEvent[] = [];
        const frame = inputs.hands as HandsFrame | undefined;
        const aspect = frame && frame.height > 0 && frame.width > 0 ? frame.width / frame.height : 0;

        const key = `${c.layout}|${c.chordHand}|${c.split}|${c.cellSize}|${aspect}`;
        if (key !== cellsKey && aspect > 0) {
          cells = layoutCells(c.layout, regions.chords, { aspect, cellSize: c.cellSize });
          cellsKey = key;
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
          choice = tracker.push(cells, chordPoint, t, aspect, shape);
          otherPoint = other ? displayPoint(other, frame, c.play === 'strum' ? c.strumPoint : 'palm') : null;
          status = { ...status, pointing: !!chordHand };
          if (c.play === 'strum' && strummer && other) {
            const kp = other.keypoints[c.strumPoint === 'wrist' ? LM.wrist : LM.index_tip];
            for (const s of strummer.push({ t, x: kp.x / frame.height, y: kp.y / frame.height }, ctx.time, c.minLead)) {
              // The chord is the one in force at the decision, about the lead plus the frame's age
              // before the strum sounds (the air guitar's rule): a chord reached later is heard on
              // the next strum. No chord, a strum of nothing.
              const chord = choice.active !== null ? chords[cells[choice.active].degree] : undefined;
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

        const degree = choice.active !== null && cells[choice.active] ? cells[choice.active].degree : -1;
        if (degree >= 0) lastDegree = degree;
        const held = c.play === 'hold' ? degree : -1;
        const { voices } = render(held);

        // The melody: the other hand's height over the chord's tones (the last chord's while
        // none is held, the tonic's before any).
        let melodyVoice = silentMelody(p.melodySound);
        let ladder: { region: Region; notes: number[]; band: number | null } | null = null;
        let melodyNote: string | null = null;
        if (c.play === 'hold' && c.melody) {
          const over = chords[lastDegree >= 0 ? lastDegree : 0].triad;
          const base = (spec.baseOctave + 2) * 12;
          const ladderNotes = melodyLadder(over, base, c.melodyOctaves);
          const band = ladderBand(regions.other, ladderNotes.length, otherPoint);
          ladder = { region: regions.other, notes: ladderNotes, band };
          if (band !== null) {
            const midi = ladderNotes[band] + 12 * shift;
            melodyNote = midiToName(midi);
            melodyVoice = { id: CHORD_MAP_MELODY_VOICE_ID, present: true, freq: midiToFreq(midi), gain: c.melodyVolume, sound: c.melodySound, brightness: 1, vibrato: 0, pan: 0 };
          }
        }

        const active = degree >= 0 ? chords[degree] : null;
        status = {
          ...status,
          enabled: true,
          play: c.play,
          key: keyName(spec) + (spec.type === 'major' ? '' : 'm'),
          chord: active?.name ?? null,
          numeral: active?.numeral ?? null,
          melody: melodyNote,
        };
        const grid: CellGrid = chordMapGrid({
          layout: c.layout,
          cells,
          chords,
          choice,
          captions: c.captions,
          ladder,
          pointers: [chordPoint, c.play === 'hold' && c.melody ? otherPoint : null].filter((x): x is { x: number; y: number } => x !== null),
        });
        return { params: { voices: [...voices, melodyVoice] } satisfies SynthParams, notes, grid, status, triad: active ? active.triad : [] };
      },
      dispose() {
        reset();
      },
    };
  },
});
