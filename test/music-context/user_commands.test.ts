/**
 * The Music tool's write path: the `music.*` commands write the player's entry for the piece
 * playing (a per-device pref, keyed by the piece), taps are placed on the song's position and make
 * the tempo, and the player's producer publishes the timeline in force from them.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { provideControls, type ControlsHost } from '@thoremin/sdk-ui/host';
import { songTimeAt, EMPTY_SONG_GRID } from '@thoremin/ictus';
import type { ActiveContext } from '@thoremin/sdk/context/reading';
import { clearMusicKeyCmd, setChartCmd, setMusicKeyCmd, tapTempoCmd } from '@/slices/music-context/app/commands';
import { clearTaps, mirrorSongTime, pieceKey, startUserContext, tap, userPref } from '@/slices/music-context/app/user';
import { MUSIC } from '../helpers/extensions';

function fakeControls(initial: Record<string, unknown> = {}) {
  let state: Record<string, unknown> = { ...initial };
  const listeners = new Set<() => void>();
  const write = (field: string, value: unknown) => {
    state = { ...state, [field]: value };
    for (const l of [...listeners]) l();
  };
  const host: ControlsHost = { get: () => state, setTransient: write, setHush: () => {}, setPref: write, subscribe: (l) => (listeners.add(l), () => void listeners.delete(l)) };
  provideControls(host);
  return { state: () => state, set: (patch: Record<string, unknown>) => { state = { ...state, ...patch }; for (const l of [...listeners]) l(); } };
}

const SONG = { id: 's1', name: 'tune.mp3', url: 'blob:x', durationS: 60, grid: EMPTY_SONG_GRID, item: { source: 'internet-archive', id: 'tune', title: 'Tune' } };
const run = <P>(cmd: { execute: (p: P, ctx: never) => unknown }, params: P) => cmd.execute(params, {} as never) as Promise<{ ok: boolean; value?: unknown; error?: { code: string } }>;

describe.runIf(MUSIC)('the Music tool commands', () => {
  beforeEach(() => {
    clearTaps();
    mirrorSongTime(null);
  });

  it('keys the entry by the piece: its source item, its file, a conducted score; refuses with nothing loaded', async () => {
    fakeControls();
    expect(pieceKey()).toBe('');
    expect((await run(setMusicKeyCmd, { tonic: 2, mode: 'minor' })).error?.code).toBe('no_piece');
    const host = fakeControls({ songHandle: SONG });
    expect(pieceKey()).toBe('internet-archive:tune');
    expect(pieceKey({ name: 'a.mp3', durationS: 61.2 })).toBe('file:a.mp3:61');
    expect((await run(setMusicKeyCmd, { tonic: 2, mode: 'minor' })).ok).toBe(true);
    expect(userPref().entries['internet-archive:tune'].key).toEqual({ tonic: 2, mode: 'minor' });
    await run(clearMusicKeyCmd, {});
    expect(userPref().entries['internet-archive:tune']).toBeUndefined(); // an empty entry is removed
    host.set({ songHandle: null, scoreDoc: { title: 'Modulation study' } });
    expect(pieceKey()).toBe('score:Modulation study');
  });

  it('refuses a chart with tokens that are not chords, and saves a good one', async () => {
    fakeControls({ songHandle: SONG });
    expect((await run(setChartCmd, { chart: 'C | Q7' })).error?.code).toBe('bad_chart');
    // The song has no beat grid and no tempo was tapped: saved, but waiting for a tempo.
    expect(await run(setChartCmd, { chart: 'C | F G' })).toMatchObject({ ok: true, value: { bars: 2, placed: false } });
  });

  it('places taps on the song position and sets the tempo after four', async () => {
    fakeControls({ songHandle: SONG });
    expect(tap(10)).toBe('no-song');
    expect((await run(tapTempoCmd, {})).error?.code).toBe('no_song');
    // The song plays from position 2 at engine time 50; the player taps on its beats at 120 bpm.
    mirrorSongTime(songTimeAt(EMPTY_SONG_GRID, 2, { t: 50, rate: 1, playing: true }));
    expect(tap(50)).toEqual({ taps: 1 });
    tap(50.5);
    tap(51);
    expect(tap(51.5)).toMatchObject({ bpm: 120, taps: 4 });
    expect(userPref().entries['internet-archive:tune'].tempo).toMatchObject({ bpm: 120, firstBeatS: 2, beatsPerBar: 4 });
  });

  it('places a tap where the beat was heard (less the output stage), and starts again after a seek', () => {
    fakeControls({ songHandle: SONG });
    // A 50 ms output stage: the beat heard at engine time 50 left the player at position 2 - 0.05.
    mirrorSongTime(songTimeAt(EMPTY_SONG_GRID, 2, { t: 50, rate: 1, playing: true }), 0.05);
    for (const t of [50.05, 50.55, 51.05]) tap(t);
    expect((tap(51.55) as { bpm: number }).bpm).toBeCloseTo(120, 6);
    expect(userPref().entries['internet-archive:tune'].tempo!.firstBeatS).toBeCloseTo(2, 6);
    // The song jumps to 30 s: the next taps are a new run.
    mirrorSongTime(songTimeAt(EMPTY_SONG_GRID, 30, { t: 52, rate: 1, playing: true }), 0.05);
    expect(tap(52.05)).toEqual({ taps: 1 });
  });

  it("starts again on the song player's own seek, however short (#945)", () => {
    fakeControls({ songHandle: SONG });
    // Slow tapping (2 s apart, 30 bpm): a 0.3 s seek is inside the position test's slack.
    mirrorSongTime(songTimeAt(EMPTY_SONG_GRID, 2, { t: 50, rate: 1, playing: true }), 0, 0);
    for (const t of [50, 52, 54]) tap(t);
    expect((tap(56) as { taps: number }).taps).toBe(4);
    mirrorSongTime(songTimeAt(EMPTY_SONG_GRID, 8.3, { t: 56, rate: 1, playing: true }), 0, 0);
    expect((tap(58) as { taps: number }).taps).toBe(5);
    // The same 0.3 s seek made by the player: its count moved, so the run starts again.
    mirrorSongTime(songTimeAt(EMPTY_SONG_GRID, 10.6, { t: 58, rate: 1, playing: true }), 0, 1);
    expect(tap(60)).toEqual({ taps: 1 });
  });

  it('keeps the downbeat past the cap on taps', () => {
    fakeControls({ songHandle: SONG });
    // 200 taps at 120 bpm from song position 10 (song time = engine time - 40).
    mirrorSongTime(songTimeAt(EMPTY_SONG_GRID, 10, { t: 50, rate: 1, playing: true }));
    let last: ReturnType<typeof tap> = { taps: 0 };
    for (let k = 0; k < 200; k++) last = tap(50 + k * 0.5);
    expect(last).toMatchObject({ taps: 128 });
    const tempo = userPref().entries['internet-archive:tune'].tempo!;
    expect(tempo.firstBeatS).toBeCloseTo(10, 6);
    expect(tempo.bpm).toBeCloseTo(120, 6);
  });

  it('reads the entries one by one: one it cannot read is skipped and kept', async () => {
    const host = fakeControls({ songHandle: SONG, musicUser: { entries: { 'x:new': { key: { tonic: 2, mode: 'hypophrygian' } }, 'x:old': { key: { tonic: 4, mode: 'minor' } } } } });
    expect(Object.keys(userPref().entries)).toEqual(['x:old']);
    await run(setMusicKeyCmd, { tonic: 0, mode: 'major' });
    const stored = (host.state().musicUser as { entries: Record<string, unknown> }).entries;
    expect(Object.keys(stored).sort()).toEqual(['internet-archive:tune', 'x:new', 'x:old']);
  });

  it("publishes the player's timeline, on the song's clock, and withdraws it with the entry", async () => {
    const host = fakeControls({ songHandle: SONG });
    const stop = startUserContext();
    const active = () => host.state().musicContextActive as ActiveContext | null | undefined;
    expect(active() ?? null).toBeNull();
    await run(setMusicKeyCmd, { tonic: 9, mode: 'minor' });
    expect(active()).toMatchObject({ clock: 'song', context: { source: 'user', keys: [{ tonic: 9, mode: 'minor' }] } });
    await run(clearMusicKeyCmd, {});
    expect(active()).toBeNull();
    stop();
  });
});
