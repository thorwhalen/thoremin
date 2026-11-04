/** The `audio-events` source node over a fake hub: drained per tick, stamped in engine time, released on dispose. */
import { describe, expect, it } from 'vitest';
import { readsResource, runHeadless } from '@thoremin/dag';
import { audioEventsNode, stampToEngineTime, AUDIO_EVENTS_NODE, AUDIO_INPUT_RESOURCE_KEY, type AudioInputLike } from '@/nodes/sources/audio_events';
import { createCoreRegistry } from '@/nodes/index';
import { AUDIO_INPUT_RESOURCE_KEY as APP_KEY } from '@/app/audio';
import type { AudioEvent } from '@thoremin/sdk/audio/types';
import { defaultGraphResources } from '@/app/graph';

function fakeHub() {
  const queue: { source: string; event: AudioEvent }[] = [];
  const state = { released: 0, acquired: [] as unknown[] };
  const hub: AudioInputLike = {
    acquire(req) {
      state.acquired.push(req);
      return { drain: () => queue.splice(0), release: () => void state.released++ };
    },
    status: () => ({ state: 'live', sampleRate: 48000 }),
    inputStage: () => ({ seconds: 0.01, source: 'prior' }),
    contextTime: () => 10,
  };
  return { hub, queue, state };
}

describe('audio-events node', () => {
  it('converts a stamp to the engine time the sound reached the microphone', () => {
    // Stamped 0.1 s ago on the context clock, 10 ms of input stage: 0.11 s before the tick.
    expect(stampToEngineTime(9.9 * 48000, { sampleRate: 48000, contextNow: 10, engineNow: 100, inputStage: 0.01 })).toBeCloseTo(99.89, 9);
  });

  it('drains its lease each tick, tags and times every event, keeps the level, and releases on dispose', () => {
    const { hub, queue, state } = fakeHub();
    const h = audioEventsNode.make(audioEventsNode.params.parse({ analysers: [{ name: 'onset' }] }));
    const ctx = { tick: 1, time: 100, dt: 1 / 30, resources: { audioInput: hub } };
    h.init?.(ctx);
    expect(state.acquired).toEqual([expect.objectContaining({ source: 'microphone', constraints: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })]);
    queue.push({ source: 'onset', event: { kind: 'onset', frame: 9.9 * 48000, detectedFrame: 9.9 * 48000 + 32, strength: 30 } });
    queue.push({ source: 'onset', event: { kind: 'level', frame: 9.95 * 48000, rms: 0.2, peak: 0.5 } });
    const out = h.process({}, ctx) as { events: { kind: string; source: string; t: number }[]; level: number; status: string };
    expect(out.events.map((e) => [e.kind, e.source])).toEqual([['onset', 'onset'], ['level', 'onset']]);
    expect(out.events[0].t).toBeCloseTo(99.89, 9);
    expect(out.level).toBe(0.2);
    expect(out.status).toBe('live');
    const next = h.process({}, { ...ctx, tick: 2 }) as { events: unknown[]; level: number };
    expect(next.events).toEqual([]);
    expect(next.level).toBe(0.2);
    h.dispose?.();
    expect(state.released).toBe(1);
  });

  it('emits nothing and says unavailable with no hub (headless)', () => {
    const h = audioEventsNode.make(audioEventsNode.params.parse({}));
    const ctx = { tick: 1, time: 0, dt: 0, resources: {} };
    h.init?.(ctx);
    expect(h.process({}, ctx)).toEqual({ events: [], level: 0, status: 'unavailable' });
  });

  it('declares the hub it reads, so a headless run without one fails at init (#974)', async () => {
    const registry = createCoreRegistry();
    expect(APP_KEY).toBe(AUDIO_INPUT_RESOURCE_KEY);
    expect(readsResource(registry, AUDIO_EVENTS_NODE, AUDIO_INPUT_RESOURCE_KEY)).toBe(true);
    const spec = { nodes: [{ id: 'mic', type: AUDIO_EVENTS_NODE }], edges: [] };
    await expect(runHeadless(spec, registry, { ticks: 1 })).rejects.toThrow(/node "mic" \(audio-events\) reads "audioInput"/);
    const { hub, state } = fakeHub();
    const { engine } = await runHeadless(spec, registry, { ticks: 2, resources: { [AUDIO_INPUT_RESOURCE_KEY]: hub } });
    expect(state.acquired).toHaveLength(1);
    expect(engine.getOutput('mic', 'status')).toBe('live');
  });

  it("a headless run of the default graph's resources provides a silent hub, so a listening build's graph inits (#974 review)", async () => {
    // The lab build composes the games' `audio-events` node into `defaultGraph`; its headless runs
    // spread `defaultGraphResources()`, which must satisfy the declared read with a hub that hears nothing.
    const registry = createCoreRegistry();
    const spec = { nodes: [{ id: 'mic', type: AUDIO_EVENTS_NODE }], edges: [] };
    const { engine } = await runHeadless(spec, registry, { ticks: 2, resources: defaultGraphResources() });
    expect(engine.getOutput('mic', 'events')).toEqual([]);
    expect(engine.getOutput('mic', 'status')).toBe('silent');
  });
});
