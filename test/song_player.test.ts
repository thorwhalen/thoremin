/**
 * `song-player` (#186 PR G): the song the Song tool loaded, played at a live rate into
 * the master bus, with the song's beat published as musical time. The stretcher is
 * injected (`ctx.resources.createStretcher`), a fake that advances its position with the
 * test's clock, so the node's lifecycle runs in Node.
 *
 * The fixture replay at the end is the reason the song half exists: the real dancer
 * (`video_body_que_calor`) against the song's beat as TRACKED from audio (a click track
 * at the clip's 129.2 bpm, its beat 0 at the clip's start, as `meta.json` says), read
 * through the player's `songTime`. The dancer's pulse level is four song beats (the
 * bar), and the dancer's anchors land at one place in the song's bar: the integer
 * relation PR H's pace controller is built on.
 */
import { describe, it, expect, vi } from 'vitest';

// The browser stretcher, replaced: every test here injects its own except the lazy-load one.
const defaultStretcher = vi.hoisted(() => vi.fn());
vi.mock('@/nodes/output/song_stretcher', () => ({
  createMediaElementStretcher: (...a: unknown[]) => {
    defaultStretcher(...a);
    return { load: async () => {}, play() {}, pause() {}, setRate() {}, setVolume() {}, position: () => 0, playing: () => false, ended: () => false, dispose() {} };
  },
}));
// The default (Signalsmith) stretcher, replaced the same way (#187 PR 7).
const signalsmithStretcher = vi.hoisted(() => vi.fn());
vi.mock('@/nodes/output/song_stretcher_signalsmith', () => ({
  createSignalsmithStretcher: (...a: unknown[]) => {
    signalsmithStretcher(...a);
    return { load: async () => {}, play() {}, pause() {}, setRate() {}, setVolume() {}, position: () => 0, playing: () => false, ended: () => false, dispose() {} };
  },
}));
import type { NodeContext, NodeHandlers, PortValues } from '@thoremin/dag';
import { trackSongGrid, PULSE_TRUSTED_CONFIDENCE, type MusicalTime, type PulseState, type SongGrid } from '@thoremin/ictus';
import type { LoadStatus } from '@thoremin/lazy';
import { bodyPulseNode, songPlayerNode, type BodyFrame, type SongHandle, type Stretcher } from '@/nodes';
import { createAppRegistry } from '@/nodes/browser';
import { defaultGraph } from '@/app/graph';
import { loadStream } from './helpers/fixtures';
import { renderClickTrack, SR } from './helpers/clicks';

/** A stretcher whose position is the test's clock times the rate while it plays. */
function fakeStretcher(opts: { failLoad?: boolean; durationS?: number } = {}) {
  const log: string[] = [];
  let pos = 0;
  let playing = false;
  let rate = 1;
  let volume = 1;
  const s: Stretcher & { advance(dt: number): void; log: string[]; rate(): number; volume(): number } = {
    log,
    load: async (url) => {
      log.push(`load:${url}`);
      pos = 0;
      playing = false;
      if (opts.failLoad) throw new Error('bad file');
    },
    play: () => {
      log.push('play');
      if (pos >= (opts.durationS ?? Infinity)) pos = 0;
      playing = true;
    },
    pause: () => {
      if (playing) log.push('pause');
      playing = false;
    },
    setRate: (r) => {
      rate = r;
    },
    setVolume: (v) => {
      volume = v;
    },
    position: () => pos,
    playing: () => playing,
    ended: () => pos >= (opts.durationS ?? Infinity),
    dispose: () => log.push('dispose'),
    advance(dt) {
      if (!playing) return;
      pos += dt * rate;
      if (pos >= (opts.durationS ?? Infinity)) {
        pos = opts.durationS!;
        playing = false;
      }
    },
    rate: () => rate,
    volume: () => volume,
  };
  return s;
}

const AUDIO = { audioContext: {}, masterGain: {} };

/** Drive a node tick by tick, letting promises settle between ticks (a load resolves
 *  between frames, as it does live). */
async function drive(h: NodeHandlers, frames: PortValues[], opts: { dt?: number; resources?: Record<string, unknown>; onTick?: (dt: number) => void } = {}) {
  const dt = opts.dt ?? 1 / 30;
  const out: PortValues[] = [];
  for (let i = 0; i < frames.length; i++) {
    const ctx: NodeContext = { tick: i, time: i * dt, dt: i === 0 ? 0 : dt, resources: opts.resources ?? {} };
    if (i > 0) opts.onTick?.(dt);
    out.push(h.process(frames[i], ctx));
    await Promise.resolve();
    await Promise.resolve();
  }
  return out;
}

const grid120: SongGrid = trackSongGrid(renderClickTrack({ bpm: 120, seconds: 12 }).samples, { sampleRate: SR });
const song = (id = 's1', grid = grid120): SongHandle => ({ id, name: `${id}.mp3`, url: `blob:${id}`, durationS: 12, grid });
const statusOf = (o: PortValues) => o.status as LoadStatus;

describe('song-player', () => {
  const make = () => songPlayerNode.make(songPlayerNode.params.parse({}));

  it('is off with no song, and waits for the audio before it loads anything', async () => {
    const st = fakeStretcher();
    const out = await drive(make(), [{}, { song: song() }], { resources: { createStretcher: () => st } });
    expect(statusOf(out[0]).phase).toBe('off');
    expect(statusOf(out[1])).toMatchObject({ phase: 'unavailable', reason: 'no-audio' });
    expect(st.log).toEqual([]);
  });

  it('loads a song ONCE by identity, plays on a rising edge, and pauses', async () => {
    const st = fakeStretcher();
    const s = song();
    const frames = [
      { song: s },
      { song: s },
      { song: s, playing: true },
      { song: s, playing: true },
      { song: s, playing: false },
    ];
    const out = await drive(make(), frames, { resources: { ...AUDIO, createStretcher: () => st }, onTick: (dt) => st.advance(dt) });
    expect(st.log).toEqual(['load:blob:s1', 'play', 'pause']);
    expect(statusOf(out[1]).phase).toBe('ready');
    expect(statusOf(out[2]).phase).toBe('active');
    expect(statusOf(out[4]).phase).toBe('ready');
    expect(out[3].position as number).toBeGreaterThan(0);
  });

  it('a press made while the song is loading plays it once it is ready', async () => {
    const st = fakeStretcher();
    const s = song();
    await drive(make(), [{ song: s, playing: true }, { song: s, playing: true }], { resources: { ...AUDIO, createStretcher: () => st } });
    expect(st.log).toEqual(['load:blob:s1', 'play']);
  });

  it('clamps the rate, and a tool claim silences it', async () => {
    const st = fakeStretcher();
    const s = song();
    await drive(make(), [{ song: s, rate: 7, volume: 0.5 }], { resources: { ...AUDIO, createStretcher: () => st } });
    expect(st.rate()).toBe(2);
    expect(st.volume()).toBe(0.5);
    await drive(make(), [{ song: s, rate: 0.1, claimed: true }], { resources: { ...AUDIO, createStretcher: () => st } });
    expect(st.rate()).toBe(0.5);
    expect(st.volume()).toBe(0);
  });

  it('reports a finished song as ended, and a fresh press plays it from the start', async () => {
    const st = fakeStretcher({ durationS: 0.1 });
    const s = song();
    const frames: PortValues[] = [{ song: s }, ...Array.from({ length: 6 }, () => ({ song: s, playing: true })), { song: s }, { song: s, playing: true }];
    const out = await drive(make(), frames, { resources: { ...AUDIO, createStretcher: () => st }, onTick: (dt) => st.advance(dt) });
    expect(statusOf(out[6])).toMatchObject({ phase: 'ready', reason: 'ended' });
    expect(st.log.filter((l) => l === 'play')).toHaveLength(2);
    expect(statusOf(out[8]).phase).toBe('active');
  });

  it('a Play pressed in the frame the song ends is not lost: the press counter is an edge whatever the level did (#344)', async () => {
    const st = fakeStretcher({ durationS: 0.1 });
    const s = song();
    // The song plays to its end with the transport held on; the reporter's "off" and the
    // player's next press both land before the next tick, so the LEVEL never falls. Only
    // the press counter (`play`) says a press happened.
    const held = Array.from({ length: 6 }, () => ({ song: s, playing: true, play: 1 }));
    const frames: PortValues[] = [{ song: s, play: 0 }, ...held, { song: s, playing: true, play: 2 }, { song: s, playing: true, play: 2 }];
    const out = await drive(make(), frames, { resources: { ...AUDIO, createStretcher: () => st }, onTick: (dt) => st.advance(dt) });
    expect(statusOf(out[6])).toMatchObject({ phase: 'ready', reason: 'ended' });
    expect(st.log.filter((l) => l === 'play')).toHaveLength(2);
    expect(statusOf(out[7]).phase).toBe('active');
  });

  it('a held transport with an unchanged press counter does not loop a finished song (#344)', async () => {
    const st = fakeStretcher({ durationS: 0.1 });
    const s = song();
    const frames: PortValues[] = [{ song: s, play: 0 }, ...Array.from({ length: 10 }, () => ({ song: s, playing: true, play: 1 }))];
    const out = await drive(make(), frames, { resources: { ...AUDIO, createStretcher: () => st }, onTick: (dt) => st.advance(dt) });
    expect(st.log.filter((l) => l === 'play')).toHaveLength(1);
    expect(statusOf(out[10])).toMatchObject({ phase: 'ready', reason: 'ended' });
  });

  it('a press made while the song is playing does not restart it (#344)', async () => {
    const st = fakeStretcher();
    const frames: PortValues[] = [{ song: song('a'), play: 5 }, { song: song('a'), playing: true, play: 6 }, { song: song('a'), playing: true, play: 7 }];
    await drive(make(), frames, { resources: { ...AUDIO, createStretcher: () => st } });
    expect(st.log.filter((l) => l === 'play')).toHaveLength(1);
  });

  it('a press counted while a leader held the transport does not play when he lets go (#344)', async () => {
    const st = fakeStretcher();
    const s = song();
    // The player pressed Play (level up, counter 1 -> 2) while the conductor led and kept the
    // song paused; once the leader lets go the song waits for a FRESH press, as with the level.
    const frames: PortValues[] = [
      { song: s, play: 1 },
      { song: s, playing: true, play: 1, followPlaying: false },
      { song: s, playing: true, play: 2, followPlaying: false },
      { song: s, playing: true, play: 2 },
      { song: s, playing: true, play: 2 },
      { song: s, playing: true, play: 3 },
    ];
    await drive(make(), frames, { resources: { ...AUDIO, createStretcher: () => st } });
    const plays = st.log.filter((l) => l === 'play').length;
    expect(plays).toBe(1);
    expect(st.playing()).toBe(true);
  });

  it('a new song is loaded; an unloaded one is paused and the player goes off', async () => {
    const st = fakeStretcher();
    const frames = [{ song: song('a') }, { song: song('a'), playing: true }, { song: song('b'), playing: true }, { song: null }];
    const out = await drive(make(), frames, { resources: { ...AUDIO, createStretcher: () => st } });
    expect(st.log.filter((l) => l.startsWith('load'))).toEqual(['load:blob:a', 'load:blob:b']);
    expect(statusOf(out[3]).phase).toBe('off');
  });

  it('a song that cannot be decoded is an error that names it', async () => {
    const st = fakeStretcher({ failLoad: true });
    const out = await drive(make(), [{ song: song('bad') }, { song: song('bad') }], { resources: { ...AUDIO, createStretcher: () => st } });
    expect(statusOf(out[1])).toMatchObject({ phase: 'error', reason: 'decode' });
    expect(statusOf(out[1]).message).toMatch(/bad\.mp3/);
  });

  it('a play the browser refuses is an autoplay error, not a silent "playing"; the next press retries', async () => {
    const st = fakeStretcher();
    let refuse = true;
    let ticks = 0;
    const play = st.play;
    let blocked = false;
    st.play = () => {
      play();
      blocked = refuse;
      if (refuse) st.pause();
    };
    st.blocked = () => blocked;
    const s = song();
    const out = await drive(make(), [{ song: s }, { song: s, playing: true }, { song: s, playing: false }, { song: s, playing: true }], {
      resources: { ...AUDIO, createStretcher: () => st },
      // The press on tick 1 is refused; by tick 3 the player has pressed Play in a click.
      onTick: () => {
        refuse = ++ticks < 3;
      },
    });
    expect(statusOf(out[1])).toMatchObject({ phase: 'error', reason: 'autoplay' });
    expect(statusOf(out[3]).phase).toBe('active');
  });

  it('a node disposed while its default stretcher loads creates no player', async () => {
    defaultStretcher.mockClear();
    signalsmithStretcher.mockClear();
    const h = make();
    // No injected factory: the default is imported lazily; dispose before it resolves.
    h.process({ song: song() }, { tick: 0, time: 0, dt: 0, resources: AUDIO });
    h.dispose?.();
    await new Promise((r) => setTimeout(r, 50));
    expect(signalsmithStretcher).not.toHaveBeenCalled();
    // A live node does create it once the import resolves: Signalsmith by default.
    const live = make();
    live.process({ song: song() }, { tick: 0, time: 0, dt: 0, resources: AUDIO });
    await new Promise((r) => setTimeout(r, 50));
    expect(signalsmithStretcher).toHaveBeenCalledTimes(1);
    expect(defaultStretcher).not.toHaveBeenCalled();
    live.dispose?.();
    // The `stretcher` param picks the media element outright.
    const element = songPlayerNode.make(songPlayerNode.params.parse({ stretcher: 'element' }));
    element.process({ song: song() }, { tick: 0, time: 0, dt: 0, resources: AUDIO });
    await new Promise((r) => setTimeout(r, 50));
    expect(defaultStretcher).toHaveBeenCalledTimes(1);
    element.dispose?.();
  });

  it('plays nothing in a replay that is not real time', async () => {
    const st = fakeStretcher();
    const out = await drive(make(), [{ song: song(), playing: true }], { resources: { ...AUDIO, createStretcher: () => st, timeScale: 0 } });
    expect(statusOf(out[0]).phase).toBe('unavailable');
    expect(st.log).toEqual([]);
  });

  it('publishes the song beat in ENGINE time: at 1.25x the period is 0.4 s', async () => {
    const st = fakeStretcher();
    const s = song();
    const frames = Array.from({ length: 90 }, () => ({ song: s, playing: true, rate: 1.25 }));
    const out = await drive(make(), frames, { resources: { ...AUDIO, createStretcher: () => st }, onTick: (dt) => st.advance(dt) });
    const t = out.at(-1)!.songTime as MusicalTime;
    expect(t.state).toBe('running');
    expect(t.period).toBeCloseTo(0.4, 2);
    expect(t.tempo).toBeCloseTo(150, 0);
  });
});

describe('the trunk wires the song player to the store and the claim (a structural guard)', () => {
  it('every input that makes the Song tool audible is connected', () => {
    const g = defaultGraph();
    expect(g.nodes.find((n) => n.id === 'songPlayer')?.type).toBe('song-player');
    const into = (port: string) => g.edges.filter((e) => e.to.node === 'songPlayer' && e.to.port === port).map((e) => `${e.from.node}.${e.from.port}`);
    expect(into('song')).toEqual(['ui.songHandle']);
    expect(into('playing')).toEqual(['ui.songPlaying']);
    expect(into('play')).toEqual(['ui.songPlays']);
    expect(into('rate')).toEqual(['ui.songRate']);
    expect(into('volume')).toEqual(['ui.songVolume']);
    expect(into('claimed')).toEqual(['ui.claimed']);
    // The ports exist on store-controls (a dangling edge would fail validation, not silently).
    const ui = createAppRegistry().get('store-controls')!;
    for (const p of ['songHandle', 'songPlaying', 'songPlays', 'songRate', 'songVolume']) expect(ui.outputs.map((o) => o.name)).toContain(p);
  });
});

describe('the real dancer against a tracked song grid (video_body_que_calor)', () => {
  // What this does and does not show: the song is a click track at the clip's STATED
  // tempo (the fixture has no audio), so it checks that the tracker, the player's
  // songTime and the pulse share one timeline and relate by an integer ratio. The bar
  // resultant is invariant to a constant offset, so it does not check the dancer's
  // phase against the real recording's downbeat.
  it('the dancer repeats every FOUR song beats, at one place in the song bar', async () => {
    const frames = loadStream('video_body_que_calor', 'camBody.body') as BodyFrame[];
    const seconds = frames.length / 30;
    // The song: a click track at the clip's tempo, beat 0 at the clip's start (meta.json:
    // the clip starts at the music's origin), tracked like any loaded file.
    const grid = trackSongGrid(renderClickTrack({ bpm: 129.2, seconds: seconds + 1 }).samples, { sampleRate: SR });
    expect(Math.abs(grid.bpm - 129.2)).toBeLessThan(0.2);

    const pulse = (await drive(bodyPulseNode.make(bodyPulseNode.params.parse({})), frames.map((body) => ({ body })))).map((o) => o.pulse as PulseState);
    const st = fakeStretcher();
    const s: SongHandle = { id: 'que', name: 'que.wav', url: 'blob:que', durationS: seconds + 1, grid };
    // Play from the first frame: the press is on tick 0, the song is ready on tick 1.
    const played = await drive(songPlayerNode.make(songPlayerNode.params.parse({})), frames.map(() => ({ song: s, playing: true })), {
      resources: { ...AUDIO, createStretcher: () => st },
      onTick: (dt) => st.advance(dt),
    });
    const songTime = played.map((o) => o.songTime as MusicalTime);

    // The level, in song beats, on every trusted tick after the first six seconds.
    const late = pulse.map((p, i) => ({ p, m: songTime[i] })).slice(6 * 30).filter(({ p, m }) => p.confidence >= PULSE_TRUSTED_CONFIDENCE && m.state === 'running');
    expect(late.length).toBeGreaterThan(300);
    const ratios = late.map(({ p, m }) => p.level / m.period);
    expect(ratios.every((r) => Math.abs(r - 4) < 0.25)).toBe(true);

    // Each anchor's place in the song's bar (beats mod 4), read off the song's own time.
    const anchors: number[] = [];
    for (const p of pulse) if (p.lastAnchorAt !== undefined && anchors.at(-1) !== p.lastAnchorAt) anchors.push(p.lastAnchorAt);
    const beatAt = (t: number) => {
      const i = Math.min(songTime.length - 1, Math.max(0, Math.round(t * 30)));
      const m = songTime[i];
      return m.beat + (t - m.t) / m.period;
    };
    const barPhases = anchors.filter((t) => t > 1).map((t) => (2 * Math.PI * beatAt(t)) / 4);
    const R = Math.hypot(barPhases.reduce((a, x) => a + Math.cos(x), 0), barPhases.reduce((a, x) => a + Math.sin(x), 0)) / barPhases.length;
    expect(barPhases.length).toBeGreaterThanOrEqual(8);
    // The D-Jogger acceptance figure for 30 Hz pose is R > 0.7 (research map §6.2).
    expect(R).toBeGreaterThan(0.8);
  });
});

describe('the song reporter', () => {
  it('turns the transport off once per end or refusal, and writes only on a change', async () => {
    const { makeSongReporter } = await import('@/app/songStatus');
    const outputs: Record<string, unknown> = { status: { phase: 'active', message: 'Playing' }, position: 1.2 };
    const engine = { getOutput: (_n: string, port: string) => outputs[port] };
    const reports: unknown[] = [];
    let stopped = 0;
    const tick = makeSongReporter(engine, { report: (s) => reports.push(s) }, () => stopped++);
    tick();
    tick();
    expect(reports).toHaveLength(1);
    outputs.status = { phase: 'ready', reason: 'ended', message: 'done' };
    tick();
    tick();
    expect(stopped).toBe(1);
    outputs.status = { phase: 'error', reason: 'autoplay', message: 'blocked' };
    tick();
    expect(stopped).toBe(2);
  });
});
