/**
 * `drum-out` node (#233) — sounds the air drum's hits on the audio clock, at the
 * time each hit was predicted for.
 *
 * The other half of the two-clock discipline (`docs/research/conducting-and-virtual-
 * orchestra-research-map.md` §6.5): the `air-drum` node decides WHEN a hit should
 * sound, in engine seconds and possibly in the future; this node maps that instant
 * onto `AudioContext` time and schedules a short percussive voice there, so the
 * prediction's lead becomes a sound at the impact rather than a sound one frame
 * after it. Engine time is `performance.now()/1000` at speed 1. The map is the ONE
 * shared by every scheduler (`@thoremin/sdk/timing/clock_map`): `currentTime + (t -
 * now) - outputStage`, the output stage coming from the host's `timing` resource
 * (`@thoremin/sdk/timing/tracker`). This node used to read the context's
 * `getOutputTimestamp()` pair itself as "the exact map"; measured in WebKit, that pair
 * stops at the I/O callback, before the device, so every hit sounded `outputLatency`
 * late on Safari (16 ms built-in, 150 ms or more on AirPods). The resource applies the
 * rule that tells a pre-latency pair from a true one, smooths Chrome's bouncing readings,
 * and never answers 0.
 *
 * The audio itself sits behind a small {@link DrumSink} facade, like `midi-out`'s
 * sink: the browser implementation builds the drum voices from oscillators and noise
 * (no samples to load), shaped per hit by {@link drumVoice} (#245): a harder hit is
 * louder AND brighter, and a hit near a pad's rim is higher, shorter and edgier than one
 * at its centre, as on a real drum head, and a mock makes the scheduling logic — where a wrong
 * clock map or a hit sounded twice would live — headlessly testable. A committed hit
 * is never moved (a scheduler never touches what it scheduled). Boundary B: at any
 * clock scale but real time this node sounds nothing.
 */
import { z } from 'zod';
import { defineNode } from '@thoremin/dag';
import type { NodeContext } from '@thoremin/dag';
import { realtimeOutputAllowed } from '@thoremin/dag';
import { scheduleAt, type TickClock } from '@thoremin/sdk/timing/clock_map';
import type { AudioView } from '@thoremin/sdk/timing/audio';
import { timingFrom } from '@thoremin/sdk/timing/tracker';
import { createEventBatchParser } from '../lib/event_batch';
import { DRUM_SOUNDS, DrumHitSchema, type DrumSound } from './air_drum';

/** Per-hit shading of a voice beyond its loudness. */
export interface DrumTouch {
  /** Where on the pad: 0 = the centre, 1 = the rim. */
  radial?: number;
}

/** The audio the node drives: one call per hit, at a context time. */
export interface DrumSink {
  play(sound: DrumSound, velocity: number, whenContextSeconds: number, touch?: DrumTouch): void;
  close(): void;
}

/** A pitched body: a sine swept from `from` to `to` Hz over `drop` s, decaying over `decay` s. */
export interface ToneVoice {
  from: number;
  to: number;
  drop: number;
  decay: number;
  gain: number;
}
/** A filtered noise burst. */
export interface NoiseVoice {
  filter: 'bandpass' | 'highpass';
  freq: number;
  q: number;
  decay: number;
  gain: number;
}
export interface DrumVoice {
  tones: ToneVoice[];
  noises: NoiseVoice[];
}

/** The base (centre, full-velocity) voice of each drum. */
const BASE: Record<DrumSound, DrumVoice> = {
  kick: { tones: [{ from: 160, to: 45, drop: 0.06, decay: 0.28, gain: 0.9 }], noises: [] },
  tom: { tones: [{ from: 220, to: 110, drop: 0.12, decay: 0.35, gain: 0.7 }], noises: [] },
  snare: {
    tones: [{ from: 190, to: 150, drop: 0.03, decay: 0.12, gain: 0.35 }],
    noises: [{ filter: 'bandpass', freq: 1800, q: 0.8, decay: 0.16, gain: 0.8 }],
  },
  hihat: { tones: [], noises: [{ filter: 'highpass', freq: 6000, q: 1, decay: 0.06, gain: 0.5 }] },
  crash: { tones: [], noises: [{ filter: 'highpass', freq: 4000, q: 0.7, decay: 1.2, gain: 0.45 }] },
  ride: {
    tones: [
      { from: 2400, to: 2380, drop: 0.3, decay: 0.7, gain: 0.08 },
      { from: 3370, to: 3350, drop: 0.3, decay: 0.5, gain: 0.05 },
    ],
    noises: [{ filter: 'highpass', freq: 7000, q: 0.8, decay: 0.45, gain: 0.25 }],
  },
};

/** How much a hit's hardness brightens it: the tone sweeps start this much higher and the
 *  noise filters open this much wider at full velocity than at none. */
const BRIGHTNESS_SPAN = 0.4;
/** How much the rim raises pitch and filter (fraction) and shortens decay (fraction). */
const RIM_PITCH = 0.3;
const RIM_DECAY = 0.35;
/** How much louder the rim makes the noise part (fraction at the rim): the edge rattles. */
const RIM_NOISE_GAIN = 0.3;

/**
 * The voice for one hit (#245): the drum's base voice, with loudness scaled by the
 * velocity, brightness raised by it (a hard stroke excites the upper partials), and pitch,
 * filter and decay moved by where on the pad it landed (a rim hit is higher, shorter and
 * edgier; a centre hit is the drum's full body). Pure, so the sound's shape is testable
 * without WebAudio.
 */
export function drumVoice(sound: DrumSound, velocity: number, touch: DrumTouch = {}): DrumVoice {
  const v = Math.max(0, Math.min(1, velocity));
  const r = Math.max(0, Math.min(1, touch.radial ?? 0));
  const bright = 1 - BRIGHTNESS_SPAN / 2 + BRIGHTNESS_SPAN * v;
  const pitch = 1 + RIM_PITCH * r;
  const decay = 1 - RIM_DECAY * r;
  const base = BASE[sound];
  return {
    // Both ends of a sweep move together, so a hard hit is brighter without a sustained
    // partial (the ride's) gliding in pitch.
    tones: base.tones.map((t) => ({ ...t, from: t.from * pitch * bright, to: t.to * pitch * bright, decay: t.decay * decay, gain: t.gain * v })),
    noises: base.noises.map((n) => ({ ...n, freq: n.freq * pitch * bright, decay: n.decay * decay, gain: n.gain * v * (1 + RIM_NOISE_GAIN * r) })),
  };
}

/** The slice of `AudioContext` this node reads. */
export type AudioClockLike = AudioView<'currentTime', 'state'>;

/** How a sink is made: injected through `ctx.resources.createDrumSink` (tests, custom
 *  hosts; may be called without WebAudio resources), else the WebAudio one below over
 *  `audioContext` / `masterGain`. */
export type DrumSinkFactory = (ac: AudioContext | undefined, destination: AudioNode | undefined) => DrumSink;

/** The gain an exponential decay ramps to: an exponential ramp cannot reach 0, and this
 *  is inaudible (-60 dB). */
const DECAY_FLOOR_GAIN = 0.001;
/** Seconds a voice keeps running after its decay ends, so the ramp is never cut. */
const STOP_MARGIN_S = 0.02;

/** Build a noise buffer once per context (a second of white noise). */
function noiseBuffer(ac: AudioContext): AudioBuffer {
  const len = ac.sampleRate;
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/** The drums, from primitives: a pitched sine that drops (kick, tom), a noise burst
 *  through a filter with a short tone (snare), filtered noise (hi-hat, crash), and a
 *  pair of inharmonic partials over noise (ride); each hit's voice from {@link drumVoice}. */
export function createWebAudioDrumSink(ac: AudioContext, destination: AudioNode): DrumSink {
  let noise: AudioBuffer | null = null;
  const tone = ({ from, to, drop, decay, gain }: ToneVoice, when: number) => {
    if (gain <= 0) return;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(from, when);
    osc.frequency.exponentialRampToValueAtTime(to, when + drop);
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(DECAY_FLOOR_GAIN, when + decay);
    osc.connect(g);
    g.connect(destination);
    osc.start(when);
    osc.stop(when + decay + STOP_MARGIN_S);
  };
  const burst = ({ filter, freq, q, decay, gain }: NoiseVoice, when: number) => {
    if (gain <= 0) return;
    noise ??= noiseBuffer(ac);
    const src = ac.createBufferSource();
    src.buffer = noise;
    const f = ac.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, when);
    f.Q.setValueAtTime(q, when);
    const g = ac.createGain();
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(DECAY_FLOOR_GAIN, when + decay);
    src.connect(f);
    f.connect(g);
    g.connect(destination);
    src.start(when);
    src.stop(when + decay + STOP_MARGIN_S);
  };
  return {
    play(sound, velocity, when, touch) {
      if (!(velocity > 0)) return;
      const voice = drumVoice(sound, velocity, touch);
      for (const t of voice.tones) tone(t, when);
      for (const n of voice.noises) burst(n, when);
    },
    close() {
      noise = null;
    },
  };
}

const Params = z.object({});
type Params = z.infer<typeof Params>;

export const drumOutNode = defineNode<Params>({
  type: 'drum-out',
  roles: ['synth'],
  title: 'Drum out',
  description: 'Sounds the air drum hits on the audio clock at the time each was predicted for (WebAudio drums from primitives, no samples).',
  inputs: [
    { name: 'hits', kind: 'drum-hits' },
    // The player's mute, a tool's hush or the conductor (`muteStrikes`, `hushOf`):
    // true → drop every event, so nothing new sounds. Absent → false.
    { name: 'mute', kind: 'boolean', default: false },
  ],
  outputs: [],
  params: Params,
  make() {
    let sink: DrumSink | null = null;
    let sinkAc: AudioContext | null = null;
    // Each hit parsed on its own: one malformed hit is skipped and counted, never the
    // whole tick's batch (#393 item 8; `../lib/event_batch`).
    const batch = createEventBatchParser(DrumHitSchema, 'drum-out');
    return {
      process(inputs, ctx: NodeContext) {
        if (inputs.mute === true) return {};
        const raw = inputs.hits;
        if (!Array.isArray(raw) || raw.length === 0) return {};
        if (!realtimeOutputAllowed(ctx)) return {};
        const ac = ctx.resources.audioContext as AudioContext | undefined;
        const master = ctx.resources.masterGain as AudioNode | undefined;
        const factory = ctx.resources.createDrumSink as DrumSinkFactory | undefined;
        // An injected sink (a test, a custom host) needs no WebAudio; the default does.
        if (!factory && !(ac && master)) return {};
        if (!sink || sinkAc !== (ac ?? null)) {
          sink?.close();
          sink = factory ? factory(ac, master) : createWebAudioDrumSink(ac!, master!);
          sinkAc = ac ?? null;
        }
        const clock: AudioClockLike = ac ?? { currentTime: 0 };
        // A context that is not running (suspended, interrupted, not yet resumed) has a
        // frozen clock: hits scheduled against it would burst out on resume. Drop them.
        if (clock.state !== undefined && clock.state !== 'running') return {};
        const hits = batch.parse(raw, ctx.log);
        if (hits.length === 0) return {};
        const at: TickClock = { clock, nowEngine: ctx.time, stage: timingFrom(ctx.resources).outputStage.value };
        for (const hit of hits) {
          if (!DRUM_SOUNDS.includes(hit.sound)) continue;
          // Never in the past: a ghost note (or a late prediction) sounds at once.
          const when = scheduleAt(hit.t, at);
          sink.play(hit.sound, hit.velocity, when, { radial: hit.radial ?? 0 });
        }
        return {};
      },
      dispose() {
        sink?.close();
        sink = null;
        sinkAc = null;
      },
    };
  },
});
