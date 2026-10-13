/**
 * The general model is one categorizer (#330 P6), and the general path plays EXACTLY as before.
 *
 * The golden (`fixtures/general_chords.golden.json`) was written BEFORE P6, at the P5 tip
 * (whose general path is main's), by this same replay: the real recording
 * `video_face_expressions` and a scripted face holding each of the seven expression
 * prototypes, through the general model (`face-expression`) and the chord renderer
 * (`expression-chord`) as `face-chord` joins them, under the default degrees and a custom map
 * (a silenced expression, a sounding neutral). Every frame's chord voices, triad and decided
 * label are hashed per scenario, so "byte-identical" is literal; the run-length label and
 * triad sequence beside each hash says what the chords were. `GOLDEN_WRITE=1` rewrites it,
 * which a change to the general path must never need.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { replayNode } from '@thoremin/dag';
import {
  ABSENT_EXPRESSION,
  categorizerReading,
  DEFAULT_EXPRESSION_TO_DEGREE,
  EMOTIONS,
  EXPRESSION_PROTOTYPES,
  GENERAL_CATEGORIZER_ID,
  generalReading,
  personalDegree,
  readingName,
  SILENCE_DEGREE,
  type ExpressionLabel,
  type ExpressionScores,
} from '@thoremin/sdk/music/expression';
import { faceCategorizerNode } from '@thoremin/ext-faces/nodes/face_categorizer';
import { DEFAULT_FACE_CATEGORIZER, GENERAL_CATEGORIZER } from '@thoremin/ext-faces/schema';
import type { ScaleSpec } from '@thoremin/sdk/music/theory';
import type { FaceFrame } from '@thoremin/sdk/nodes/domain';
import { faceExpressionNode } from '@/nodes/features/face_expression';
import { expressionChordNode } from '@/nodes/music/expression_chord';
import { RECORDING_FPS, recordedFrames } from '../helpers/faceRecording';

const GOLDEN = join(__dirname, 'fixtures', 'general_chords.golden.json');
const cMajor: ScaleSpec = { root: 0, type: 'major', octaves: 2, baseOctave: 3 };

/** A face holding each prototype in turn (at full strength), resting between: all seven labels. */
function prototypeFrames(): FaceFrame[] {
  const rest: FaceFrame = { present: true, landmarks: [], blendshapes: {} } as unknown as FaceFrame;
  const out: FaceFrame[] = [];
  const hold = (f: FaceFrame, n: number) => {
    for (let i = 0; i < n; i++) out.push(f);
  };
  hold(rest, 10);
  for (const e of EMOTIONS) {
    hold({ ...rest, blendshapes: { ...EXPRESSION_PROTOTYPES[e] } } as FaceFrame, 20);
    hold(rest, 10);
  }
  hold({ present: false } as unknown as FaceFrame, 5);
  return out;
}

const DEGREE_MAPS: Record<string, Partial<Record<ExpressionLabel, number>>> = {
  default: DEFAULT_EXPRESSION_TO_DEGREE,
  custom: { ...DEFAULT_EXPRESSION_TO_DEGREE, happy: -1, neutral: 4, kiss: 6, surprised: 0 },
};

/** The two ways the general reading reaches the chord: `face-chord`'s edges (core), or through
 *  the faces extension's `face-categorizer` with the dial naming `general` (or an id this device
 *  does not have), its category slots set but meaning nothing to the general model. */
type Route = 'face-chord' | 'categorizer-general' | 'categorizer-missing';

async function replay(frames: readonly FaceFrame[], degrees: Partial<Record<ExpressionLabel, number>>, route: Route = 'face-chord') {
  const general = faceExpressionNode.make(faceExpressionNode.params.parse({}));
  let read = await replayNode(general, { face: [...frames] }, { dt: 1 / RECORDING_FPS });
  let categoryDegrees: unknown[] | undefined;
  if (route !== 'face-chord') {
    const config = { ...DEFAULT_FACE_CATEGORIZER, id: route === 'categorizer-general' ? GENERAL_CATEGORIZER : 'not-here', degrees: { ...DEFAULT_FACE_CATEGORIZER.degrees, 'cat-1': 5, 'cat-2': SILENCE_DEGREE } };
    const node = faceCategorizerNode.make(faceCategorizerNode.params.parse({}));
    const out = await replayNode(node, { face: [...frames], general: read.map((r) => r.expression), model: frames.map(() => null), config: frames.map(() => config) }, { dt: 1 / RECORDING_FPS });
    read = out.map((o) => ({ expression: o.expression }));
    categoryDegrees = out.map((o) => o.degrees);
  }
  const chord = expressionChordNode.make(expressionChordNode.params.parse({}));
  const played = await replayNode(chord, {
    expression: read.map((r) => r.expression),
    ...(categoryDegrees ? { categoryDegrees } : {}),
    spec: frames.map(() => cMajor),
    faceMapping: frames.map(() => 'chord'),
    degrees: frames.map(() => degrees),
  }, { dt: 1 / RECORDING_FPS });
  return played.map((p, i) => ({ params: p.params, triad: p.triad, label: (read[i].expression as ExpressionScores).label }));
}

/** `label:triad` runs, e.g. `neutral:-x10 happy:0,2,4x20`. */
function runs(frames: { label: string; triad: unknown }[]): string {
  const out: string[] = [];
  let prev = '';
  let n = 0;
  for (const f of frames) {
    const key = `${f.label}:${(f.triad as number[]).join(',') || '-'}`;
    if (key === prev) n++;
    else {
      if (n) out.push(`${prev}x${n}`);
      prev = key;
      n = 1;
    }
  }
  if (n) out.push(`${prev}x${n}`);
  return out.join(' ');
}

const SCENARIOS = { recording: recordedFrames, prototypes: prototypeFrames } as const;

describe('the general path plays exactly as before P6', () => {
  it('chords, triads and labels are byte-identical to the golden, per scenario and degree map', async () => {
    const actual: Record<string, { sha256: string; runs: string }> = {};
    for (const [scenario, frames] of Object.entries(SCENARIOS)) {
      for (const [map, degrees] of Object.entries(DEGREE_MAPS)) {
        const out = await replay(frames(), degrees);
        // The chord voices and triad as the synth and overlay get them (the played reading's
        // shape is P6's change; what it decided is the label, hashed with them).
        const bytes = JSON.stringify(out.map((f) => ({ params: f.params, triad: f.triad, label: f.label })));
        actual[`${scenario}/${map}`] = { sha256: createHash('sha256').update(bytes).digest('hex'), runs: runs(out) };
      }
    }
    if (process.env.GOLDEN_WRITE === '1') writeFileSync(GOLDEN, `${JSON.stringify(actual, null, 1)}\n`);
    expect(actual).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')));
    // Every expression was read at least once, so every degree rule was exercised.
    for (const e of EMOTIONS) expect(actual['prototypes/default'].runs).toContain(`${e}:`);
  });

  it('the general model through the face-categorizer node (the dial naming general, or a missing id) plays the same bytes', async () => {
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, { sha256: string }>;
    for (const route of ['categorizer-general', 'categorizer-missing'] as const) {
      for (const [map, degrees] of Object.entries(DEGREE_MAPS)) {
        const out = await replay(prototypeFrames(), degrees, route);
        const bytes = JSON.stringify(out.map((f) => ({ params: f.params, triad: f.triad, label: f.label })));
        expect(createHash('sha256').update(bytes).digest('hex'), `${route}/${map}`).toBe(golden[`prototypes/${map}`].sha256);
      }
    }
  });
});

describe('the general model is one categorizer', () => {
  it('reads as a categorizer whose categories are the seven expressions, neutral its none of these', () => {
    const r = generalReading('happy');
    expect(r).toMatchObject({ categorizer: GENERAL_CATEGORIZER_ID, id: 'happy', name: 'happy', noneName: 'neutral' });
    expect(r.ids).toEqual(EMOTIONS);
    expect(r.standsFor).toEqual(EMOTIONS);
    expect(generalReading('neutral')).toMatchObject({ id: null, name: null });
    expect(GENERAL_CATEGORIZER).toBe(GENERAL_CATEGORIZER_ID);
  });

  it('its per-category degrees are the instrument\'s expression degrees, for every label', () => {
    const degrees: Partial<Record<ExpressionLabel, number>> = { happy: SILENCE_DEGREE, neutral: 3 };
    const degreeFor = (l: ExpressionLabel): number => degrees[l] ?? DEFAULT_EXPRESSION_TO_DEGREE[l];
    for (const label of ['neutral', ...EMOTIONS] as ExpressionLabel[]) {
      const r = generalReading(label);
      expect(personalDegree(r, r.id === null ? null : r.ids.indexOf(r.id), undefined, degreeFor), label).toBe(degreeFor(label));
    }
  });

  it('names what it read as before (an expression, or neutral), and reads an old reading as the general one', async () => {
    const out = await replayNode(faceExpressionNode.make(faceExpressionNode.params.parse({})), { face: prototypeFrames() }, { dt: 1 / RECORDING_FPS });
    for (const o of out) {
      const e = o.expression as ExpressionScores;
      expect(e.personal?.categorizer).toBe(GENERAL_CATEGORIZER_ID);
      expect(readingName(e)).toBe(e.label);
    }
    const legacy: ExpressionScores = { present: true, label: 'sad', scores: [], thresholds: [], fired: [] };
    expect(categorizerReading(legacy)).toEqual(generalReading('sad'));
    expect(readingName({ label: 'neutral' })).toBe('neutral');
    expect(readingName(ABSENT_EXPRESSION)).toBe('neutral');
    // An absent reading carries no categorizer of its own, so a producer spreading it and
    // setting a label is read by that label.
    expect(ABSENT_EXPRESSION.personal).toBeUndefined();
    expect(readingName({ ...ABSENT_EXPRESSION, label: 'sad' })).toBe('sad');
    // A player's categorizer keeps its own "none of these".
    expect(readingName({ label: 'neutral', personal: { id: null, name: null, ids: ['cat-1'], names: ['smile'], standsFor: ['happy'] } })).toBe('none of these');
  });
});
