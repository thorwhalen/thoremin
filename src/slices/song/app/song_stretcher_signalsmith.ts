/**
 * The default {@link Stretcher} for the `song-player` node (#187 PR 7): Signalsmith
 * Stretch (MIT; an AudioWorklet with its DSP in WebAssembly, `signalsmith-stretch` on
 * npm), the stretcher the conducting research map chose (§6.6, §6.7, D7).
 *
 * Why it, over the media element it falls back to: it plays from the instrument's own
 * `AudioContext`, so a rate is committed on the AUDIO clock at a known moment, which is
 * what lets the conductor's beat servo close a tight loop; `HTMLMediaElement.playbackRate`
 * changes the rate at an unobservable moment. It also needs no autoplay unlock (the
 * context is already running), and its time-stretch is better than the browsers' own.
 *
 * Where the song is comes from the adapter's OWN time map, not from the worklet's reports:
 * every change is scheduled at `output = currentTime` (the node compensates its own latency
 * so that the input it names is the audio leaving it then), and between changes the
 * position is `input + (now - output) * rate`. The worklet's periodic `inputTime` reports
 * run its internal latency ahead (about 120 ms at rate 1, measured by the adversarial
 * review); reading them made the servo hold the song 120 to 130 ms late whenever the
 * engine ticked slower than the report interval.
 *
 * What it costs: about 115 kB of script, loaded the first time a song loads (never in the
 * entry chunk: `vite.lazy-guard.ts` names the package), and the song DECODED in memory at
 * the context's rate (about 90 MB for a four-minute stereo song at 48 kHz), where the media
 * element streams the file. The decoded buffer's OWN channel arrays are transferred to the
 * worklet (#365), so one decoded copy is held, not two: the Web Audio spec lets those arrays
 * be detached (the buffer then reads as empty, and nothing here reads it again; Chromium and
 * Firefox do). A browser that will not detach them may refuse the message, and then copies
 * of the still intact buffer go instead, or copy them silently (WebKit's engine may: no
 * saving there, no loss either); what arrives short of the song (a partial detach) is
 * dropped and the file decoded again for copies. Those paths hold two copies at the peak,
 * as before.
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
import type { Stretcher, StretcherFactory, StretcherOptions } from '../nodes/song_player.schema';
import { createMediaElementStretcher } from './song_stretcher';
import { rampGain } from './gain_ramp';

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
  /** The trailing array is a transfer list: the package posts those buffers instead of copying them. */
  addBuffers(channels: Float32Array[], transfer?: ArrayBufferLike[]): Promise<number>;
  dropBuffers(): Promise<unknown>;
}

/** Seconds the worklet gets to say it is ready. Where WebAssembly is refused inside the
 *  worklet (iOS Lockdown Mode, a policy) its processor dies without a word and the node's
 *  promise never settles: past this, the media element plays the song instead. */
const START_TIMEOUT_S = 8;
/** A position this close to the end is the end. */
const END_EPS_S = 0.005;

/** What the worklet holds short of the song (seconds) before the hand-over counts as lost. */
const HANDOVER_EPS_S = 0.01;

/**
 * Hand the decoded song to the worklet by transfer: the buffer's own channel arrays, or (`copy`)
 * copies of them. True when the worklet then holds the whole song (its reply is the end of what
 * it holds, in seconds, at the context's rate, which `decodeAudioData` resampled to); false
 * when the message could not be sent (a browser that will not detach the buffer's arrays) or
 * arrived short (a detach that stopped part way). A refused copy is an error.
 */
async function handOver(n: StretchNode, buffer: AudioBuffer, copy: boolean, seconds: number): Promise<boolean> {
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(copy ? buffer.getChannelData(c).slice() : buffer.getChannelData(c));
  try {
    const end = await n.addBuffers(channels, channels.map((ch) => ch.buffer));
    return typeof end === 'number' && end >= seconds - HANDOVER_EPS_S;
  } catch (e) {
    if (copy) throw e;
    return false;
  }
}

export const createSignalsmithStretcher: StretcherFactory = (audio) => createSignalsmithStretcherWith(audio, loadSignalsmith);

/** {@link createSignalsmithStretcher} with the package loader injected (the tests). */
export function createSignalsmithStretcherWith(audio: StretcherOptions, load: () => Promise<SignalsmithFactory>): Stretcher {
  const { audioContext, destination } = audio;
  const gain = audioContext.createGain();
  gain.connect(destination);
  // The hold fade's fader (#366), between the worklet and the volume.
  const fader = audioContext.createGain();
  fader.connect(gain);
  let node: StretchNode | null = null;
  let fallback: Stretcher | null = null;
  let loadId = 0;
  let duration = 0;
  let rate = 1;
  let volume = 1;
  let wanted = false;
  let disposed = false;
  /** The adapter's time map: the input at context time `posAt`, advancing at `rate` while
   *  wanted (see the header). */
  let pos = 0;
  let posAt = 0;

  const now = () => audioContext.currentTime;
  const raw = (): number => (wanted ? pos + (now() - posAt) * rate : pos);
  const anchor = (p: number) => {
    pos = p;
    posAt = now();
  };
  /** A song played to its end stops the worklet (it would keep computing silence). */
  const settle = (): void => {
    if (wanted && duration > 0 && raw() >= duration - END_EPS_S) {
      wanted = false;
      anchor(duration);
      node?.schedule({ active: false, output: now() });
    }
  };
  const position = (): number => {
    settle();
    return Math.max(0, Math.min(duration, raw()));
  };
  const ended = () => duration > 0 && position() >= duration - END_EPS_S;

  /** The worklet, made once (concurrent loads share it); null, with the fallback made, when
   *  it cannot start or does not say it is ready in time. */
  let starting: Promise<StretchNode | null> | null = null;
  const start = (): Promise<StretchNode | null> => {
    starting ??= (async () => {
      try {
        const SignalsmithStretch = await load();
        const made = SignalsmithStretch(audioContext);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`the worklet was not ready within ${START_TIMEOUT_S} s`)), START_TIMEOUT_S * 1000);
        });
        // A node that arrives after the timeout is closed, never left running.
        void made.then((late) => {
          if (late !== (node as unknown)) late.disconnect();
        }, () => {});
        const n = (await Promise.race([made, timeout]).finally(() => clearTimeout(timer))) as unknown as StretchNode;
        if (disposed) {
          n.disconnect();
          return null;
        }
        n.connect(fader);
        node = n;
      } catch (e) {
        if (disposed) return null;
        console.warn(`[song-player] Signalsmith Stretch could not start, playing through the media element: ${String(e)}`);
        fallback = createMediaElementStretcher(audio);
        fallback.setVolume(volume);
        fallback.setRate(rate);
      }
      return node;
    })();
    return starting;
  };

  return {
    async load(url) {
      const id = ++loadId;
      wanted = false;
      const n = await start();
      if (fallback) return fallback.load(url);
      if (!n) throw new Error('the song player could not start');
      n.schedule({ active: false, output: now() });
      const decode = async (): Promise<AudioBuffer> => {
        const buffer = await audioContext.decodeAudioData(await (await fetch(url)).arrayBuffer());
        // A superseded load settles as a failure its caller ignores (it checks the id).
        if (id !== loadId) throw new Error('superseded');
        return buffer;
      };
      /** A superseded or disposed load must not touch the worklet again. */
      const current = () => {
        if (id !== loadId) throw new Error('superseded');
      };
      const decoded = await decode();
      const seconds = decoded.duration;
      await n.dropBuffers();
      current();
      // The buffer's own arrays, TRANSFERRED (#365): one decoded copy held, not two.
      if (!(await handOver(n, decoded, false, seconds))) {
        await n.dropBuffers();
        current();
        // Refused before anything was detached: copies of the same buffer. Else decode again.
        const intact = Array.from({ length: decoded.numberOfChannels }, (_, c) => decoded.getChannelData(c).length).every((len) => len === decoded.length);
        if (!(await handOver(n, intact ? decoded : await decode(), true, seconds))) throw new Error('the worklet did not take the song');
      }
      current();
      duration = seconds;
      n.schedule({ active: false, input: 0, output: now() });
      anchor(0);
    },
    play() {
      if (fallback) return fallback.play();
      if (!node || (wanted && !ended())) return;
      // An ended song restarts from the beginning, like a media element.
      const from = ended() ? 0 : position();
      wanted = true;
      node.schedule({ active: true, input: from, rate, output: now() });
      anchor(from);
    },
    pause() {
      if (fallback) return fallback.pause();
      if (!node || !wanted) return;
      const at = position();
      wanted = false;
      node.schedule({ active: false, output: now() });
      anchor(at);
    },
    setRate(r) {
      if (!(Number.isFinite(r) && r > 0) || r === rate) return;
      if (fallback) {
        rate = r;
        return fallback.setRate(r);
      }
      // Re-anchor the extrapolation at the old rate before the new one applies.
      if (wanted) anchor(position());
      rate = r;
      if (node && wanted) node.schedule({ rate, output: now() });
    },
    fade(level, seconds) {
      if (fallback) return fallback.fade?.(level, seconds);
      rampGain(fader.gain, level, seconds, now());
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
      anchor(p);
    },
    playing: () => (fallback ? fallback.playing() : wanted && !ended()),
    ended: () => (fallback ? fallback.ended() : ended()),
    blocked: () => fallback?.blocked?.() ?? false,
    unlock: () => fallback?.unlock?.(),
    dispose() {
      disposed = true;
      loadId++;
      fallback?.dispose();
      if (node) {
        node.schedule({ active: false, output: now() });
        void node.dropBuffers();
        node.disconnect();
        node = null;
      }
      fader.disconnect();
      gain.disconnect();
    },
  };
}
