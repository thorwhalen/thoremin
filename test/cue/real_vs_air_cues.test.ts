/**
 * The pieces a real-versus-air routine is made of (#247), each on its own: the cue
 * schema's new product and sufficiency and their cross-field rules, the click plan, the
 * runner ending a clicked cue on time (in manual mode too), the click tags in the take's
 * annotations, and the recorder's microphone stream in the plan and the take session.
 */
import { describe, it, expect } from 'vitest';
import { CueSpecSchema, clickPlan, createRunner, createSession, cueCoverage, type Cue, type CueSpecInput, type RunnerEvent } from '@thoremin/sdk/enroll';
import { REAL_VS_AIR_CUES, routineRecordsPerformance } from '@/app/enroll/realVsAirCues';
import { STARTER_CUES } from '@/app/enroll/starterCues';
import { createTrainerTagSource, trainerTagDefs, TRAINER_TAGS } from '@/app/enroll/annotations';
import { trainerTakeMeta, trainerTakeSession } from '@/app/enroll/takeSession';
import { DEFAULT_RECORDING_SESSION } from '@/app/recording/schema';
import { planRecording } from '@/app/recording/plan';
import { activeStreamLabels } from '@/app/recording/session';
import { buildManifest } from '@/app/recording/manifest';

const spec = (over: Partial<CueSpecInput>): CueSpecInput => ({
  instruction: 'Tap on each click.',
  collects: { groups: ['hand.position.raw'] },
  produces: 'performance',
  sufficiency: { kind: 'clicked' },
  ...over,
});

describe('cue schema: performance cues and clicked sufficiency', () => {
  it('a performance cue with a clicked sufficiency and a pairing parses, with the defaults', () => {
    const c = CueSpecSchema.parse(spec({ pairing: { phrase: 'taps', surface: 'real' } }));
    expect(c.sufficiency).toEqual({ kind: 'clicked', bpm: 80, beats: 16, countIn: 4, leadInMs: 3000, patienceMs: 120000 });
    expect(c.pairing).toEqual({ phrase: 'taps', surface: 'real' });
  });

  it('refuses the combinations the runner could not honour', () => {
    // A performance cue must be clicked; a click belongs only to a performance cue.
    expect(CueSpecSchema.safeParse(spec({ sufficiency: { kind: 'frames' } })).success).toBe(false);
    expect(CueSpecSchema.safeParse(spec({ produces: 'baseline' })).success).toBe(false);
    expect(CueSpecSchema.safeParse(spec({ produces: 'vocabulary' })).success).toBe(false);
    // Only a performance cue can be half of a pair.
    expect(
      CueSpecSchema.safeParse({ ...spec({ produces: 'baseline', sufficiency: { kind: 'frames' } }), pairing: { phrase: 'x', surface: 'air' } }).success,
    ).toBe(false);
  });
});

describe('clickPlan', () => {
  it('lead-in, count-in, beats, and the end one beat after the last click', () => {
    const cue = { sufficiency: { kind: 'clicked', bpm: 120, beats: 8, countIn: 4, leadInMs: 1000, patienceMs: 60000 } } as Pick<Cue, 'sufficiency'>;
    const plan = clickPlan(cue, 10_000)!;
    expect(plan.beatMs).toBe(500);
    expect(plan.clicks).toHaveLength(12);
    expect(plan.clicks[0]).toEqual({ t: 11_000, kind: 'count', index: 0, accent: true });
    expect(plan.clicks[4]).toEqual({ t: 13_000, kind: 'beat', index: 0, accent: true });
    expect(plan.clicks[5].accent).toBe(false);
    expect(plan.clicks[11]).toEqual({ t: 16_500, kind: 'beat', index: 7, accent: false });
    expect(plan.endMs).toBe(17_000);
  });

  it('is null for every other cue', () => {
    for (const c of STARTER_CUES) expect(clickPlan(c)).toBeNull();
  });
});

describe('the runner on a clicked cue', () => {
  const cue = REAL_VS_AIR_CUES.find((c) => c.id === 'rva-clap')!;
  const endMs = clickPlan(cue)!.endMs;
  const vec = { 'hand.right.wrist.y': 0.5 };

  const run = (manualAdvance: boolean, feed: boolean) => {
    const runner = createRunner({ cues: [cue], session: createSession(), manualAdvance });
    const events: RunnerEvent[] = [];
    runner.subscribe((e) => events.push(e));
    runner.start(0);
    for (let t = 33; t <= endMs + 500; t += 33) {
      if (feed) runner.push(vec, t);
      else runner.tick(t);
      if (t < endMs) expect(runner.state().status, `t=${t}`).toBe('running');
    }
    return { runner, events };
  };

  it('ends when the phrase has played through, not before; its meter is time', () => {
    const { runner, events } = run(false, true);
    const end = events.find((e) => e.type === 'cue-end') as Extract<RunnerEvent, { type: 'cue-end' }>;
    expect(end.outcome).toBe('enough');
    expect(end.t).toBeGreaterThanOrEqual(endMs);
    expect(runner.state().status).toBe('done');
    expect(cueCoverage(cue, 0, endMs / 2)).toBeCloseTo(0.5);
  });

  it('ends on time in manual mode too: the click is over, there is nothing to wait for', () => {
    const { events } = run(true, true);
    expect(events.some((e) => e.type === 'cue-end')).toBe(true);
  });

  it('ends `cannot` when the camera never saw the player (the take is recorded regardless)', () => {
    const { events } = run(false, false);
    const end = events.find((e) => e.type === 'cue-end') as Extract<RunnerEvent, { type: 'cue-end' }>;
    expect(end.outcome).toBe('cannot');
  });
});

describe('clicks in the take', () => {
  it('a routine with clicked cues gets click tags; a face routine does not', () => {
    expect(trainerTagDefs(REAL_VS_AIR_CUES).map((d) => d.id)).toEqual(expect.arrayContaining(['click:count', 'click:beat']));
    expect(trainerTagDefs(STARTER_CUES).some((d) => d.id.startsWith('click:'))).toBe(false);
  });

  it('the tag source writes each click as a point on the take clock', () => {
    const src = createTrainerTagSource({ active: () => true, cues: () => REAL_VS_AIR_CUES });
    src.beginTake({ t0: 10, startedAt: 'x', session: 's' });
    src.click('count', 11_000);
    src.click('beat', 12_500);
    const rows = src.endTake(20).trim().split('\n').slice(1).map((l) => JSON.parse(l) as { tag: string; t: number });
    expect(rows.map((r) => [r.tag, r.t])).toEqual([
      [TRAINER_TAGS.click('count'), 11],
      [TRAINER_TAGS.click('beat'), 12.5],
    ]);
  });
});

describe('the microphone stream', () => {
  it('the take session records the microphone only for a real-vs-air routine', () => {
    expect(routineRecordsPerformance(REAL_VS_AIR_CUES)).toBe(true);
    expect(routineRecordsPerformance(STARTER_CUES)).toBe(false);
    const face = trainerTakeSession(DEFAULT_RECORDING_SESSION, new Date('2026-09-27T10:00:00Z'));
    const pair = trainerTakeSession(DEFAULT_RECORDING_SESSION, new Date('2026-09-27T10:00:00Z'), { microphone: true });
    expect(face.streams.microphone).toBe(false);
    expect(face.name).toMatch(/^trainer-/);
    expect(pair.streams.microphone).toBe(true);
    expect(pair.streams.audio).toBe(false);
    expect(pair.name).toMatch(/^real-vs-air-/);
    expect(activeStreamLabels(pair)).toEqual(['camera', 'features', 'mic']);
  });

  it('the plan writes it twice, native and WAV, whatever audio formats were picked, always in a folder', () => {
    const session = { ...trainerTakeSession(DEFAULT_RECORDING_SESSION, new Date(), { microphone: true }), formats: ['flac'], singleFileWhenAlone: true };
    const plan = planRecording({ session, stem: 's', audioMime: 'audio/webm;codecs=opus', videoMime: 'video/webm' });
    expect(plan.useFolder).toBe(true);
    const mic = plan.files.filter((f) => f.kind === 'microphone').map((f) => f.name);
    expect(mic).toEqual(['s.mic.webm', 's.mic.wav']);
    // The synth audio is off, so no synth file, and FLAC was never asked of the mic.
    expect(plan.files.some((f) => f.kind === 'audio')).toBe(false);
    // Alone (no features), the escape hatch still does not apply: two files need a folder.
    const alone = { ...session, streams: { ...session.streams, pureVideo: false, features: false } };
    expect(planRecording({ session: alone, stem: 's', audioMime: 'audio/webm', videoMime: 'video/webm' }).useFolder).toBe(true);
  });

  it('the manifest carries the routine, so a take explains its own annotations', () => {
    const meta = trainerTakeMeta('Real vs air: taps', REAL_VS_AIR_CUES);
    const m = buildManifest({ startedAt: 'x', t0: 1, stem: 's', streams: [], meta });
    expect((m.meta as typeof meta).trainer.cues.find((c) => c.id === 'rva-taps-real')!.pairing).toEqual({ phrase: 'taps', surface: 'real' });
    expect(buildManifest({ startedAt: 'x', t0: 1, stem: 's', streams: [] })).not.toHaveProperty('meta');
  });
});
