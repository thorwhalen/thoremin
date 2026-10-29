/**
 * The listening games in the app: each seed composes the games branch (dial, start counter,
 * transport and offset into the node; its view to the stage element; its sounds to its sink), the
 * node runs a session from Start to the results on scripted input, and the stage draws every game
 * and phase from the view model alone.
 */
import { describe, it, expect } from 'vitest';
import { composeInstrumentGraph, branchIdsFor } from '@/app/graph';
import { createAppRegistry } from '@/nodes/browser';
import { seedSettings } from '../../scripts/stability/lib_run';
import { GAMES } from '../helpers/extensions';
import { makeRecordingCanvas } from '../helpers/canvas';
import { listeningGameNode, LEAD, type GamesStatus } from '@/slices/games/nodes/listening_game';
import { drawStage, layout } from '@/slices/games/nodes/overlay/stage';
import { DEFAULT_GAMES } from '@/slices/games/schema';
import { createSingSession } from '@/slices/games/lib/sing';
import { createPlayAlongSession } from '@/slices/games/lib/play_along';
import { createMatchSession } from '@/slices/games/lib/match';
import { createCalibrationSession } from '@/slices/games/lib/calibrate';
import { LESSONS } from '@/slices/games/lib/lessons';
import type { GameView } from '@/slices/games/lib/view';
import { heardFrom, type Heard, type TimedAudioEvent } from '@/slices/games/lib/listen';
import { micNotice } from '@/slices/games/nodes/listening_game';
import type { NodeContext } from '@thoremin/dag';
import type { NoteEvent } from '@thoremin/sdk/nodes/note_events';

const SEEDS = ['Sing Along', 'Play Along Lessons', 'Match the Note'];

/** Onsets as the audio seam's `audio-events` port carries them, from the games' onset analyser. */
const asEvents = (onsets: { t: number; strength: number }[]): TimedAudioEvent[] =>
  onsets.map((o) => ({ kind: 'onset', source: 'onset', frame: 0, detectedFrame: 0, strength: o.strength, t: o.t }));

describe.runIf(GAMES)('the listening game seeds', () => {
  for (const seed of SEEDS) {
    it(`${seed} composes the games branch, wired end to end, with the video hidden`, () => {
      const settings = seedSettings(seed) as unknown as Record<string, { enabled?: boolean; video?: { show?: boolean } }>;
      expect(settings.games.enabled).toBe(true);
      expect((settings.overlay as { video: { show: boolean } }).video.show).toBe(false);
      const branches = branchIdsFor(settings as never);
      expect(branches).toContain('listening-games');
      const { spec } = composeInstrumentGraph(branches, {}, createAppRegistry());
      const has = (fn: string, fp: string, tn: string, tp: string) => spec.edges.some((e) => e.from.node === fn && e.from.port === fp && e.to.node === tn && e.to.port === tp);
      expect(has('ui', 'games', 'listeningGame', 'config')).toBe(true);
      expect(has('ui', 'gamesRun', 'listeningGame', 'run')).toBe(true);
      expect(has('ui', 'gamesPlaying', 'listeningGame', 'playing')).toBe(true);
      expect(has('ui', 'gamesOffset', 'listeningGame', 'offset')).toBe(true);
      expect(has('gamesAudio', 'events', 'listeningGame', 'audio')).toBe(true);
      expect(has('gamesAudio', 'status', 'listeningGame', 'micStatus')).toBe(true);
      const audio = spec.nodes.find((x) => x.id === 'gamesAudio')!;
      expect(audio.type).toBe('audio-events');
      expect((audio.params as { analysers: { name: string }[] }).analysers.map((a) => a.name).sort()).toEqual(['onset', 'pitch']);
      expect(has('listeningGame', 'view', 'overlay', 'audio-games.stage.view')).toBe(true);
      expect(has('listeningGame', 'notes', 'gamesOut', 'notes')).toBe(true);
    });
  }

  it('no game, no branch', () => {
    expect(branchIdsFor(seedSettings('Sing Along', { games: { ...DEFAULT_GAMES, enabled: false } }))).not.toContain('listening-games');
  });
});

describe('the listening-game node', () => {
  const ctx = (time: number) => ({ time, resources: {}, log: () => undefined }) as unknown as NodeContext;
  const node = () => listeningGameNode.make({});
  const step = (n: ReturnType<typeof node>, time: number, inputs: Record<string, unknown>) =>
    n.process(inputs, ctx(time)) as { view: GameView | null; notes: NoteEvent[]; status: GamesStatus };

  it('is idle until started, runs a rhythm lesson from Start to the results, and schedules its count-in ahead', () => {
    const n = node();
    const config = { ...DEFAULT_GAMES, enabled: true, game: 'play-along', lesson: 'rhythm-quarters' };
    expect(step(n, 0, { config, run: 0, playing: false }).view).toBeNull();
    const first = step(n, 1, { config, run: 1, playing: true });
    expect(first.status.phase).toBe('count-in');
    // The first click is LEAD after Start, handed out ahead of time with a positive lead.
    expect(first.notes.length).toBeGreaterThan(0);
    expect(first.notes[0].t).toBeCloseTo(1 + LEAD);
    expect(first.notes[0].lead).toBeGreaterThan(0);
    const lesson = createPlayAlongSession(LESSONS.find((l) => l.id === 'rhythm-quarters')!, { start: 1 + LEAD });
    let last!: ReturnType<typeof step>;
    let prev = 1;
    for (let t = 1 + 1 / 60; t < lesson.end + 0.6; t += 1 / 60) {
      const onsets = lesson.notes.filter((x) => x.start > prev && x.start <= t).map((x) => ({ t: x.start + 0.01, strength: 1 }));
      last = step(n, t, { config, run: 1, playing: true, audio: asEvents(onsets) });
      prev = t;
    }
    expect(last.status.phase).toBe('results');
    expect(last.status.results!.counts.perfect).toBe(8);
  });

  it('a new Start restarts, and Stop goes idle keeping the last result', () => {
    const n = node();
    const config = { ...DEFAULT_GAMES, enabled: true, game: 'match', lesson: 'match-triad' };
    step(n, 0, { config, run: 1, playing: true });
    const again = step(n, 5, { config, run: 2, playing: true });
    expect(again.notes.map((e) => e.t)).toEqual([5 + LEAD]);
    expect(step(n, 6, { config, run: 2, playing: false }).status.phase).toBe('idle');
  });

  it('the timing take reports an offset from taps', () => {
    const n = node();
    const config = { ...DEFAULT_GAMES, enabled: true, game: 'calibrate' };
    step(n, 0, { config, run: 1, playing: true });
    const cal = createCalibrationSession({ start: LEAD });
    let last!: ReturnType<typeof step>;
    let prev = 0;
    for (let t = 1 / 60; t < cal.end + 0.2; t += 1 / 60) {
      const onsets = cal.clicks.filter((c) => c + 0.07 > prev && c + 0.07 <= t).map((c, i) => ({ t: c + 0.07 + (i % 2 ? 0.004 : -0.004), strength: 1 }));
      last = step(n, t, { config, run: 1, playing: true, audio: asEvents(onsets) });
      prev = t;
    }
    expect(last.status.calibration!.refusal).toBeNull();
    expect(last.status.calibration!.offset).toBeCloseTo(0.07, 2);
  });
});

describe('from the audio seam', () => {
  it('reads only the games\' own pitch and onset analysers', () => {
    const events: TimedAudioEvent[] = [
      { kind: 'pitch', source: 'pitch', frame: 0, f0: 440, clarity: 0.9, t: 1 },
      { kind: 'onset', source: 'onset', frame: 0, detectedFrame: 0, strength: 3, t: 1.1 },
      { kind: 'onset', source: 'sound-mapper', frame: 0, detectedFrame: 0, strength: 3, t: 1.2 },
      { kind: 'level', source: 'onset', frame: 0, rms: 0.1, peak: 0.2, t: 1.3 },
    ];
    const h: Heard = heardFrom(events);
    expect(h.pitch).toEqual([{ t: 1, f0: 440, clarity: 0.9 }]);
    expect(h.onsets).toEqual([{ t: 1.1, strength: 3 }]);
    expect(heardFrom(undefined)).toEqual({ pitch: [], onsets: [] });
  });

  it('says what is wrong with the microphone, and nothing while it is live', () => {
    expect(micNotice('live')).toBeNull();
    expect(micNotice('denied')).toMatch(/refused/);
    expect(micNotice('opening')).toMatch(/Opening/);
  });
});

describe('the stage', () => {
  const views = (): GameView[] => {
    const sing = createSingSession(LESSONS.find((l) => l.id === 'sing-five')!, { start: 0 });
    const play = createPlayAlongSession(LESSONS.find((l) => l.id === 'play-mary')!, { start: 0 });
    const match = createMatchSession(LESSONS.find((l) => l.id === 'match-triad')!, { start: 0 });
    const cal = createCalibrationSession({ start: 0 });
    const heard = (t: number): Heard => ({ pitch: [{ t, f0: 262, clarity: 0.9 }], onsets: [{ t, strength: 1 }] });
    const out: GameView[] = [];
    for (const s of [sing, play, match, cal]) for (const t of [0.1, 4, 6, 200]) out.push(s.tick(t, heard(t)).view);
    return out;
  };

  it('draws every game and phase, background first, from the view alone', () => {
    for (const v of views()) {
      const c = makeRecordingCanvas(960, 540);
      drawStage(c.canvas.getContext('2d') as CanvasRenderingContext2D, { W: 960, H: 540 }, v);
      expect(c.calls[0].m).toBe('fillRect');
      expect(c.texts()).toContain(v.title);
      if (v.phase === 'results') expect(c.texts().some((x) => x.includes(v.results!.summary))).toBe(true);
    }
  });

  it('leaves the background out of the overlay-only take', () => {
    const v = views()[1];
    const c = makeRecordingCanvas(960, 540);
    drawStage(c.canvas.getContext('2d') as CanvasRenderingContext2D, { W: 960, H: 540, overlayOnly: true }, v);
    expect(c.calls.filter((x) => x.m === 'fillRect' && x.args[2] === 960 && x.args[3] === 540)).toHaveLength(0);
  });

  it('puts now on the now line and higher notes higher', () => {
    const v = views()[1];
    const L = layout(v, 1000, 500);
    expect(L.xOf(v.now)).toBeCloseTo(300);
    expect(L.yOfMidi(v.high)).toBeLessThan(L.yOfMidi(v.low));
  });
});
