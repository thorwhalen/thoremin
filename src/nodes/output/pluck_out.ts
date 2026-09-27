/**
 * `pluck-out` node (#249) — sounds plucked-string note events (the air bass now; the
 * air guitar's strums next) on the audio clock, at the time each was predicted for.
 *
 * The melodic path everywhere else in thoremin is CONTINUOUS voices (a frequency and a
 * gain smoothed every tick, `webaudio-synth`), which is right for a theremin and wrong
 * for a string: a pluck is an event with an attack at a precise instant and a decay,
 * and the instant is predicted ahead of the frame that shows it. So this is the
 * `drum-out` discipline for pitched notes: the engine-to-audio clock map is the one
 * `drum-out` owns ({@link engineToContextTime}), a committed note is never moved, and a
 * context that is not running drops notes instead of bursting them on resume.
 *
 * The sound sits behind a {@link PluckSink} facade (injectable through
 * `ctx.resources.createPluckSink`, so the scheduling logic is headlessly testable). The
 * WebAudio sink is a subtractive pluck from primitives, no samples: a sawtooth plus a
 * triangle an octave down, through a low-pass filter whose cutoff falls fast (the
 * bright attack of a string settling into its fundamental), under an exponential decay.
 * `mono` (the bass) damps the ringing note when the next one starts, as a bassist's
 * fretting hand does.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';
import { realtimeOutputAllowed } from '@/dag';
import { NoteEventsSchema, type NoteEvent } from '../music/air_bass';
import { engineToContextTime, type AudioClockLike } from './drum_out';

/** The plucked timbres: each a filter brightness and a decay. */
export const PLUCK_TIMBRES = {
  bass: { brightness: 6, decay: 1.4, gain: 0.9 },
  guitar: { brightness: 12, decay: 2.2, gain: 0.5 },
} as const satisfies Record<string, { brightness: number; decay: number; gain: number }>;
export type PluckTimbre = keyof typeof PLUCK_TIMBRES;

/** The audio the node drives: one call per note, at a context time. */
export interface PluckSink {
  play(midi: number, velocity: number, whenContextSeconds: number): void;
  close(): void;
}

export type PluckSinkFactory = (ac: AudioContext | undefined, destination: AudioNode | undefined, opts: PluckSinkOptions) => PluckSink;

export interface PluckSinkOptions {
  timbre: PluckTimbre;
  mono: boolean;
}

/** Seconds to damp a ringing note when a mono voice is re-plucked (no click). */
const DAMP_S = 0.02;
/** The cutoff's floor, as a multiple of the fundamental, after the attack settles. */
const SETTLED_BRIGHTNESS = 1.5;
/** How long the attack's brightness takes to settle, seconds. */
const SETTLE_S = 0.25;

const midiToFreq = (m: number) => 440 * 2 ** ((m - 69) / 12);

export function createWebAudioPluckSink(ac: AudioContext, destination: AudioNode, { timbre, mono }: PluckSinkOptions): PluckSink {
  const tone = PLUCK_TIMBRES[timbre];
  let ringing: { gain: GainNode; stopAt: number } | null = null;
  return {
    play(midi, velocity, when) {
      const v = Math.max(0, Math.min(1, velocity));
      if (v <= 0) return;
      const f = midiToFreq(midi);
      if (mono && ringing && ringing.stopAt > when) {
        ringing.gain.gain.cancelScheduledValues(when);
        ringing.gain.gain.setTargetAtTime(0.0001, when, DAMP_S / 3);
      }
      const saw = ac.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.setValueAtTime(f, when);
      const sub = ac.createOscillator();
      sub.type = 'triangle';
      sub.frequency.setValueAtTime(f / 2, when);
      const filter = ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(f * tone.brightness, when);
      filter.frequency.exponentialRampToValueAtTime(f * SETTLED_BRIGHTNESS, when + SETTLE_S);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(tone.gain * v, when + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, when + tone.decay);
      saw.connect(filter);
      sub.connect(filter);
      filter.connect(g);
      g.connect(destination);
      const stopAt = when + tone.decay + 0.05;
      saw.start(when);
      sub.start(when);
      saw.stop(stopAt);
      sub.stop(stopAt);
      ringing = { gain: g, stopAt };
    },
    close() {
      ringing = null;
    },
  };
}

const Params = z.object({
  timbre: z.enum(Object.keys(PLUCK_TIMBRES) as [PluckTimbre, ...PluckTimbre[]]).default('bass'),
  /** One note at a time: a new pluck damps the ringing one (a bass). */
  mono: z.boolean().default(true),
});
type Params = z.infer<typeof Params>;

export const pluckOutNode = defineNode<Params>({
  type: 'pluck-out',
  roles: ['synth'],
  title: 'Pluck out',
  description: 'Sounds plucked-string note events (the air bass) on the audio clock at the time each was predicted for (WebAudio plucks from primitives, no samples).',
  inputs: [{ name: 'notes', kind: 'note-events' }],
  outputs: [],
  params: Params,
  make(p) {
    let sink: PluckSink | null = null;
    let sinkAc: AudioContext | null = null;
    return {
      process(inputs, ctx: NodeContext) {
        const raw = inputs.notes;
        if (!Array.isArray(raw) || raw.length === 0) return {};
        if (!realtimeOutputAllowed(ctx)) return {};
        const ac = ctx.resources.audioContext as AudioContext | undefined;
        const master = ctx.resources.masterGain as AudioNode | undefined;
        const factory = ctx.resources.createPluckSink as PluckSinkFactory | undefined;
        // An injected sink (a test, a custom host) needs no WebAudio; the default does.
        if (!factory && !(ac && master)) return {};
        if (!sink || sinkAc !== (ac ?? null)) {
          sink?.close();
          const opts = { timbre: p.timbre, mono: p.mono };
          sink = factory ? factory(ac, master, opts) : createWebAudioPluckSink(ac!, master!, opts);
          sinkAc = ac ?? null;
        }
        const clock: AudioClockLike = ac ?? { currentTime: 0 };
        if (clock.state !== undefined && clock.state !== 'running') return {};
        const parsed = NoteEventsSchema.safeParse(raw);
        if (!parsed.success) return {};
        for (const note of parsed.data as NoteEvent[]) {
          // Never in the past: a late note sounds at once.
          const when = Math.max(clock.currentTime + 0.001, engineToContextTime(clock, note.t, ctx.time));
          sink.play(note.midi, note.velocity, when);
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
