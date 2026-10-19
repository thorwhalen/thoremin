/**
 * The song slice's branches (#600 S15): the player, which was the trunk's (composed always, idle
 * until a song loads), and the pace controller that lets a leader set its tempo.
 */
import { defineBranch } from '@thoremin/sdk/instruments/branch';
import { SONG_PLAYER, TRUNK } from '@thoremin/sdk/instruments/trunk';
import { SONG_PACE_BRANCH, SONG_PLAYBACK_BRANCH } from './derive';

const ui = (port: string) => ({ node: TRUNK.ui, port });
const to = (from: { node: string; port: string }, toRef: { node: string; port: string }, optional = false) =>
  optional ? { from, to: toRef, optional: true } : { from, to: toRef };

/** The song the player loaded in the Song tool (#186 PR G): the loaded song by identity, its
 *  transport, level and rate, and a tool's claim, which silences it like every other voice. It
 *  plays into the master bus itself (no voice in the merge). */
export const SONG_PLAYBACK = defineBranch({
  id: SONG_PLAYBACK_BRANCH,
  description: 'The song loaded in the Song tool, played at a rate with its pitch kept; its beat as musical time.',
  nodes: [{ id: SONG_PLAYER, type: 'song-player', params: {} }],
  edges: [
    to(ui('songHandle'), { node: SONG_PLAYER, port: 'song' }),
    to(ui('songPlaying'), { node: SONG_PLAYER, port: 'playing' }),
    to(ui('songPlays'), { node: SONG_PLAYER, port: 'play' }),
    to(ui('songRate'), { node: SONG_PLAYER, port: 'rate' }),
    to(ui('songVolume'), { node: SONG_PLAYER, port: 'volume' }),
    to(ui('songHoldFade'), { node: SONG_PLAYER, port: 'holdFade' }),
    to(ui('songHoldSlow'), { node: SONG_PLAYER, port: 'holdSlow' }),
    to(ui('claimed'), { node: SONG_PLAYER, port: 'claimed' }),
  ],
});

/**
 * The song follows a leader: the dancer (#186 PR H, research map §9.6) or the conductor
 * (#187 PR 7, "Conduct a recording", the conducting map §6.7). One pace controller reads
 * the leader and the song's beat and sets the rate the song plays at. It closes a loop
 * through the song player, so the two edges back from the player are DELAYED (the
 * previous tick's song time and rate, extrapolated to now).
 *
 * The leaders arrive on OPTIONAL edges, each present when its branch is composed: the
 * dancer's pulse from the body source, the conductor's `recordingTime` from the conductor
 * (a time only while he leads the recording, so a conductor leading the score never
 * steers the song). With a conductor's time the node runs the beat servo and also drives
 * the player's transport (`followPlaying`) and cue; with the dancer's pulse alone it runs
 * the dancer's law and leaves the transport to the player. Composed while following is on
 * or the conductor leads the recording, and a song is loaded; the derivation composes the
 * leader's branch with it (the body source for the dancer, the conductor for himself): the slice's
 * `toolDerive` (`./derive.ts`).
 */
export const SONG_PACE = defineBranch({
  id: SONG_PACE_BRANCH,
  description: "The song's tempo follows a leader: the dancer's pulse or the conductor's beat.",
  nodes: [{ id: 'pace', type: 'pace-controller', params: {} }],
  edges: [
    to({ node: 'bodyPulse', port: 'pulse' }, { node: 'pace', port: 'pulse' }, true),
    to({ node: 'conductor', port: 'recordingTime' }, { node: 'pace', port: 'lead' }, true),
    { from: { node: SONG_PLAYER, port: 'songTime' }, to: { node: 'pace', port: 'song' }, delayed: true },
    { from: { node: SONG_PLAYER, port: 'rate' }, to: { node: 'pace', port: 'rate' }, delayed: true },
    // Neither law leads a song still loading (#500).
    { from: { node: SONG_PLAYER, port: 'status' }, to: { node: 'pace', port: 'songStatus' }, delayed: true },
    to(ui('songRate'), { node: 'pace', port: 'base' }),
    to(ui('songFollowRange'), { node: 'pace', port: 'range' }),
    // After a Play, land the song's beat on the dancer's cycle at once (#346 item 1).
    to(ui('songAlignStart'), { node: 'pace', port: 'alignStart' }),
    // Where the conductor's first beat lands in the song (#364); the dancer's law ignores it.
    to(ui('songStartBeat'), { node: 'pace', port: 'offset' }),
    // A new song restarts the laws (#439): the handle's identity, not its time.
    to(ui('songHandle'), { node: 'pace', port: 'songHandle' }),
    to({ node: 'pace', port: 'rate' }, { node: SONG_PLAYER, port: 'followRate' }),
    to({ node: 'pace', port: 'playing' }, { node: SONG_PLAYER, port: 'followPlaying' }),
    to({ node: 'pace', port: 'cue' }, { node: SONG_PLAYER, port: 'cue' }),
  ],
});
