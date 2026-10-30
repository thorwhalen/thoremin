/**
 * The song slice (#600 S15; #186 PR G, H; #187 PR 7): the song a player loads in the Song tool,
 * played under any instrument at a rate with its pitch kept (`song-player` and its stretchers), and
 * the pace controller that lets a leader set its tempo (`pace-controller`: the dancer's pulse or the
 * conductor's beat). Moved out of core whole: the player was a trunk node, its level and rate a core
 * device pref, its song and transport core transients, its derivation rules core's.
 *
 * Nothing here is an instrument's: the pref is per device (`songPrefs`, a `PrefSlice` whose ports
 * the nodes read field by field), the song and its transport are transient, and both branches are a
 * TOOL's need: the player joins the trunk (`trunk`), the pace controller is derived from the tool's
 * state (`toolDerive`) into an instrument's explicit branch set too. Another
 * extension reads the song's musical time from `SONG_PLAYER` on an optional edge (the air chord map).
 * The sampled orchestra stays with the conductor (S18).
 */
import { defineExtension, transientPort } from '@thoremin/sdk/instruments/extension';
import type { NodeDef } from '@thoremin/dag';
import { songPlayerNode } from './nodes/song_player';
import { paceControllerNode } from './nodes/pace_controller';
import type { SongHandle } from './nodes/song_player.schema';
import { SONG_PACE, SONG_PLAYBACK } from './branches';
import { deriveSongBranches, SONG_PLAYBACK_BRANCH } from './derive';
import { SongSettingsSchema, DEFAULT_SONG, SONG_PREFS, type SongSettings } from './schema';

export const SONG_EXTENSION = defineExtension({
  id: 'song-tool',
  nodes: [songPlayerNode, paceControllerNode] as unknown as NodeDef<unknown>[],
  branches: [SONG_PLAYBACK, SONG_PACE],
  dials: [] as const,
  prefs: [
    {
      key: SONG_PREFS,
      liveInTab: true,
      schema: SongSettingsSchema.default(DEFAULT_SONG),
      // The ports the player and the pace controller read, as core's bridge emitted them.
      ports: [
        { name: 'songVolume', kind: 'number', read: (p: SongSettings) => p.volume },
        { name: 'songRate', kind: 'number', read: (p: SongSettings) => p.rate },
        { name: 'songHoldFade', kind: 'number', read: (p: SongSettings) => p.holdFadeS },
        { name: 'songHoldSlow', kind: 'number', read: (p: SongSettings) => p.holdSlow },
        { name: 'songAlignStart', kind: 'boolean', read: (p: SongSettings) => p.alignStart },
        // How far the pace controller may pull the song (#186 PR H; `follow` itself composes the
        // pace branch, so it needs no port).
        { name: 'songFollowRange', kind: 'number', read: (p: SongSettings) => p.followRange },
      ],
    },
  ],
  // The loaded song (by identity: the player tells a new song by it), its transport, the press
  // counter (#344) and the conductor's start beat (#364): never persisted, so a reload never plays.
  transient: [
    transientPort<SongHandle | null>()('songHandle', 'song-handle', null),
    transientPort<boolean>()('songPlaying', 'boolean', false),
    transientPort<number>()('songPlays', 'number', 0),
    transientPort<number>()('songStartBeat', 'number', 0),
  ] as const,
  derive: () => [],
  // The player joins the trunk, as it was before the slice: every instrument has it, idle until a
  // song loads. The pace controller is a tool's need.
  trunk: [SONG_PLAYBACK_BRANCH],
  toolDerive: deriveSongBranches,
});

export default SONG_EXTENSION;
