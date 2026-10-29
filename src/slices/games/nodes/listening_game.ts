/**
 * The listening game node: one of Sing, Play along, Match the note, or the calibration take, run
 * over what the microphone heard each tick (`heard`), on the engine clock.
 *
 * Inputs: the `games` dial (`config`), the start counter (`run`: a press of Start increments it,
 * and a new value starts a new session), the transport (`playing`: false stops it), the player's
 * calibrated offset (`offset`, a per-device pref), and `audio`, the tick's events from the audio
 * seam's `audio-events` node (adapted by `heardFrom` to pitch frames and onsets in engine seconds),
 * with that node's state (`micStatus`, shown while the microphone is not running). Outputs: the stage's view model
 * (`view`), the sounds due (`notes`, note events for the plucked sink: count-in clicks and
 * reference notes), and a human-rate `status` for the editor section.
 *
 * A session starts LEAD seconds after Start, so its first click can be scheduled ahead of the
 * output stage. Nothing here touches Web Audio or the canvas.
 */
import { z } from 'zod';
import { defineNode } from '@thoremin/dag';
import type { NodeContext } from '@thoremin/dag';
import type { NoteEvent } from '@thoremin/sdk/nodes/note_events';
import { createSingSession } from '../lib/sing';
import { createPlayAlongSession } from '../lib/play_along';
import { createMatchSession } from '../lib/match';
import { createCalibrationSession } from '../lib/calibrate';
import { lessonById, lessonsFor } from '../lib/lessons';
import { heardFrom, type Heard, type TimedAudioEvent } from '../lib/listen';
import type { Cue } from '../lib/cues';
import type { GameView, Phase, Results } from '../lib/view';
import { DEFAULT_GAMES, GamesSettingsSchema, MATCH_TOLERANCE, ONSET_WINDOWS, PITCH_TOLERANCE, type GameMode, type GamesSettings } from '../schema';
import type { Lesson } from '../lib/lesson';

/** Seconds between Start and the session's start: room to schedule the first click ahead. */
export const LEAD = 0.5;

const Params = z.object({});

export interface GamesStatus {
  enabled: boolean;
  mode: GameMode;
  lesson: string;
  phase: Phase | 'idle';
  accuracy: number;
  results: Results | null;
  /** The calibration take's estimate, when one just finished. */
  calibration: { offset: number; spread: number; refusal: string | null } | null;
  /** What is wrong with the microphone, or null while it is live. */
  notice: string | null;
}

export const IDLE_GAMES_STATUS: GamesStatus = { enabled: false, mode: 'sing', lesson: '', phase: 'idle', accuracy: 0, results: null, calibration: null, notice: null };

/** The dial, parsed with defaults; a malformed one is the defaults. */
export function resolveGames(raw: unknown): GamesSettings {
  const r = GamesSettingsSchema.safeParse(raw ?? {});
  return r.success ? r.data : DEFAULT_GAMES;
}

/** The lesson the dial names, or the game's first when it names none of this game's. */
export function lessonFor(s: GamesSettings): Lesson | undefined {
  if (s.game === 'calibrate') return undefined;
  const named = lessonById(s.lesson);
  return named && named.game === s.game ? named : lessonsFor(s.game)[0];
}

interface Session {
  tick(now: number, heard: Heard): { view: GameView; cues: Cue[] };
  result?: () => { offset: number; spread: number; refusal: string | null } | null;
}

function startSession(s: GamesSettings, start: number, offset: number): { session: Session; lesson: string } {
  if (s.game === 'calibrate') return { session: createCalibrationSession({ start }), lesson: 'calibrate' };
  const lesson = lessonFor(s)!;
  const common = { start, transpose: s.transpose, offset };
  switch (s.game) {
    case 'sing':
      return { session: createSingSession(lesson, { ...common, toleranceCents: PITCH_TOLERANCE[s.difficulty], octaveFold: s.octaveFold, reference: s.reference }), lesson: lesson.id };
    case 'play-along':
      return { session: createPlayAlongSession(lesson, { ...common, toleranceCents: PITCH_TOLERANCE[s.difficulty], windows: ONSET_WINDOWS[s.difficulty] }), lesson: lesson.id };
    case 'match':
      return { session: createMatchSession(lesson, { ...common, toleranceCents: MATCH_TOLERANCE[s.difficulty] }), lesson: lesson.id };
  }
}

/** What to tell the player about the microphone, from the audio hub's state; null while it is live. */
export function micNotice(state: string): string | null {
  switch (state) {
    case '':
    case 'live':
      return null;
    case 'denied':
      return 'The microphone was refused: allow it in the browser to play.';
    case 'unsupported':
      return 'This browser offers no microphone.';
    case 'failed':
      return 'The microphone could not be opened.';
    case 'unavailable':
      return 'No audio input here.';
    case 'waiting-audio':
      return 'Click or press a key to start the sound.';
    default:
      return 'Opening the microphone...';
  }
}

const toNoteEvent = (c: Cue, now: number): NoteEvent => ({ t: c.t, midi: c.midi, velocity: c.velocity, predicted: true, lead: c.t - now });

export const listeningGameNode = defineNode<z.infer<typeof Params>>({
  type: 'listening-game',
  roles: ['mapping'],
  title: 'Listening game',
  description:
    "A music game or lesson that listens to the microphone: Sing (a melody's notes as bars, the voice as a trail, judged by the share of each note on pitch), Play along (a note highway judged in time, and in pitch when the lesson is pitched), Match the note (find a played note and hold it), or the calibration take. Emits the stage's view model and its own count-in and reference sounds.",
  inputs: [
    { name: 'config', kind: 'games-config' },
    { name: 'run', kind: 'number', default: 0 },
    { name: 'playing', kind: 'boolean', default: false },
    { name: 'offset', kind: 'number', default: 0 },
    { name: 'audio', kind: 'audio-events' },
    { name: 'micStatus', kind: 'string', default: '' },
  ],
  outputs: [
    { name: 'view', kind: 'game-view' },
    { name: 'notes', kind: 'note-events' },
    { name: 'status', kind: 'games-status' },
  ],
  params: Params,
  make() {
    let session: Session | null = null;
    let lastRun = 0;
    let status: GamesStatus = { ...IDLE_GAMES_STATUS };
    return {
      process(inputs, ctx: NodeContext) {
        const s = resolveGames(inputs.config);
        const run = typeof inputs.run === 'number' ? inputs.run : 0;
        const playing = inputs.playing === true;
        const notice = micNotice(typeof inputs.micStatus === 'string' ? inputs.micStatus : '');
        const offset = typeof inputs.offset === 'number' && Number.isFinite(inputs.offset) ? inputs.offset : 0;
        if (!s.enabled || !playing) {
          session = null;
          lastRun = run;
          status = { ...IDLE_GAMES_STATUS, enabled: s.enabled, mode: s.game, lesson: s.lesson, results: status.results, calibration: status.calibration, notice };
          return { view: null, notes: [], status };
        }
        if (session === null || run !== lastRun) {
          lastRun = run;
          const started = startSession(s, ctx.time + LEAD, offset);
          session = started.session;
          status = { ...IDLE_GAMES_STATUS, enabled: true, mode: s.game, lesson: started.lesson };
        }
        const heard: Heard = heardFrom(inputs.audio as TimedAudioEvent[] | undefined);
        const { view: played, cues } = session.tick(ctx.time, heard);
        const view: GameView = notice ? { ...played, notice } : played;
        const calibration = view.phase === 'results' && session.result ? session.result() : null;
        status = { ...status, phase: view.phase, accuracy: view.accuracy, results: view.results ?? null, calibration, notice };
        return { view, notes: cues.map((c) => toNoteEvent(c, ctx.time)), status };
      },
      dispose() {
        session = null;
      },
    };
  },
});
