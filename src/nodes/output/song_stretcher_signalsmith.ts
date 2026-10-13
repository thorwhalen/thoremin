/**
 * The default {@link Stretcher} for the `song-player` node (#187 PR 7): Signalsmith
 * Stretch (MIT; an AudioWorklet with its DSP in WebAssembly, `signalsmith-stretch` on
 * npm), the stretcher the conducting research map chose (§6.6, §6.7, D7).
 *
 * Why it, over the media element it falls back to: it plays from the instrument's own
 * `AudioContext`, so a rate is committed on the AUDIO clock and the position it reports
 * is the audio leaving the node now (it compensates its own latency), which is what lets
 * the conductor's beat servo close a tight loop; `HTMLMediaElement.playbackRate` changes
 * the rate at an unobservable moment. It also needs no autoplay unlock (the context is
 * already running), and its time-stretch is better than the browsers' own.
 *
 * What it costs: about 115 kB of script, loaded the first time a song loads (never in the
 * entry chunk: `vite.lazy-guard.ts` names the package), and the song DECODED in memory at
 * the context's rate (about 90 MB for a four-minute stereo song at 48 kHz), where the
 * media element streams the file.
 *
 * The package is loaded VERBATIM: its file is emitted as an asset (`?url`) and imported
 * from there, never bundled. It builds its AudioWorklet by stringifying its own processor
 * and WebAssembly glue (`Function.prototype.toString`) into a Blob module, and a bundled,
 * minified copy is no longer self-contained (the minifier renames the glue's free
 * variables and hoists a class-field helper to the chunk's top, neither of which exists in
 * the worklet's scope): the processor then dies before it says it is ready, silently,
 * and the load hangs. The browser smoke (`smoke/tests/conduct_recording.smoke.ts`) is the
 * guard; it caught exactly that.
 *
 * Where its worklet cannot start (no AudioWorklet, WebAssembly refused by a policy), it
 * hands every call to the media element stretcher instead, so a song always plays.
 * Browser-only, like the element: the node imports this module dynamically on first need.
 */
import type { Stretcher, StretcherFactory, StretcherOptions } from './song_player';
import { createMediaElementStretcher } from './song_stretcher';

/** Signalsmith's entry: a node factory resolving once its worklet says it is ready. */
export type SignalsmithFactory = (audioContext: BaseAudioContext) => Promise<AudioNode>;

/** The package, imported from its verbatim asset (see the header). */
async function loadSignalsmith(): Promise<SignalsmithFactory> {
  const { default: url } = await import('signalsmith-stretch?url');
  const mod = (await import(/* @vite-ignore */ url)) as { default: SignalsmithFactory };
  return mod.default;
}

/** The slice of Signalsmith's node this adapter uses (the package ships no types). */
interface StretchNode extends AudioNode {
  schedule(change: { active?: boolean; input?: number; output?: number; rate?: number }): unknown;
  addBuffers(channels: Float32Array[]): Promise<number>;
  dropBuffers(): Promise<unknown>;
  setUpdateInterval(seconds: number, callback?: (inputTime: number) => void): Promise<unknown>;
}

/** How often the worklet reports its position, seconds. Between reports it is
 *  extrapolated at the rate. */
const UPDATE_S = 0.02;
/** A position this close to the end is the end. */
const END_EPS_S = 0.005;

export const createSignalsmithStretcher: StretcherFactory = (audio) => createSignalsmithStretcherWith(audio, loadSignalsmith);

/** {@link createSignalsmithStretcher} with the package loader injected (the tests). */
export function createSignalsmithStretcherWith(audio: StretcherOptions, load: () => Promise<SignalsmithFactory>): Stretcher {
  const { audioContext, destination } = audio;
  const gain = audioContext.createGain();
  gain.connect(destination);
  let node: StretchNode | null = null;
  let fallback: Stretcher | null = null;
  let loadId = 0;
  let duration = 0;
  let rate = 1;
  let volume = 1;
  let wanted = false;
  /** The last reported input time, and the context time it was received at. */
  let pos = 0;
  let posAt = 0;

  const now = () => audioContext.currentTime;
  const position = (): number => {
    const p = wanted ? pos + (now() - posAt) * rate : pos;
    return Math.max(0, Math.min(duration, p));
  };
  const ended = () => duration > 0 && position() >= duration - END_EPS_S;
  const report = (p: number) => {
    pos = p;
    posAt = now();
  };

  /** The worklet, once; null (and the fallback made) when it cannot start. */
  const start = async (): Promise<StretchNode | null> => {
    if (node || fallback) return node;
    try {
      const SignalsmithStretch = await load();
      const n = (await SignalsmithStretch(audioContext)) as unknown as StretchNode;
      n.connect(gain);
      await n.setUpdateInterval(UPDATE_S, report);
      node = n;
    } catch (e) {
      console.warn(`[song-player] Signalsmith Stretch could not start, playing through the media element: ${String(e)}`);
      fallback = createMediaElementStretcher(audio);
      fallback.setVolume(volume);
      fallback.setRate(rate);
    }
    return node;
  };

  return {
    async load(url) {
      const id = ++loadId;
      wanted = false;
      const n = await start();
      if (fallback) return fallback.load(url);
      if (!n) throw new Error('the song player could not start');
      n.schedule({ active: false, output: now() });
      const bytes = await (await fetch(url)).arrayBuffer();
      const buffer = await audioContext.decodeAudioData(bytes);
      // A superseded load settles as a failure its caller ignores (it checks the id).
      if (id !== loadId) throw new Error('superseded');
      await n.dropBuffers();
      const channels: Float32Array[] = [];
      for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
      await n.addBuffers(channels);
      duration = buffer.duration;
      n.schedule({ active: false, input: 0, output: now() });
      report(0);
    },
    play() {
      if (fallback) return fallback.play();
      if (!node || (wanted && !ended())) return;
      // An ended song restarts from the beginning, like a media element.
      const from = ended() ? 0 : position();
      wanted = true;
      node.schedule({ active: true, input: from, rate, output: now() });
      report(from);
    },
    pause() {
      if (fallback) return fallback.pause();
      if (!node || !wanted) return;
      const at = position();
      wanted = false;
      node.schedule({ active: false, output: now() });
      report(at);
    },
    setRate(r) {
      if (!(Number.isFinite(r) && r > 0) || r === rate) return;
      if (fallback) {
        rate = r;
        return fallback.setRate(r);
      }
      // Re-anchor the extrapolation at the old rate before the new one applies.
      if (wanted) report(position());
      rate = r;
      if (node && wanted) node.schedule({ rate, output: now() });
    },
    setVolume(v) {
      if (fallback) return fallback.setVolume(v);
      if (v === volume) return;
      volume = v;
      gain.gain.setTargetAtTime(v, now(), 0.03);
    },
    position: () => (fallback ? fallback.position() : position()),
    seek(p) {
      if (fallback) return fallback.seek?.(p);
      if (!node || !Number.isFinite(p) || p < 0) return;
      node.schedule({ input: p, output: now() });
      report(p);
    },
    playing: () => (fallback ? fallback.playing() : wanted && !ended()),
    ended: () => (fallback ? fallback.ended() : ended()),
    blocked: () => fallback?.blocked?.() ?? false,
    unlock: () => fallback?.unlock?.(),
    dispose() {
      loadId++;
      fallback?.dispose();
      if (node) {
        node.schedule({ active: false, output: now() });
        void node.dropBuffers();
        node.disconnect();
        node = null;
      }
      gain.disconnect();
    },
  };
}
