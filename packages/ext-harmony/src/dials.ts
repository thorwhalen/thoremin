/**
 * The harmony slice's dial slices (#674; the air extension's until then): the chord map, the chord
 * wheel and the chord chart, each a node's own dial schema lifted into the settings (the chord map's
 * also carries whether its grid is drawn on the video). Their keys, kinds and versions are what they
 * were, so a stored state and a saved instrument read back byte-identical: a slice is keyed by its
 * dial key, whichever extension declares it.
 *
 * Pure: Zod and the node schemas only.
 */
import { z } from 'zod';
import { dialSlice } from '@thoremin/sdk/instruments/extension';
// v1 -> v2 of a dial whose element moved out of core's overlay (#610 item 4).
import { movedFromOverlay } from '@thoremin/sdk/overlay/moved';
import { ChordMapDialSchema } from './nodes/chord_map';
import { ChordWheelDialSchema } from './nodes/chord_wheel';
import { ChordChartDialSchema } from './nodes/chord_chart';

/** The chord map's grid drawn on the video (#610 item 4: the map's own overlay element; this was
 *  `overlay.cellGrid` in core's overlay dial). */
const GridOnVideoSchema = z.object({ show: z.boolean().default(true) }).prefault({});

/** The chord map: the node's params, plus whether its grid is drawn on the video. */
export const ChordMapSettingsSchema = ChordMapDialSchema.extend({ gridOnVideo: GridOnVideoSchema });
export type ChordMapSettings = z.infer<typeof ChordMapSettingsSchema>;
export const DEFAULT_CHORD_MAP: ChordMapSettings = ChordMapSettingsSchema.parse({});

/** The chord wheel: the node's params ARE the dial. */
export const ChordWheelSettingsSchema = ChordWheelDialSchema;
export const DEFAULT_CHORD_WHEEL = ChordWheelSettingsSchema.parse({});

/** The chord chart (H9 of #613): the node's params ARE the dial. */
export const ChordChartSettingsSchema = ChordChartDialSchema;
export const DEFAULT_CHORD_CHART = ChordChartSettingsSchema.parse({});

/** The settings-schema shape the harmony slice contributes (spread into `SettingsSchema`). */
export const HARMONY_SETTINGS_SHAPE = {
  chordMap: ChordMapSettingsSchema.default(DEFAULT_CHORD_MAP),
  chordWheel: ChordWheelSettingsSchema.default(DEFAULT_CHORD_WHEEL),
  chordChart: ChordChartSettingsSchema.default(DEFAULT_CHORD_CHART),
};

/** The same three keys as dial slices: what `store-controls` and the dials form fold over. */
export const HARMONY_DIAL_SLICES = [
  dialSlice({
    version: 2,
    // v2 (#610 item 4): the grid's show flag moved in from `overlay.cellGrid`.
    migrations: { 1: movedFromOverlay('cellGrid', 'gridOnVideo', GridOnVideoSchema) },
    key: 'chordMap',
    schema: HARMONY_SETTINGS_SHAPE.chordMap,
    kind: 'chord-map-config',
    meta: {
      facets: ['Chord map'],
      title: 'Chord map',
      description: "Point at a key's chords on the screen: on/off, the layout (the harmonic map, a row by fifths, a row in scale order), hold or strum, which hand points, the melody on the chord's tones",
    },
  }),
  dialSlice({
    key: 'chordWheel',
    schema: HARMONY_SETTINGS_SHAPE.chordWheel,
    kind: 'chord-wheel-config',
    meta: {
      facets: ['Chord wheel'],
      title: 'Chord wheel',
      description: 'A next-chord wheel: on/off, which moves (the key\'s diatonic moves, or the Tonnetz\'s), which hand steers, its size, how far to push and how long to hold',
    },
  }),
  dialSlice({
    key: 'chordChart',
    schema: HARMONY_SETTINGS_SHAPE.chordChart,
    kind: 'chord-chart-config',
    meta: {
      facets: ['Chord chart'],
      title: 'Chord chart',
      description: "Conduct a chord chart: on/off, and how much of the conducted piece is read as one chord (a beat, two, a bar)",
    },
  }),
] as const;
