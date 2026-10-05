/**
 * The air instruments' dial slices: the four whole-object settings keys the air extension
 * owns (`airDrum`, `airBass`, `airGuitar`, `airFlute`), each a node's own dial schema lifted
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
import { AirDrumDialSchema } from '@/extensions/air/nodes/air_drum';
import { AirBassDialSchema } from '@/extensions/air/nodes/air_bass';
import { AirGuitarDialSchema } from '@/extensions/air/nodes/air_guitar';
import { AirFluteDialSchema } from '@/extensions/air/nodes/air_flute';
import { DEFAULT_FINGERING_PRIOR, FingeringPriorSettingsSchema } from '@/extensions/air/lib/fingering_prior';
import { dialSlice } from '@/instruments/extension';

/** The air drum (#233): the node's params ARE the dial, plus the pattern in play (#269: the id
 *  of a trained pattern, '' for none), which the node never sees as a param (the app resolves
 *  it to the pattern and its model and hands those to the node's `pattern` port). */
export const AirDrumSettingsSchema = AirDrumDialSchema.extend({
  pattern: z.string().default(''),
});
export type AirDrumSettings = z.infer<typeof AirDrumSettingsSchema>;
export const DEFAULT_AIR_DRUM: AirDrumSettings = AirDrumSettingsSchema.parse({});

export const AirBassSettingsSchema = AirBassDialSchema;
export type AirBassSettings = z.infer<typeof AirBassSettingsSchema>;
export const DEFAULT_AIR_BASS: AirBassSettings = AirBassSettingsSchema.parse({});

export const AirGuitarSettingsSchema = AirGuitarDialSchema;
export type AirGuitarSettings = z.infer<typeof AirGuitarSettingsSchema>;
export const DEFAULT_AIR_GUITAR: AirGuitarSettings = AirGuitarSettingsSchema.parse({});

export const AirFluteSettingsSchema = AirFluteDialSchema.extend({
  prior: FingeringPriorSettingsSchema.default(DEFAULT_FINGERING_PRIOR),
});
export type AirFluteSettings = z.infer<typeof AirFluteSettingsSchema>;
export const DEFAULT_AIR_FLUTE: AirFluteSettings = AirFluteSettingsSchema.parse({});

/** The settings-schema shape the air extension contributes (spread into `SettingsSchema`). */
export const AIR_SETTINGS_SHAPE = {
  airDrum: AirDrumSettingsSchema.default(DEFAULT_AIR_DRUM),
  airBass: AirBassSettingsSchema.default(DEFAULT_AIR_BASS),
  airGuitar: AirGuitarSettingsSchema.default(DEFAULT_AIR_GUITAR),
  airFlute: AirFluteSettingsSchema.default(DEFAULT_AIR_FLUTE),
};

/** The same four keys as dial slices: what `store-controls` and the dials form fold over. */
export const AIR_DIAL_SLICES = [
  dialSlice({
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
    key: 'airFlute',
    schema: AIR_SETTINGS_SHAPE.airFlute,
    kind: 'air-flute-config',
    meta: {
      facets: ['Air flute'],
      title: 'Air flute',
      description: 'Play enrolled fingerings in the air: on/off, what sounds the note (the enrolled blowing mouth, or a held fingering alone), volume',
    },
  }),
] as const;
