/**
 * A rest before the first gesture (#857): a routine that asks for a gesture first lets the session
 * learn rest on the gesture's features, or the noise warm-up learns the wave as jitter.
 *
 * The routine helpers are pinned on small routines; then the reason they exist, end to end: a
 * player who waves 200 ms after being asked loses waves when the gesture cue opens the routine
 * (fewer since the session forgets a warm-up learned from the wave, #913), and yields all five
 * once the rest is prepended (the runner asks for the rest first, and
 * the same player waves 200 ms after the gesture cue starts).
 */
import { describe, it, expect } from 'vitest';
import { CueSchema, type Cue } from '@thoremin/sdk/enroll/cue';
import { GESTURE_REST_CUE, gestureRestCue, restlessGestures, withRestBeforeGestures } from '@thoremin/sdk/enroll/gestures';
import { createRunner, type RunnerEvent } from '@thoremin/sdk/enroll/runner';
import { createSession, type Session } from '@thoremin/sdk/enroll/session';
import { waveTake } from './helpers/wave_take';

const HAND = 'hand.position.raw';
const cue = (id: string, produces: 'baseline' | 'gesture' | 'vocabulary', groups: string[]): Cue =>
  CueSchema.parse({
    id,
    name: id,
    instruction: id,
    collects: { groups },
    produces,
    ...(produces === 'gesture' ? { gesture: id, sufficiency: { kind: 'repetitions' } } : produces === 'baseline' ? { sufficiency: { kind: 'frames' } } : { sufficiency: { kind: 'variety' } }),
  });
const WAVE = cue('wave', 'gesture', [HAND]);
const ids = (cues: readonly Cue[]) => cues.map((c) => c.id);

describe('restlessGestures', () => {
  it('names a gesture cue with no rest before it on its groups, and only the groups missing', () => {
    expect(restlessGestures([WAVE])).toEqual([{ cue: WAVE, groups: [HAND] }]);
    const both = cue('both', 'gesture', ['face.head', HAND]);
    expect(restlessGestures([cue('face-rest', 'baseline', ['face.head']), both])).toEqual([{ cue: both, groups: [HAND] }]);
  });

  it('is satisfied by any earlier baselines that together cover the groups, and not by a later one', () => {
    const both = cue('both', 'gesture', ['face.head', HAND]);
    expect(restlessGestures([cue('r1', 'baseline', ['face.head']), cue('r2', 'baseline', [HAND]), both])).toEqual([]);
    expect(restlessGestures([WAVE, cue('late', 'baseline', [HAND])])).toHaveLength(1);
    expect(restlessGestures([cue('smile', 'vocabulary', [HAND]), WAVE])).toHaveLength(1);
  });
});

describe('withRestBeforeGestures', () => {
  it('inserts one rest just before the first gesture that needs it, covering every restless group', () => {
    const nod = cue('nod', 'gesture', ['face.head']);
    const smile = cue('smile', 'vocabulary', ['face.mouth']);
    const out = withRestBeforeGestures([smile, WAVE, nod]);
    expect(ids(out)).toEqual(['smile', GESTURE_REST_CUE.id, 'wave', 'nod']);
    const rest = out[1];
    expect(rest.produces).toBe('baseline');
    expect(rest.collects.groups).toEqual([HAND, 'face.head']);
    expect(restlessGestures(out)).toEqual([]);
  });

  it('returns a routine that already rests first as it was', () => {
    const routine = [cue('rest', 'baseline', [HAND]), WAVE];
    expect(withRestBeforeGestures(routine)).toEqual(routine);
    expect(withRestBeforeGestures([cue('smile', 'vocabulary', [HAND])])).toHaveLength(1);
  });

  it('takes the caller own rest cue, and refuses one whose id the routine already uses', () => {
    const own = (groups: readonly string[]) => ({ ...gestureRestCue(groups), id: 'my-rest' });
    expect(ids(withRestBeforeGestures([WAVE], { rest: own }))).toEqual(['my-rest', 'wave']);
    const clash = cue(GESTURE_REST_CUE.id, 'vocabulary', ['face.mouth']);
    expect(() => withRestBeforeGestures([clash, WAVE])).toThrow(/already has a cue/);
  });

  it('refuses a rest cue that would leave the routine restless (not a baseline, or too few groups)', () => {
    const notBaseline = () => cue('my-rest', 'vocabulary', [HAND]);
    expect(() => withRestBeforeGestures([WAVE], { rest: notBaseline })).toThrow(/must be a baseline cue/);
    const tooNarrow = () => cue('my-rest', 'baseline', ['face.head']);
    expect(() => withRestBeforeGestures([WAVE], { rest: tooNarrow })).toThrow(/must be a baseline cue/);
  });
});

describe('end to end: a player who waves 200 ms after being asked', () => {
  /** Run `cues` over a take whose waves start `leadMs` after the wave cue starts. */
  function run(cues: Cue[], leadMs: number) {
    // Where the wave cue starts depends only on the cues before it (a rest cue ends on its frame
    // count), so find it on a still take first, then script the player against it.
    const startOf = (frames: ReturnType<typeof waveTake>['frames']) => {
      const runner = createRunner({ cues, session: createSession() });
      let start: number | null = null;
      runner.subscribe((e: RunnerEvent) => {
        if (e.type === 'cue-start' && e.cue.id === WAVE.id) start ??= e.t;
      });
      runner.start(0);
      for (const f of frames) if (start === null) runner.push(f.v, f.t);
      return start ?? 0;
    };
    const waveStart = startOf(waveTake({ waves: 0, restMs: 20000 }).frames);
    const take = waveTake({ restMs: waveStart + leadMs });
    let session: Session = createSession();
    const runner = createRunner({ cues, session });
    runner.start(0);
    for (const f of take.frames) runner.push(f.v, f.t);
    return { traces: session.tracesFor(WAVE.id), waveStart };
  }

  it('loses the first wave with the gesture cue first, and cuts all five with the rest prepended', () => {
    const bare = run([WAVE], 200);
    expect(bare.waveStart).toBe(0);
    // The session's own guard (#913) forgets the unit the first wave taught and learns it again in
    // the pause, so the later waves are cut; the first, made while the hand was cold, never is.
    expect(bare.traces.length).toBeLessThan(5);
    const rested = run(withRestBeforeGestures([WAVE]), 200);
    expect(rested.waveStart).toBeGreaterThan(2000);
    expect(rested.traces).toHaveLength(5);
  });
});
