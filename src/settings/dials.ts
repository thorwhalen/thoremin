/**
 * thoreminDials — thoremin's full settings surface modeled as a zodal-dials
 * definition: a flat dotted keyspace (master / two voices / face / overlay),
 * faceted for the panel, with the chord-needs-a-7-note-scale constraint.
 *
 * This is the schema the settings PANEL renders from (via `@zodal/dials-ui`
 * `toSettingsForm`) and the basis for named "instruments" (profiles = sparse
 * {@link Layer}s). The live audio DAG still reads the synchronous zustand control
 * store, so {@link settingsToLayer} / {@link layerToSettings} bridge the nested
 * {@link Settings} (what the store + persistence speak) and the flat dials Layer
 * (what dials speaks). The mapping is explicit — the keyspace is fixed and small,
 * so a hand-written bijection is clearer and safer than a generic flatten.
 */
import { z } from 'zod';
import { defineDials } from '@zodal/dials-core';
import type { Layer } from '@zodal/dials-core';
import { SCALE_TYPES, type ScaleTypeId } from '@thoremin/sdk/music/theory';
import { SOUND_IDS, type SoundId } from '@thoremin/sdk/music/sounds';
import { VOICINGS, RENDERINGS, type VoicingId, type RenderingId } from '@/music/voicing';
import { FACE_MAPPINGS, type FaceMapping } from '@thoremin/sdk/nodes/domain';
import { DEFAULT_EXPRESSION_SENSITIVITY, DEFAULT_EXPRESSION_TO_DEGREE } from '@/music/expression';
import { OverlayDialSchema } from '@/nodes/output/canvas_overlay.schema';
import { FaceControlsDialSchema, DEFAULT_FACE_CONTROLS_DIAL } from '@/nodes/features/face_controls.schema';
import { ConductorSettingsSchema, DEFAULT_CONDUCTOR } from './schema';
import { CONTRIBUTIONS } from '@/host/contributions';
import { flatDialKey, flatFields } from '@/host/slices';

/** One dials-form field per extension dial slice, with the slice's metadata; a FLAT slice (#600
 *  S13) gives one field per member (`midi.enabled`, or its `flatKeys` name), each with its own
 *  metadata and default. */
function extensionDialFields(): Record<string, z.ZodTypeAny> {
  const out: Record<string, z.ZodTypeAny> = {};
  for (const slice of CONTRIBUTIONS.dialSlices) {
    if (slice.layout === 'flat') for (const [field, schema] of flatFields(slice)) out[flatDialKey(slice, field)] = schema as unknown as z.ZodTypeAny;
    else out[slice.key] = (slice.schema as z.ZodTypeAny).meta(slice.meta);
  }
  return out;
}

/** A settings object's extension slices as dials values: an object slice verbatim, a flat one
 *  spread into its member keys (`midi` -> `midi.enabled`, ...). */
function extensionDialsOf(settings: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const slice of CONTRIBUTIONS.dialSlices) {
    const value = settings[slice.key];
    if (slice.layout !== 'flat') out[slice.key] = value;
    else for (const [field] of flatFields(slice)) out[flatDialKey(slice, field)] = (value as Record<string, unknown> | undefined)?.[field];
  }
  return out;
}

/** Dials values' extension slices as settings: an object slice verbatim, a flat one gathered
 *  back from its member keys. */
function extensionSettingsOf(dials: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const slice of CONTRIBUTIONS.dialSlices) {
    out[slice.key] = slice.layout === 'flat' ? Object.fromEntries(flatFields(slice).map(([field]) => [field, dials[flatDialKey(slice, field)]])) : dials[slice.key];
  }
  return out;
}
import { DEFAULT_HAND_MAP } from '@/nodes/mapping/hand_map.schema';
import { SettingsSchema, HandMapSchema, DEFAULT_EXPRESSION_TARGETS, DEFAULT_FACE_CHORD, DEFAULT_HANDS, type Settings } from './schema';
import { MAX_HANDEDNESS_DWELL_FRAMES } from '@thoremin/sdk/features/handedness';

const ScaleEnum = z.enum(Object.keys(SCALE_TYPES) as [ScaleTypeId, ...ScaleTypeId[]]);
const SoundEnum = z.enum(SOUND_IDS as [SoundId, ...SoundId[]]);
const VoicingEnum = z.enum(VOICINGS as unknown as [VoicingId, ...VoicingId[]]);
const RenderingEnum = z.enum(RENDERINGS as unknown as [RenderingId, ...RenderingId[]]);
const FaceMappingEnum = z.enum(FACE_MAPPINGS as unknown as [FaceMapping, ...FaceMapping[]]);

const voice = (sound: SoundId, facet: string) => ({
  root: z.number().int().min(0).max(11).default(0).meta({ facets: [facet], title: 'Root' }),
  type: ScaleEnum.default('pentatonic').meta({ facets: [facet], title: 'Scale' }),
  // #63: `octaves` is superseded by the range slider (rangeLow/rangeHigh) as the span
  // control. It stays in the keyspace as the integer SHADOW that the slider keeps in sync
  // (and the legacy generateScale fallback for pre-#63 voices), but is marked `hidden` so
  // it generates no palette/AI `set` command — a direct "Set Octaves" would be a silent
  // no-op whenever the range fields are present (generateScale ignores octaves then).
  octaves: z.number().int().min(1).max(4).default(2).meta({ facets: [facet, 'advanced'], title: 'Octaves', hidden: true }),
  baseOctave: z.number().int().min(0).max(8).default(3).meta({ facets: [facet, 'advanced'], title: 'Base octave' }),
  sound: SoundEnum.default(sound).meta({ facets: [facet], title: 'Sound' }),
  // #63 octave RANGE — fractional octaves below/above the locked middle octave. OPTIONAL
  // (NOT `.default(...)`): a default would force a 2-octave range onto any preset/instrument
  // loaded without range (via resolve → applySettings), silently shrinking an octaves≥3
  // instrument. Absent → the hot store falls back to the legacy `octaves` span (exact); the
  // fresh-install default (0/1) is seeded from the hot store, and the double-thumb slider
  // derives its thumbs from `octaves` when the range is absent, writing it on first drag.
  rangeLow: z.number().min(0).max(1).optional().meta({ facets: [facet, 'advanced'], title: 'Range below' }),
  rangeHigh: z.number().min(0).max(1).optional().meta({ facets: [facet, 'advanced'], title: 'Range above' }),
});
const right = voice('warmPad', 'Right hand');
const left = voice('glass', 'Left hand');

export const thoreminDials = defineDials(
  z.object({
    'master.volume': z.number().min(0).max(1).default(0.4).meta({ facets: ['Sound'], title: 'Master volume' }),
    'master.syncHands': z.boolean().default(true).meta({ facets: ['Sound'], title: 'Sync both hands' }),
    // Keyboard-driven globals (#90), now dials so the keymap dispatches commands.
    'master.octaveShift': z.number().int().min(-2).max(2).default(0).meta({ facets: ['Sound', 'advanced'], title: 'Octave shift' }),
    'master.magnetism': z.number().min(0).max(1).default(0.8).meta({ facets: ['Sound', 'advanced'], title: 'Scale magnetism' }),

    'right.root': right.root,
    'right.type': right.type,
    'right.octaves': right.octaves,
    'right.baseOctave': right.baseOctave,
    'right.sound': right.sound,
    'right.rangeLow': right.rangeLow,
    'right.rangeHigh': right.rangeHigh,

    'left.root': left.root,
    'left.type': left.type,
    'left.octaves': left.octaves,
    'left.baseOctave': left.baseOctave,
    'left.sound': left.sound,
    'left.rangeLow': left.rangeLow,
    'left.rangeHigh': left.rangeHigh,

    'face.mapping': FaceMappingEnum.default('none').meta({ facets: ['Face'], title: 'Mapping', description: 'What your facial expression controls' }),
    'faceChord.sound': SoundEnum.default(DEFAULT_FACE_CHORD.sound).meta({ facets: ['Face'], title: 'Chord sound' }),
    'faceChord.volume': z.number().min(0).max(1).default(DEFAULT_FACE_CHORD.volume).meta({ facets: ['Face'], title: 'Chord volume' }),
    'faceChord.voicing': VoicingEnum.default(DEFAULT_FACE_CHORD.voicing).meta({ facets: ['Face'], title: 'Voicing' }),
    'faceChord.rendering': RenderingEnum.default(DEFAULT_FACE_CHORD.rendering).meta({ facets: ['Face'], title: 'Rendering' }),
    'faceChord.bpm': z.number().int().min(40).max(200).default(DEFAULT_FACE_CHORD.bpm).meta({ facets: ['Face'], title: 'Tempo (BPM)' }),
    // #75: the chord-source scale, decoupled from the right-hand melody scale.
    // 'auto' follows the melody (smart default); 'custom' pins chordRoot/chordType.
    'faceChord.chordSource': z.enum(['auto', 'custom']).default(DEFAULT_FACE_CHORD.chordSource).meta({ facets: ['Face'], title: 'Chord source' }),
    'faceChord.chordRoot': z.number().int().min(0).max(11).default(DEFAULT_FACE_CHORD.chordRoot).meta({ facets: ['Face'], title: 'Chord root' }),
    'faceChord.chordType': ScaleEnum.default(DEFAULT_FACE_CHORD.chordType).meta({ facets: ['Face'], title: 'Chord scale' }),


    // The hands reading (#148): the handedness dwell the sound path's `hand-features`
    // applies, live through `store-controls`. 0 = the raw per-frame label (the instrument
    // as it always played); a dwell of N frames absorbs a Left/Right flicker of up to N
    // frames at the cost of N frames of delay on a real hand swap. The field
    // instruments read `hand-features`, and since #314 the instruments that pick a hand by label (drum, bass, guitar, flute) read the same dwell through
    // the trunk's `hands-dwell` node (the chord map and ASL still label hands themselves).
    // Whether to raise the default is #168.
    'hands.handednessDwell': z
      .number()
      .int()
      .min(0)
      .max(MAX_HANDEDNESS_DWELL_FRAMES)
      .default(DEFAULT_HANDS.handednessDwell)
      .meta({
        facets: ['Hand', 'advanced'],
        title: 'Handedness dwell',
        description: 'Field instruments and the drum, bass, guitar and flute (not the chord map or ASL yet): frames a new Left/Right label is held before a hand\'s voice moves to the other side (0 = follow the label at once; 3 absorbs a flicker of up to 3 frames and delays a real hand swap by ~100 ms)',
      }),

    // Complex/structured settings — rendered by bespoke widgets (the expression
    // table, the overlay accordion); carried as whole-object dial values.
    'faceExpr.sensitivity': z
      .record(z.string(), z.number().min(0).max(1))
      .default({ ...DEFAULT_EXPRESSION_SENSITIVITY })
      .meta({ facets: ['Face', 'advanced'], title: 'Expression sensitivity' }),
    'faceExpr.degrees': z
      .record(z.string(), z.number().int().min(-1).max(6))
      .default({ ...DEFAULT_EXPRESSION_TO_DEGREE })
      .meta({ facets: ['Face', 'advanced'], title: 'Expression chord map' }),
    'faceExpr.targets': z
      .record(z.string(), z.string())
      .default({ ...DEFAULT_EXPRESSION_TARGETS })
      .meta({
        facets: ['Face', 'advanced'],
        title: 'Expression moves and functions',
        description: "Per expression: '' plays its degree; 'move:dia+3' (or dia-3, dia+2, dia-2, dia+1, dia-1) moves from the chord in force by a fourth, third or second; 'fn:T', 'fn:S', 'fn:D' go to the nearest tonic, subdominant or dominant chord; 'ctl:seventh' adds the seventh while held",
      }),
    overlay: OverlayDialSchema.default(OverlayDialSchema.parse({})).meta({ facets: ['Overlay'], title: 'Overlay' }),
    // The hand→sound mapping (note source + finger routing + knobs) — a whole-object
    // dial rendered by the bespoke Hand widget, like `overlay` / the expression maps.
    handMap: HandMapSchema.default(DEFAULT_HAND_MAP).meta({ facets: ['Hand'], title: 'Hand mapping' }),
    // The head/face CONTROL axes (#76) — a whole-object dial like `overlay` / `handMap`,
    // rendered by a bespoke widget in the Face panel and reachable leaf-by-leaf through
    // `dial.setIn` (paths.ts derives `faceControls.yawGain`, `faceControls.headRangeDeg`,
    // … straight from this schema). Facet 'Face' so it files with the mapping chooser it
    // belongs to; the panel only shows it in the `controls` mode that uses it.
    faceControls: FaceControlsDialSchema.default(DEFAULT_FACE_CONTROLS_DIAL).meta({
      facets: ['Face', 'advanced'],
      title: 'Face control axes',
      description: 'Per-axis gain / deadzone / neutral zero / smoothing for the head-pose control mode',
    }),
    // The conductor (#187) — a whole-object dial like `faceControls`: `paths.ts` derives
    // `conductor.enabled`, `conductor.hand`, `conductor.servoBeats`, … from the node's own
    // schema, so the panel, the palette, a keybinding and the AI assistant can all start
    // conducting or retune the follower. Off by default.
    conductor: ConductorSettingsSchema.default(DEFAULT_CONDUCTOR).meta({
      facets: ['Conductor'],
      title: 'Conductor',
      description: 'Conduct the score with your hand: on/off, which hand and point to follow, how tightly the score follows the beat',
    }),
    // The extensions' whole-object dials (the air instruments'), one field per slice:
    // `paths.ts` derives `airDrum.enabled`, `airDrum.rightSound`, … from each node's own
    // schema, and the per-dial commands, the palette and the AI tool surface follow.
    ...extensionDialFields(),
  }),
  // No cross-field constraints: since #75 the chord/head-pose modes no longer require
  // a seven-note melody scale — the chord SOURCE (auto-derived or custom) is what a
  // diatonic chord is built from, and a generalized chord is defined on any scale.
);

/**
 * The nested {@link Settings} → the flat dials {@link Layer}. Every key is emitted
 * EXCEPT those whose value is `undefined` (the optional #63 range fields on a legacy
 * voice): an undefined-valued key resolves identically to an absent one, but it does
 * NOT survive a JSON round-trip (localStorage persistence drops it) — so emitting it
 * would make the in-memory working layer structurally differ from a saved copy of
 * itself, and the instruments' dirty compare (key presence counts) would flag a
 * phantom "edited" state on every reload.
 */
export function settingsToLayer(s: Settings): Layer {
  return _dropUndefined({
    'master.volume': s.masterVolume,
    'master.syncHands': s.syncHands,
    'master.octaveShift': s.octaveShift,
    'master.magnetism': s.magnetism,
    'right.root': s.right.root,
    'right.type': s.right.type,
    'right.octaves': s.right.octaves,
    'right.baseOctave': s.right.baseOctave,
    'right.sound': s.right.sound,
    'right.rangeLow': s.right.rangeLow,
    'right.rangeHigh': s.right.rangeHigh,
    'left.root': s.left.root,
    'left.type': s.left.type,
    'left.octaves': s.left.octaves,
    'left.baseOctave': s.left.baseOctave,
    'left.sound': s.left.sound,
    'left.rangeLow': s.left.rangeLow,
    'left.rangeHigh': s.left.rangeHigh,
    'face.mapping': s.faceMapping,
    'faceChord.sound': s.faceChord.sound,
    'faceChord.volume': s.faceChord.volume,
    'faceChord.voicing': s.faceChord.voicing,
    'faceChord.rendering': s.faceChord.rendering,
    'faceChord.bpm': s.faceChord.bpm,
    'faceChord.chordSource': s.faceChord.chordSource,
    'faceChord.chordRoot': s.faceChord.chordRoot,
    'faceChord.chordType': s.faceChord.chordType,
    'faceExpr.sensitivity': s.faceExpr.sensitivity,
    'faceExpr.degrees': s.faceExpr.degrees,
    'faceExpr.targets': s.faceExpr.targets,
    'hands.handednessDwell': s.hands.handednessDwell,
    overlay: s.overlay,
    handMap: s.handMap,
    faceControls: s.faceControls,
    conductor: s.conductor,
    ...extensionDialsOf(s),
  });
}

/** A copy of `layer` without its undefined-valued keys (see {@link settingsToLayer}). */
function _dropUndefined(layer: Layer): Layer {
  return Object.fromEntries(Object.entries(layer).filter(([, v]) => v !== undefined));
}

/** The flat dials effective values → a validated nested {@link Settings}. */
export function layerToSettings(v: Record<string, unknown>): Settings {
  return SettingsSchema.parse({
    masterVolume: v['master.volume'],
    syncHands: v['master.syncHands'],
    octaveShift: v['master.octaveShift'],
    magnetism: v['master.magnetism'],
    right: { root: v['right.root'], type: v['right.type'], octaves: v['right.octaves'], baseOctave: v['right.baseOctave'], sound: v['right.sound'], rangeLow: v['right.rangeLow'], rangeHigh: v['right.rangeHigh'] },
    left: { root: v['left.root'], type: v['left.type'], octaves: v['left.octaves'], baseOctave: v['left.baseOctave'], sound: v['left.sound'], rangeLow: v['left.rangeLow'], rangeHigh: v['left.rangeHigh'] },
    faceMapping: v['face.mapping'],
    faceChord: {
      sound: v['faceChord.sound'],
      volume: v['faceChord.volume'],
      voicing: v['faceChord.voicing'],
      rendering: v['faceChord.rendering'],
      bpm: v['faceChord.bpm'],
      chordSource: v['faceChord.chordSource'],
      chordRoot: v['faceChord.chordRoot'],
      chordType: v['faceChord.chordType'],
    },
    faceExpr: { sensitivity: v['faceExpr.sensitivity'], degrees: v['faceExpr.degrees'], targets: v['faceExpr.targets'] },
    hands: { handednessDwell: v['hands.handednessDwell'] },
    overlay: v.overlay,
    handMap: v.handMap,
    faceControls: v.faceControls,
    conductor: v.conductor,
    ...extensionSettingsOf(v),
  });
}
