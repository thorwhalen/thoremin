/**
 * The trainer store (#163) — the zodal-to-zustand hydration path, label identity across
 * re-cuts, and runner lifecycle — headless, over in-memory providers.
 *
 * `listCues` / `loadRoutine` are unit-tested in `enroll_cues.test.ts`; this is the other
 * half: that `load()` actually writes what they return into the store, and that the
 * store's own invariants hold when it is driven directly (as the panel, the feature-
 * demand test and the PR 2 picker all do).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createInMemoryProvider } from '@zodal/store';
import { CueSpecSchema, categoryKey, type CueRecord, type FeatureVector, type RoutineRecord } from '@/enroll';
import { createCueStore, createRoutineStore } from '@/app/enroll/cueStore';
import { useTrainer, useTrainerStores } from '@/app/enroll/store';
import { useTrainerPrefs } from '@/app/enroll/prefs';
import { DEFAULT_ROUTINE_CUE_IDS, STARTER_CUES } from '@/app/enroll/starterCues';
import { appFeatureDemand } from '@/app/featureDemand';

const stores = () => ({
  cues: createCueStore(createInMemoryProvider<CueRecord>([], { searchFields: ['name'] })),
  routines: createRoutineStore(createInMemoryProvider<RoutineRecord>([], { searchFields: ['name'] })),
});

const prng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 2147483648 - 1;
};

beforeEach(() => {
  useTrainer.getState().reset();
  useTrainerStores(null);
  appFeatureDemand.reset();
});

describe('load(): stored cues and routines reach the store', () => {
  it('with empty stores, the routine is the default in order and nothing is missing or unusable', async () => {
    useTrainerStores(stores());
    await useTrainer.getState().load();
    const s = useTrainer.getState();
    expect(s.loaded).toBe(true);
    expect(s.cues.map((c) => c.id)).toEqual(STARTER_CUES.map((c) => c.id));
    expect(s.routine.map((c) => c.id)).toEqual([...DEFAULT_ROUTINE_CUE_IDS]);
    expect(s.routineName).toBe('Default');
    expect(s.missing).toEqual([]);
    expect(s.unusable).toEqual([]);
    expect(s.outcomes).toHaveLength(DEFAULT_ROUTINE_CUE_IDS.length);
  });

  it('a stored override of a starter (same name) reaches the routine; an unresolvable cue is reported', async () => {
    const st = stores();
    const reworded = CueSpecSchema.parse({
      instruction: 'Look over your left shoulder, and hold it.',
      collects: { groups: ['face.head'] },
      produces: 'vocabulary',
      sufficiency: { kind: 'excursion' },
    });
    await st.cues.save('Look left', reworded, 1000);
    await st.cues.save('Elbow', { ...reworded, collects: { groups: ['elbow.angle'], omit: [], axes: [] } }, 1001);
    useTrainerStores(st);
    await useTrainer.getState().load();
    const s = useTrainer.getState();
    expect(s.routine.find((c) => c.id === 'look-left')?.instruction).toBe(reworded.instruction);
    expect(s.unusable).toEqual(['elbow']);
    expect(s.cues.some((c) => c.id === 'elbow')).toBe(false);
  });

  it('a load that resolves while a routine is RUNNING does not swap the routine under the runner', async () => {
    const st = stores();
    await st.routines.save('Default', { cueIds: ['rest', 'your-faces'] }, 1000); // (ignored: load uses the default)
    useTrainerStores(st);
    const pending = useTrainer.getState().load();
    useTrainer.getState().start(1000); // Start pressed before the stores answered
    const runningRoutine = useTrainer.getState().routine;
    await pending;
    expect(useTrainer.getState().loaded).toBe(true);
    expect(useTrainer.getState().routine).toBe(runningRoutine);
    expect(useTrainer.getState().cues.length).toBeGreaterThan(0);
    // And setRoutine is refused while running.
    useTrainer.getState().setRoutine(['rest']);
    expect(useTrainer.getState().routine).toBe(runningRoutine);
    useTrainer.getState().stop(2000);
  });

  it('is idempotent: a second load does not re-read (loaded stays true, state unchanged)', async () => {
    useTrainerStores(stores());
    await useTrainer.getState().load();
    const before = useTrainer.getState().routine;
    await useTrainer.getState().load();
    expect(useTrainer.getState().routine).toBe(before);
  });

  it('setRoutine resolves ids against the known cues and reports unknown ones', async () => {
    useTrainerStores(stores());
    await useTrainer.getState().load();
    useTrainer.getState().setRoutine(['rest', 'nope', 'your-faces'], 'Short');
    const s = useTrainer.getState();
    expect(s.routine.map((c) => c.id)).toEqual(['rest', 'your-faces']);
    expect(s.missing).toEqual(['nope']);
    expect(s.routineName).toBe('Short');
    expect(s.outcomes).toEqual([null, null]);
  });
});

describe('routine persistence through the store', () => {
  it('saveRoutine hydrates FIRST (the routine in use changes synchronously), then persists; useRoutine/removeRoutine round-trip', async () => {
    useTrainerStores(stores());
    await useTrainer.getState().load();
    const pending = useTrainer.getState().saveRoutine('Head only', ['rest', 'look-left', 'look-right']);
    // Before the provider answers, the routine is already the saved one.
    expect(useTrainer.getState().routine.map((c) => c.id)).toEqual(['rest', 'look-left', 'look-right']);
    expect(useTrainer.getState().routineName).toBe('Head only');
    await pending;
    expect(useTrainer.getState().savedRoutines.map((r) => r.id)).toEqual(['head-only']);
    // Back to the default, then the saved one by id.
    await useTrainer.getState().useRoutine(null);
    expect(useTrainer.getState().routine).toHaveLength(DEFAULT_ROUTINE_CUE_IDS.length);
    await useTrainer.getState().useRoutine('head-only');
    expect(useTrainer.getState().routine.map((c) => c.id)).toEqual(['rest', 'look-left', 'look-right']);
    // Saving under the same name overwrites (one record), newest first.
    await useTrainer.getState().saveRoutine('Head only', ['rest', 'look-up']);
    expect(useTrainer.getState().savedRoutines).toHaveLength(1);
    await useTrainer.getState().saveRoutine('Faces', ['rest', 'your-faces']);
    expect(useTrainer.getState().savedRoutines.map((r) => r.id).sort()).toEqual(['faces', 'head-only']);
    await useTrainer.getState().removeRoutine('head-only');
    expect(useTrainer.getState().savedRoutines.map((r) => r.id)).toEqual(['faces']);
    // A removed id falls back to the default rather than failing.
    await useTrainer.getState().useRoutine('head-only');
    expect(useTrainer.getState().routineName).toBe('Default');
  });

  it('setRoutine runs a repeated id once (the routine schema forbids duplicates; no duplicate rows)', () => {
    useTrainer.getState().setRoutine(['rest', 'look-left', 'rest'], 'Dup');
    expect(useTrainer.getState().routine.map((c) => c.id)).toEqual(['rest', 'look-left']);
  });
});

describe('runner lifecycle through the store', () => {
  it('start() stops and DETACHES a previous runner, so it cannot keep writing into the store', () => {
    useTrainer.getState().start(1000);
    const first = useTrainer.getState().runner()!;
    expect(first.state().status).toBe('running');
    useTrainer.getState().start(2000);
    expect(first.state().status).toBe('stopped');
    const transcriptLen = useTrainer.getState().transcript.length;
    // Even if something drove the old runner, its events do not land here.
    first.skip(3000);
    expect(useTrainer.getState().transcript).toHaveLength(transcriptLen);
    expect(useTrainer.getState().runner()).not.toBe(first);
  });

  it('skip adds no blank line to the transcript, and the beat after a skip shows NOTHING (not an older "Good.")', () => {
    useTrainer.getState().start(1000);
    useTrainer.getState().skip(1100);
    expect(useTrainer.getState().transcript.every((l) => l.say.length > 0)).toBe(true);
    expect(useTrainer.getState().lastEndSay).toBeNull();
    useTrainer.getState().stop(1200);
  });

  it('with manualAdvance=false (the default), a fed movement AUTO-advances the cue — guards the store->runner wiring', () => {
    // The mutation guard for start()'s `manualAdvance: useTrainerPrefs.getState().manualAdvance`
    // (store.ts): were the runner built in manual mode, the default player's routine would
    // never advance on its own. Here a real fed movement must reach 'enough' with NO
    // complete() call — so hardcoding manualAdvance:true turns this red.
    useTrainerPrefs.setState({ manualAdvance: false });
    const st = useTrainer.getState();
    st.setRoutine(['rest', 'look-left']);
    st.start(1000);
    const r = prng(11);
    const jit = () => 0.3 * r();
    const base = (): FeatureVector => ({ 'face.head.yaw': jit(), 'face.head.pitch': jit(), 'face.head.roll': jit() });
    let t = 1000;
    const feed = (n: number, make: (i: number) => FeatureVector) => {
      for (let i = 0; i < n; i++) {
        t += 33;
        useTrainer.getState().sample(make(i), t);
      }
    };
    const tick = (ms: number) => {
      const e = t + ms;
      while (t < e) {
        t += 100;
        useTrainer.getState().tick(t);
      }
    };
    feed(100, () => base()); // rest (minFrames 90) reaches enough on its own
    tick(1700); // the beat elapses -> look-left begins on its own
    expect(useTrainer.getState().outcomes[0]).toBe('enough');
    expect(useTrainer.getState().status).toBe('running');
    // A big, held ~30-degree yaw: excursion far past the 12-sigma bar -> auto 'enough'.
    feed(8, (i) => ({ ...base(), 'face.head.yaw': (30 * (i + 1)) / 8 }));
    feed(40, () => ({ ...base(), 'face.head.yaw': 30 + jit() }));
    expect(useTrainer.getState().outcomes[1]).toBe('enough');
    useTrainer.getState().stop(t + 100);
  });

  it('a guidance sink that reacts by stopping or skipping cannot corrupt the runner (sinks run after the event settles)', async () => {
    const { addGuidanceSink, resetGuidanceSinks } = await import('@/app/enroll/guidance');
    resetGuidanceSinks();
    // A sink that skips on every instruction: each cue is skipped as soon as it starts.
    const off = addGuidanceSink({
      say: (l) => {
        if (l.kind === 'instruction') useTrainer.getState().skip(5000);
      },
    });
    useTrainer.getState().start(1000);
    await new Promise((r) => setTimeout(r, 0));
    // One skip per instruction, applied cleanly: the first cue is skipped, the runner
    // is between cues (not restarted, not stopped), and outcomes are consistent.
    const st = useTrainer.getState();
    expect(st.outcomes[0]).toBe('skipped');
    expect(['between', 'running']).toContain(st.status);
    expect(st.runner()?.state().outcomes.filter((o) => o === 'skipped').length).toBe(1);
    off();
    useTrainer.getState().stop(6000);
    resetGuidanceSinks();
  });
});

describe('labels survive a re-cut', () => {
  /** Drive a take with three well-separated held "faces" via a one-cue routine. */
  // A deterministic take: hold each pose long enough for a still-point, then press
  // "Done" (complete) to advance — the manual-advance flow, so it never depends on the
  // excursion threshold. Distinct held poses become distinct clusters to label.
  function takeWithThreeFaces() {
    const r = prng(4);
    const jitter = () => 0.3 * r();
    const base = (): FeatureVector => ({ 'face.head.yaw': jitter(), 'face.head.pitch': jitter(), 'face.head.roll': jitter() });
    const st = useTrainer.getState();
    st.setRoutine(['rest', 'look-left', 'look-right', 'look-up']);
    // Manual advance: every cue boundary is a `complete()` here, so the take is
    // deterministic and never depends on the excursion threshold. Restore the pref
    // right after start() — the runner has already captured it.
    useTrainerPrefs.getState().setManualAdvance(true);
    st.start(1000);
    useTrainerPrefs.getState().setManualAdvance(false);
    let t = 1000;
    const feed = (n: number, make: () => FeatureVector) => {
      for (let i = 0; i < n; i++) {
        t += 33;
        useTrainer.getState().sample(make(), t);
      }
    };
    const advance = () => {
      t += 100;
      useTrainer.getState().complete(t);
    };
    feed(120, base); // rest baseline (fixes the noise scale)
    advance(); // "Done" with rest -> between
    const poses: FeatureVector[] = [{ 'face.head.yaw': -25 }, { 'face.head.yaw': 25 }, { 'face.head.pitch': -25 }];
    for (const pose of poses) {
      advance(); // between -> begin the next movement cue (running)
      const at = () => ({ ...base(), ...Object.fromEntries(Object.entries(pose).map(([k, v]) => [k, v + jitter()])) });
      feed(8, (): FeatureVector => ({ ...base(), ...Object.fromEntries(Object.entries(pose).map(([k, v]) => [k, v * 0.5])) })); // the move arms the sampler
      feed(25, at); // the hold -> a still-point for this pose
      advance(); // "Done" -> end this cue
    }
    // Drain any cue the poses did not cover, so the routine reaches 'done'.
    for (let guard = 0; useTrainer.getState().status !== 'done' && guard < 20; guard++) advance();
    return useTrainer.getState();
  }

  it('a name typed at one k is still on the SAME poses at another k, never on a different cluster', () => {
    const s = takeWithThreeFaces();
    expect(s.status).toBe('done');
    useTrainer.getState().build();
    useTrainer.getState().setK(3);
    const at3 = useTrainer.getState().model!;
    expect(at3.categories).toHaveLength(3);
    const named = at3.categories[1];
    useTrainer.getState().setLabel(categoryKey(named), 'my left');
    // Re-cut to 2: two clusters merge, one survives with the same member set.
    useTrainer.getState().setK(2);
    const at2 = useTrainer.getState().model!;
    const labels = useTrainer.getState().labels;
    for (const c of at2.categories) {
      const label = labels[categoryKey(c)];
      // A label appears only on a category with EXACTLY the named member set.
      if (label) expect(c.members).toEqual(named.members);
    }
    // And back to 3: the name is back on its poses.
    useTrainer.getState().setK(3);
    const back = useTrainer.getState().model!.categories.find((c) => categoryKey(c) === categoryKey(named));
    expect(back).toBeDefined();
    expect(useTrainer.getState().labels[categoryKey(back!)]).toBe('my left');
  });
});
