/**
 * The listening games slice (lane A of #866): music games and lessons that listen to the
 * microphone, the three most common kinds the research found (`docs/research/music-games-from-
 * audio.md`): **Sing** (karaoke pitch matching), **Play along** (a note highway judged in time and
 * pitch; its rhythm lessons are the rhythm trainer) and **Match the note** (a tuner made into a
 * drill), plus the calibration take that measures the player's offset. The design is
 * `docs/design/audio-games.md`.
 *
 * One node (`listening-game`) runs whichever the `games` dial names over what the microphone heard,
 * and drives the picture: its view model feeds this slice's own overlay element (`stage`), which
 * paints the whole canvas (the seeds hide the video). Its own sounds (count-in clicks, reference
 * notes) are note events into a plucked sink of this slice's (`games-out`), scheduled ahead on the
 * audio clock. The player's offset is a per-device pref (`gamesPrefs`), never an instrument's.
 */
import { defineBranch } from '@thoremin/sdk/instruments/branch';
import { defineExtension, dialSlice, overlayElementId, overlayPortName, transientPort } from '@thoremin/sdk/instruments/extension';
import { TRUNK } from '@thoremin/sdk/instruments/trunk';
import { makePluckOutNode } from '@thoremin/sdk/nodes/pluck_out';
import type { NodeDef } from '@thoremin/dag';
import { listeningGameNode } from './nodes/listening_game';
import { STAGE_ELEMENT, stageElement } from './nodes/overlay/stage';
import { GAMES_ANALYSERS } from '@thoremin/games/listen';
import { DEFAULT_GAMES, DEFAULT_GAMES_PREFS, GAMES_PREFS, GamesPrefsSchema, GamesSettingsSchema, type GamesPrefs } from './schema';

export const GAMES_EXTENSION_ID = 'audio-games';
export const GAMES_BRANCH_ID = 'listening-games';
export const GAMES_NODE_ID = 'listeningGame';
export const GAMES_OUT_NODE_ID = 'gamesOut';
export const GAMES_AUDIO_NODE_ID = 'gamesAudio';
export const GAMES_DIAL = 'games';
export const GAMES_CLASS = 'listen';

const gamesOutNode = makePluckOutNode('games-out', {
  title: 'Listening games sounds',
  description: "The listening games' own sounds (count-in clicks, reference notes) as plucked notes on the audio clock, each at the time the game scheduled it.",
});

const ui = (port: string) => ({ node: TRUNK.ui, port });
const to = (from: { node: string; port: string }, toRef: { node: string; port: string }) => ({ from, to: toRef });
const game = (port: string) => ({ node: GAMES_NODE_ID, port });

export const listeningGames = defineBranch({
  id: GAMES_BRANCH_ID,
  description: 'A listening game (Sing, Play along, Match the note) or the calibration take: the microphone in, the stage and the count-in out.',
  nodes: [
    // The microphone, through the audio seam (lane B of #866): its lease runs the onset and pitch
    // analysers while a game is composed, and only then.
    { id: GAMES_AUDIO_NODE_ID, type: 'audio-events', params: { analysers: GAMES_ANALYSERS } },
    { id: GAMES_NODE_ID, type: 'listening-game', params: {} },
    { id: GAMES_OUT_NODE_ID, type: 'games-out', params: { timbre: 'guitar', mono: false } },
  ],
  edges: [
    to(ui(GAMES_DIAL), game('config')),
    to(ui('gamesRun'), game('run')),
    to(ui('gamesPlaying'), game('playing')),
    to(ui('gamesOffset'), game('offset')),
    to({ node: GAMES_AUDIO_NODE_ID, port: 'events' }, game('audio')),
    to({ node: GAMES_AUDIO_NODE_ID, port: 'status' }, game('micStatus')),
    to(game('view'), { node: TRUNK.overlay, port: overlayPortName(GAMES_EXTENSION_ID, STAGE_ELEMENT, 'view') }),
    to(game('notes'), { node: GAMES_OUT_NODE_ID, port: 'notes' }),
  ],
  overlay: [overlayElementId(GAMES_EXTENSION_ID, STAGE_ELEMENT)],
});

const on = (s: Readonly<Record<string, unknown>>): boolean => (s[GAMES_DIAL] as { enabled?: boolean } | undefined)?.enabled === true;

/** What every game seed hides: the video (the game owns the picture), the theremin voices and
 *  the guides over the hands. */
const STAGE_PATCH = {
  handMap: { maxGain: 0 },
  overlay: { video: { show: false }, scaleGuide: { show: false }, markers: { showNotes: false } },
};

export const GAMES_EXTENSION = defineExtension({
  id: GAMES_EXTENSION_ID,
  classes: [{ id: GAMES_CLASS, label: 'Listening games', emoji: '👂', colour: 'hsl(190 70% 45%)', showEmpty: true }],
  catalog: [{ id: GAMES_DIAL, label: 'Listening games', emoji: '🎙️', class: GAMES_CLASS, usesScale: false, on }],
  overlay: [{ name: STAGE_ELEMENT, category: 'output', inputs: [{ name: 'view', kind: 'game-view' }] }],
  overlayElements: [stageElement],
  nodes: [listeningGameNode, gamesOutNode] as unknown as NodeDef<unknown>[],
  branches: [listeningGames],
  dials: [
    dialSlice({
      version: 1,
      key: 'games',
      schema: GamesSettingsSchema.default(DEFAULT_GAMES),
      kind: 'games-config',
      meta: {
        facets: ['Listening games'],
        title: 'Listening games',
        description: 'Which listening game (Sing, Play along, Match the note, or the timing take), its lesson, the difficulty, a transposition, whether any octave counts and whether Sing plays the first note',
      },
    }),
  ] as const,
  prefs: [
    {
      key: GAMES_PREFS,
      schema: GamesPrefsSchema.default(DEFAULT_GAMES_PREFS),
      ports: [{ name: 'gamesOffset', kind: 'number', read: (p: GamesPrefs) => p.offset }],
    },
  ],
  // The start counter (a press of Start) and the transport: never persisted, so a reload never starts a game.
  transient: [transientPort<number>()('gamesRun', 'number', 0), transientPort<boolean>()('gamesPlaying', 'boolean', false)] as const,
  instruments: [
    { name: 'Sing Along', patch: { ...STAGE_PATCH, [GAMES_DIAL]: { enabled: true, game: 'sing', lesson: 'sing-five' } } },
    { name: 'Play Along Lessons', patch: { ...STAGE_PATCH, [GAMES_DIAL]: { enabled: true, game: 'play-along', lesson: 'rhythm-quarters' } } },
    { name: 'Match the Note', patch: { ...STAGE_PATCH, [GAMES_DIAL]: { enabled: true, game: 'match', lesson: 'match-triad' } } },
  ],
  derive: (s) => (on(s as Readonly<Record<string, unknown>>) ? [GAMES_BRANCH_ID] : []),
});

export default GAMES_EXTENSION;
