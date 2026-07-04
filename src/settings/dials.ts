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
import { SCALE_TYPES, isSevenNoteScale, type ScaleTypeId } from '@/music/theory';
import { SOUND_IDS, type SoundId } from '@/music/sounds';
import { VOICINGS, RENDERINGS, type VoicingId, type RenderingId } from '@/music/voicing';
import { FACE_MAPPINGS, type FaceMapping } from '@/nodes/domain';
import { DEFAULT_EXPRESSION_SENSITIVITY, DEFAULT_EXPRESSION_TO_DEGREE } from '@/music/expression';
import { OverlayParamsSchema } from '@/nodes/output/canvas_overlay';
import { DEFAULT_HAND_MAP } from '@/nodes/mapping/hand_map';
import { SettingsSchema, HandMapSchema, DEFAULT_FACE_CHORD, type Settings } from './schema';

const ScaleEnum = z.enum(Object.keys(SCALE_TYPES) as [ScaleTypeId, ...ScaleTypeId[]]);
const SoundEnum = z.enum(SOUND_IDS as [SoundId, ...SoundId[]]);
const VoicingEnum = z.enum(VOICINGS as unknown as [VoicingId, ...VoicingId[]]);
const RenderingEnum = z.enum(RENDERINGS as unknown as [RenderingId, ...RenderingId[]]);
const FaceMappingEnum = z.enum(FACE_MAPPINGS as unknown as [FaceMapping, ...FaceMapping[]]);

const voice = (sound: SoundId, facet: string) => ({
  root: z.number().int().min(0).max(11).default(0).meta({ facets: [facet], title: 'Root' }),
  type: ScaleEnum.default('pentatonic').meta({ facets: [facet], title: 'Scale' }),
  octaves: z.number().int().min(1).max(4).default(2).meta({ facets: [facet], title: 'Octaves' }),
  baseOctave: z.number().int().min(0).max(8).default(3).meta({ facets: [facet, 'advanced'], title: 'Base octave' }),
  sound: SoundEnum.default(sound).meta({ facets: [facet], title: 'Sound' }),
});
const right = voice('warmPad', 'Right hand');
const left = voice('glass', 'Left hand');

export const thoreminDials = defineDials(
  z.object({
    'master.volume': z.number().min(0).max(1).default(0.4).meta({ facets: ['Sound'], title: 'Master volume' }),
    'master.syncHands': z.boolean().default(true).meta({ facets: ['Sound'], title: 'Sync both hands' }),

    'right.root': right.root,
    'right.type': right.type,
    'right.octaves': right.octaves,
    'right.baseOctave': right.baseOctave,
    'right.sound': right.sound,

    'left.root': left.root,
    'left.type': left.type,
    'left.octaves': left.octaves,
    'left.baseOctave': left.baseOctave,
    'left.sound': left.sound,

    'face.mapping': FaceMappingEnum.default('none').meta({ facets: ['Face'], title: 'Mapping', description: 'What your facial expression controls' }),
    'faceChord.sound': SoundEnum.default(DEFAULT_FACE_CHORD.sound).meta({ facets: ['Face'], title: 'Chord sound' }),
    'faceChord.volume': z.number().min(0).max(1).default(DEFAULT_FACE_CHORD.volume).meta({ facets: ['Face'], title: 'Chord volume' }),
    'faceChord.voicing': VoicingEnum.default(DEFAULT_FACE_CHORD.voicing).meta({ facets: ['Face'], title: 'Voicing' }),
    'faceChord.rendering': RenderingEnum.default(DEFAULT_FACE_CHORD.rendering).meta({ facets: ['Face'], title: 'Rendering' }),
    'faceChord.bpm': z.number().int().min(40).max(200).default(DEFAULT_FACE_CHORD.bpm).meta({ facets: ['Face'], title: 'Tempo (BPM)' }),

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
    overlay: OverlayParamsSchema.default(OverlayParamsSchema.parse({})).meta({ facets: ['Overlay'], title: 'Overlay' }),
    // The hand→sound mapping (note source + finger routing + knobs) — a whole-object
    // dial rendered by the bespoke Hand widget, like `overlay` / the expression maps.
    handMap: HandMapSchema.default(DEFAULT_HAND_MAP).meta({ facets: ['Hand'], title: 'Hand mapping' }),
  }),
  {
    constraints: {
      assertions: [
        {
          message:
            'Chord and head-pose face-mappings need a 7-note scale (Major / Natural Minor / Harmonic Minor) on the right hand.',
          keys: ['face.mapping', 'right.type'],
          check: (v) => {
            const m = v['face.mapping'];
            return (m !== 'chord' && m !== 'controls') || isSevenNoteScale(v['right.type'] as ScaleTypeId);
          },
        },
      ],
    },
  },
);

/** The nested {@link Settings} → the flat dials {@link Layer} (every key set). */
export function settingsToLayer(s: Settings): Layer {
  return {
    'master.volume': s.masterVolume,
    'master.syncHands': s.syncHands,
    'right.root': s.right.root,
    'right.type': s.right.type,
    'right.octaves': s.right.octaves,
    'right.baseOctave': s.right.baseOctave,
    'right.sound': s.right.sound,
    'left.root': s.left.root,
    'left.type': s.left.type,
    'left.octaves': s.left.octaves,
    'left.baseOctave': s.left.baseOctave,
    'left.sound': s.left.sound,
    'face.mapping': s.faceMapping,
    'faceChord.sound': s.faceChord.sound,
    'faceChord.volume': s.faceChord.volume,
    'faceChord.voicing': s.faceChord.voicing,
    'faceChord.rendering': s.faceChord.rendering,
    'faceChord.bpm': s.faceChord.bpm,
    'faceExpr.sensitivity': s.faceExpr.sensitivity,
    'faceExpr.degrees': s.faceExpr.degrees,
    overlay: s.overlay,
    handMap: s.handMap,
  };
}

/** The flat dials effective values → a validated nested {@link Settings}. */
export function layerToSettings(v: Record<string, unknown>): Settings {
  return SettingsSchema.parse({
    masterVolume: v['master.volume'],
    syncHands: v['master.syncHands'],
    right: { root: v['right.root'], type: v['right.type'], octaves: v['right.octaves'], baseOctave: v['right.baseOctave'], sound: v['right.sound'] },
    left: { root: v['left.root'], type: v['left.type'], octaves: v['left.octaves'], baseOctave: v['left.baseOctave'], sound: v['left.sound'] },
    faceMapping: v['face.mapping'],
    faceChord: {
      sound: v['faceChord.sound'],
      volume: v['faceChord.volume'],
      voicing: v['faceChord.voicing'],
      rendering: v['faceChord.rendering'],
      bpm: v['faceChord.bpm'],
    },
    faceExpr: { sensitivity: v['faceExpr.sensitivity'], degrees: v['faceExpr.degrees'] },
    overlay: v.overlay,
    handMap: v.handMap,
  });
}
