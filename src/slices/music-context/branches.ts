/**
 * The music-context branch: the node, fed by its dial and the timeline in force, keeping time with
 * the song player or the conductor (optional edges: each is in the graph only when its slice is in
 * the build and composed), handing the scale back to `store-controls` on a delayed edge (the
 * bridge is upstream of every clock).
 */
import { defineBranch } from '@thoremin/sdk/instruments/branch';
import { SONG_PLAYER, TRUNK } from '@thoremin/sdk/instruments/trunk';
import { MUSIC_CONTEXT_BRANCH, MUSIC_CONTEXT_NODE_ID } from '@thoremin/sdk/context/reading';
import { SCALE_OVERRIDE_PORT } from '@thoremin/sdk/context/scale';
import { MUSIC_CONTEXT_ACTIVE, MUSIC_CONTEXT_DIAL } from './schema';

const ui = (port: string) => ({ node: TRUNK.ui, port });
const node = (port: string) => ({ node: MUSIC_CONTEXT_NODE_ID, port });

export const musicContextBranch = defineBranch({
  id: MUSIC_CONTEXT_BRANCH,
  description: "The music's timeline read at the playing position: the key and chord in force, and the instrument's scale while it follows the music.",
  nodes: [{ id: MUSIC_CONTEXT_NODE_ID, type: 'music-context', params: {} }],
  edges: [
    { from: ui(MUSIC_CONTEXT_DIAL), to: node('config') },
    { from: ui(MUSIC_CONTEXT_ACTIVE), to: node('context') },
    { from: { node: SONG_PLAYER, port: 'songTime' }, to: node('time'), optional: true },
    { from: { node: 'conductor', port: 'time' }, to: node('conductorTime'), optional: true },
    { from: node('scale'), to: ui(SCALE_OVERRIDE_PORT.name), delayed: true },
  ],
});
