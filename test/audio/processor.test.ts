/** The worklet processor's logic (`@thoremin/sdk/audio/processor`): analysers added and removed live, events batched per quantum, raw PCM with back-pressure. */
import { describe, expect, it } from 'vitest';
import { createProcessorCore, type ProcessorOutMessage } from '@thoremin/sdk/audio/processor';
import { synthTake } from '@thoremin/sdk/audio/synthetic_taps';

const SR = 48000;

function run(pcm: Float32Array, setup: (core: ReturnType<typeof createProcessorCore>) => void) {
  const posted: { m: ProcessorOutMessage; transfer?: Transferable[] }[] = [];
  const core = createProcessorCore({ sampleRate: SR, post: (m, transfer) => posted.push({ m, transfer }) });
  setup(core);
  const out = new Float32Array(128);
  for (let b = 0; b * 128 < pcm.length; b++) core.process(pcm.slice(b * 128, (b + 1) * 128), out, b * 128);
  return posted;
}

describe('processor core', () => {
  const take = synthTake({ sampleRate: SR, seed: 4, perSurface: 2, gapMin: 0.4, gapMax: 0.5 });

  it('posts one message per quantum that had events, each tagged with its analyser id', () => {
    const posted = run(take.pcm, (c) => c.message({ type: 'add', id: 'a/onset', spec: { name: 'onset', params: { levelEveryMs: 0 } } }));
    const batches = posted.filter((p) => p.m.type === 'events');
    const onsets = batches.flatMap((p) => (p.m.type === 'events' ? p.m.events : []));
    expect(onsets).toHaveLength(take.taps.length);
    expect(onsets.every((e) => e.source === 'a/onset' && e.event.kind === 'onset')).toBe(true);
    expect(batches.length).toBeLessThanOrEqual(take.taps.length);
  });

  it('transfers a snippet buffer rather than copying it', () => {
    const posted = run(take.pcm, (c) => {
      c.message({ type: 'add', id: 'm', spec: { name: 'sound-mapper', params: { levelEveryMs: 0 } } });
      c.message({ type: 'to', id: 'm', message: { type: 'capture', on: true } });
    });
    const withSnippet = posted.filter((p) => p.m.type === 'events' && p.m.events.some((e) => e.event.kind === 'snippet'));
    expect(withSnippet).toHaveLength(take.taps.length);
    expect(withSnippet.every((p) => (p.transfer?.length ?? 0) === 1)).toBe(true);
  });

  it('removes an analyser, replaces one by id, and reports an unknown name instead of throwing', () => {
    const posted: ProcessorOutMessage[] = [];
    const core = createProcessorCore({ sampleRate: SR, post: (m) => posted.push(m) });
    core.message({ type: 'add', id: 'x', spec: { name: 'onset' } });
    core.message({ type: 'add', id: 'x', spec: { name: 'onset' } });
    core.message({ type: 'add', id: 'y', spec: { name: 'nope' } });
    expect(core.ids()).toEqual(['x']);
    expect(posted).toEqual([expect.objectContaining({ type: 'error', id: 'y' })]);
    core.message({ type: 'remove', id: 'x' });
    expect(core.ids()).toEqual([]);
  });

  it('keeps running when one analyser throws, and reports it', () => {
    const posted: ProcessorOutMessage[] = [];
    const core = createProcessorCore({
      sampleRate: SR,
      post: (m) => posted.push(m),
      table: { bad: () => ({ process: () => { throw new Error('boom'); } }), ok: () => ({ process: (_i, o) => { o[0] += 1; return []; } }) },
    });
    core.message({ type: 'add', id: 'b', spec: { name: 'bad' } });
    core.message({ type: 'add', id: 'o', spec: { name: 'ok' } });
    const out = new Float32Array(128);
    core.process(undefined, out, 0);
    expect(out[0]).toBe(1);
    expect(posted[0]).toEqual({ type: 'error', id: 'b', message: 'boom' });
  });

  it('taps raw PCM in chunks, dropping (and counting) when the host stops acknowledging', () => {
    const posted: ProcessorOutMessage[] = [];
    const core = createProcessorCore({ sampleRate: SR, post: (m) => posted.push(m), maxPcmInFlight: 2 });
    core.message({ type: 'pcm', on: true, chunk: 256 });
    const out = new Float32Array(128);
    for (let b = 0; b < 8; b++) core.process(new Float32Array(128).fill(b), out, b * 128);
    let chunks = posted.filter((m) => m.type === 'pcm');
    expect(chunks).toHaveLength(2); // two in flight, the rest dropped
    core.message({ type: 'ack', upTo: 1 });
    for (let b = 8; b < 10; b++) core.process(new Float32Array(128).fill(b), out, b * 128);
    chunks = posted.filter((m) => m.type === 'pcm');
    expect(chunks).toHaveLength(3);
    const last = chunks[2];
    expect(last.type === 'pcm' && last.frame).toBe(8 * 128);
    expect(last.type === 'pcm' && last.dropped).toBe(512);
    expect(last.type === 'pcm' && Array.from(last.pcm.slice(0, 1))).toEqual([8]);
  });
});
