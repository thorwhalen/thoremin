/**
 * The `air-flute` node (#249) on synthetic performances: the enrolled fingering (both
 * hands) chooses the note, the enrolled blowing mouth gates it (the mouth arms the note,
 * #248), and the voice is one sustained synth voice; "fingers only" plays whenever both
 * hands hold a fingering; no face, a half-enrolled mouth, or a name that is not a note
 * plays nothing, and says so.
 */
import { describe, it, expect } from 'vitest';
import { airFluteNode, mouthVector, FLUTE_VOICE_ID, MOUTH_BLOW, MOUTH_REST, type AirFluteStatus } from '@/nodes/music/air_flute';
import type { SynthParams } from '@/nodes/domain';
import type { TrainedModel } from '@/enroll';
import { emptyVocabulary, trainVocabulary, withEntry } from '@/air/vocabulary';
import { midiToFreq } from '@/music/theory';
import { fingeringSamples, fluteTake, mouthSamples, type Fingering, type FluteTake } from './synthetic_flute';

const D5: Fingering = ['E', 'A'];
const G4: Fingering = ['G', 'C'];

function fingerModel(): TrainedModel {
  let v = emptyVocabulary([]);
  v = withEntry(v, 'D5', fingeringSamples(D5, 40, 1));
  v = withEntry(v, 'G4', fingeringSamples(G4, 40, 2));
  v = withEntry(v, 'not a note', fingeringSamples(['D', 'D'], 40, 3));
  return trainVocabulary({ ...v, features: Object.keys(v.entries[0].samples[0]) })!;
}

function mouthModel(labels = [MOUTH_BLOW, MOUTH_REST]): TrainedModel {
  let v = emptyVocabulary([]);
  if (labels.includes(MOUTH_BLOW)) v = withEntry(v, MOUTH_BLOW, mouthSamples('blowing', 30, 4));
  if (labels.includes(MOUTH_REST)) v = withEntry(v, MOUTH_REST, mouthSamples('resting', 30, 5));
  return trainVocabulary({ ...v, features: Object.keys(v.entries[0].samples[0]) })!;
}

const FM = fingerModel();
const MM = mouthModel();

function play(take: FluteTake, config: Record<string, unknown>, models: { fingers?: TrainedModel | null; mouth?: TrainedModel | null } = {}, octaveShift = 0) {
  const h = airFluteNode.make(airFluteNode.params.parse({}));
  const voices: { t: number; present: boolean; freq: number; id: number }[] = [];
  let status: AirFluteStatus | undefined;
  for (const { frame, face } of fluteTake(take)) {
    const out = h.process(
      { hands: frame, face, config, fingerModel: models.fingers === undefined ? FM : models.fingers, mouthModel: models.mouth === undefined ? MM : models.mouth, octaveShift },
      { time: frame.t!, dt: 1 / 30, tick: 0, resources: {} } as never,
    ) as { params: SynthParams; status: AirFluteStatus };
    for (const v of out.params.voices) voices.push({ t: frame.t!, present: v.present, freq: v.freq, id: v.id });
    status = out.status;
  }
  return { voices, status: status! };
}

const ON = { enabled: true, mirrorHandedness: false };
const sounding = (voices: { t: number; present: boolean; freq: number }[], lo: number, hi: number) => voices.filter((v) => v.t > lo && v.t < hi);

describe('mouthVector', () => {
  it('keeps only the mouth, jaw and lip features of the face vector', () => {
    const m = mouthVector({ 'face.blendshape.mouth.pucker': 0.5, 'face.blendshape.jaw.open': 0.2, 'face.geom.mouth.width': 0.6, 'face.head.yaw': 0.3, 'face.blendshape.eye.blinkLeft': 1 })!;
    expect(Object.keys(m).sort()).toEqual(['face.blendshape.jaw.open', 'face.blendshape.mouth.pucker', 'face.geom.mouth.width']);
    expect(mouthVector(null)).toBeNull();
  });
});

describe('the air-flute node', () => {
  it('sounds the held fingering while the mouth blows, legato across a fingering change, silent at rest', () => {
    const { voices, status } = play(
      { duration: 4, fingeringAt: (t) => (t < 2 ? D5 : G4), mouthAt: (t) => (t > 0.5 && t < 3.5 ? 'blowing' : 'resting') },
      ON,
    );
    for (const v of voices) expect(v.id).toBe(FLUTE_VOICE_ID);
    for (const v of sounding(voices, 0, 0.4)) expect(v.present).toBe(false);
    for (const v of sounding(voices, 0.8, 1.9)) expect(v).toMatchObject({ present: true, freq: expect.closeTo(midiToFreq(74), 6) });
    for (const v of sounding(voices, 2.3, 3.4)) expect(v).toMatchObject({ present: true, freq: expect.closeTo(midiToFreq(67), 6) });
    for (const v of sounding(voices, 3.8, 4)) expect(v.present).toBe(false);
    expect(status).toMatchObject({ knownFingers: 3, mouthReady: true, hands: true, face: true, note: 'G4', sounding: false });
  });

  it('"fingers only" plays whenever both hands hold a fingering, with no face at all', () => {
    const { voices } = play({ duration: 2, fingeringAt: () => D5, mouthAt: () => null }, { ...ON, breath: 'always' });
    for (const v of sounding(voices, 0.3, 2)) expect(v).toMatchObject({ present: true, freq: expect.closeTo(midiToFreq(74), 6) });
  });

  it('in the mouth mode, no face, or a mouth that knows only one state, plays nothing', () => {
    const noFace = play({ duration: 2, fingeringAt: () => D5, mouthAt: () => null }, ON);
    expect(noFace.voices.every((v) => !v.present)).toBe(true);
    expect(noFace.status.face).toBe(false);
    const half = play({ duration: 2, fingeringAt: () => D5, mouthAt: () => 'blowing' }, ON, { mouth: mouthModel([MOUTH_BLOW]) });
    expect(half.voices.every((v) => !v.present)).toBe(true);
    expect(half.status.mouthReady).toBe(false);
  });

  it('plays nothing with no fingerings enrolled, or on a fingering whose name is not a note', () => {
    const none = play({ duration: 2, fingeringAt: () => D5, mouthAt: () => 'blowing' }, ON, { fingers: null });
    expect(none.voices.every((v) => !v.present)).toBe(true);
    expect(none.status.knownFingers).toBe(0);
    const odd = play({ duration: 2, fingeringAt: () => ['D', 'D'], mouthAt: () => 'blowing' }, ON);
    expect(odd.voices.every((v) => !v.present)).toBe(true);
    expect(odd.status).toMatchObject({ note: 'not a note', playable: false });
  });

  it('shifts by the global octave shift, and is silent with the dial off', () => {
    const up = play({ duration: 1.5, fingeringAt: () => D5, mouthAt: () => 'blowing' }, ON, {}, 1);
    for (const v of sounding(up.voices, 0.5, 1.5)) expect(v.freq).toBeCloseTo(midiToFreq(86), 6);
    const off = play({ duration: 1, fingeringAt: () => D5, mouthAt: () => 'blowing' }, { enabled: false });
    expect(off.voices).toEqual([]);
    expect(off.status.enabled).toBe(false);
  });
});
