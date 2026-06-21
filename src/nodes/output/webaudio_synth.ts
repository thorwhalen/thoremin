/**
 * `webaudio-synth` node (browser-only) — renders {@link SynthParams} to sound
 * via the Web Audio API, using the instrument preset registry
 * ({@link getInstrument}). Each voice is built from its preset's additive
 * oscillator partials, run through an optional tone filter and pitch vibrato,
 * with a smoothed amplitude envelope so per-frame parameter updates never click.
 * All voices share a reverb and feed an output compressor bus, which gives the
 * whole instrument a sense of space and protects headroom when voices stack.
 *
 * The AudioContext and master GainNode are injected through `ctx.resources`
 * (the host owns them, because audio can only start after a user gesture). If
 * they are absent the node is a no-op — so it is safe to construct anywhere;
 * it simply stays silent until the host wires audio in. It is never imported by
 * the Node test registry.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';
import { getInstrument } from '@/music/instruments';
import type { SynthParams, VoiceParams } from '../domain';

const Params = z.object({
  /** Frequency smoothing time constant (seconds). */
  freqGlide: z.number().default(0.03),
  /** Fallback amplitude smoothing time constant when a preset omits attack/release (seconds). */
  gainGlide: z.number().default(0.08),
});
type Params = z.infer<typeof Params>;

/** One oscillator within a voice, plus its frequency ratio to the fundamental. */
interface PartialOsc {
  osc: OscillatorNode;
  ratio: number;
}

interface Voice {
  /** The instrument id this voice was built for (rebuilt if it changes). */
  instrument: string;
  partials: PartialOsc[];
  vibrato: { lfo: OscillatorNode } | null;
  /** Live low-pass whose cutoff tracks the voice's `brightness` (expression). */
  brightnessFilter: BiquadFilterNode;
  /** The amplitude-envelope gain driven by the voice's `gain`. */
  voiceGain: GainNode;
  /** Every node to disconnect on teardown. */
  nodes: AudioNode[];
  attack: number;
  release: number;
}

/** Map a brightness (0..1) to a low-pass cutoff (Hz), exponentially. NaN-safe. */
function brightnessToCutoff(brightness: number): number {
  const b = Number.isFinite(brightness) ? Math.max(0, Math.min(1, brightness)) : 1;
  return 500 * Math.pow(28, b); // 500 Hz (dark) .. 14 kHz (open)
}

/** Shared per-synth audio infrastructure, built lazily once audio exists. */
interface Bus {
  ac: AudioContext;
  /** Where voices send their dry signal (a compressor → master). */
  out: AudioNode;
  /** Where voices send their wet (reverb) signal. */
  reverbIn: GainNode;
  nodes: AudioNode[];
}

function getAudio(ctx: NodeContext): { ac: AudioContext; master: GainNode } | null {
  const ac = ctx.resources.audioContext as AudioContext | undefined;
  const master = ctx.resources.masterGain as GainNode | undefined;
  if (!ac || !master) return null;
  return { ac, master };
}

/** Build a decaying-noise impulse response for a simple, pleasant reverb. */
function makeImpulse(ac: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ac.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ac.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

function ensureBus(ac: AudioContext, master: GainNode, current: Bus | null): Bus {
  if (current && current.ac === ac) return current;
  const now = ac.currentTime;
  // Output compressor acts as a gentle limiter so stacked voices + reverb
  // don't clip; it is the single connection point into the host master.
  const comp = ac.createDynamicsCompressor();
  comp.threshold.setValueAtTime(-14, now);
  comp.knee.setValueAtTime(24, now);
  comp.ratio.setValueAtTime(3, now);
  comp.attack.setValueAtTime(0.005, now);
  comp.release.setValueAtTime(0.2, now);
  // Makeup gain recovers the level the compressor sheds, so the instrument is
  // present at a sensible default volume. The host master fader sits after it.
  const makeup = ac.createGain();
  makeup.gain.setValueAtTime(1.6, now);
  comp.connect(makeup);
  makeup.connect(master);
  // Shared reverb: reverbIn → convolver → reverbOut → compressor.
  const reverbIn = ac.createGain();
  const convolver = ac.createConvolver();
  convolver.buffer = makeImpulse(ac, 1.8, 2.2);
  const reverbOut = ac.createGain();
  reverbOut.gain.setValueAtTime(0.9, now);
  reverbIn.connect(convolver);
  convolver.connect(reverbOut);
  reverbOut.connect(comp);
  return { ac, out: comp, reverbIn, nodes: [comp, makeup, reverbIn, convolver, reverbOut] };
}

function buildVoice(ac: AudioContext, bus: Bus, v: VoiceParams, p: Params): Voice {
  const preset = getInstrument(v.instrument);
  const now = ac.currentTime;
  const nodes: AudioNode[] = [];

  const voiceGain = ac.createGain();
  voiceGain.gain.setValueAtTime(0, now);
  nodes.push(voiceGain);

  // Live brightness low-pass (expression) sits just before the envelope gain,
  // so every preset responds to gesture even if it has no filter of its own.
  const brightnessFilter = ac.createBiquadFilter();
  brightnessFilter.type = 'lowpass';
  brightnessFilter.frequency.setValueAtTime(brightnessToCutoff(v.brightness ?? 1), now);
  brightnessFilter.Q.setValueAtTime(0.7, now);
  brightnessFilter.connect(voiceGain);
  nodes.push(brightnessFilter);

  // Partials sum into the preset filter (if any), then the brightness filter.
  let sumTarget: AudioNode = brightnessFilter;
  if (preset.filter) {
    const filter = ac.createBiquadFilter();
    filter.type = preset.filter.type;
    filter.frequency.setValueAtTime(preset.filter.cutoff, now);
    filter.Q.setValueAtTime(preset.filter.q ?? 0.7, now);
    filter.connect(brightnessFilter);
    nodes.push(filter);
    sumTarget = filter;
  }

  const partials: PartialOsc[] = preset.partials.map((part) => {
    const osc = ac.createOscillator();
    osc.type = part.type;
    if (part.detuneCents) osc.detune.setValueAtTime(part.detuneCents, now);
    const g = ac.createGain();
    g.gain.setValueAtTime(part.gain ?? 1, now);
    osc.connect(g);
    g.connect(sumTarget);
    osc.start();
    nodes.push(osc, g);
    return { osc, ratio: part.ratio ?? 1 };
  });

  // Vibrato: an LFO modulating every partial's detune (cents).
  let vibrato: Voice['vibrato'] = null;
  if (preset.vibrato) {
    const lfo = ac.createOscillator();
    lfo.frequency.setValueAtTime(preset.vibrato.rateHz, now);
    const depth = ac.createGain();
    depth.gain.setValueAtTime(preset.vibrato.depthCents, now);
    lfo.connect(depth);
    partials.forEach((pp) => depth.connect(pp.osc.detune));
    lfo.start();
    nodes.push(lfo, depth);
    vibrato = { lfo };
  }

  // Output: voiceGain → trim → (dry) compressor; trim → send → reverb.
  const trim = ac.createGain();
  trim.gain.setValueAtTime(preset.gain ?? 1, now);
  voiceGain.connect(trim);
  trim.connect(bus.out);
  nodes.push(trim);
  if (preset.reverbSend && preset.reverbSend > 0) {
    const send = ac.createGain();
    send.gain.setValueAtTime(preset.reverbSend, now);
    trim.connect(send);
    send.connect(bus.reverbIn);
    nodes.push(send);
  }

  return {
    instrument: v.instrument,
    partials,
    vibrato,
    brightnessFilter,
    voiceGain,
    nodes,
    attack: preset.attack ?? p.gainGlide,
    release: preset.release ?? p.gainGlide,
  };
}

/**
 * Tear a voice down. With `fade` (a live instrument swap on a sounding voice),
 * ramp the amplitude to zero over a few ms and stop the oscillators after a
 * short tail so the switch doesn't click; otherwise (engine dispose) stop now.
 */
function teardownVoice(voice: Voice, ac: AudioContext, fade = false): void {
  const now = ac.currentTime;
  const tail = fade ? 0.03 : 0;
  if (fade) {
    try {
      const g = voice.voiceGain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + 0.02);
    } catch {
      /* param unavailable; fall through to hard stop */
    }
  }
  for (const part of voice.partials) {
    try {
      part.osc.stop(now + tail);
    } catch {
      /* already stopped */
    }
  }
  if (voice.vibrato) {
    try {
      voice.vibrato.lfo.stop(now + tail);
    } catch {
      /* already stopped */
    }
  }
  const disconnectAll = () => {
    for (const n of voice.nodes) {
      try {
        n.disconnect();
      } catch {
        /* already disconnected */
      }
    }
  };
  // Disconnect after the fade tail so the ramp is actually heard.
  if (fade) setTimeout(disconnectAll, 120);
  else disconnectAll();
}

export const webAudioSynthNode = defineNode<Params>({
  type: 'webaudio-synth',
  title: 'Web Audio Synth',
  description: 'Renders synth params to instrument-preset voices (browser only).',
  inputs: [{ name: 'params', kind: 'synth-params' }],
  outputs: [],
  params: Params,
  make(p) {
    const voices = new Map<number, Voice>();
    let bus: Bus | null = null;

    return {
      process(inputs, ctx) {
        const audio = getAudio(ctx);
        if (!audio) return {};
        const { ac, master } = audio;
        bus = ensureBus(ac, master, bus);
        const sp = inputs.params as SynthParams | undefined;
        if (!sp) return {};
        const now = ac.currentTime;

        for (const v of sp.voices) {
          // Guard against non-finite params (a degenerate upstream feature):
          // setTargetAtTime throws on NaN/Infinity, which would otherwise abort
          // the whole tick. Skip the bad voice rather than kill the engine.
          if (!Number.isFinite(v.freq) || !Number.isFinite(v.gain)) continue;
          let voice = voices.get(v.id);
          // Instrument changed → fade out the old voice and rebuild.
          if (voice && voice.instrument !== v.instrument) {
            teardownVoice(voice, ac, true);
            voices.delete(v.id);
            voice = undefined;
          }
          if (v.present && v.gain > 0) {
            if (!voice) {
              voice = buildVoice(ac, bus, v, p);
              voices.set(v.id, voice);
            }
            for (const part of voice.partials) {
              part.osc.frequency.setTargetAtTime(v.freq * part.ratio, now, p.freqGlide);
            }
            voice.brightnessFilter.frequency.setTargetAtTime(
              brightnessToCutoff(v.brightness ?? 1),
              now,
              0.04,
            );
            voice.voiceGain.gain.setTargetAtTime(v.gain, now, voice.attack);
          } else if (voice) {
            voice.voiceGain.gain.setTargetAtTime(0, now, voice.release);
          }
        }
        return {};
      },
      dispose() {
        if (bus) for (const voice of voices.values()) teardownVoice(voice, bus.ac);
        voices.clear();
        if (bus) {
          for (const n of bus.nodes) {
            try {
              n.disconnect();
            } catch {
              /* already disconnected */
            }
          }
          bus = null;
        }
      },
    };
  },
});
