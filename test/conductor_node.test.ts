/**
 * The `conductor` node (#187 PR 2) — src/ictus wrapped as a DAG node — on the recorded
 * conducting fixtures and inside the real default graph.
 *
 * Node level (replayNode on `test/fixtures/conducting_44`): the beat is monotone and
 * advances at about the stated tempo while she beats, dynamics stay inside the dial's
 * range, the follower reports `running`, and once she lowers her hands the beat freezes
 * (`hold`, bpm 0). Disabled: a frozen beat, `enabled: false`, velocityScale 0, so the
 * score behind it emits nothing. The `config` input overrides the params live.
 *
 * Graph level: `runHeadless` over the production `defaultGraph()` with the recorded
 * hands replayed through the `replay-hands` source slot and the conductor dial turned
 * on through the same `ctx.resources.controls` getter the app injects. The score's
 * voices sound on most ticks and reach the merge — the reachability the shipping rule
 * demands, proven on the real wiring rather than a bespoke spec. With the dial off, the
 * same run produces no score voice at all.
 */
import { describe, it, expect } from 'vitest';
import { replayNode, runHeadless } from '@/dag';
import { conductorNode, DEFAULT_CONDUCTOR_DIAL, SCORE_VOICE_ID_BASE, type HandsFrame, type SynthParams } from '@/nodes';
import { createAppRegistry } from '@/nodes/browser';
import { defaultGraph } from '@/app/graph';
import { loadStream } from './helpers/fixtures';

const FPS = 30;
const frames = loadStream('conducting_44', 'src.hands') as HandsFrame[];
/** The recording is a third-person video: no selfie mirroring. */
const RECORDED = { mirrorX: false, mirrorHandedness: false };

describe('conductor node on the 4/4 fixture (stated 70 bpm)', () => {
  it('advances a monotone beat at about the stated tempo, reports running, then holds when she stops', async () => {
    const h = conductorNode.make(conductorNode.params.parse({ enabled: true, ...RECORDED }));
    const outs = await replayNode(h, { hands: frames }, { dt: 1 / FPS });
    const beats = outs.map((o) => o.beat as number);
    for (let i = 1; i < beats.length; i++) expect(beats[i]).toBeGreaterThanOrEqual(beats[i - 1]);
    // She beats for about the first 11 s of the 13.5 s clip: the beat advanced by
    // roughly 11 s * 70/60 = 12.8 beats over that span (bar-level tempo, ±15%).
    const atEleven = beats[Math.round(11 * FPS)];
    expect(atEleven).toBeGreaterThan(12.8 * 0.85);
    expect(atEleven).toBeLessThan(12.8 * 1.15);
    const states = outs.map((o) => (o.time as { state: string }).state);
    const running = states.filter((s) => s === 'running').length / states.length;
    expect(running).toBeGreaterThan(0.6);
    // The clip ends with her hands down: the follower holds and the beat freezes.
    const last = outs[outs.length - 1];
    expect((last.time as { state: string }).state).toBe('hold');
    expect(last.bpm).toBe(0);
    expect(beats[beats.length - 1]).toBeCloseTo(beats[beats.length - 10], 5);
    // Dynamics stay inside the dial's range and enabled is reported.
    for (const o of outs) {
      expect(o.velocityScale as number).toBeGreaterThanOrEqual(DEFAULT_CONDUCTOR_DIAL.dynMin - 1e-9);
      expect(o.velocityScale as number).toBeLessThanOrEqual(DEFAULT_CONDUCTOR_DIAL.dynMax + 1e-9);
      expect(o.enabled).toBe(true);
    }
  });

  it('enabled with no hand in frame, or a hand that never strokes: nothing plays until the first beat', async () => {
    const h = conductorNode.make(conductorNode.params.parse({ enabled: true, ...RECORDED }));
    const empty: HandsFrame[] = Array.from({ length: 150 }, () => ({ width: 1920, height: 1080, hands: [] }));
    const outs = await replayNode(h, { hands: empty }, { dt: 1 / FPS });
    for (const o of outs) {
      expect(o.beat).toBe(0);
      expect(o.bpm).toBe(0);
    }
    // A hand held still (the first frames of the clip before she beats) is the same.
    const still = frames.slice(0, 2).concat(Array.from({ length: 60 }, () => frames[1]));
    const h2 = conductorNode.make(conductorNode.params.parse({ enabled: true, ...RECORDED }));
    const outs2 = await replayNode(h2, { hands: still }, { dt: 1 / FPS });
    expect(outs2[outs2.length - 1].beat).toBe(0);
  });

  it('the beat never goes backwards, even with a tight servo and dropped frames', async () => {
    const h = conductorNode.make(conductorNode.params.parse({ enabled: true, servoBeats: 0.25, ...RECORDED }));
    // Every third frame, so dt is 0.1 s: a coarse, jittery clock.
    const sparse = frames.filter((_, i) => i % 3 === 0);
    const outs = await replayNode(h, { hands: sparse }, { dt: 3 / FPS });
    const beats = outs.map((o) => o.beat as number);
    for (let i = 1; i < beats.length; i++) expect(beats[i]).toBeGreaterThanOrEqual(beats[i - 1]);
    expect(beats[beats.length - 1]).toBeGreaterThan(5);
  });

  it('disabling resets the beat, so re-enabling starts from the top', async () => {
    const h = conductorNode.make(conductorNode.params.parse({ enabled: true, ...RECORDED }));
    const n = 240;
    const config = frames.slice(0, n).map((_, i) => (i < 150 ? { enabled: true, ...RECORDED } : i < 180 ? { enabled: false } : { enabled: true, ...RECORDED }));
    const outs = await replayNode(h, { hands: frames.slice(0, n), config }, { dt: 1 / FPS });
    expect(outs[149].beat as number).toBeGreaterThan(2);
    expect(outs[160].beat).toBe(0);
    expect(outs[n - 1].beat as number).toBeLessThan(outs[149].beat as number);
  });

  it('disabled: the beat is frozen, enabled is false and velocityScale is 0', async () => {
    const h = conductorNode.make(conductorNode.params.parse({ enabled: false, ...RECORDED }));
    const outs = await replayNode(h, { hands: frames.slice(0, 120) }, { dt: 1 / FPS });
    for (const o of outs) {
      expect(o.beat).toBe(0);
      expect(o.enabled).toBe(false);
      expect(o.velocityScale).toBe(0);
      expect(o.bpm).toBe(0);
    }
  });

  it('the config input overrides the params live: enabling mid-stream starts the follower', async () => {
    const h = conductorNode.make(conductorNode.params.parse({ enabled: false, ...RECORDED }));
    const n = 240;
    const config = frames.slice(0, n).map((_, i) => (i < 60 ? { enabled: false } : { enabled: true, ...RECORDED }));
    const outs = await replayNode(h, { hands: frames.slice(0, n), config }, { dt: 1 / FPS });
    expect(outs[30].enabled).toBe(false);
    expect(outs[30].beat).toBe(0);
    expect(outs[n - 1].enabled).toBe(true);
    expect(outs[n - 1].beat as number).toBeGreaterThan(1);
  });
});

describe('conductor mode in the real default graph (replayed hands, dial on)', () => {
  const ticks = 300;
  const spec = (dialOn: boolean) => {
    const g = defaultGraph({ source: 'replay-hands' }, createAppRegistry());
    const cam = g.nodes.find((n) => n.id === 'cam')!;
    cam.params = { frames: frames.slice(0, ticks) };
    return { g, controls: () => ({ ...baseControls(), conductor: { ...DEFAULT_CONDUCTOR_DIAL, enabled: dialOn, ...RECORDED } }) };
  };

  it('the score sounds on most ticks and its voices reach the merge', async () => {
    const { g, controls } = spec(true);
    const { recorder } = await runHeadless(g, createAppRegistry(), {
      ticks,
      nominalDt: 1 / FPS,
      resources: { controls },
      recordOnly: ['score.params', 'merge.params', 'conductor.beat', 'conductor.time'],
    });
    const score = recorder.values('score.params') as SynthParams[];
    const sounding = score.filter((p) => p.voices.some((v) => v.present)).length;
    expect(sounding).toBeGreaterThan(ticks * 0.5);
    const merged = recorder.values('merge.params') as SynthParams[];
    const scoreVoiceAtMerge = merged.some((p) => p.voices.some((v) => v.present && v.id >= SCORE_VOICE_ID_BASE));
    expect(scoreVoiceAtMerge).toBe(true);
    // The ictus, not the fallback, is what drives it: the follower is running most of
    // the time and the beat at 10 s is the bar-level tempo (10 s * 70/60 ≈ 11.7 beats,
    // ±15%). The 50 bpm fallback alone would give 8.3 beats and never run.
    const times = recorder.values('conductor.time') as { state: string }[];
    expect(times.filter((t) => t.state === 'running').length / times.length).toBeGreaterThan(0.6);
    const beats = recorder.values('conductor.beat') as number[];
    expect(beats[beats.length - 1]).toBeGreaterThan(11.7 * 0.85);
    expect(beats[beats.length - 1]).toBeLessThan(11.7 * 1.15);
  });

  it('with the dial off, not one score voice sounds', async () => {
    const { g, controls } = spec(false);
    const { recorder } = await runHeadless(g, createAppRegistry(), {
      ticks,
      nominalDt: 1 / FPS,
      resources: { controls },
      recordOnly: ['score.params'],
    });
    const score = recorder.values('score.params') as SynthParams[];
    expect(score.every((p) => p.voices.every((v) => !v.present))).toBe(true);
  });
});

/** The minimum `ControlSnapshot` store-controls needs (the app injects the whole store). */
function baseControls() {
  const voice = { root: 0, type: 'major', octaves: 2, baseOctave: 3, sound: 'sine' } as const;
  return { right: voice, left: { ...voice, sound: 'triangle' as const } };
}
