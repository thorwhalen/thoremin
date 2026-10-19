/**
 * `chord-wheel` node: a "next chord" wheel (H5 of #613, `docs/design/harmonic-layers.md` §6.2):
 * the chord in force in the centre and one move per wedge around it, each at a FIXED angle, so a
 * direction always means the same move. Push the chord hand from the wheel's centre toward a
 * wedge and hold it there a moment: that move is made, the wheel recentres on the new chord, and
 * the hand comes back to the centre to make the next one. The video's explainer graph (its
 * chapter 2) made playable.
 *
 * Composed from the harmonic layers, no bespoke logic: a space's relations
 * (`@thoremin/sdk/harmony/space`: the key's diatonic moves, or the Tonnetz's P, L, R and their
 * compounds, which leave the key), a radial layout (`harmony/layout`), the direction stepper
 * (`harmony/navigate`: one move per push, re-armed at the centre, which a dynamic layout needs),
 * the harmonic state (`harmony/state`: step intents, a rejected move reported) and the realization
 * pipeline (`harmony/realize`: the instrument's Chord sound settings, voice-led by default in the
 * shipped instruments). The wheel is drawn by the air extension's own overlay element (#600 S5).
 *
 * The chord sounds while the chord hand is seen, and a moment after it is lost. Off by default;
 * pure and Node-safe.
 */
import { z } from 'zod';
import { defineNode } from '@thoremin/dag';
import type { NodeContext } from '@thoremin/dag';
import { createRealizer, DEFAULT_CONTROLS, DEFAULT_SPEC, tonesInRegister } from '@thoremin/sdk/harmony/realize';
import { chordName, functionOf, keyOf, pitchClasses, type Chord, type Key } from '@thoremin/sdk/harmony/chord';
import { radial, type Region } from '@thoremin/sdk/harmony/layout';
import { createCategoryStepper, createDirectionStepper, type CategoryStepper, type DirectionStepper } from '@thoremin/sdk/harmony/navigate';
import { EMOTIONS, type Emotion, type ExpressionScores } from '@thoremin/sdk/music/expression';
import { RELATIONS } from '@thoremin/sdk/harmony/space';
import { applyIntents, initialState, type HarmonicState } from '@thoremin/sdk/harmony/state';
import { letterChordSpec, scalePitchClasses, type ScaleSpec } from '@thoremin/sdk/music/theory';
import { SoundSchema } from '@thoremin/sdk/music/sounds';
import { RENDERINGS, VOICINGS, type RenderingId, type VoicingId } from '@thoremin/sdk/music/voicing';
import type { HandsFrame, SynthParams, VoiceParams } from '@thoremin/sdk/nodes/domain';
import { EMPTY_CELL_GRID, type CellGrid, type GridCell } from '@thoremin/sdk/nodes/cell_grid';
import { captureTime } from '@thoremin/sdk/timing/tracker';
import { DEGREE_COLORS } from '../lib/chord_map';
import { PLAYER_HANDS, labelFor } from './air_bass';
import { CHORD_MAP_POINTS, displayPoint } from './chord_map';

/** The moves each wheel offers, clockwise from the top. The diatonic wheel puts each move
 *  opposite its inverse (a fourth up at the top, a fourth down at the bottom). */
export const WHEEL_MOVES = {
  diatonic: ['dia+3', 'dia+2', 'dia+1', 'dia-3', 'dia-2', 'dia-1'],
  tonnetz: ['P', 'L', 'R', 'N', 'S', 'H'],
} as const;
export type WheelMovesId = keyof typeof WHEEL_MOVES;
export const WHEEL_MOVE_SETS = Object.keys(WHEEL_MOVES) as [WheelMovesId, ...WheelMovesId[]];

/** Who steers the wheel: the hand's push, the face's expressions (each a move), or both. */
export const WHEEL_STEER = ['hand', 'face', 'both'] as const;

/**
 * The move each expression makes by default, per moves set (the face as harmonic expression,
 * `docs/design/harmonic-layers.md` §5.4: an expression as a MOVE from the chord in force). Chosen
 * for the major/minor valence link the research found robust (a sad face to the minor side), not
 * for the video's per-move emotion words (the creator's, unsourced): diatonic, a smile to the
 * dominant, a sad face to the relative minor; Tonnetz, a sad face flips to the parallel minor (P)
 * and a smile to the relative (R). Neutral makes no move: it re-arms.
 */
export const DEFAULT_FACE_MOVES: Readonly<Record<WheelMovesId, Readonly<Record<Emotion, string>>>> = {
  diatonic: { happy: 'dia-3', sad: 'dia-2', surprised: 'dia+1', angry: 'dia-1', fearful: 'dia+2', disgusted: 'none', kiss: 'dia+3' },
  tonnetz: { happy: 'R', sad: 'P', surprised: 'H', angry: 'N', fearful: 'S', disgusted: 'none', kiss: 'L' },
};

/** An expression's move: the player's choice, '' for the moves set's default, 'none' for no move. */
export function faceMoveFor(set: WheelMovesId, chosen: string | undefined, emotion: Emotion): string | null {
  const id = chosen && chosen !== '' ? chosen : DEFAULT_FACE_MOVES[set][emotion];
  return id === 'none' ? null : id;
}

/** The wheel's voices: a block of their own (the chord map's is 4_000_000). */
export const CHORD_WHEEL_VOICE_ID_BASE = 5_000_000;
export const MAX_CHORD_WHEEL_VOICES = 5;

/** A chord outside the key (a Tonnetz move leaves it) is drawn in this colour. */
const OUTSIDE_KEY_COLOR = '#e2e8f0';
/** The wheel keeps this far from the frame's top and bottom (the shell's bars). */
const REGION_TOP = 0.1;
const REGION_BOTTOM = 0.9;

const Params = z.object({
  enabled: z.boolean().default(false),
  /** Which moves the wheel offers: the key's diatonic moves, or the Tonnetz's (they leave the key). */
  moves: z.enum(WHEEL_MOVE_SETS).default('diatonic'),
  /** The hand that steers the wheel. */
  hand: z.enum(PLAYER_HANDS).default('left'),
  point: z.enum(CHORD_MAP_POINTS).default('palm'),
  /** The wheel's radius, in frame heights. */
  radius: z.number().min(0.15).max(0.45).default(0.3),
  /** The centre's dead zone, in frame heights from the centre: back inside it re-arms the wheel. */
  dead: z.number().min(0.02).max(0.2).default(0.07),
  /** How far from the centre the hand must reach to choose a move, in frame heights. */
  reach: z.number().min(0.05).max(0.4).default(0.14),
  /** Camera frames the hand must hold a wedge before its move is made. */
  enterFrames: z.number().int().min(1).max(15).default(3),
  /** Seconds the chord keeps sounding after the hand is lost. */
  releaseS: z.number().min(0).max(2).default(0.4),
  gain: z.number().min(0).max(1).default(0.22),
  sound: SoundSchema.default('warmPad'),
  voicing: z.enum(VOICINGS).default('voiceLed'),
  rendering: z.enum(RENDERINGS).default('sustained'),
  bpm: z.number().min(40).max(200).default(100),
  mirrorHandedness: z.boolean().default(true),
  /** Who steers: the hand's push, the face's expressions (each one a move), or both. */
  steer: z.enum(WHEEL_STEER).default('hand'),
  /** The move each expression makes: a relation id, '' for the moves set's default, 'none'. */
  faceMoves: z
    .object(Object.fromEntries(EMOTIONS.map((e) => [e, z.string().default('')])) as Record<Emotion, z.ZodDefault<z.ZodString>>)
    .prefault({}),
  /** Readings in a row an expression must hold before its move is made. */
  faceFrames: z.number().int().min(1).max(30).default(6),
});
type Params = z.infer<typeof Params>;
export const ChordWheelDialSchema = Params;
export type ChordWheelDialParams = Params;

interface ChordConfig {
  sound?: VoiceParams['sound'];
  gain?: number;
  voicing?: VoicingId;
  rendering?: RenderingId;
  bpm?: number;
}

export interface ChordWheelStatus {
  enabled: boolean;
  moves: WheelMovesId;
  key: string;
  /** The steering hand is seen. */
  steering: boolean;
  /** The chord in force (name and numeral; '' for a chord outside the key). */
  chord: string | null;
  numeral: string;
  /** Ready for a move: the hand has come back to the centre. */
  armed: boolean;
  /** How many moves were made, and the last one ("4th up", "parallel"). */
  moveCount: number;
  lastMove: string | null;
  /** The last move that could not be made from the chord (P from a diminished chord). */
  rejected: string | null;
  /** The face's expression now, when the face steers (null: none read, or the hand alone). */
  face: string | null;
  steer: (typeof WHEEL_STEER)[number];
}

export const IDLE_CHORD_WHEEL_STATUS: ChordWheelStatus = { enabled: false, moves: 'diatonic', key: '', steering: false, chord: null, numeral: '', armed: true, moveCount: 0, lastMove: null, rejected: null, face: null, steer: 'hand' };

/** The wheel's region: the steering hand's side of the (mirrored) screen, full height. */
export function wheelRegion(hand: (typeof PLAYER_HANDS)[number]): Region {
  return hand === 'left' ? { x0: 0, x1: 0.6, y0: REGION_TOP, y1: REGION_BOTTOM } : { x0: 0.4, x1: 1, y0: REGION_TOP, y1: REGION_BOTTOM };
}

/** A chord's colour: its degree's when it is one of the key's chords, else the outside colour. */
function colorOf(chord: Chord, key: Key): string {
  const fn = functionOf(chord, key);
  return fn && fn.alter === undefined && fn.of === undefined ? DEGREE_COLORS[fn.degree] : OUTSIDE_KEY_COLOR;
}

/** The chord's tones in register, root first, from the spec's base octave. */
function tonesOf(chord: Chord, spec: ScaleSpec): number[] {
  const root = (spec.baseOctave + 1) * 12 + chord.root;
  return pitchClasses(chord).map((p) => root + ((((p - chord.root) % 12) + 12) % 12));
}

const sameKey = (a: Key, b: Key) => a.tonic === b.tonic && a.scale === b.scale;

export const chordWheelNode = defineNode<Params>({
  type: 'chord-wheel',
  roles: ['feature', 'mapping', 'music'],
  title: 'Chord wheel',
  description:
    "A next-chord wheel: the chord in force in the centre, one move per wedge at a fixed angle (the key's diatonic moves, or the Tonnetz's P, L, R and their compounds); push the hand toward a move and hold it, the wheel recentres on the new chord. Off by default.",
  inputs: [
    { name: 'hands', kind: 'hands-frame' },
    { name: 'config', kind: 'chord-wheel-config' },
    { name: 'spec', kind: 'scale-spec' },
    { name: 'chordConfig', kind: 'chord-config' },
    { name: 'octaveShift', kind: 'number', default: 0 },
    // The face's expression (the general model, or a personal categorizer's reading), when the
    // face steers: an optional edge, composed only then.
    { name: 'expression', kind: 'face-expression' },
  ],
  outputs: [
    { name: 'params', kind: 'synth-params' },
    { name: 'grid', kind: 'cell-grid' },
    { name: 'status', kind: 'chord-wheel-status' },
    // The chord in force, un-voiced ([] for none): the shared chord display.
    { name: 'triad', kind: 'number[]' },
  ],
  params: Params,
  make(p) {
    const realizer = createRealizer({ idBase: CHORD_WHEEL_VOICE_ID_BASE, maxVoices: MAX_CHORD_WHEEL_VOICES });
    let cfg: Params = p;
    let lastConfigRef: unknown = undefined;
    let state: HarmonicState | null = null;
    let stepper: DirectionStepper | null = null;
    let faceStepper: CategoryStepper | null = null;
    let faceFrames = 0;
    let lastFace = -Infinity;
    let stepperKey = '';
    let lastFrame: HandsFrame | undefined;
    let lastSeen = -Infinity;
    let pointer: { x: number; y: number } | null = null;
    let pointing: number | null = null;
    let status: ChordWheelStatus = { ...IDLE_CHORD_WHEEL_STATUS };

    const resolveConfig = (raw: unknown): Params => {
      if (raw === lastConfigRef) return cfg;
      lastConfigRef = raw;
      const parsed = raw && typeof raw === 'object' ? Params.partial().safeParse(raw) : null;
      cfg = parsed?.success ? ({ ...p, ...Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) } as Params) : p;
      return cfg;
    };

    const reset = () => {
      state = null;
      stepper = null;
      stepperKey = '';
      faceStepper = null;
      lastFace = -Infinity;
      lastFrame = undefined;
      lastSeen = -Infinity;
      pointer = null;
      pointing = null;
      status = { ...IDLE_CHORD_WHEEL_STATUS };
    };

    return {
      process(inputs, ctx: NodeContext) {
        const c = resolveConfig(inputs.config);
        const chordCfg = (inputs.chordConfig as ChordConfig | undefined) ?? {};
        const rawSpec = inputs.spec as ScaleSpec | undefined;
        const spec = rawSpec ? letterChordSpec(rawSpec) : undefined;
        const shift = typeof inputs.octaveShift === 'number' && Number.isFinite(inputs.octaveShift) ? Math.round(inputs.octaveShift) : 0;
        const dt = typeof ctx?.dt === 'number' ? ctx.dt : 0;
        const render = (chord: Chord | null) =>
          realizer.render({
            tones: chord && spec ? tonesInRegister(tonesOf(chord, spec)) : [],
            context: spec ? { scale: [...scalePitchClasses(spec.root, spec.type)] } : undefined,
            spec: { ...DEFAULT_SPEC, voicing: chordCfg.voicing ?? c.voicing, figuration: chordCfg.rendering ?? c.rendering },
            controls: { ...DEFAULT_CONTROLS, register: shift },
            bpm: chordCfg.bpm ?? c.bpm,
            gain: chordCfg.gain ?? c.gain,
            sound: chordCfg.sound ?? c.sound,
            silentSound: p.sound,
            dt,
          });
        if (!c.enabled || !spec) {
          if (status.enabled) reset();
          return { params: { voices: render(null).voices } satisfies SynthParams, grid: EMPTY_CELL_GRID, status, triad: [] };
        }

        // The harmony starts on the key's tonic, and follows a change of key (a modulation).
        const key = keyOf(spec);
        if (!state) state = applyIntents(initialState(key), [{ kind: 'function', fn: { degree: 0 }, at: ctx.time }]);
        else if (!sameKey(state.key, key)) state = applyIntents(state, [{ kind: 'modulate', key, at: ctx.time }]);

        const moves = WHEEL_MOVES[c.moves];
        const sKey = `${c.moves}|${c.dead}|${c.reach}|${c.enterFrames}`;
        if (!stepper || sKey !== stepperKey) {
          stepper = createDirectionStepper({ wedges: moves.length, dead: c.dead, reach: c.reach, enterFrames: c.enterFrames });
          stepperKey = sKey;
        }

        const frame = inputs.hands as HandsFrame | undefined;
        const aspect = frame && frame.height > 0 && frame.width > 0 ? frame.width / frame.height : 0;
        const region = wheelRegion(c.hand);
        const cells = aspect > 0 ? radial(region, moves.length, { aspect, radius: c.radius }) : [];
        const fresh = !!frame && frame !== lastFrame && !(lastFrame && frame.t !== undefined && frame.t === lastFrame.t);
        lastFrame = frame;
        if (frame && fresh && aspect > 0 && cells.length) {
          const t = captureTime(frame, ctx);
          const hand = frame.hands.find((h) => h.handedness === labelFor(c.hand, c.mirrorHandedness));
          pointer = hand ? displayPoint(hand, frame, c.point) : null;
          if (pointer) lastSeen = t;
          const centre = cells[0];
          const choice = stepper.push(pointer ? { dx: (pointer.x - centre.x) * aspect, dy: pointer.y - centre.y } : null);
          pointing = choice.pointing;
          if (choice.committed !== null) {
            const move = moves[choice.committed];
            const before = state.chord;
            state = applyIntents(state, [{ kind: 'step', relation: move, at: t }]);
            if (state.chord !== before) status = { ...status, moveCount: status.moveCount + 1, lastMove: RELATIONS.get(move)?.label ?? move };
          }
          status = { ...status, armed: choice.armed, steering: !!hand };
        }

        // The face: each expression held a moment makes its move once; a neutral face re-arms.
        let face: string | null = null;
        if (c.steer !== 'hand') {
          if (!faceStepper || faceFrames !== c.faceFrames) {
            faceStepper = createCategoryStepper({ enterFrames: c.faceFrames, rest: 'neutral' });
            faceFrames = c.faceFrames;
          }
          const expr = inputs.expression as ExpressionScores | undefined;
          face = expr?.present ? expr.label : null;
          if (face !== null) lastFace = ctx.time;
          const emotion = faceStepper.push(face);
          const move = emotion && emotion !== 'neutral' ? faceMoveFor(c.moves, c.faceMoves[emotion as Emotion], emotion as Emotion) : null;
          if (move) {
            const before = state.chord;
            state = applyIntents(state, [{ kind: 'step', relation: move, at: ctx.time }]);
            if (state.chord !== before) status = { ...status, moveCount: status.moveCount + 1, lastMove: RELATIONS.get(move)?.label ?? move };
          }
        }

        // Sounding while the steering hand (or face) is seen, and a moment after it is lost.
        const seen = c.steer === 'face' ? lastFace : c.steer === 'both' ? Math.max(lastSeen, lastFace) : lastSeen;
        const sounding = ctx.time - seen <= c.releaseS ? state.chord : null;
        const { voices } = render(sounding);
        const chord = state.chord;
        const k = state.key;
        const gridCells: GridCell[] = chord
          ? cells.map((cell, i) => {
              if (i === 0) return { x: cell.x, y: cell.y, w: cell.w, h: cell.h, shape: 'hex', label: chordName(chord, k), sub: state!.fn?.numeral ?? '', color: colorOf(chord, k), state: sounding ? 'active' : 'idle' };
              const move = moves[i - 1];
              const target = RELATIONS.get(move)?.apply(chord, k)[0];
              return {
                x: cell.x,
                y: cell.y,
                w: cell.w,
                h: cell.h,
                shape: 'hex',
                label: target ? chordName(target, k) : '-',
                sub: RELATIONS.get(move)?.label ?? move,
                color: target ? colorOf(target, k) : OUTSIDE_KEY_COLOR,
                state: pointing === i - 1 && status.armed ? 'candidate' : 'idle',
              };
            })
          : [];
        const grid: CellGrid = { cells: gridCells, captions: [], pointers: pointer ? [pointer] : [] };
        status = {
          ...status,
          enabled: true,
          moves: c.moves,
          key: chordName({ root: k.tonic, quality: k.scale === 'major' ? 'maj' : 'min' }, k),
          chord: chord ? chordName(chord, k) : null,
          numeral: state.fn?.numeral ?? '',
          rejected: state.rejected,
          face,
          steer: c.steer,
        };
        return { params: { voices } satisfies SynthParams, grid, status, triad: sounding ? tonesOf(sounding, spec) : [] };
      },
      dispose() {
        reset();
      },
    };
  },
});
