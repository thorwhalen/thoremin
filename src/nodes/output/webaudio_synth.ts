/**
 * `webaudio-synth` node (browser-only) — renders {@link SynthParams} to sound
 * via the Web Audio API. One {@link OscillatorNode}+{@link GainNode} per voice,
 * with smoothed frequency/gain ramps so per-frame parameter updates don't click.
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
import type { SynthParams, VoiceParams } from '../domain';

const Params = z.object({
  /** Frequency smoothing time constant (seconds). */
  freqGlide: z.number().default(0.03),
  /** Gain smoothing time constant (seconds). */
  gainGlide: z.number().default(0.08),
});
type Params = z.infer<typeof Params>;

interface Voice {
  osc: OscillatorNode;
  gain: GainNode;
  type: OscillatorType;
}

function getAudio(ctx: NodeContext): { ac: AudioContext; master: GainNode } | null {
  const ac = ctx.resources.audioContext as AudioContext | undefined;
  const master = ctx.resources.masterGain as GainNode | undefined;
  if (!ac || !master) return null;
  return { ac, master };
}

export const webAudioSynthNode = defineNode<Params>({
  type: 'webaudio-synth',
  title: 'Web Audio Synth',
  description: 'Renders synth params to oscillator voices (browser only).',
  inputs: [{ name: 'params', kind: 'synth-params' }],
  outputs: [],
  params: Params,
  make(p) {
    const voices = new Map<number, Voice>();

    const ensureVoice = (ac: AudioContext, master: GainNode, v: VoiceParams): Voice => {
      let voice = voices.get(v.id);
      if (!voice) {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = v.instrument;
        gain.gain.setValueAtTime(0, ac.currentTime);
        osc.connect(gain);
        gain.connect(master);
        osc.start();
        voice = { osc, gain, type: v.instrument };
        voices.set(v.id, voice);
      }
      if (voice.type !== v.instrument) {
        voice.osc.type = v.instrument;
        voice.type = v.instrument;
      }
      return voice;
    };

    return {
      process(inputs, ctx) {
        const audio = getAudio(ctx);
        if (!audio) return {};
        const { ac, master } = audio;
        const sp = inputs.params as SynthParams | undefined;
        if (!sp) return {};
        const now = ac.currentTime;
        for (const v of sp.voices) {
          if (v.present && v.gain > 0) {
            const voice = ensureVoice(ac, master, v);
            voice.osc.frequency.setTargetAtTime(v.freq, now, p.freqGlide);
            voice.gain.gain.setTargetAtTime(v.gain, now, p.gainGlide);
          } else {
            const voice = voices.get(v.id);
            if (voice) voice.gain.gain.setTargetAtTime(0, now, p.gainGlide);
          }
        }
        return {};
      },
      dispose() {
        for (const voice of voices.values()) {
          try {
            voice.osc.stop();
            voice.osc.disconnect();
            voice.gain.disconnect();
          } catch {
            /* already torn down */
          }
        }
        voices.clear();
      },
    };
  },
});
