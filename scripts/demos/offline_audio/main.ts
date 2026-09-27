/**
 * Offline audio for the demo takes: the SHIPPED WebAudio sinks (`drum-out`'s drum sink,
 * `pluck-out`'s pluck sink) played into an `OfflineAudioContext`, so a take recorded
 * headlessly (`scripts/demos/instrument_take.ts`) is heard with exactly the timbres the
 * app plays, rendered faster than real time and without a speaker.
 *
 * Loaded by the Vite dev server (it resolves `@/` and TypeScript), driven by
 * `scripts/demos/render_take_audio.mjs`, which calls `window.renderTake(take)` and saves
 * the returned 16-bit PCM. Nothing here is part of the app bundle.
 */
import { createWebAudioDrumSink } from '@/nodes/output/drum_out';
import { createWebAudioPluckSink } from '@/nodes/output/pluck_out';
import type { DrumSound } from '@/nodes/music/drum_pads';

interface Take {
  instrument: 'drums' | 'bass' | 'guitar';
  events: { t: number; sound?: DrumSound; velocity: number; radial?: number; midi?: number; voice?: number }[];
  /** Seconds of audio to render. */
  duration: number;
}

const SAMPLE_RATE = 44100;

async function renderTake(take: Take): Promise<{ sampleRate: number; pcm16: string }> {
  const ac = new OfflineAudioContext(1, Math.ceil(take.duration * SAMPLE_RATE), SAMPLE_RATE);
  const master = ac.createGain();
  master.connect(ac.destination);
  const ctx = ac as unknown as AudioContext;
  if (take.instrument === 'drums') {
    const sink = createWebAudioDrumSink(ctx, master);
    for (const e of take.events) sink.play(e.sound!, e.velocity, e.t, { radial: e.radial ?? 0 });
  } else {
    const sink = createWebAudioPluckSink(ctx, master, { timbre: take.instrument === 'bass' ? 'bass' : 'guitar', mono: take.instrument === 'bass' });
    for (const e of take.events) sink.play(e.midi!, e.velocity, e.t, e.voice);
  }
  const buf = await ac.startRendering();
  const data = buf.getChannelData(0);
  let peak = 0;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0 ? 0.9 / peak : 1;
  const bytes = new Uint8Array(data.length * 2);
  const view = new DataView(bytes.buffer);
  data.forEach((v, i) => view.setInt16(2 * i, Math.max(-1, Math.min(1, v * gain)) * 32767, true));
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { sampleRate: SAMPLE_RATE, pcm16: btoa(s) };
}

(window as unknown as { renderTake: typeof renderTake }).renderTake = renderTake;
document.title = 'ready';
