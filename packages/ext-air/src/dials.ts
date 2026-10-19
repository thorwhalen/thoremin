/**
 * The air instruments' dial slices: the whole-object settings keys the air extension
 * owns (`airDrum`, `airBass`, `airGuitar`, `airFlute`, `chordMap`), each a node's own dial schema lifted
 * into the settings (the flute's also carries the fingering prior, #263). The core settings
 * schema and the dials form spread these in (PR 5a of the instruments-as-graphs ADR), so core
 * `schema.ts` no longer NAMES an air node; it still loads them, through this module.
 *
 * The keys a node never sees as a param (`airDrum.pattern`, `airFlute.prior`) ride the dial
 * because the app resolves them (to a pattern and its model; into the finger model) and hands
 * the result to the node's port; the node's partial parse strips the extra key. The enrolled
 * chords, fingerings and mouth states are not dials: they are zodal collections
 * (`src/app/air/vocabularyStore.ts`).
 *
 * Pure: Zod and the node schemas only.
 */
import { z } from 'zod';
import { AirDrumDialSchema } from './nodes/air_drum';
import { AirBassDialSchema } from './nodes/air_bass';
import { AirGuitarDialSchema } from './nodes/air_guitar';
import { AirFluteDialSchema } from './nodes/air_flute';
import { ChordMapDialSchema } from './nodes/chord_map';
import { ChordWheelDialSchema } from './nodes/chord_wheel';
import { DEFAULT_FINGERING_PRIOR, FingeringPriorSettingsSchema } from './lib/fingering_prior';
import { dialSlice } from '@thoremin/sdk/instruments/extension';

/** The air drum (#233): the node's params ARE the dial, plus the pattern in play (#269: the id
 *  of a trained pattern, '' for none), which the node never sees as a param (the app resolves
 *  it to the pattern and its model and hands those to the node's `pattern` port). */
/** The pads and sticks drawn on the video (#600 S10: the drum's own overlay element; this was
 *  `overlay.drumPads` in core's overlay dial). */
const PadsOnVideoSchema = z.object({ show: z.boolean().default(true) }).prefault({});

export const AirDrumSettingsSchema = AirDrumDialSchema.extend({
  pattern: z.string().default(''),
  padsOnVideo: PadsOnVideoSchema,
});
export type AirDrumSettings = z.infer<typeof AirDrumSettingsSchema>;
export const DEFAULT_AIR_DRUM: AirDrumSettings = AirDrumSettingsSchema.parse({});

export const AirBassSettingsSchema = AirBassDialSchema;
export type AirBassSettings = z.infer<typeof AirBassSettingsSchema>;
export const DEFAULT_AIR_BASS: AirBassSettings = AirBassSettingsSchema.parse({});

export const AirGuitarSettingsSchema = AirGuitarDialSchema;
export type AirGuitarSettings = z.infer<typeof AirGuitarSettingsSchema>;
export const DEFAULT_AIR_GUITAR: AirGuitarSettings = AirGuitarSettingsSchema.parse({});

/** Which screen edge a HUD cue sits on (the overlay's cue layout). */
const CueEdge = z.enum(['left', 'right', 'top', 'bottom']);

/** The breath cue on the video (#600 S10: the flute's own overlay cue; this was
 *  `overlay.mouthCue` in core's overlay dial). */
const BreathCueSchema = z.object({ show: z.boolean().default(true), position: CueEdge.default('left') }).prefault({});

export const AirFluteSettingsSchema = AirFluteDialSchema.extend({
  prior: FingeringPriorSettingsSchema.default(DEFAULT_FINGERING_PRIOR),
  breathCue: BreathCueSchema,
});

/**
 * v1 -> v2 of a dial whose element moved out of core's overlay (#600 S10): the element's options,
 * stored until now at `overlay.<element>` in the same blob (or saved instrument), move to
 * `<dial>.<field>`. Idempotent: a value already there is kept; nothing to move leaves the field
 * for the schema's default. Returns a new value.
 */
const movedFromOverlay = (element: string, field: string, schema: z.ZodTypeAny) => (old: unknown, stored: Readonly<Record<string, unknown>>): unknown => {
  if (!old || typeof old !== 'object' || field in old) return old;
  // Only a valid value moves: a corrupt one (`{ show: null }`) would fail the whole dial's heal
  // and reset everything else in it; it is left behind, and the field takes its default.
  const legacy = schema.safeParse((stored.overlay as Record<string, unknown> | undefined)?.[element]);
  return legacy.success && (stored.overlay as Record<string, unknown> | undefined)?.[element] !== undefined ? { ...(old as object), [field]: legacy.data } : old;
};
export type AirFluteSettings = z.infer<typeof AirFluteSettingsSchema>;
export const DEFAULT_AIR_FLUTE: AirFluteSettings = AirFluteSettingsSchema.parse({});

/** The chord map: the node's params ARE the dial. */
export const ChordMapSettingsSchema = ChordMapDialSchema;
export type ChordMapSettings = z.infer<typeof ChordMapSettingsSchema>;
export const DEFAULT_CHORD_MAP: ChordMapSettings = ChordMapSettingsSchema.parse({});

/** The chord wheel: the node's params ARE the dial. */
export const ChordWheelSettingsSchema = ChordWheelDialSchema;
export const DEFAULT_CHORD_WHEEL = ChordWheelSettingsSchema.parse({});

/** The settings-schema shape the air extension contributes (spread into `SettingsSchema`). */
export const AIR_SETTINGS_SHAPE = {
  airDrum: AirDrumSettingsSchema.default(DEFAULT_AIR_DRUM),
  airBass: AirBassSettingsSchema.default(DEFAULT_AIR_BASS),
  airGuitar: AirGuitarSettingsSchema.default(DEFAULT_AIR_GUITAR),
  airFlute: AirFluteSettingsSchema.default(DEFAULT_AIR_FLUTE),
  chordMap: ChordMapSettingsSchema.default(DEFAULT_CHORD_MAP),
  chordWheel: ChordWheelSettingsSchema.default(DEFAULT_CHORD_WHEEL),
};

/** The same four keys as dial slices: what `store-controls` and the dials form fold over. */
export const AIR_DIAL_SLICES = [
  dialSlice({
    // This slice's own schema version (#600 S9): a stored-shape change bumps it with a migration.
    version: 2,
    // v2 (#600 S10): the pads' show flag moved in from `overlay.drumPads`.
    migrations: { 1: movedFromOverlay('drumPads', 'padsOnVideo', PadsOnVideoSchema) },
    key: 'airDrum',
    schema: AIR_SETTINGS_SHAPE.airDrum,
    kind: 'air-drum-config',
    meta: {
      facets: ['Air drum'],
      title: 'Air drum',
      description: 'Strike the air and hear a drum at the strike: on/off, which hands and point, the sounds, how far ahead a hit is committed, timing magnetism',
    },
  }),
  dialSlice({
    version: 1,
    key: 'airBass',
    schema: AIR_SETTINGS_SHAPE.airBass,
    kind: 'air-bass-config',
    meta: {
      facets: ['Air bass'],
      title: 'Air bass',
      description: 'Play a bass in the air: on/off, which hand plucks, the neck length (where the lowest and highest notes are), how far ahead a note is committed, volume',
    },
  }),
  dialSlice({
    version: 1,
    key: 'airGuitar',
    schema: AIR_SETTINGS_SHAPE.airGuitar,
    kind: 'air-guitar-config',
    meta: {
      facets: ['Air guitar'],
      title: 'Air guitar',
      description: 'Strum enrolled chords in the air: on/off, which hand strums and its point, the strum spread, how far ahead a strum is committed, volume',
    },
  }),
  dialSlice({
    // v2 (#600 S10): the breath cue's options moved in from `overlay.mouthCue`.
    version: 2,
    migrations: { 1: movedFromOverlay('mouthCue', 'breathCue', BreathCueSchema) },
    key: 'airFlute',
    schema: AIR_SETTINGS_SHAPE.airFlute,
    kind: 'air-flute-config',
    meta: {
      facets: ['Air flute'],
      title: 'Air flute',
      description: 'Play enrolled fingerings in the air: on/off, what sounds the note (the enrolled blowing mouth, or a held fingering alone), volume',
    },
  }),
  dialSlice({
    version: 1,
    key: 'chordMap',
    schema: AIR_SETTINGS_SHAPE.chordMap,
    kind: 'chord-map-config',
    meta: {
      facets: ['Chord map'],
      title: 'Chord map',
      description: "Point at a key's chords on the screen: on/off, the layout (the harmonic map, a row by fifths, a row in scale order), hold or strum, which hand points, the melody on the chord's tones",
    },
  }),
  dialSlice({
    key: 'chordWheel',
    schema: AIR_SETTINGS_SHAPE.chordWheel,
    kind: 'chord-wheel-config',
    meta: {
      facets: ['Chord wheel'],
      title: 'Chord wheel',
      description: 'A next-chord wheel: on/off, which moves (the key\'s diatonic moves, or the Tonnetz\'s), which hand steers, its size, how far to push and how long to hold',
    },
  }),
] as const;
