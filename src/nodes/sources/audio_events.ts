/**
 * `audio-events` (source; browser, or headless with a fake hub): the audio thread's events,
 * drained once per tick (`docs/design/audio-input.md`, "the slow path"). Its lease on the
 * audio-input hub (`resources.audioInput`) runs the analysers named in its params; the
 * microphone opens when the first such node (or other consumer) is composed and closes with the
 * last. Outputs every event of the tick with its engine time, the latest input level, and the
 * hub's state (so an overlay can say "waiting for sound" or "microphone refused").
 *
 * With no hub (a headless run, a test without one) it emits nothing and says `unavailable`.
 */
import { defineNode } from '@thoremin/dag';
import type { NodeContext } from '@thoremin/dag';
import { AUDIO_EVENTS_NODE, AudioEventsParamsSchema, stampToEngineTime, type AudioEventsParams, type AudioInputLike, type TimedAudioEvent } from './audio_events.schema';
export * from './audio_events.schema';

export const audioEventsNode = defineNode<AudioEventsParams>({
  type: AUDIO_EVENTS_NODE,
  roles: ['source'],
  title: 'Audio events',
  description: 'Microphone (or replayed / synthetic sound) analysed on the audio thread: onsets, recognised sounds, level, pitch, stamped in engine time.',
  inputs: [],
  outputs: [
    { name: 'events', kind: 'audio-events' },
    { name: 'level', kind: 'number' },
    { name: 'status', kind: 'string' },
  ],
  params: AudioEventsParamsSchema,
  make(p) {
    let hub: AudioInputLike | undefined;
    let lease: ReturnType<AudioInputLike['acquire']> | undefined;
    let level = 0;
    return {
      init(ctx: NodeContext) {
        hub = ctx.resources.audioInput as AudioInputLike | undefined;
        lease = hub?.acquire({
          analysers: p.analysers,
          source: p.source,
          constraints: { echoCancellation: p.echoCancellation, noiseSuppression: p.noiseSuppression, autoGainControl: p.autoGainControl },
        });
      },
      process(_inputs, ctx: NodeContext) {
        if (!hub || !lease) return { events: [], level: 0, status: 'unavailable' };
        const drained = lease.drain();
        const { state, sampleRate } = hub.status();
        const contextNow = hub.contextTime();
        const events: TimedAudioEvent[] = [];
        if (drained.length > 0 && sampleRate && contextNow !== null) {
          const at = { sampleRate, contextNow, engineNow: ctx.time, inputStage: hub.inputStage().seconds };
          for (const { source, event } of drained) {
            if (event.kind === 'level') level = event.rms;
            // A snippet's audio is for teaching, through the hub; the graph gets its time only.
            const e = event.kind === 'snippet' ? { ...event, pcm: new Float32Array(0) } : event;
            events.push({ ...e, source, t: stampToEngineTime(event.frame, at) });
          }
        }
        return { events, level, status: state };
      },
      dispose() {
        lease?.release();
        lease = undefined;
        hub = undefined;
      },
    };
  },
});
