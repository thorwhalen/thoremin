/**
 * Recording a training take (#163 §6): the trainer's annotations ride in the EXISTING
 * tag stream (taglog) — parseable by the same codec and resolver every other take's
 * `annotations.jsonl` goes through — the take records only the clean camera and the
 * features, and the trainer store drives the app's one recorder through the
 * controller seam.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRunner, createSession, type Cue, type FeatureVector, type RunnerEvent } from '@/enroll';
import { createTrainerTagSource, trainerTagDefs, TRAINER_TAGS } from '@/app/enroll/annotations';
import { trainerTakeSession, TRAINER_TAKE_INSTRUMENT } from '@/app/enroll/takeSession';
import { DEFAULT_RECORDING_SESSION } from '@/app/recording/schema';
import { STARTER_CUES } from '@/app/enroll/starterCues';
import { useTrainer } from '@/app/enroll/store';
import { useTrainerPrefs } from '@/app/enroll/prefs';
import { registerRecordingController, recordingController, type RecordingController } from '@/app/recording/controller';
import { planRecording } from '@/app/recording/plan';
import { getCodec } from '@/taglog/affordances/codec';
import { resolveIntervals } from '@/taglog/affordances/resolve';
import { AnchorRecordSchema, ANNOTATIONS_SCHEMA_ID, TagEventSchema } from '@/taglog/affordances/schema';
import { toAudacityLabels } from '@/taglog/adapters';
import { appFeatureDemand } from '@/app/featureDemand';

const v = (o: Record<string, number>): FeatureVector => o;
const prng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 2147483648 - 1;
};
const registry = {
  allFeatureIds: ['yaw', 'pitch', 'roll', 'smile'],
  groupOf: (id: string) => (id === 'smile' ? 'expr' : 'head'),
};
const cue = (id: string, spec: Partial<Cue>): Cue =>
  ({
    id,
    name: id,
    instruction: `Do ${id}.`,
    rationale: '',
    collects: { groups: ['head', 'expr'], omit: [], axes: [] },
    produces: 'vocabulary',
    sufficiency: { kind: 'excursion', minPoints: 1, minExcursion: 8, patienceMs: 20000 },
    variations: ['Further.'],
    tags: [],
    ...spec,
  }) as Cue;
const REST = cue('rest', { produces: 'baseline', sufficiency: { kind: 'frames', minFrames: 15, patienceMs: 5000 } });
const LOOK = cue('look', { collects: { groups: ['head'], omit: [], axes: [] } });

/** Parse a JSONL annotation stream back the way the exporters do. */
function parseStream(jsonl: string) {
  const rows = jsonl.trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
  const anchor = AnchorRecordSchema.parse(rows[0]);
  const events = rows.slice(1).map((r) => TagEventSchema.parse(r));
  const edges = getCodec('statusEnum').decode(events);
  return { anchor, events, intervals: resolveIntervals(edges) };
}

describe('the trainer annotation source', () => {
  it('writes a self-describing stream: one interval per cue, a point per verdict and nudge, all src "auto"', () => {
    const session = createSession({ ...registry, sampler: { dwellMs: 200 } });
    const runner = createRunner({ cues: [REST, LOOK], session, beatMs: 500, repeatSayMs: 4000 });
    const source = createTrainerTagSource({ active: () => true, cues: () => [REST, LOOK] });
    const seen: string[] = [];
    runner.subscribe((e: RunnerEvent) => {
      seen.push(e.type);
      source.onEvent(e);
    });
    expect(source.active()).toBe(true);
    // The recorder begins the take on the shared clock (seconds) before the routine.
    const t0 = 100; // s
    source.beginTake({ t0, startedAt: '2026-08-23T12:00:00.000Z', session: 'take-1' });
    expect(source.inTake()).toBe(true);

    const r = prng(3);
    let t = t0 * 1000 + 500; // ms on the same clock
    const rest = () => v({ yaw: 0.3 * r(), pitch: 0.3 * r(), roll: 0.3 * r(), smile: 0.02 + 0.01 * r() });
    runner.start(t);
    for (let i = 0; i < 40; i++) runner.push(rest(), (t += 33));
    // Through the beat the player keeps sitting there (frames keep arriving, as the
    // live panel's poll does).
    for (let i = 0; i < 20; i++) runner.push(rest(), (t += 33));
    expect(runner.state().cue?.id).toBe('look');
    // A timid move (a nudge), then the real turn.
    // A quick, timid 2.2-degree turn (quick enough to register as a MOVE over the
    // head features, small enough to fall short of the cue's excursion), held.
    for (let i = 0; i < 2; i++) runner.push(v({ ...rest(), yaw: 1.1 * (i + 1) }), (t += 33));
    for (let i = 0; i < 20; i++) runner.push(v({ ...rest(), yaw: 2.2 + 0.3 * r() }), (t += 33));
    for (let i = 0; i < 15; i++) runner.push(v({ ...rest(), yaw: 2.2 + (22.8 * i) / 15 }), (t += 33));
    for (let i = 0; i < 20; i++) runner.push(v({ ...rest(), yaw: 25 + 0.3 * r() }), (t += 33));
    expect(seen).toContain('guidance');
    expect(runner.state().status).toBe('done');

    const jsonl = source.endTake(t / 1000);
    expect(source.inTake()).toBe(false);
    const { anchor, events, intervals } = parseStream(jsonl);
    expect(anchor.t).toBe(t0);
    expect(anchor.schema).toBe(ANNOTATIONS_SCHEMA_ID);
    expect(anchor.session).toBe('take-1');
    expect(events.every((e) => e.src === 'auto')).toBe(true);
    // Every event time is on the take's clock, after its origin.
    expect(events.every((e) => e.t >= t0)).toBe(true);

    const byTag = (tag: string) => intervals.filter((i) => i.tag === tag);
    expect(byTag(TRAINER_TAGS.cue('rest'))).toHaveLength(1);
    expect(byTag(TRAINER_TAGS.cue('look'))).toHaveLength(1);
    const restI = byTag(TRAINER_TAGS.cue('rest'))[0];
    const lookI = byTag(TRAINER_TAGS.cue('look'))[0];
    expect(restI.kind).toBe('interval');
    expect(restI.end).toBeGreaterThan(restI.start);
    expect(lookI.start).toBeGreaterThanOrEqual(restI.end); // cues do not overlap
    expect(byTag(TRAINER_TAGS.verdict('enough'))).toHaveLength(2);
    expect(byTag(TRAINER_TAGS.guidance).length).toBeGreaterThanOrEqual(1);
    // The nudge fell inside the look cue.
    const nudge = byTag(TRAINER_TAGS.guidance)[0];
    expect(nudge.start).toBeGreaterThanOrEqual(lookI.start);
    expect(nudge.start).toBeLessThanOrEqual(lookI.end);
    // And the exporters work on it unchanged.
    const labels = toAudacityLabels(intervals);
    expect(labels).toContain('cue:look');
  });

  it('a take stopped mid-cue closes the open interval at the end time; outside a take, events are ignored', () => {
    const source = createTrainerTagSource({ active: () => true, cues: () => [REST] });
    source.onEvent({ type: 'cue-start', cue: REST, index: 0, say: REST.instruction, t: 1000 }); // no take yet
    source.beginTake({ t0: 0, startedAt: 'x', session: 's' });
    source.onEvent({ type: 'cue-start', cue: REST, index: 0, say: REST.instruction, t: 1000 });
    const { intervals } = parseStream(source.endTake(5));
    expect(intervals).toHaveLength(1);
    expect(intervals[0].tag).toBe(TRAINER_TAGS.cue('rest'));
    expect(intervals[0].start).toBe(1);
    expect(intervals[0].end).toBe(5);
    expect(source.endTake(6)).toBe('');
  });

  it('clamps an event stamped BEFORE the take\'s t0 to t0 (the stream\'s own invariant)', () => {
    const source = createTrainerTagSource({ active: () => true, cues: () => [REST] });
    source.beginTake({ t0: 5, startedAt: 'x', session: 's' });
    // A cue-start whose tap stamp is one poll (33 ms) older than t0.
    source.onEvent({ type: 'cue-start', cue: REST, index: 0, say: REST.instruction, t: 4967 });
    const { events, intervals } = parseStream(source.endTake(8));
    expect(events.every((e) => e.t >= 5)).toBe(true);
    expect(intervals[0].start).toBe(5);
  });

  it('the tag set covers every cue of the routine, the three outcomes and the nudge', () => {
    const defs = trainerTagDefs(STARTER_CUES);
    for (const c of STARTER_CUES) expect(defs.some((d) => d.id === TRAINER_TAGS.cue(c.id) && d.kind === 'interval')).toBe(true);
    for (const o of ['enough', 'cannot', 'skipped']) expect(defs.some((d) => d.id === TRAINER_TAGS.verdict(o) && d.kind === 'point')).toBe(true);
    expect(defs.some((d) => d.id === TRAINER_TAGS.guidance && d.kind === 'point')).toBe(true);
  });
});

describe('what a training take records', () => {
  it('only the CLEAN camera and the features — no overlay video, no audio — under the trainer label', () => {
    const s = trainerTakeSession(undefined, new Date('2026-08-23T12:00:00Z'));
    expect(s.streams).toMatchObject({ audio: false, overlayVideo: false, overlayAlpha: false, pureVideo: true, features: true });
    expect(s.name).toContain(TRAINER_TAKE_INSTRUMENT);
    const plan = planRecording({ session: s, stem: s.name, audioMime: 'audio/webm', videoMime: 'video/webm', includeAnnotations: true });
    const kinds = plan.files.map((f) => f.kind);
    expect(kinds).toContain('pureVideo');
    expect(kinds).toContain('features');
    expect(kinds).toContain('annotations');
    expect(kinds).not.toContain('overlayVideo');
    expect(kinds.some((k) => k.startsWith('audio'))).toBe(false);
  });

  it('inherits the player\'s recording location and fps from their last Record-sheet config', () => {
    const base = { ...DEFAULT_RECORDING_SESSION, location: 'directory' as const, fps: 24 };
    const s = trainerTakeSession(base);
    expect(s.location).toBe('directory');
    expect(s.fps).toBe(24);
    // But the streams are always the trainer's, and the name is the trainer's.
    expect(s.streams.audio).toBe(false);
    expect(s.streams.pureVideo).toBe(true);
    expect(s.name).toContain(TRAINER_TAKE_INSTRUMENT);
  });
});

describe('the trainer store drives the recorder through the controller seam', () => {
  const calls: string[] = [];
  let recordingNow = false;
  const fake: RecordingController = {
    start: async (session, opts) => {
      calls.push(`start:${session.streams.pureVideo ? 'pure' : 'other'}:${opts?.instrument ?? ''}:${opts?.tagSource ? 'tags' : 'notags'}`);
      recordingNow = true;
      opts?.tagSource?.beginTake({ t0: 1, startedAt: 'x', session: 's' });
      return true;
    },
    stop: async () => {
      calls.push('stop');
      recordingNow = false;
    },
    isRecording: () => recordingNow,
  };
  let unregister: () => void = () => undefined;

  beforeEach(() => {
    calls.length = 0;
    recordingNow = false;
    useTrainer.getState().reset();
    appFeatureDemand.reset();
    unregister();
    unregister = registerRecordingController(fake);
  });

  it('with the pref off, Start records nothing; with it on, the take starts BEFORE the routine and stops when it ends', async () => {
    useTrainerPrefs.getState().setRecordTake(false);
    await useTrainer.getState().startTake(() => 1000);
    expect(calls).toEqual([]);
    expect(useTrainer.getState().recording).toBe(false);
    useTrainer.getState().stop(2000);
    await Promise.resolve();
    expect(calls).toEqual([]);

    useTrainerPrefs.getState().setRecordTake(true);
    await useTrainer.getState().startTake(() => 3000);
    expect(calls).toEqual([`start:pure:${TRAINER_TAKE_INSTRUMENT}:tags`]);
    expect(useTrainer.getState().recording).toBe(true);
    expect(useTrainer.getState().status).toBe('running');
    useTrainer.getState().stop(4000);
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual([`start:pure:${TRAINER_TAKE_INSTRUMENT}:tags`, 'stop']);
    expect(useTrainer.getState().recording).toBe(false);
    useTrainerPrefs.getState().setRecordTake(false);
  });

  it('a second startTake while recording is a no-op: the take is not orphaned and is stopped exactly once', async () => {
    useTrainerPrefs.getState().setRecordTake(true);
    await useTrainer.getState().startTake(() => 1000);
    expect(useTrainer.getState().recording).toBe(true);
    expect(calls).toEqual([`start:pure:${TRAINER_TAKE_INSTRUMENT}:tags`]);
    // A second Start (a second surface, or a double-click) must NOT start another take.
    await useTrainer.getState().startTake(() => 1500);
    expect(calls).toEqual([`start:pure:${TRAINER_TAKE_INSTRUMENT}:tags`]);
    useTrainer.getState().stop(2000);
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual([`start:pure:${TRAINER_TAKE_INSTRUMENT}:tags`, 'stop']);
    useTrainerPrefs.getState().setRecordTake(false);
  });

  it('the REC flag reconciles when the take is stopped by ANOTHER surface (the Record HUD)', async () => {
    useTrainerPrefs.getState().setRecordTake(true);
    await useTrainer.getState().startTake(() => 1000);
    expect(useTrainer.getState().recording).toBe(true);
    // The Record HUD's Stop calls the controller directly, not the trainer store.
    await recordingController().stop();
    expect(recordingNow).toBe(false);
    // The trainer's flag is still stale until its next poll...
    expect(useTrainer.getState().recording).toBe(true);
    useTrainer.getState().sample({ 'face.head.yaw': 1 }, 1100);
    expect(useTrainer.getState().recording).toBe(false);
    useTrainer.getState().stop(2000);
    useTrainerPrefs.getState().setRecordTake(false);
  });

  it('a recorder that cannot start (no audio yet, a dismissed picker) still lets the routine run, unrecorded', async () => {
    unregister();
    unregister = registerRecordingController({ ...fake, start: async () => false });
    useTrainerPrefs.getState().setRecordTake(true);
    await useTrainer.getState().startTake(() => 1000);
    expect(useTrainer.getState().status).toBe('running');
    expect(useTrainer.getState().recording).toBe(false);
    useTrainer.getState().stop(2000);
    useTrainerPrefs.getState().setRecordTake(false);
  });

  it('without a registered controller, starting a take is a no-op that reports false', async () => {
    unregister();
    unregister = () => undefined;
    expect(await recordingController().start(trainerTakeSession())).toBe(false);
    expect(recordingController().isRecording()).toBe(false);
  });
});

describe('the production wiring (source guard)', () => {
  it('useEngine registers the controller with the same start/stop the Record button uses', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/app/useEngine.ts'), 'utf8');
    expect(src).toMatch(/registerRecordingController\(/);
    expect(src).toMatch(/start:\s*startTake/);
    expect(src).toMatch(/stop:\s*stopRecording/);
    // And the button's "Rec now" goes through the same startTake (one code path).
    expect(src).toMatch(/recNow = useCallback\(async \(\) => \{\s*await startTake\(recSession, \{ fromSheet: true \}\)/);
  });
});
