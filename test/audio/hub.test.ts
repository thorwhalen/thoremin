/** The audio-input hub with the browser faked: one input for many consumers, opened on demand, closed with the last lease. */
import { describe, expect, it } from 'vitest';
import { createAudioInputHub, type ContextLike, type HubDeps, type MicConstraints, type WorkletNodeLike } from '@thoremin/sdk-ui/audio/hub';
import type { ProcessorInMessage, ProcessorOutMessage } from '@thoremin/sdk/audio/processor';

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

function fakes(opts: { deny?: boolean } = {}) {
  let ctx: ContextLike | undefined;
  const posted: ProcessorInMessage[] = [];
  const opens: { kind: string; constraints: Required<MicConstraints> }[] = [];
  let closes = 0;
  let node: WorkletNodeLike | null = null;
  const deps: HubDeps = {
    audio: () => ctx,
    destination: () => 'master',
    async makeNode() {
      node = { port: { postMessage: (m) => posted.push(m as ProcessorInMessage), onmessage: null }, connect: () => undefined, disconnect: () => undefined };
      return node;
    },
    async open(_c, kind, { constraints }) {
      if (opts.deny) throw Object.assign(new Error('Permission denied'), { denied: true });
      opens.push({ kind, constraints });
      return { source: { connect: () => undefined, disconnect: () => undefined }, reportedLatency: 0.012, close: () => void closes++ };
    },
  };
  return {
    deps,
    posted,
    opens,
    closes: () => closes,
    setContext: (c: ContextLike) => (ctx = c),
    emit: (m: ProcessorOutMessage) => node?.port.onmessage?.({ data: m }),
  };
}

const CTX: ContextLike = { sampleRate: 48000, currentTime: 2, state: 'running' };

describe('audio-input hub', () => {
  it('waits for the audio context, then opens once and adds each lease analyser under its own namespace', async () => {
    const f = fakes();
    const hub = createAudioInputHub(f.deps);
    hub.acquire({ analysers: [{ name: 'onset' }] });
    await flush();
    expect(hub.status().state).toBe('waiting-audio');
    f.setContext(CTX);
    hub.poke();
    await flush();
    expect(hub.status()).toMatchObject({ state: 'live', source: 'microphone', sampleRate: 48000 });
    expect(hub.status().inputStage).toEqual({ seconds: 0.012, source: 'reported' });
    hub.acquire({ analysers: [{ name: 'onset' }] });
    await flush();
    expect(f.opens).toHaveLength(1);
    const adds = f.posted.filter((m) => m.type === 'add').map((m) => (m.type === 'add' ? m.id : ''));
    expect(new Set(adds)).toEqual(new Set(['l0/onset', 'l1/onset']));
  });

  it('gives each lease only its own events, by the id it named', async () => {
    const f = fakes();
    f.setContext(CTX);
    const hub = createAudioInputHub(f.deps);
    const a = hub.acquire({ analysers: [{ name: 'onset' }] });
    const b = hub.acquire({ analysers: [{ name: 'sound-mapper', id: 'mapper' }] });
    await flush();
    const heard: string[] = [];
    b.listen((e) => heard.push(e.source));
    f.emit({
      type: 'events',
      frame: 0,
      events: [
        { source: 'l0/onset', event: { kind: 'onset', frame: 10, detectedFrame: 32, strength: 20 } },
        { source: 'l1/mapper', event: { kind: 'onset', frame: 11, detectedFrame: 32, strength: 20 } },
      ],
    });
    expect(a.drain().map((e) => [e.source, e.event.frame])).toEqual([['onset', 10]]);
    expect(b.drain().map((e) => [e.source, e.event.frame])).toEqual([['mapper', 11]]);
    expect(a.drain()).toEqual([]);
    expect(heard).toEqual(['mapper']);
  });

  it('closes the input and goes idle when the last lease is released', async () => {
    const f = fakes();
    f.setContext(CTX);
    const hub = createAudioInputHub(f.deps);
    const a = hub.acquire({ analysers: [{ name: 'onset' }] });
    const b = hub.acquire({ analysers: [{ name: 'onset' }] });
    await flush();
    a.release();
    await flush();
    expect(hub.status().state).toBe('live');
    b.release();
    b.release();
    await flush();
    expect(hub.status().state).toBe('idle');
    expect(f.closes()).toBe(1);
    expect(f.posted.filter((m) => m.type === 'remove')).toHaveLength(2);
  });

  it('turns processing on only when every lease asks for it, reopening when that changes', async () => {
    const f = fakes();
    f.setContext(CTX);
    const hub = createAudioInputHub(f.deps);
    hub.acquire({ analysers: [{ name: 'onset' }], constraints: { echoCancellation: true } });
    const plain = hub.acquire({ analysers: [{ name: 'onset' }] });
    await flush();
    expect(f.opens.at(-1)?.constraints.echoCancellation).toBe(false);
    plain.release();
    await flush();
    expect(f.opens.at(-1)?.constraints.echoCancellation).toBe(true);
    expect(hub.status().constraints?.echoCancellation).toBe(true);
  });

  it('says so when the microphone is refused', async () => {
    const f = fakes({ deny: true });
    f.setContext(CTX);
    const hub = createAudioInputHub(f.deps);
    const seen: string[] = [];
    hub.subscribe((s) => seen.push(s.state));
    hub.acquire({ analysers: [{ name: 'onset' }] });
    await flush();
    expect(hub.status().state).toBe('denied');
    expect(seen).toContain('opening');
  });

  it('honours a forced source and the stored input stage over the reported one', async () => {
    const f = fakes();
    f.setContext(CTX);
    const hub = createAudioInputHub({ ...f.deps, forcedSource: () => 'synthetic', storedInputStage: () => ({ seconds: 0.02, source: 'loopback' }) });
    hub.acquire({ analysers: [{ name: 'onset' }], source: 'microphone' });
    await flush();
    expect(f.opens[0].kind).toBe('synthetic');
    expect(hub.inputStage()).toEqual({ seconds: 0.02, source: 'loopback' });
  });

  it('acknowledges raw PCM chunks and hands them to the tap', async () => {
    const f = fakes();
    f.setContext(CTX);
    const hub = createAudioInputHub(f.deps);
    hub.acquire({ analysers: [{ name: 'onset' }] });
    const chunks: number[] = [];
    const stop = hub.tapPcm((c) => chunks.push(c.frame));
    await flush();
    expect(f.posted).toContainEqual({ type: 'pcm', on: true });
    f.emit({ type: 'pcm', frame: 256, pcm: new Float32Array(4), dropped: 0, seq: 3 });
    expect(chunks).toEqual([256]);
    expect(f.posted).toContainEqual({ type: 'ack', upTo: 3 });
    stop();
    expect(f.posted.at(-1)).toEqual({ type: 'pcm', on: false });
  });
});
