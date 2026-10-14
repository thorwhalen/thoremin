/**
 * "Conduct a recording" (#187 PR 7): the conductor's beat leads the song loaded in the
 * Song tool, through the SAME pace-controller node, song player and beat grid the dancer
 * uses (#186 PR G/H). Pinned here: which branches compose (one leader for one song), what
 * the conductor node hands the score and the song, and the loop closed through the two
 * real nodes (pace controller with a conductor on `lead`, song player with a stretcher
 * whose position is the exact integral of its rate), as the graph's delayed edges close it.
 */
import { describe, it, expect } from 'vitest';
import type { NodeContext, PortValues } from '@thoremin/dag';
import { beatIndexAt, trackSongGrid, type MusicalTime, type ServoState } from '@thoremin/ictus';
import { conductorNode, paceControllerNode, songPlayerNode, type SongHandle, type Stretcher } from '@/nodes';
import { branchIdsFor, composeInstrumentGraph } from '@/app/graph';
import { songConducted, type DerivationSettings } from '@/instruments/derive';
import { renderClickTrack, SR } from './helpers/clicks';

const handle = (): SongHandle => ({
  id: 'take',
  name: 'take.wav',
  url: 'blob:take',
  durationS: 30,
  grid: trackSongGrid(renderClickTrack({ bpm: 120, seconds: 30 }).samples, { sampleRate: SR }),
});

const settings = (over: Partial<DerivationSettings> = {}): DerivationSettings => ({
  conductor: { enabled: true, conducts: 'recording', orchestra: { enabled: false } },
  songPrefs: { follow: false },
  songHandle: handle(),
  ...over,
});

describe('which branches compose', () => {
  it('the conductor leading a loaded recording composes the song pace and the conductor, not the body', () => {
    const ids = branchIdsFor(settings());
    expect(songConducted(settings())).toBe(true);
    expect(ids).toEqual(expect.arrayContaining(['conductor', 'song-pace']));
    expect(ids).not.toContain('body-source');
    // It compiles against the real table (one pace node, its leaders on optional edges).
    const { spec } = composeInstrumentGraph(ids);
    expect(spec.edges).toEqual(expect.arrayContaining([expect.objectContaining({ from: { node: 'conductor', port: 'recordingTime' }, to: { node: 'pace', port: 'lead' } })]));
    // No dancer: the pulse edge is optional and dropped.
    expect(spec.edges.some((e) => e.to.node === 'pace' && e.to.port === 'pulse')).toBe(false);
  });

  it('replaces the dancer while it leads: following on does not start the body camera', () => {
    const ids = branchIdsFor(settings({ songPrefs: { follow: true } }));
    expect(ids).toContain('song-pace');
    expect(ids).not.toContain('body-source');
    // The conductor leading the SCORE leaves the dancer leading the song.
    const dancer = branchIdsFor(settings({ songPrefs: { follow: true }, conductor: { enabled: true, conducts: 'score' } }));
    expect(dancer).toEqual(expect.arrayContaining(['song-pace', 'body-source', 'conductor']));
  });

  it('needs a song, and the conductor on', () => {
    expect(branchIdsFor(settings({ songHandle: null }))).not.toContain('song-pace');
    expect(branchIdsFor(settings({ conductor: { enabled: false, conducts: 'recording' } }))).not.toContain('song-pace');
  });

  it('under an explicit branch set, only when the instrument lists the conductor', () => {
    expect(branchIdsFor(settings(), { explicit: ['field-voices', 'conductor'] })).toContain('song-pace');
    expect(branchIdsFor(settings(), { explicit: ['field-voices'] })).not.toContain('song-pace');
  });
});

describe('the conductor node hands the score or the recording the beat, never both', () => {
  const ctx: NodeContext = { tick: 0, time: 0, dt: 0, resources: {} };
  it('leading the score: the score plays, the song is not led', () => {
    const out = conductorNode.make(conductorNode.params.parse({ enabled: true })).process({}, ctx);
    expect(out.leadsScore).toBe(true);
    expect(out.recordingTime).toBeUndefined();
  });
  it('leading the recording: the score is silent, the song gets the time', () => {
    const out = conductorNode.make(conductorNode.params.parse({ enabled: true, conducts: 'recording' })).process({}, ctx);
    expect(out.leadsScore).toBe(false);
    expect(out.enabled).toBe(true);
    expect((out.recordingTime as MusicalTime).state).toBe('ready');
  });
  it('off: neither', () => {
    const out = conductorNode.make(conductorNode.params.parse({ conducts: 'recording' })).process({}, ctx);
    expect(out.leadsScore).toBe(false);
    expect(out.recordingTime).toBeUndefined();
  });
});

describe('the loop through the real nodes', () => {
  /** A stretcher whose position is the exact integral of its rate, with seek. */
  function integratingStretcher() {
    let pos = 0;
    let playing = false;
    let rate = 1;
    const seeks: number[] = [];
    const s: Stretcher & { advance(dt: number): void; seeks: number[] } = {
      seeks,
      load: async () => {},
      play: () => void (playing = true),
      pause: () => void (playing = false),
      setRate: (r) => void (rate = r),
      setVolume: () => {},
      seek: (p) => {
        seeks.push(p);
        pos = p;
      },
      position: () => pos,
      playing: () => playing,
      ended: () => false,
      dispose: () => {},
      advance(dt) {
        if (playing) pos += rate * dt;
      },
    };
    return s;
  }

  it('waits cued on the first beat, starts on the first stroke and holds the heard beat to the conductor', async () => {
    const song = handle();
    const st = integratingStretcher();
    const pace = paceControllerNode.make(paceControllerNode.params.parse({}));
    const player = songPlayerNode.make(songPlayerNode.params.parse({}));
    // A known output stage, so the test can say what is heard when.
    const LATENCY = 0.05;
    const timing = { outputStage: { value: LATENCY, source: 'measured' } };
    const resources = { audioContext: {}, masterGain: {}, createStretcher: () => st, timing };
    const HZ = 60;
    const dt = 1 / HZ;
    // The conductor: still until 1 s, then 1.7 beats a second (102 bpm against the song's 120).
    const leadAt = (t: number): MusicalTime => {
      const on = t > 1;
      const beat = on ? (t - 1) * 1.7 : 0;
      return { t, beat, phase: beat % 1, tempo: on ? 102 : 0, period: on ? 1 / 1.7 : Infinity, confidence: 0.9, nextBeatAt: Infinity, beatsPerBar: 4, beatInBar: 0, state: on ? 'running' : 'ready', anchors: on ? 1 : 0 };
    };
    let prev: PortValues = {};
    const heard: Array<{ t: number; pos: number }> = [];
    const states: ServoState[] = [];
    for (let i = 0; i <= 10 * HZ; i++) {
      const t = i * dt;
      const ctx: NodeContext = { tick: i, time: t, dt: i ? dt : 0, resources };
      const p = pace.process({ lead: leadAt(t), song: prev.songTime, rate: prev.rate, base: 1, range: 0.1 }, ctx);
      states.push(p.servo as ServoState);
      prev = player.process({ song, playing: false, rate: 1, followRate: p.rate, followPlaying: p.playing, cue: p.cue, volume: 0.8 }, ctx);
      heard.push({ t, pos: st.position() });
      await Promise.resolve();
      st.advance(dt);
    }
    // Before the first stroke: paused on the song's first beat.
    expect(st.seeks[0]).toBeCloseTo(song.grid.beats[0], 3);
    expect(states[Math.round(0.9 * HZ)].mode).toBe('cueing');
    expect(states[Math.round(0.9 * HZ)].playing).toBe(false);
    // After it: following, and the beat HEARD (the position LATENCY ago) is the conductor's.
    expect(states[5 * HZ].mode).toBe('following');
    for (let t = 6; t <= 10; t += 0.25) {
      const i = Math.round(t * HZ);
      const then = heard[i - Math.round(LATENCY * HZ)];
      expect(Math.abs(leadAt(t).beat - beatIndexAt(song.grid, then.pos))).toBeLessThan(0.03);
    }
    // At 102 bpm against 120 the song plays at about 0.85.
    expect(prev.rate as number).toBeCloseTo(102 / song.grid.bpm, 1);
  });
});

describe('the song player under a leader (the review\'s cases)', () => {
  function seekingStretcher(durationS = 30) {
    let pos = 0;
    let playing = false;
    const log: string[] = [];
    const s: Stretcher & { log: string[] } = {
      log,
      load: async () => {},
      play: () => {
        log.push('play');
        if (pos >= durationS) pos = 0;
        playing = true;
      },
      pause: () => {
        if (playing) log.push('pause');
        playing = false;
      },
      setRate: () => {},
      setVolume: () => {},
      seek: (p) => {
        log.push(`seek:${p.toFixed(2)}`);
        pos = p;
      },
      position: () => pos,
      playing: () => playing,
      ended: () => pos >= durationS,
      dispose: () => {},
    };
    return s;
  }
  const drive = async (frames: PortValues[], st: Stretcher) => {
    const player = songPlayerNode.make(songPlayerNode.params.parse({}));
    for (let i = 0; i < frames.length; i++) {
      player.process(frames[i], { tick: i, time: i / 30, dt: i ? 1 / 30 : 0, resources: { audioContext: {}, masterGain: {}, createStretcher: () => st } });
      await Promise.resolve();
      await Promise.resolve();
    }
  };

  it('a new leader\'s cue ids, counting from 1 again, are never mistaken for the old one\'s', async () => {
    const song = handle();
    const st = seekingStretcher();
    await drive([{ song }, { song, cue: { id: 1, beat: 2 } }, { song }, { song, cue: { id: 1, beat: 4 } }], st);
    expect(st.log.filter((l) => l.startsWith('seek'))).toHaveLength(2);
  });

  it('a song cued past its end is not restarted from the top by the leader', async () => {
    const song = { ...handle(), durationS: 30 };
    const st = seekingStretcher(30);
    await drive([{ song }, { song, followPlaying: false, cue: { id: 1, beat: 999 } }, { song, followPlaying: true, cue: { id: 1, beat: 999 } }], st);
    expect(st.log).not.toContain('play');
  });

  it('when the leader lets go, the song pauses and waits for a fresh press of Play', async () => {
    const song = handle();
    const st = seekingStretcher();
    await drive([{ song, playing: true }, { song, playing: true, followPlaying: true }, { song, playing: true }, { song, playing: true }], st);
    expect(st.log.at(-1)).toBe('pause');
    expect(st.playing()).toBe(false);
  });
});

describe('a conductor\'s hold fades the song instead of cutting it (#366)', () => {
  function fadingStretcher() {
    let playing = false;
    let pos = 0;
    const log: string[] = [];
    const s: Stretcher & { log: string[] } = {
      log,
      load: async () => {},
      play: () => {
        log.push('play');
        playing = true;
      },
      pause: () => {
        if (playing) log.push('pause');
        playing = false;
      },
      fade: (level, seconds) => log.push(`fade:${level}:${seconds}`),
      setRate: () => {},
      setVolume: () => {},
      seek: (p) => {
        log.push(`seek:${p.toFixed(1)}`);
        pos = p;
      },
      position: () => pos,
      playing: () => playing,
      ended: () => false,
      dispose: () => {},
    };
    return s;
  }
  /** One tick per `dt`; frames are [followPlaying, cue?]. */
  const run = async (st: Stretcher, holdFade: number, frames: [boolean, number?][], dt = 0.25) => {
    const song = handle();
    const player = songPlayerNode.make(songPlayerNode.params.parse({}));
    for (let i = 0; i < frames.length; i++) {
      const [followPlaying, cue] = frames[i];
      player.process(
        { song, followPlaying, holdFade, ...(cue ? { cue: { id: cue, beat: 2 } } : {}) },
        { tick: i, time: i * dt, dt: i ? dt : 0, resources: { audioContext: {}, masterGain: {}, createStretcher: () => st } },
      );
      await Promise.resolve();
      await Promise.resolve();
    }
  };

  it('with no fade a hold pauses at once (today\'s behaviour)', async () => {
    const st = fadingStretcher();
    await run(st, 0, [[false], [true], [true], [false]]);
    expect(st.log).toEqual(['play', 'pause']);
  });

  it('fades out over the length, pauses once silent, and fades back in from silence on the release', async () => {
    const st = fadingStretcher();
    // dt 0.25 s: sounds, then holds for 1.2 s of a 1 s fade, then releases.
    await run(st, 1, [[false], [true], [true], [false], [false], [false], [false], [false], [false], [true]]);
    expect(st.log).toEqual(['play', 'fade:0:1', 'pause', 'fade:1:1', 'play']);
  });

  it('a release before the ramp ends climbs back without a pause or a restart', async () => {
    const st = fadingStretcher();
    await run(st, 1, [[false], [true], [false], [false], [true], [true]]);
    expect(st.log).toEqual(['play', 'fade:0:1', 'fade:1:1']);
  });

  it('a cue waits out the ramp, then the song seeks and plays', async () => {
    const st = fadingStretcher();
    await run(st, 1, [[false], [true], [false, 1], [false, 1], [false, 1], [false, 1], [false, 1], [true, 1]]);
    const seek = st.log.findIndex((l) => l.startsWith('seek'));
    expect(st.log.indexOf('pause')).toBeGreaterThan(-1);
    expect(seek).toBeGreaterThan(st.log.indexOf('pause'));
  });

  it('a stretcher with no fader cuts, as before', async () => {
    const st = fadingStretcher();
    delete (st as { fade?: unknown }).fade;
    await run(st, 1, [[false], [true], [false], [false]]);
    expect(st.log).toEqual(['play', 'pause']);
  });
});

describe('a song replaced by another restarts the beat servo (#439)', () => {
  // The pace node alone, over a song that obeys it: its beat advances at the rate the node
  // asks while it says play, and jumps to a new cue, as the song player does. Song A is at
  // 120 bpm under a conductor at 240, so the servo settles on a level ratio other than 1;
  // song B is at the conductor's own 240, so its ratio is 1.
  const HZ = 60;
  const dt = 1 / HZ;
  const SWAP = 8;
  const leadAt = (t: number): MusicalTime => {
    const beat = t * 4;
    return { t, beat, phase: beat % 1, tempo: 240, period: 0.25, confidence: 0.9, nextBeatAt: Infinity, beatsPerBar: 4, beatInBar: Math.floor(beat) % 4, state: 'running', anchors: Math.floor(beat) + 1 };
  };
  const run = (swapId: string) => {
    const pace = paceControllerNode.make(paceControllerNode.params.parse({}));
    let bpm = 120;
    let pos = 0;
    let prev: PortValues = {};
    let cueId: number | null = null;
    const states: ServoState[] = [];
    const rates: number[] = [];
    for (let i = 0; i <= 14 * HZ; i++) {
      const t = i * dt;
      const handle = { id: t < SWAP ? 'a' : swapId };
      // The song's time as the player gives it (`songTimeAt`): tempo and period in ENGINE
      // time, at the rate it played. It arrives on a delayed edge, so on the swap tick it
      // is still song A's; song B's starts the tick after.
      const r = (prev.rate as number) ?? 1;
      const song: MusicalTime = { t, beat: pos, phase: pos % 1, tempo: bpm * r, period: 60 / bpm / r, confidence: 1, nextBeatAt: Infinity, beatsPerBar: 4, beatInBar: Math.floor(pos) % 4, state: 'running', anchors: 1 };
      const ctx: NodeContext = { tick: i, time: t, dt: i ? dt : 0, resources: {} };
      prev = pace.process({ lead: leadAt(t), song, rate: (prev.rate as number) ?? 1, base: 1, range: 0.1, songHandle: handle }, ctx);
      states.push(prev.servo as ServoState);
      rates.push(prev.rate as number);
      if (i === SWAP * HZ) {
        bpm = swapId === 'a' ? bpm : 240;
        pos = swapId === 'a' ? pos : 0;
      }
      const cue = prev.cue as { id: number; beat: number } | undefined;
      if (cue && cue.id !== cueId) {
        cueId = cue.id;
        pos = cue.beat;
      } else if (prev.playing) pos += ((bpm * (prev.rate as number)) / 60) * dt;
    }
    return { states, rates };
  };

  it('the old song\'s level ratio is dropped at once, not after it has stopped persisting', () => {
    const { states, rates } = run('b');
    // Under song A the servo had settled on a level ratio other than 1.
    expect(states[Math.round((SWAP - 0.5) * HZ)].ratio).not.toBe(1);
    // From the swap on, song B (at the conductor's own tempo) is followed at 1, never at A's,
    // and it settles at its own speed.
    for (let t = SWAP; t <= SWAP + 2.5; t += 0.25) expect(states[Math.round(t * HZ)].ratio, `t=${t}`).toBe(1);
    for (let t = SWAP + 4; t <= SWAP + 6; t += 0.25) expect(rates[Math.round(t * HZ)], `t=${t}`).toBeCloseTo(1, 1);
  });

  it('the same song (same id) keeps what the servo learned (the control)', () => {
    const { states } = run('a');
    expect(states[Math.round((SWAP + 0.5) * HZ)].ratio).toBe(states[Math.round((SWAP - 0.5) * HZ)].ratio);
  });
});

describe('a song still loading is not led (#500)', () => {
  // The real pace node and song player under a running conductor. Song A plays; at SWAP the
  // player is given song B, whose load resolves only at LOADED. Until then the stretcher
  // keeps song A's position (as Signalsmith does while it fetches and decodes), so the
  // player's songTime is B's grid read at A's position. A cue computed from that would be
  // stale by the time B plays.
  const HZ = 60;
  const dt = 1 / HZ;
  const SWAP = 4;
  const LOADED = 6;
  const leadAt = (t: number): MusicalTime => {
    const on = t > 0.5;
    const beat = on ? (t - 0.5) * 1.7 : 0;
    return { t, beat, phase: beat % 1, tempo: on ? 102 : 0, period: on ? 1 / 1.7 : Infinity, confidence: 0.9, nextBeatAt: Infinity, beatsPerBar: 4, beatInBar: 0, state: on ? 'running' : 'ready', anchors: on ? 1 : 0 };
  };
  /** The integrating stretcher, whose loads resolve when the test says so; until then the
   *  position is the previous song's. */
  function slowStretcher() {
    let pos = 0;
    let playing = false;
    let rate = 1;
    const seeks: Array<{ t: number; p: number }> = [];
    let now = 0;
    let release: (() => void) | null = null;
    const s: Stretcher & { advance(dt: number): void; seeks: typeof seeks; finish(): void; at(t: number): void } = {
      seeks,
      load: () => new Promise<void>((resolve) => {
        if (now < SWAP) return resolve();
        release = () => {
          pos = 0;
          resolve();
        };
      }),
      play: () => void (playing = true),
      pause: () => void (playing = false),
      setRate: (r) => void (rate = r),
      setVolume: () => {},
      seek: (p) => {
        seeks.push({ t: now, p });
        pos = p;
      },
      position: () => pos,
      playing: () => playing,
      ended: () => false,
      dispose: () => {},
      advance(d) {
        if (playing) pos += rate * d;
      },
      finish() {
        release?.();
        release = null;
      },
      at(t) {
        now = t;
      },
    };
    return s;
  }

  it('no cue while song B loads, and its first cue is the conductor\'s beat once it can play', async () => {
    const a = handle();
    const b = { ...handle(), id: 'take-b', name: 'b.wav', url: 'blob:b' };
    const st = slowStretcher();
    const pace = paceControllerNode.make(paceControllerNode.params.parse({}));
    const player = songPlayerNode.make(songPlayerNode.params.parse({}));
    const timing = { outputStage: { value: 0, source: 'measured' } };
    const resources = { audioContext: {}, masterGain: {}, createStretcher: () => st, timing };
    let prev: PortValues = {};
    const cues: Array<{ t: number; id: number; beat: number }> = [];
    let lastCue: number | null = null;
    for (let i = 0; i <= 10 * HZ; i++) {
      const t = i * dt;
      st.at(t);
      if (i === LOADED * HZ) st.finish();
      const song = t < SWAP ? a : b;
      const ctx: NodeContext = { tick: i, time: t, dt: i ? dt : 0, resources };
      const p = pace.process({ lead: leadAt(t), song: prev.songTime, rate: prev.rate, base: 1, range: 0.1, songHandle: song, songStatus: prev.status }, ctx);
      const cue = p.cue as { id: number; beat: number } | undefined;
      if (cue && cue.id !== lastCue) {
        lastCue = cue.id;
        cues.push({ t, id: cue.id, beat: cue.beat });
      }
      prev = player.process({ song, playing: false, rate: 1, followRate: p.rate, followPlaying: p.playing, cue: p.cue, volume: 0.8 }, ctx);
      await Promise.resolve();
      await Promise.resolve();
      st.advance(dt);
    }
    // Nothing is cued while B loads.
    expect(cues.filter((c) => c.t > SWAP && c.t < LOADED)).toEqual([]);
    // Once B can play, its first cue is where the conductor is then (song beat = conductor beat).
    const first = cues.find((c) => c.t >= LOADED);
    expect(first).toBeDefined();
    expect(Math.abs(first!.beat - leadAt(first!.t).beat)).toBeLessThan(0.25);
    // And the song then follows the conductor: by the end, the beat played is his.
    const end = 10;
    expect(Math.abs(beatIndexAt(b.grid, st.position()) - leadAt(end).beat)).toBeLessThan(0.1);
  });
});
