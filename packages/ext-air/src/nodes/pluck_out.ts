/**
 * The air extension's plucked-string sink, `pluck-out` (#249): the air bass's plucks and the air
 * guitar's strums, sounded on the audio clock at the time each was predicted for. The sink itself
 * is the SDK's (`@thoremin/sdk/nodes/pluck_out`, #674), shared with the harmony slice, which
 * registers its own under a type of its own.
 */
import { makePluckOutNode } from '@thoremin/sdk/nodes/pluck_out';

export { PLUCK_TIMBRES, createWebAudioPluckSink, type PluckSink, type PluckSinkFactory, type PluckSinkOptions, type PluckTimbre } from '@thoremin/sdk/nodes/pluck_out';

export const pluckOutNode = makePluckOutNode('pluck-out', {
  title: 'Pluck out',
  description: 'Sounds plucked-string note events (the air bass and guitar) on the audio clock at the time each was predicted for (WebAudio plucks from primitives, no samples).',
});
