/**
 * `pace-controller` (#186 PR H): the song follows the dancer, through the real wiring.
 *
 * The graph here is the composed instrument graph (the `song-pace` branch and what it
 * requires) cut down to the five nodes the loop runs through: the store bridge, the body
 * source (a replay), the dancer's pulse, the pace controller and the song player (its
 * stretcher injected, advancing with the test's clock at the rate it was given). So the
 * edges, the delayed ones that close the loop included, are the branch table's own.
 *
 * The fixture replay is the acceptance test of the research map §6.2: the real dancer
 * (`video_body_que_calor`, dancing at 129.2 bpm) against a song tracked from a click track
 * 6 % SLOWER than the dance. Following, the song is pulled up to the dancer's tempo and
 * the dancer's anchors land at one place in the song's beat (D-Jogger's R); not
 * following, they drift through it.
 */
import { describe, it, expect } from 'vitest';
import { Engine, type GraphSpec } from '@thoremin/dag';
import { trackSongGrid, type MusicalTime, type PaceState, type PulseState } from '@thoremin/ictus';
import { createAppRegistry } from '@/nodes/browser';
import { composeInstrumentGraph, branchIdsFor } from '@/app/graph';
import { DEFAULT_SONG } from '@/settings/schema';
import { useControls } from '@/app/store';
import type { BodyFrame, SongHandle, Stretcher } from '@/nodes';
import { loadStream } from './helpers/fixtures';
import { renderClickTrack, SR } from './helpers/clicks';

const HZ = 30;
const REGISTRY = createAppRegistry();
const LOOP = ['ui', 'camBody', 'bodyPulse', 'pace', 'songPlayer'];

/** The composed graph with following on, cut to the loop's nodes. `follow: false` cuts the
 *  controller's rate out of the player too: the same song, played at its own tempo. */
function loopSpec(bodyParams: Record<string, unknown>, follow = true): GraphSpec {
  const ids = branchIdsFor({ songPrefs: { follow: true }, songHandle: {} });
  expect(ids).toContain('song-pace');
  expect(ids).toContain('body-source');
  const { spec } = composeInstrumentGraph(ids, { body: 'replay-body', source: 'synthetic-hands' }, REGISTRY);
  expect(spec.nodes.find((n) => n.id === 'camBody')?.type).toBe('replay-body');
  return {
    nodes: spec.nodes.filter((n) => LOOP.includes(n.id)).map((n) => (n.id === 'camBody' ? { ...n, params: bodyParams } : n)),
    edges: spec.edges.filter((e) => LOOP.includes(e.from.node) && LOOP.includes(e.to.node) && (follow || e.to.port !== 'followRate')),
  };
}

/** A stretcher whose position is the test's clock times the rate it was last given. */
function clockStretcher() {
  let pos = 0;
  let playing = false;
  let rate = 1;
  const s: Stretcher & { advance(dt: number): void } = {
    load: async () => {},
    play: () => {
      playing = true;
    },
    pause: () => {
      playing = false;
    },
    setRate: (r) => {
      rate = r;
    },
    setVolume: () => {},
    position: () => pos,
    playing: () => playing,
    ended: () => false,
    dispose: () => {},
    advance(dt) {
      if (playing) pos += dt * rate;
    },
  };
  return s;
}

interface Run {
  pace: PaceState[];
  rate: number[];
  pulse: PulseState[];
  song: MusicalTime[];
}

async function runLoop(frames: BodyFrame[], song: SongHandle, prefs: Partial<typeof DEFAULT_SONG> = {}, follow = true): Promise<Run> {
  const st = clockStretcher();
  // The real store's snapshot (store-controls reads every field), with the song loaded.
  const controls = { ...useControls.getState(), songHandle: song, songPlaying: true, songPrefs: { ...DEFAULT_SONG, ...prefs } };
  const engine = new Engine(loopSpec({ frames }, follow), REGISTRY, {
    resources: { controls: () => controls, audioContext: {}, masterGain: {}, createStretcher: () => st },
  });
  const out: Run = { pace: [], rate: [], pulse: [], song: [] };
  for (let i = 0; i < frames.length; i++) {
    if (i > 0) st.advance(1 / HZ);
    engine.tick(i / HZ);
    // The song's load resolves between frames, as it does live.
    await Promise.resolve();
    out.pace.push(engine.getOutput('pace', 'pace') as PaceState);
    out.rate.push(engine.getOutput('songPlayer', 'rate') as number);
    out.pulse.push(engine.getOutput('bodyPulse', 'pulse') as PulseState);
    out.song.push(engine.getOutput('songPlayer', 'songTime') as MusicalTime);
  }
  return out;
}

/** D-Jogger's R: how concentrated the anchors' phases in the song's beat are, from `fromS`. */
function anchorR(run: Run, fromS: number): { R: number; n: number } {
  const anchors: number[] = [];
  for (const p of run.pulse) if (p.lastAnchorAt !== undefined && anchors.at(-1) !== p.lastAnchorAt) anchors.push(p.lastAnchorAt);
  const beatAt = (t: number) => {
    const m = run.song[Math.min(run.song.length - 1, Math.max(0, Math.round(t * HZ)))];
    return m.beat + (t - m.t) / m.period;
  };
  const ph = anchors.filter((t) => t >= fromS).map((t) => 2 * Math.PI * beatAt(t));
  const R = Math.hypot(ph.reduce((a, x) => a + Math.cos(x), 0), ph.reduce((a, x) => a + Math.sin(x), 0)) / ph.length;
  return { R, n: ph.length };
}

describe('the real dancer leads the song (video_body_que_calor)', () => {
  // The clip is 20 s and the pulse needs about 6 s before it is trusted and the lock 3 s
  // more, so it is played twice through; the seam is a jump in the dance, which the
  // follower answers by dropping its pulse (the controller holds) and finding it again.
  const dance = loadStream('video_body_que_calor', 'camBody.body') as BodyFrame[];
  const frames = [...dance, ...dance];
  const seconds = frames.length / HZ;
  const songAt = (bpm: number): SongHandle => {
    const grid = trackSongGrid(renderClickTrack({ bpm, seconds: seconds + 2 }).samples, { sampleRate: SR });
    return { id: `s${bpm}`, name: `${bpm}.wav`, url: `blob:${bpm}`, durationS: seconds + 2, grid };
  };

  // Measured (the R is the anchors' phase in the song's BEAT, D-Jogger's figure; the
  // anchors are the dancer's, the beat is the song as it played):
  //   song at          followed: R   rate (from 15 s)   not followed: R
  //   129.2 / 1.06     0.71          1.007              0.45
  //   129.2            0.67          0.947              0.09
  //   129.2 * 1.06     0.67          0.918              0.23
  // The rates are the DANCER's: from 9 s on this dancer's cycles are about 1.94 s apart
  // (the anchors), slower than the clip's nominal bar (1.858 s), so even a song at the
  // nominal tempo is slowed about 5 %, and the unfollowed song drifts through the beat.
  for (const { bpm, rMin, rOffMax, mean: meanRange } of [
    { bpm: 129.2 / 1.06, rMin: 0.7, rOffMax: 0.5, mean: [0.99, 1.03] },
    { bpm: 129.2, rMin: 0.6, rOffMax: 0.2, mean: [0.92, 0.97] },
    { bpm: 129.2 * 1.06, rMin: 0.6, rOffMax: 0.3, mean: [0.9, 0.94] },
  ]) {
    it(`a song at ${bpm.toFixed(1)} bpm: locks on the bar, stays in the clamp, and the anchors land in step`, async () => {
      const song = songAt(bpm);
      const on = await runLoop(frames, song);
      const off = await runLoop(frames, song, {}, false);

      // Locked on four song beats (the bar) once the pulse is trusted, and only on that.
      const first = on.pace.findIndex((p) => p.mode === 'following');
      expect(first / HZ).toBeGreaterThan(6);
      expect(first / HZ).toBeLessThan(11);
      const following = on.pace.filter((p) => p.mode === 'following');
      expect(following.length / on.pace.length).toBeGreaterThan(0.45);
      expect(new Set(following.map((p) => p.ratio))).toEqual(new Set([4]));
      // The rate the player used never left the clamp.
      expect(on.rate.every((r) => r >= 0.9 - 1e-9 && r <= 1.1 + 1e-9)).toBe(true);
      const late = on.rate.slice(15 * HZ);
      const mean = late.reduce((acc, x) => acc + x, 0) / late.length;
      expect(mean).toBeGreaterThan(meanRange[0]);
      expect(mean).toBeLessThan(meanRange[1]);

      // D-Jogger's acceptance figure for 30 Hz pose is R > 0.7 (research map §6.2); the
      // unfollowed song is the control.
      const rOn = anchorR(on, 15);
      const rOff = anchorR(off, 15);
      expect(rOn.n).toBeGreaterThanOrEqual(10);
      expect(rOn.R).toBeGreaterThan(rMin);
      expect(rOff.R).toBeLessThan(rOffMax);
    });
  }
});

describe('the synthetic dancer (synthetic-body), a known answer', () => {
  it('steps every 1.2 s against a song whose beat is 0.6 s at 1.05x: locks on two beats and plays at 1.05', async () => {
    const st = clockStretcher();
    // The song's own beat is 0.63 s; two of them at 1.05x are the dancer's 1.2 s step.
    const bpm = 100 / 1.05;
    const grid = trackSongGrid(renderClickTrack({ bpm, seconds: 64 }).samples, { sampleRate: SR });
    const song: SongHandle = { id: 'syn', name: 'syn.wav', url: 'blob:syn', durationS: 64, grid };
    const controls = { ...useControls.getState(), songHandle: song, songPlaying: true, songPrefs: { ...DEFAULT_SONG, follow: true } };
    const spec = loopSpec({});
    spec.nodes = spec.nodes.map((n) => (n.id === 'camBody' ? { id: 'camBody', type: 'synthetic-body', params: { stepPeriod: 1.2 } } : n));
    const engine = new Engine(spec, REGISTRY, { resources: { controls: () => controls, audioContext: {}, masterGain: {}, createStretcher: () => st } });
    const pace: PaceState[] = [];
    for (let i = 0; i < 60 * HZ; i++) {
      if (i > 0) st.advance(1 / HZ);
      engine.tick(i / HZ);
      await Promise.resolve();
      pace.push(engine.getOutput('pace', 'pace') as PaceState);
    }
    const late = pace.slice(30 * HZ);
    expect(late.every((p) => p.mode === 'following' && p.ratio === 2)).toBe(true);
    const mean = late.reduce((a, p) => a + p.rate, 0) / late.length;
    expect(mean).toBeCloseTo(1.05, 2);
    // In step: the phase error inside a twelfth of a beat for the last 20 s.
    expect(pace.slice(40 * HZ).every((p) => Math.abs(p.phaseError) <= 1 / 12)).toBe(true);
  });
});

describe('when the song follows (the derivation)', () => {
  it('following composes the pace branch and the body it needs, only while a song is loaded', () => {
    expect(branchIdsFor({ songPrefs: { follow: true }, songHandle: {} })).toEqual(expect.arrayContaining(['song-pace', 'body-source']));
    expect(branchIdsFor({ songPrefs: { follow: true }, songHandle: null })).not.toContain('song-pace');
    expect(branchIdsFor({ songPrefs: { follow: true }, songHandle: null })).not.toContain('body-source');
    expect(branchIdsFor({ songPrefs: { follow: false }, songHandle: {} })).not.toContain('song-pace');
    // Following does not route the body onto the hand voices.
    const routes = { a: { target: 'vibrato', feature: 'body.kin.qom' } };
    expect(branchIdsFor({ songPrefs: { follow: true }, songHandle: {}, bodyMap: { routes } })).not.toContain('body-route');
    // A per-device need, like a tool's: an instrument's explicit branch set does not veto it.
    expect(branchIdsFor({ songPrefs: { follow: true }, songHandle: {} }, { explicit: ['field-voices'] })).toEqual(
      expect.arrayContaining(['song-pace', 'body-source']),
    );
  });
});
