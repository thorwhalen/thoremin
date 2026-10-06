/**
 * The `air-flute` node (#249) on synthetic performances: the enrolled fingering (both
 * hands) chooses the note, the enrolled blowing mouth gates it (the mouth arms the note,
 * #248), and the voice is one sustained synth voice; "fingers only" plays whenever both
 * hands hold a fingering; no face, a half-enrolled mouth, or a name that is not a note
 * plays nothing, and says so.
 */
import { describe, it, expect } from 'vitest';
import { airFluteNode, mouthVector, FLUTE_VOICE_ID, MOUTH_BLOW, MOUTH_REST, type AirFluteStatus } from '@thoremin/ext-air/nodes/air_flute';
import type { HandsFrame, SynthParams } from '@thoremin/sdk/nodes/domain';
import type { FeatureVector, TrainedModel } from '@thoremin/sdk/enroll';
import { fingeringVector } from '@thoremin/ext-air/nodes/air_flute';
import { ALL_FEATURES } from '@thoremin/sdk/features/catalog';
import { MOUTH_GROUPS } from '@thoremin/ext-air/nodes/air_flute';
import { MOUTH_REJECT_SCALE } from '@thoremin/ext-air/app/vocabularyStore';
import { rng } from './synthetic_hand';
import { emptyVocabulary, trainVocabulary, withEntry } from '@thoremin/ext-air/lib/vocabulary';
import { midiToFreq } from '@thoremin/sdk/music/theory';
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
  // As the app trains it: open-set, a mouth like neither state is not blowing.
  return trainVocabulary({ ...v, features: Object.keys(v.entries[0].samples[0]) }, { rejectScale: MOUTH_REJECT_SCALE })!;
}

const FM = fingerModel();
const MM = mouthModel();

type Tick = { frame: HandsFrame; face: FeatureVector | null; faceFrame?: { t: number; present: boolean } };

function play(
  take: FluteTake | Tick[],
  config: Record<string, unknown> | ((t: number) => Record<string, unknown>),
  models: { fingers?: TrainedModel | null; mouth?: TrainedModel | null } = {},
  octaveShift = 0,
) {
  const h = airFluteNode.make(airFluteNode.params.parse({}));
  const voices: { t: number; present: boolean; freq: number; id: number }[] = [];
  let status: AirFluteStatus | undefined;
  const ticks: Tick[] = Array.isArray(take) ? take : fluteTake(take).map((x) => ({ ...x, faceFrame: { t: x.frame.t!, present: x.face !== null } }));
  for (const { frame, face, faceFrame } of ticks) {
    const cfg = typeof config === 'function' ? config(frame.t!) : config;
    const out = h.process(
      { hands: frame, face, faceFrame, config: cfg, fingerModel: models.fingers === undefined ? FM : models.fingers, mouthModel: models.mouth === undefined ? MM : models.mouth, octaveShift },
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

  it('shifts by the global octave shift', () => {
    const up = play({ duration: 1.5, fingeringAt: () => D5, mouthAt: () => 'blowing' }, ON, {}, 1);
    for (const v of sounding(up.voices, 0.5, 1.5)) expect(v.freq).toBeCloseTo(midiToFreq(86), 6);
  });
});

describe('the air-flute node, continued', () => {
  it('is silent with the dial off', () => {
    const off = play({ duration: 1, fingeringAt: () => D5, mouthAt: () => 'blowing' }, { enabled: false });
    expect(off.voices.every((v) => v.id === FLUTE_VOICE_ID && !v.present)).toBe(true);
    expect(off.status.enabled).toBe(false);
  });

  it('turned off mid-note, says so to the synth (an absent voice, not a vanished one) so the note fades', () => {
    const { voices } = play({ duration: 2, fingeringAt: () => D5, mouthAt: () => 'blowing' }, (t) => ({ ...ON, enabled: t < 1 }));
    expect(sounding(voices, 0.5, 0.95).every((v) => v.present)).toBe(true);
    const after = sounding(voices, 1.01, 2);
    expect(after.length).toBeGreaterThan(0);
    for (const v of after) expect(v).toMatchObject({ id: FLUTE_VOICE_ID, present: false });
  });

  it('stops when the hands go, in either breath mode (the flute put down)', () => {
    for (const breath of ['mouth', 'always']) {
      const ticks = fluteTake({ duration: 2, fingeringAt: () => D5, mouthAt: () => 'blowing' }).map((x) => ({
        ...x,
        frame: x.frame.t! > 1 ? { ...x.frame, hands: [] } : x.frame,
        faceFrame: { t: x.frame.t!, present: true },
      }));
      const { voices, status } = play(ticks, { ...ON, breath });
      expect(sounding(voices, 0.5, 0.95).every((v) => v.present), breath).toBe(true);
      expect(sounding(voices, 1.05, 2).every((v) => !v.present), breath).toBe(true);
      expect(status).toMatchObject({ hands: false, note: null, sounding: false });
    }
  });

  it('counts the breath on face FRAMES: one odd face frame repeated over ticks does not start it', () => {
    // A resting mouth, one blowing face frame, resting again; each face frame is seen
    // for three ticks (a 60-90 Hz tick over a 20-30 Hz face model).
    const frames = fluteTake({ duration: 2, fingeringAt: () => D5, mouthAt: () => 'resting' }).map((x) => x.frame);
    const ticks: Tick[] = frames.map((frame, i) => {
      const faceIdx = Math.floor(i / 3);
      const face = faceIdx === 10 ? mouthSamples('blowing', 1, 50)[0] : mouthSamples('resting', 1, 100 + faceIdx)[0];
      return { frame, face, faceFrame: { t: faceIdx / 10, present: true } };
    });
    const { voices } = play(ticks, { ...ON, breathFrames: 2 });
    expect(voices.every((v) => !v.present)).toBe(true);
  });

  it('holds the breath through a short face dropout, stops after a long one, and returns without a blip', () => {
    const mouthAt = (t: number) => (t > 1 && t < 1.2 ? null : t > 1.6 && t < 2.4 ? null : t >= 2.4 ? 'resting' : 'blowing');
    const { voices } = play({ duration: 3, fingeringAt: () => D5, mouthAt }, ON);
    expect(sounding(voices, 1.0, 1.2).every((v) => v.present)).toBe(true); // 0.2 s: held
    expect(sounding(voices, 2.0, 2.4).every((v) => !v.present)).toBe(true); // 0.8 s: stopped
    expect(sounding(voices, 2.4, 3).every((v) => !v.present)).toBe(true); // back resting: no blip
  });

  it('a mouth like neither enrolled state (talking) is not blowing', () => {
    const talking = (): FeatureVector => ({ 'face.blendshape.mouth.pucker': 0.1, 'face.blendshape.mouth.funnel': 0.05, 'face.blendshape.mouth.pressRight': 0.0, 'face.blendshape.jaw.open': 0.7, 'face.geom.mouth.width': 1.2 });
    const ticks = fluteTake({ duration: 1.5, fingeringAt: () => D5, mouthAt: () => 'resting' }).map((x) => ({ ...x, face: talking(), faceFrame: { t: x.frame.t!, present: true } }));
    expect(play(ticks, ON).voices.every((v) => !v.present)).toBe(true);
  });

  it('gates on the catalog\'s real mouth features, all of them', () => {
    const ids = ALL_FEATURES.filter((f) => (MOUTH_GROUPS as readonly string[]).includes(f.group)).map((f) => f.id);
    expect(ids.length).toBeGreaterThan(20);
    const r = rng(12);
    const mouth = (blow: boolean): FeatureVector =>
      Object.fromEntries(ids.map((id) => [id, (id.endsWith('mouth.pucker') ? (blow ? 0.7 : 0.05) : id.endsWith('mouth.funnel') ? (blow ? 0.4 : 0.03) : 0.2) + (r() - 0.5) * 0.04]));
    let v = emptyVocabulary(ids);
    v = withEntry(v, MOUTH_BLOW, Array.from({ length: 30 }, () => mouth(true)));
    v = withEntry(v, MOUTH_REST, Array.from({ length: 30 }, () => mouth(false)));
    const model = trainVocabulary(v, { rejectScale: MOUTH_REJECT_SCALE })!;
    const ticks = fluteTake({ duration: 2, fingeringAt: () => D5, mouthAt: () => 'resting' }).map((x) => ({
      ...x,
      face: mouth(x.frame.t! > 1),
      faceFrame: { t: x.frame.t!, present: true },
    }));
    const { voices } = play(ticks, ON, { mouth: model });
    expect(sounding(voices, 0, 1).every((v) => !v.present)).toBe(true);
    expect(sounding(voices, 1.2, 2).every((v) => v.present)).toBe(true);
  });
});

describe('fingeringVector', () => {
  it('is both hands or nothing (a fingering learned one-handed could never be played)', () => {
    const [x] = fluteTake({ duration: 0.04, fingeringAt: () => D5, mouthAt: () => null });
    expect(fingeringVector(x.frame, false)).not.toBeNull();
    expect(fingeringVector({ ...x.frame, hands: x.frame.hands.slice(0, 1) }, false)).toBeNull();
  });

  it('the voice id sits beyond any score (11 + note index)', () => {
    expect(FLUTE_VOICE_ID).toBeGreaterThan(11 + 100_000);
  });
});
