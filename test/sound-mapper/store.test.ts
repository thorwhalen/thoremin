/**
 * The sound mapper end to end, in node: the tool's store, the real audio-input hub and the real
 * worklet processor core, with only the browser faked (the context, the worklet node's port, the
 * microphone). Synthetic taps (known surfaces) are pumped through quantum by quantum: the player
 * teaches two surfaces, plays, and hears each surface's drum.
 */
import { describe, expect, it } from 'vitest';
import { createInMemoryProvider } from '@zodal/store';
import { createAudioInputHub, type ContextLike, type HubDeps } from '@thoremin/sdk-ui/audio/hub';
import { createProcessorCore, type ProcessorCore } from '@thoremin/sdk/audio/processor';
import { SURFACES, synthTake } from '@thoremin/sdk/audio/synthetic_taps';
import { createSoundMapperStore, type SoundMapperState } from '@/slices/sound-mapper/app/store';
import type { SoundMapRecord } from '@/slices/sound-mapper/schema';
import { decodePcm16, encodePcm16 } from '@/slices/sound-mapper/lib/pcm';
import { SOUND_MAPPER } from '../helpers/extensions';

const SR = 48000;
const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

function rig() {
  const ctx: ContextLike = { sampleRate: SR, currentTime: 0, state: 'running' };
  let core: ProcessorCore | null = null;
  let frame = 0;
  const deps: HubDeps = {
    audio: () => ctx,
    destination: () => null,
    async makeNode() {
      const port = { onmessage: null as ((e: { data: unknown }) => void) | null, postMessage: (m: unknown) => core!.message(m as never) };
      core = createProcessorCore({ sampleRate: SR, post: (m) => port.onmessage?.({ data: m }) });
      return { port, connect: () => undefined, disconnect: () => undefined };
    },
    async open() {
      return { source: { connect: () => undefined, disconnect: () => undefined }, close: () => undefined };
    },
  };
  const hub = createAudioInputHub(deps);
  /** Play `pcm` into the worklet; returns what it played. */
  const pump = (pcm: Float32Array): Float32Array => {
    const out = new Float32Array(Math.ceil(pcm.length / 128) * 128);
    const block = new Float32Array(128);
    for (let b = 0; b * 128 < pcm.length; b++) {
      core!.process(pcm.slice(b * 128, (b + 1) * 128), block, frame);
      out.set(block, b * 128);
      frame += 128;
    }
    return out;
  };
  const provider = createInMemoryProvider<SoundMapRecord>([], { idField: 'id' });
  const timers: (() => void)[] = [];
  const store = createSoundMapperStore({ hub: () => hub, provider, setTimer: (fn) => timers.push(fn), clearTimer: () => undefined });
  return { hub, pump, store, provider, saveNow: () => timers.splice(0).forEach((f) => f()) };
}

const taps = (surface: string, seed: number, n: number) => synthTake({ sampleRate: SR, seed, perSurface: n, surfaces: SURFACES.filter((s) => s.id === surface), gapMin: 0.35, gapMax: 0.5, lead: 0.3 });

describe.runIf(SOUND_MAPPER)('sound mapper: teach, play, hear', () => {
  it('round-trips a taught tap through its stored text', () => {
    const pcm = Float32Array.from({ length: 300 }, (_, i) => Math.sin(i / 7) * 0.8);
    const back = decodePcm16(encodePcm16(pcm));
    expect(back.length).toBe(300);
    for (let i = 0; i < 300; i++) expect(Math.abs(back[i] - pcm[i])).toBeLessThan(1 / 30000);
  });

  it('teaches each sound from the taps it hears, silently, then plays each surface its own drum', async () => {
    const { pump, store, saveNow, provider } = rig();
    const s = (): SoundMapperState => store.getState();
    const table = s().addClass('Table', 'kick')!;
    const pot = s().addClass('Pot', 'cowbell')!;

    s().teach(table);
    await flush();
    expect(s().status?.state).toBe('live');
    const quiet = pump(taps('table-middle', 1, 8).pcm);
    s().teach(pot);
    await flush();
    pump(taps('pot', 2, 8).pcm);
    s().teach(null);
    // A pot tap landing in the last one's ring can go unheard (docs/research/audio-trigger-latency.md).
    for (const c of s().map.classes) expect(c.examples.length).toBeGreaterThanOrEqual(6);
    // Teaching sounds nothing.
    expect(peak(quiet)).toBe(0);

    s().play(true);
    await flush();
    const mixed = synthTake({ sampleRate: SR, seed: 9, perSurface: 6, surfaces: SURFACES.filter((x) => x.id === 'table-middle' || x.id === 'pot'), gapMin: 0.35, gapMax: 0.5, lead: 0.3 });
    const out = pump(mixed.pcm);
    const hits = [...s().hits].reverse();
    expect(hits.length).toBe(Math.min(12, mixed.taps.length));
    const expected = mixed.taps.slice(-hits.length).map((t) => (t.surface === 'pot' ? pot : table));
    const right = hits.filter((h, i) => h.classId === expected[i]).length;
    expect(right / hits.length).toBeGreaterThanOrEqual(0.9);
    // The drums are in the output, a few ms after each tap.
    expect(peak(out)).toBeGreaterThan(0.3);
    for (const h of hits) expect(h.latencyMs).toBeLessThan(5);

    // The map persists.
    saveNow();
    await flush();
    const { data } = await provider.getList({});
    expect(data[0].map.classes.map((c) => [c.label, c.sound, c.examples.length])).toEqual(s().map.classes.map((c) => [c.label, c.sound, c.examples.length]));
    expect(data[0].map.classes.map((c) => c.label)).toEqual(['Table', 'Pot']);

    s().play(false);
    await flush();
    expect(s().status?.state).toBe('idle');
  });

  it('a stored map comes back on hydrate; a change of window re-makes the analyser', async () => {
    const a = rig();
    const id = a.store.getState().addClass('Mug', 'hat')!;
    a.store.getState().teach(id);
    await flush();
    a.pump(taps('mug', 3, 4).pcm);
    a.store.getState().teach(null);
    a.saveNow();
    await flush();
    const b = createSoundMapperStore({ hub: () => null, provider: a.provider });
    await b.getState().hydrate();
    expect(b.getState().map.classes[0]).toMatchObject({ label: 'Mug', sound: 'hat' });
    expect(b.getState().map.classes[0].examples).toHaveLength(4);
    // No hub in this page: playing says so instead of failing silently.
    b.getState().play(true);
    expect(b.getState().error).toMatch(/no microphone/);
  });
});
