/**
 * The musical-context slice: a timeline of the music around the player (`MusicalContext`), read
 * every tick by the `music-context` node, and the instrument's scale following it while the
 * `musicContext.scaleFrom` dial says so. The timeline is handed to the graph as a transient field
 * (`musicContextActive`) by the producers in the app half (the loaded score; the player's key,
 * tapped tempo and chord chart, a per-device pref, through the Music tool); the node and its
 * branch are composed while the dial gives the music the scale, or while another branch reads its
 * readings (the chord map following the music).
 */
import { defineExtension, dialSlice, transientPort } from '@thoremin/sdk/instruments/extension';
import type { NodeDef } from '@thoremin/dag';
import { MUSIC_CONTEXT_BRANCH, type ActiveContext } from '@thoremin/sdk/context/reading';
import { musicContextNode } from './nodes/music_context';
import { musicScaleNode } from './nodes/music_scale';
import { musicContextBranch } from './branches';
import { MUSIC_CONTEXT_STORES } from './stores';
import { DEFAULT_MUSIC_CONTEXT, DEFAULT_MUSIC_USER, MUSIC_CONTEXT_ACTIVE, MUSIC_USER_PREF, MusicContextSettingsSchema, MusicUserPrefSchema, type MusicContextSettings } from './schema';

export const MUSIC_CONTEXT_EXTENSION_ID = 'music-context';

export const MUSIC_CONTEXT_EXTENSION = defineExtension({
  id: MUSIC_CONTEXT_EXTENSION_ID,
  nodes: [musicContextNode, musicScaleNode] as unknown as NodeDef<unknown>[],
  branches: [musicContextBranch],
  dials: [
    dialSlice({
      // Written out (not MUSIC_CONTEXT_DIAL): the settings type reads the literal from here.
      key: 'musicContext',
      schema: MusicContextSettingsSchema.default(DEFAULT_MUSIC_CONTEXT),
      kind: 'music-context-config',
      meta: { facets: ['Music'], title: 'Music', description: "Whether the instrument's scale follows the music playing (its key), and how" },
    }),
  ] as const,
  stores: Object.values(MUSIC_CONTEXT_STORES),
  // What the player said about each piece (key, tapped tempo, chart): a per-device pref, about the
  // music, never an instrument setting.
  prefs: [{ key: MUSIC_USER_PREF, schema: MusicUserPrefSchema.default(DEFAULT_MUSIC_USER) }],
  // The timeline in force: made by the producers, never persisted.
  transient: [transientPort<ActiveContext | null>()(MUSIC_CONTEXT_ACTIVE, 'music-context', null)] as const,
  derive: (s) => ((s as { musicContext?: Partial<MusicContextSettings> }).musicContext?.scaleFrom === 'music' ? [MUSIC_CONTEXT_BRANCH] : []),
});

export default MUSIC_CONTEXT_EXTENSION;
