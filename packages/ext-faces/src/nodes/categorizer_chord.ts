/**
 * The `categorizer-chord` node (#450): a saved hand-shape or pose categorizer, read live, playing
 * a chord per category. One node for every modality but the face (whose chords keep the general
 * expression model as their fallback, `face-categorizer`): the merged feature vector is read the
 * way the tool's live test reads it (the categorizer's projection, with its hand and mirror;
 * "cannot see you" below its trained coverage; the classifier and its hysteresis), the settled
 * category turned into a scale degree (the dial's own, else Auto by its position: I, IV, V, vi...;
 * none of these is silence), and that degree voiced and rendered on the chord-source scale by
 * the SDK's chord renderer, with the instrument's chord settings, so it sounds like the face
 * chords. Its voices are a block of their own ({@link CATEGORIZER_CHORD_VOICE_ID_BASE}), so it can
 * play under the face chords and the score.
 *
 * Outputs: the voices (`params`), the reading for the overlay's category cues (`category`, on its
 * own `chordCategories` input) and the un-voiced triad. The model is a transient the host resolves
 * off the tick; only the model the dial names plays. The engine ticks faster than the camera, so a
 * camera frame seen already is not a new reading (the hysteresis counts camera frames; `frame` is
 * the frame, since the vector node builds a new vector every tick), while the chord renderer runs
 * every tick (its beat clock).
 */
import { z } from 'zod';
import { defineNode, type NodeContext } from '@thoremin/dag';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import type { CategoryScores, VoiceParams } from '@thoremin/sdk/nodes/domain';
import type { ScaleSpec } from '@thoremin/sdk/music/theory';
import { SoundSchema } from '@thoremin/sdk/music/sounds';
import { RENDERINGS, VOICINGS, type RenderingId, type VoicingId } from '@thoremin/sdk/music/voicing';
import { createChordRenderer } from '@thoremin/sdk/music/chord_render';
import { createLiveReader, type LiveReader } from '@thoremin/sdk/enroll/live';
import { absentChordScores, categoryIndex, toChordScores, type CategorizerChordPlay } from '../lib/categorizerChord';
import { chordDegreeOf, type CategorizerChordsDial } from '../schema';

/** The first voice id of the categorizer chord: a block of its own, far from the hand voices, the
 *  face and pose chords, the score (which counts up from 11), the air flute (1_000_000) and ASL's
 *  sign chords (2_000_000). A test keeps the blocks disjoint. */
export const CATEGORIZER_CHORD_VOICE_ID_BASE = 3_000_000;
/** The largest voicing is four notes. */
export const MAX_CATEGORIZER_CHORD_VOICES = 4;

const Params = z.object({
  /** The chord's volume when the instrument's chord settings say none. */
  gain: z.number().min(0).max(1).default(0.22),
  sound: SoundSchema.default('triangle'),
  voicing: z.enum(VOICINGS).default('spread'),
  rendering: z.enum(RENDERINGS).default('sustained'),
  bpm: z.number().min(40).max(200).default(100),
});
type Params = z.infer<typeof Params>;

/** The instrument's chord settings (the face chords' too). */
interface ChordConfig {
  sound?: VoiceParams['sound'];
  gain?: number;
  voicing?: VoicingId;
  rendering?: RenderingId;
  bpm?: number;
}

const NOTHING: CategoryScores = { present: false, label: null, labels: [], scores: [] };

export const categorizerChordNode = defineNode<Params>({
  type: 'categorizer-chord',
  roles: ['feature', 'music'],
  title: 'Categorizer Chord',
  description: 'Your own hand-shape or pose categorizer (#450), read live: each of your categories plays a chord on the chord-source scale.',
  inputs: [
    // The merged feature vector of the categorizer's part (`hand.*` or `body.*`).
    { name: 'vector', kind: 'feature-vector' },
    // The camera frame the vector was computed from (its identity marks a new camera frame; the
    // vector node builds a new object every tick). Absent: the vector's identity is used.
    { name: 'frame', kind: 'any' },
    // The resolved categorizer (a transient the host sets off the tick), or null.
    { name: 'model', kind: 'categorizer-chords-model' },
    // The instrument's dial: which categorizer, and each category's degree.
    { name: 'config', kind: 'categorizer-chords-config' },
    { name: 'spec', kind: 'scale-spec' },
    { name: 'octaveShift', kind: 'number', default: 0 },
    { name: 'chordConfig', kind: 'chord-config' },
  ],
  outputs: [
    { name: 'params', kind: 'synth-params' },
    { name: 'category', kind: 'category-scores' },
    { name: 'triad', kind: 'number[]' },
  ],
  params: Params,
  make(p) {
    const renderer = createChordRenderer({ idBase: CATEGORIZER_CHORD_VOICE_ID_BASE, maxVoices: MAX_CATEGORIZER_CHORD_VOICES });
    let current: CategorizerChordPlay | null = null;
    let reader: LiveReader | null = null;
    /** The last camera frame read (or vector, with no frame wired). */
    let lastClock: unknown;
    let lastCategory: CategoryScores = NOTHING;
    let lastId: string | null = null;

    const bind = (play: CategorizerChordPlay | null): void => {
      if (play === current) return;
      current = play;
      reader = play ? createLiveReader(play.live) : null;
      lastClock = undefined;
      lastId = null;
      lastCategory = play ? absentChordScores(play) : NOTHING;
    };

    /** One camera frame: absent without the part, or with too little of what was trained. */
    const read = (vector: FeatureVector | undefined): void => {
      if (!current || !reader) return;
      const projected = vector ? current.live.project(vector) : null;
      if (!projected || Object.keys(projected).length === 0 || !current.live.inView(projected)) {
        reader.reset();
        lastId = null;
        lastCategory = absentChordScores(current);
        return;
      }
      const reading = reader.push(projected);
      lastId = reading.categoryId;
      lastCategory = toChordScores(current, reading);
    };

    return {
      process(inputs, ctx: NodeContext) {
        const config = inputs.config as Partial<CategorizerChordsDial> | undefined;
        const model = (inputs.model as CategorizerChordPlay | null | undefined) ?? null;
        bind(model && config?.id === model.id ? model : null);
        const vector = inputs.vector as FeatureVector | undefined;
        const clock = inputs.frame ?? vector;
        if (current && clock !== lastClock) {
          lastClock = clock;
          read(vector);
        }
        const cfg = (inputs.chordConfig as ChordConfig | undefined) ?? {};
        const degree = current ? chordDegreeOf(config, lastId, categoryIndex(current, lastId)) : -1;
        const { voices, triad } = renderer.render({
          degree,
          spec: inputs.spec as ScaleSpec | undefined,
          voicing: cfg.voicing ?? p.voicing,
          rendering: cfg.rendering ?? p.rendering,
          bpm: cfg.bpm ?? p.bpm,
          octaveShift: typeof inputs.octaveShift === 'number' ? inputs.octaveShift : 0,
          gain: cfg.gain ?? p.gain,
          sound: cfg.sound ?? p.sound,
          silentSound: p.sound,
          dt: typeof ctx?.dt === 'number' ? ctx.dt : 0,
        });
        return { params: { voices }, category: current ? lastCategory : NOTHING, triad };
      },
    };
  },
});
