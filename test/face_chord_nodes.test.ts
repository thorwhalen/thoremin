/**
 * Tests the three new DAG nodes for the face-mapping chooser (issues #64/#65):
 *   - `face-expression`  : blendshapes → smoothed/held 7-class expression
 *   - `expression-chord` : expression + scale → diatonic triad voices (chord mode)
 *   - `synth-merge`      : union two synth-params streams
 * All pure + headless via replayNode.
 */
import { describe, it, expect } from 'vitest';
import { replayNode } from '@/dag';
import type { NodeContext } from '@/dag';
import { faceExpressionNode, expressionChordNode, synthMergeNode, voiceMappingNode } from '@/nodes';
import { MAX_CHORD_VOICES, ABSENT_HAND, ABSENT_FACE } from '@/nodes';
import type { ExpressionScores } from '@/music/expression';
import { DEFAULT_EXPRESSION_TO_DEGREE, DEFAULT_EXPRESSION_SENSITIVITY } from '@/music/expression';
import { voiceTriad } from '@/music/voicing';
import { diatonicTriad, midiToFreq, type ScaleSpec } from '@/music/theory';
import type { FaceFrame, FaceFeatures, HandFeatures, SynthParams } from '@/nodes';

const frame = (blendshapes: Record<string, number>): FaceFrame => ({ present: true, blendshapes });
const ABSENT_FRAME: FaceFrame = { present: false, blendshapes: {} };
const cMajor: ScaleSpec = { root: 0, type: 'major', octaves: 2, baseOctave: 3 };

async function classify(frames: FaceFrame[], params: Record<string, unknown> = {}) {
  const node = faceExpressionNode.make(faceExpressionNode.params.parse(params));
  const out = await replayNode(node, { face: frames });
  return out.map((o) => o.expression as ExpressionScores);
}

describe('face-expression node', () => {
  it('classifies a smile as happy once smoothing settles', async () => {
    const smile = frame({ mouthSmileLeft: 1, mouthSmileRight: 1 });
    const out = await classify(Array(12).fill(smile), { smoothing: 0.4 });
    expect(out[out.length - 1].label).toBe('happy');
    expect(out[out.length - 1].present).toBe(true);
  });

  it('reports absent + neutral on an absent face', async () => {
    const out = await classify([ABSENT_FRAME]);
    expect(out[0].present).toBe(false);
    expect(out[0].label).toBe('neutral');
  });

  it('keeps the smoothed activation scores in [0,1] every tick', async () => {
    const seq = [
      frame({ mouthSmileLeft: 1, mouthSmileRight: 1 }),
      frame({ jawOpen: 1, eyeWideLeft: 0.8, eyeWideRight: 0.8, browOuterUpLeft: 0.7, browOuterUpRight: 0.7 }),
      ABSENT_FRAME,
      frame({ browDownLeft: 1, browDownRight: 1 }),
    ];
    const out = await classify(seq, { smoothing: 0.5 });
    for (const o of out) {
      for (const s of o.scores) {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      }
    }
  });

  it('a single off-frame does not flip the committed label (EMA + dwell hysteresis)', async () => {
    // After settling on happy, one angry blip should not switch the chord: the
    // slow EMA + the dwell (a switch must persist dwellFrames) both resist it.
    const happy = frame({ mouthSmileLeft: 1, mouthSmileRight: 1 });
    const blip = frame({ browDownLeft: 1, browDownRight: 1 });
    const out = await classify([...Array(10).fill(happy), blip], { smoothing: 0.6, dwellFrames: 3 });
    expect(out[out.length - 1].label).toBe('happy');
  });

  it('respects the live per-emotion sensitivity input (a strict bar abstains to neutral)', async () => {
    const smile = frame({ mouthSmileLeft: 0.7, mouthSmileRight: 0.7 }); // a clear-ish smile
    const run = async (sensitivity?: Record<string, number>) => {
      const node = faceExpressionNode.make(faceExpressionNode.params.parse({ smoothing: 0.3 }));
      const inputs: Record<string, unknown[]> = { face: Array(12).fill(smile) };
      if (sensitivity) inputs.sensitivity = Array(12).fill(sensitivity);
      const out = await replayNode(node, inputs);
      return (out[out.length - 1].expression as ExpressionScores).label;
    };
    // Default sensitivity → the smile clears happy's bar.
    expect(await run()).toBe('happy');
    // Sensitivity 0 for happy raises its threshold above the smile → abstains to neutral.
    expect(await run({ ...DEFAULT_EXPRESSION_SENSITIVITY, happy: 0 })).toBe('neutral');
  });
});

async function chordVoices(
  expr: ExpressionScores,
  faceMapping: string,
  spec: ScaleSpec | undefined = cMajor,
  params: Record<string, unknown> = {},
) {
  const node = expressionChordNode.make(expressionChordNode.params.parse(params));
  const out = await replayNode(node, {
    expression: [expr],
    spec: [spec],
    faceMapping: [faceMapping],
  });
  return out[0];
}

const happyExpr: ExpressionScores = {
  present: true,
  label: 'happy',
  scores: [1, 0, 0, 0, 0, 0],
  thresholds: [0.375, 0.375, 0.4475, 0.375, 0.4475, 0.375],
  fired: [true, false, false, false, false, false],
};

describe('expression-chord node', () => {
  it('voices the diatonic triad with a low bass (default spread voicing, sustained)', async () => {
    const out = await chordVoices(happyExpr, 'chord');
    const params = out.params as SynthParams;
    const triad = diatonicTriad(cMajor, DEFAULT_EXPRESSION_TO_DEGREE.happy); // [48,52,55]
    // The `triad` output is the un-voiced scale triad (for the overlay highlight).
    expect(out.triad).toEqual(triad);
    // The sounding voices are the spread voicing, emitted ascending by pitch.
    const voiced = voiceTriad(triad, 'spread', 0).sort((a, b) => a - b);
    const present = params.voices.filter((v) => v.present);
    expect(present.map((v) => v.id)).toEqual([2, 3, 4, 5]); // 4 stable ids
    expect(present.map((v) => Math.round(v.freq))).toEqual(voiced.map((m) => Math.round(midiToFreq(m))));
    expect(Math.min(...voiced)).toBeLessThan(Math.min(...triad)); // bass is below the scale triad
  });

  it('emits MAX silent voices on stable ids when not in chord mode', async () => {
    for (const mode of ['none', 'timbre']) {
      const out = await chordVoices(happyExpr, mode);
      const params = out.params as SynthParams;
      expect(out.triad).toEqual([]);
      expect(params.voices).toHaveLength(MAX_CHORD_VOICES); // stable ids → synth releases them
      expect(params.voices.every((v) => !v.present && v.gain === 0)).toBe(true);
      expect(params.voices.map((v) => v.id)).toEqual([2, 3, 4, 5]);
    }
  });

  it('follows the live per-expression degree override (happy → V instead of the default I)', async () => {
    const node = expressionChordNode.make(expressionChordNode.params.parse({}));
    const out = await replayNode(node, {
      expression: [happyExpr],
      spec: [cMajor],
      faceMapping: ['chord'],
      degrees: [{ ...DEFAULT_EXPRESSION_TO_DEGREE, happy: 4 }], // override happy → degree 4 (V)
    });
    expect(out[0].triad).toEqual(diatonicTriad(cMajor, 4)); // V triad, not the default tonic
  });

  it('stays silent on a non-seven-note scale even in chord mode', async () => {
    const out = await chordVoices(happyExpr, 'chord', { ...cMajor, type: 'pentatonic' });
    expect(out.triad).toEqual([]);
    expect((out.params as SynthParams).voices.every((v) => !v.present)).toBe(true);
  });

  it('stays silent when the face is absent', async () => {
    const absent: ExpressionScores = {
      present: false,
      label: 'neutral',
      scores: [0, 0, 0, 0, 0, 0],
      thresholds: [0, 0, 0, 0, 0, 0],
      fired: [false, false, false, false, false, false],
    };
    const out = await chordVoices(absent, 'chord');
    expect((out.params as SynthParams).voices.every((v) => !v.present)).toBe(true);
  });

  it('follows the keyboard octave shift in audio while keeping the overlay triad un-shifted', async () => {
    const node = expressionChordNode.make(expressionChordNode.params.parse({}));
    const out = await replayNode(node, {
      expression: [happyExpr],
      spec: [cMajor],
      faceMapping: ['chord'],
      octaveShift: [1],
    });
    const triad = diatonicTriad(cMajor, DEFAULT_EXPRESSION_TO_DEGREE.happy);
    expect(out[0].triad).toEqual(triad); // overlay triad stays at scale pitch (un-shifted)
    // ...but the voiced chord is an octave up, tracking the hand melody.
    const voicedShifted = voiceTriad(triad, 'spread', 1).sort((a, b) => a - b);
    const present = (out[0].params as SynthParams).voices.filter((v) => v.present);
    expect(present.map((v) => Math.round(v.freq))).toEqual(voicedShifted.map((m) => Math.round(midiToFreq(m))));
  });

  it('respects a live chordConfig (volume, voicing) over the static params', async () => {
    const node = expressionChordNode.make(expressionChordNode.params.parse({}));
    const out = await replayNode(node, {
      expression: [happyExpr],
      spec: [cMajor],
      faceMapping: ['chord'],
      chordConfig: [{ gain: 0.5, voicing: 'power' }],
    });
    const triad = diatonicTriad(cMajor, DEFAULT_EXPRESSION_TO_DEGREE.happy);
    const voiced = voiceTriad(triad, 'power', 0); // 3 notes
    const present = (out[0].params as SynthParams).voices.filter((v) => v.present);
    expect(present).toHaveLength(voiced.length);
    expect(present.every((v) => Math.abs(v.gain - 0.5) < 1e-9)).toBe(true); // live gain
  });
});

describe('expression-chord rendering over time (stateful)', () => {
  const node = () => expressionChordNode.make(expressionChordNode.params.parse({}));
  const ctx = (dt: number) => ({ tick: 0, time: 0, dt, resources: {} }) as unknown as NodeContext;
  const aMinor: ScaleSpec = { root: 9, type: 'minor', octaves: 2, baseOctave: 3 };
  const presentCount = (out: Record<string, unknown>) =>
    (out.params as SynthParams).voices.filter((v) => v.present).length;

  it('always emits MAX stable-id voices regardless of mode/rendering (no stuck voices)', () => {
    const n = node();
    for (const rendering of ['sustained', 'arpUp', 'strum'] as const) {
      for (const faceMapping of ['none', 'chord']) {
        const out = n.process(
          { expression: happyExpr, spec: cMajor, faceMapping, chordConfig: { rendering } },
          ctx(1 / 60),
        );
        expect((out.params as SynthParams).voices.map((v) => v.id)).toEqual([2, 3, 4, 5]);
      }
    }
  });

  it('the beat clock advances an arpeggio through the node (one voice at a time)', () => {
    const n = node();
    const ids = new Set<number>();
    for (let i = 0; i < 40; i++) {
      const out = n.process(
        { expression: happyExpr, spec: cMajor, faceMapping: 'chord', chordConfig: { rendering: 'arpUp', bpm: 180 } },
        ctx(1 / 60),
      );
      const present = (out.params as SynthParams).voices.filter((v) => v.present);
      expect(present.length).toBeLessThanOrEqual(1); // arpeggio = one voice at a time
      if (present.length === 1) ids.add(present[0].id);
    }
    expect(ids.size).toBeGreaterThan(1); // the active voice advanced over time
  });

  it('strum re-rolls on a real chord change — including a scale change at a fixed expression', () => {
    const n = node();
    const strum = (spec: ScaleSpec) =>
      n.process(
        { expression: happyExpr, spec, faceMapping: 'chord', chordConfig: { rendering: 'strum' } },
        ctx(1 / 60),
      );
    // Hold the first chord; the strum rolls voices in over a few ticks.
    let out = strum(cMajor);
    for (let i = 0; i < 7; i++) out = strum(cMajor);
    expect(presentCount(out)).toBeGreaterThan(1);
    // Same expression but a DIFFERENT scale = a genuinely different chord → re-roll.
    out = strum(aMinor);
    expect(presentCount(out)).toBe(1); // only the bass at the restart
  });
});

// A present right hand (openness 0 → baseline brightness 0.3) and an expressive
// face — so smile→brightness and mouthOpen→vibrato are measurable when applied.
const presentHand: HandFeatures = {
  right: { ...ABSENT_HAND, present: true, x: 0.5, y: 0.3, openness: 0, pinch: 0 },
  left: { ...ABSENT_HAND },
};
const expressiveFace: FaceFeatures = { ...ABSENT_FACE, present: true, smile: 1, mouthOpen: 1 };

function rightVoiceUnderMode(faceMapping?: string) {
  const node = voiceMappingNode.make(voiceMappingNode.params.parse({}));
  const ctx = {
    tick: 0,
    time: 0,
    dt: 0,
    resources: faceMapping === undefined ? {} : { controls: () => ({ faceMapping }) },
  } as unknown as NodeContext;
  const out = node.process({ features: presentHand, face: expressiveFace }, ctx);
  return (out.params as SynthParams).voices[0];
}

describe('voice-mapping face→timbre suppression (#64 chord mode)', () => {
  it('applies face→timbre in timbre mode AND when no mode is set (back-compat)', () => {
    for (const mode of ['timbre', undefined]) {
      const v = rightVoiceUnderMode(mode);
      expect(v.vibrato).toBeCloseTo(0.6, 5); // mouthOpen → vibrato
      expect(v.brightness).toBeCloseTo(0.8, 5); // smile → brightness (0.3 base + 0.5)
    }
  });

  it('suppresses face→timbre in chord mode (the face drives chords instead)', () => {
    const v = rightVoiceUnderMode('chord');
    expect(v.vibrato).toBeCloseTo(0, 5);
    expect(v.brightness).toBeCloseTo(0.3, 5); // baseline only, no face contribution
  });
});

describe('synth-merge node', () => {
  it('concatenates voices from both inputs', async () => {
    const node = synthMergeNode.make(synthMergeNode.params.parse({}));
    const a: SynthParams = { voices: [{ id: 0, present: true, freq: 440, gain: 0.5, instrument: 'sine' }] };
    const b: SynthParams = { voices: [{ id: 2, present: true, freq: 550, gain: 0.2, instrument: 'triangle' }] };
    const out = await replayNode(node, { a: [a], b: [b] });
    const merged = out[0].params as SynthParams;
    expect(merged.voices.map((v) => v.id)).toEqual([0, 2]);
  });

  it('treats a missing input as no voices (hand voices pass through when chord idle)', async () => {
    const node = synthMergeNode.make(synthMergeNode.params.parse({}));
    const a: SynthParams = { voices: [{ id: 0, present: true, freq: 440, gain: 0.5, instrument: 'sine' }] };
    const out = await replayNode(node, { a: [a] });
    expect((out[0].params as SynthParams).voices).toHaveLength(1);
  });
});
