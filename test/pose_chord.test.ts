/**
 * Tests the `pose-chord` node and its helpers (issue #76): head/face pose axes →
 * a voiced, rendered diatonic chord in the `controls` face mode. Pure + headless
 * via replayNode; the default `sustained` rendering makes every voiced note
 * sound each tick, so a single tick reflects the mapping.
 */
import { describe, it, expect } from 'vitest';
import { replayNode } from '@/dag';
import { poseChordNode, yawToDegree, POSE_VOICE_ID_BASE, MAX_POSE_VOICES } from '@/nodes';
import { ABSENT_FACE_CONTROLS, type FaceControls, type VoiceParams } from '@/nodes/domain';
import { diatonicChord, diatonicTriad, midiToFreq, type ScaleSpec } from '@/music/theory';
import { voiceTriad } from '@/music/voicing';

const cMajor: ScaleSpec = { root: 0, type: 'major', octaves: 2, baseOctave: 3 };
const pentatonic: ScaleSpec = { root: 0, type: 'pentatonic', octaves: 2, baseOctave: 3 };

const ctrl = (patch: Partial<FaceControls>): FaceControls => ({
  ...ABSENT_FACE_CONTROLS,
  present: true,
  ...patch,
});

/** yaw that lands on a given degree (each degree is a 1/7 slice of [-1,1]). */
const yawForDegree = (d: number): number => -1 + ((d + 0.5) / 7) * 2;

async function play(
  controls: FaceControls,
  {
    spec = cMajor,
    faceMapping = 'controls',
    octaveShift = 0,
    chordConfig,
    params = {},
  }: {
    spec?: ScaleSpec;
    faceMapping?: string;
    octaveShift?: number;
    chordConfig?: Record<string, unknown>;
    params?: Record<string, unknown>;
  } = {},
): Promise<{ voices: VoiceParams[]; chord: number[] }> {
  const node = poseChordNode.make(poseChordNode.params.parse(params));
  const inputs: Record<string, unknown[]> = {
    controls: [controls],
    spec: [spec],
    faceMapping: [faceMapping],
    octaveShift: [octaveShift],
  };
  if (chordConfig) inputs.chordConfig = [chordConfig];
  const [out] = await replayNode(node, inputs);
  return { voices: (out.params as { voices: VoiceParams[] }).voices, chord: out.chord as number[] };
}

const sounding = (voices: VoiceParams[]): VoiceParams[] => voices.filter((v) => v.present && v.gain > 0);

describe('yawToDegree', () => {
  it('sweeps [-1,1] across the seven diatonic degrees', () => {
    expect(yawToDegree(-1)).toBe(0);
    expect(yawToDegree(1)).toBe(6);
    expect(yawToDegree(0)).toBe(3);
    expect(yawToDegree(-2)).toBe(0); // clamped
    expect(yawToDegree(2)).toBe(6); // clamped
  });
});

describe('diatonicChord', () => {
  it('extends the triad with the diatonic 7th at size 4', () => {
    const triad = diatonicChord(cMajor, 0, 3);
    const seventh = diatonicChord(cMajor, 0, 4);
    expect(seventh.slice(0, 3)).toEqual(triad);
    expect(seventh).toHaveLength(4);
    // C major I7: C E G B → the 7th is 11 semitones above the root.
    expect(seventh[3] - seventh[0]).toBe(11);
  });

  it('matches diatonicTriad for size 3', () => {
    expect(diatonicChord(cMajor, 4, 3)).toEqual(diatonicTriad(cMajor, 4));
  });

  it('generalizes to a non-seven-note scale; negative degree stays silent (#75)', () => {
    // C major pentatonic {C,D,E,G,A}, L=5: degree 0 stacks its own thirds → C,E,A.
    expect(diatonicChord(pentatonic, 0, 3)).toEqual([48, 52, 57]);
    // The negative-degree silence sentinel still returns [].
    expect(diatonicChord(cMajor, -1, 3)).toEqual([]);
  });
});

describe('pose-chord node', () => {
  it('is silent in every non-controls mode', async () => {
    for (const mode of ['none', 'timbre', 'chord']) {
      const { voices, chord } = await play(ctrl({ headYaw: 0, mouthOpen: 1 }), { faceMapping: mode });
      expect(sounding(voices)).toHaveLength(0);
      expect(chord).toEqual([]);
    }
  });

  it('always emits MAX_POSE_VOICES on stable ids above the other voice sources', async () => {
    const { voices } = await play(ctrl({ mouthOpen: 0 })); // idle (mouth closed)
    expect(voices).toHaveLength(MAX_POSE_VOICES);
    expect(voices.map((v) => v.id)).toEqual([6, 7, 8, 9, 10]);
    expect(voices.every((v) => v.id >= POSE_VOICE_ID_BASE)).toBe(true);
  });

  it('gates on the jaw: silent when the mouth is closed, sounding when open', async () => {
    const closed = await play(ctrl({ headYaw: yawForDegree(0), mouthOpen: 0.05 })); // < gate 0.12
    expect(sounding(closed.voices)).toHaveLength(0);
    expect(closed.chord).toEqual([]);

    const open = await play(ctrl({ headYaw: yawForDegree(0), mouthOpen: 0.5 }));
    expect(sounding(open.voices).length).toBeGreaterThan(0);
    expect(open.chord).toEqual(diatonicChord(cMajor, 0, 3));
  });

  it('maps head yaw to the chord degree', async () => {
    for (const d of [0, 2, 4, 6]) {
      const { chord } = await play(ctrl({ headYaw: yawForDegree(d), mouthOpen: 0.5 }));
      expect(chord).toEqual(diatonicChord(cMajor, d, 3));
    }
  });

  it('voices the triad exactly as the voicing helper does', async () => {
    const { voices } = await play(ctrl({ headYaw: yawForDegree(0), mouthOpen: 0.5 }));
    const expected = voiceTriad(diatonicTriad(cMajor, 0), 'spread', 0)
      .slice()
      .sort((a, b) => a - b)
      .map((m) => midiToFreq(m));
    const freqs = sounding(voices)
      .map((v) => v.freq)
      .sort((a, b) => a - b);
    expect(freqs).toEqual(expected);
  });

  it('adds the diatonic 7th when both brows are raised', async () => {
    const plain = await play(ctrl({ headYaw: yawForDegree(0), mouthOpen: 0.5, browRaise: 0.2 }));
    expect(plain.chord).toHaveLength(3);

    const seventh = await play(ctrl({ headYaw: yawForDegree(0), mouthOpen: 0.5, browRaise: 0.8 }));
    expect(seventh.chord).toEqual(diatonicChord(cMajor, 0, 4));
    // The 7th is an extra sounding voice on top.
    expect(sounding(seventh.voices).length).toBeGreaterThan(sounding(plain.voices).length);
  });

  it('shifts the octave with head pitch (nod up = higher)', async () => {
    const flat = await play(ctrl({ headYaw: yawForDegree(0), mouthOpen: 0.5, headPitch: 0 }));
    const up = await play(ctrl({ headYaw: yawForDegree(0), mouthOpen: 0.5, headPitch: 1 })); // octaveRange 1 → +1
    const lo = (vs: VoiceParams[]) => Math.min(...sounding(vs).map((v) => v.freq));
    expect(lo(up.voices) / lo(flat.voices)).toBeCloseTo(2, 5); // one octave up
  });

  it('opens/darkens the timbre with smile↔frown (brightness)', async () => {
    const bright = await play(ctrl({ headYaw: yawForDegree(0), mouthOpen: 0.5, smileFrown: 1 }));
    const dark = await play(ctrl({ headYaw: yawForDegree(0), mouthOpen: 0.5, smileFrown: -1 }));
    const neutral = await play(ctrl({ headYaw: yawForDegree(0), mouthOpen: 0.5, smileFrown: 0 }));
    expect(sounding(bright.voices)[0].brightness).toBeCloseTo(1, 5);
    expect(sounding(dark.voices)[0].brightness).toBeCloseTo(0, 5);
    expect(sounding(neutral.voices)[0].brightness).toBeCloseTo(0.5, 5);
  });

  it('plays a generalized chord on a non-seven-note chord source (#75)', async () => {
    // Pre-#75 a pentatonic scale silenced the pose chord; now the spec is the CHORD
    // SOURCE and a pentatonic source sounds a generalized chord. The yaw at the low end
    // lands on degree 0 for any slice count (the sweep is derived from the source length).
    const { voices, chord } = await play(ctrl({ headYaw: yawForDegree(0), mouthOpen: 1 }), { spec: pentatonic });
    expect(sounding(voices).length).toBeGreaterThan(0);
    expect(chord).toEqual(diatonicChord(pentatonic, 0, 3));
  });

  it('sweeps monotonically over a non-seven-note source (no mid-sweep wrap) (#75)', async () => {
    // A 5-note source must sweep 0..4 once as the head turns left→right — the slice
    // count comes from L=5, so it never wraps back to the tonic mid-sweep.
    const degrees: number[] = [];
    for (const yaw of [-1, -0.5, 0, 0.5, 1]) {
      const { chord } = await play(ctrl({ headYaw: yaw, mouthOpen: 1 }), { spec: pentatonic });
      // Recover the degree from the sounding tones (compare against each candidate).
      const match = [0, 1, 2, 3, 4].find((d) => JSON.stringify(diatonicChord(pentatonic, d, 3)) === JSON.stringify(chord));
      degrees.push(match ?? -1);
    }
    // Non-decreasing across the sweep (monotonic), covering low→high degrees.
    for (let i = 1; i < degrees.length; i++) expect(degrees[i]).toBeGreaterThanOrEqual(degrees[i - 1]);
    expect(degrees[0]).toBe(0);
    expect(degrees[degrees.length - 1]).toBe(4);
  });

  it('honors a live chordConfig (volume + voicing) over the static params', async () => {
    const { voices } = await play(ctrl({ headYaw: yawForDegree(0), mouthOpen: 0.5 }), {
      chordConfig: { gain: 0.5, voicing: 'power' },
    });
    const expected = voiceTriad(diatonicTriad(cMajor, 0), 'power', 0)
      .slice()
      .sort((a, b) => a - b)
      .map((m) => midiToFreq(m));
    const freqs = sounding(voices)
      .map((v) => v.freq)
      .sort((a, b) => a - b);
    expect(freqs).toEqual(expected);
    // gain 0.5 * sustained (1.0) = 0.5 per voice.
    expect(sounding(voices)[0].gain).toBeCloseTo(0.5, 5);
  });
});
