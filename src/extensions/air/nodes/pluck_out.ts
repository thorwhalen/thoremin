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
 * WebAudio sink is a subtractive pluck from primitives, no samples (see
 * {@link createWebAudioPluckSink}). `mono` (the bass) damps the ringing note when the
 * next one starts, as a bassist's fretting hand does; otherwise a note damps only the
 * previous note on its own `voice` (a guitar string).
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';
import { realtimeOutputAllowed } from '@/dag';
import { NoteEventsSchema, type NoteEvent } from '@/extensions/air/nodes/note_events';
import { engineToContextTime, type AudioClockLike } from '@/extensions/air/nodes/drum_out';

/** The plucked timbres: the attack's brightness and where it settles (multiples of the
 *  fundamental), the decay, and the peak gain. The settled brightness is well above the
 *  fundamental on purpose: a laptop speaker reproduces little below 150 Hz, and a low
 *  note is heard through its harmonics. */
export const PLUCK_TIMBRES = {
  bass: { brightness: 8, settled: 5, decay: 1.4, gain: 0.8 },
  guitar: { brightness: 14, settled: 4, decay: 2.2, gain: 0.35 },
} as const satisfies Record<string, { brightness: number; settled: number; decay: number; gain: number }>;
export type PluckTimbre = keyof typeof PLUCK_TIMBRES;

/** The audio the node drives: one call per note, at a context time. */
export interface PluckSink {
  /** `voice`: a new note on a voice damps the one ringing there (see {@link NoteEvent}). */
  play(midi: number, velocity: number, whenContextSeconds: number, voice?: number): void;
  close(): void;
}

export type PluckSinkFactory = (ac: AudioContext | undefined, destination: AudioNode | undefined, opts: PluckSinkOptions) => PluckSink;

export interface PluckSinkOptions {
  timbre: PluckTimbre;
  /** One voice for every note: each note damps the previous one (a bass). */
  mono: boolean;
}

/** Time constant of the damp when a voice is re-plucked, seconds (fast, but no click). */
const DAMP_TAU_S = 0.008;
/** How long the attack's brightness takes to settle, seconds. */
const SETTLE_S = 0.25;
/** Each oscillator's share of the mix, so the sum never exceeds the peak gain. */
const OSC_MIX = 0.5;
/** The voice key every note of a mono sink shares. */
const MONO_VOICE = -1;

const midiToFreq = (m: number) => 440 * 2 ** ((m - 69) / 12);

/**
 * A subtractive pluck from primitives: a sawtooth and a triangle at the note's pitch
 * through a low-pass whose cutoff falls from bright to settled (a string's attack), under
 * an exponential envelope, then a per-note DAMP gain. The damp is a separate node on
 * purpose: cancelling the envelope's own ramp to damp a ringing note would snap it back
 * to its value before the ramp (the peak) until the damp begins, a click and a burst on
 * every re-pluck. The damp gain carries no automation until it is used, so damping it is
 * a plain fall from 1.
 */
export function createWebAudioPluckSink(ac: AudioContext, destination: AudioNode, { timbre, mono }: PluckSinkOptions): PluckSink {
  const tone = PLUCK_TIMBRES[timbre];
  const nyquist = ac.sampleRate / 2;
  const ringing = new Map<number, { damp: GainNode; stopAt: number }>();
  return {
    play(midi, velocity, when, voice) {
      const v = Math.max(0, Math.min(1, velocity));
      const key = mono ? MONO_VOICE : voice;
      if (key !== undefined) {
        const prev = ringing.get(key);
        if (prev && prev.stopAt > when) prev.damp.gain.setTargetAtTime(0, when, DAMP_TAU_S);
      }
      // A zero-velocity note is only a damp (a muted string): nothing new sounds.
      if (v <= 0) return;
      const f = midiToFreq(midi);
      const cutoff = (m: number) => Math.min(nyquist * 0.9, f * m);
      const oscs = (['sawtooth', 'triangle'] as const).map((type) => {
        const o = ac.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(f, when);
        return o;
      });
      const mix = ac.createGain();
      mix.gain.value = OSC_MIX;
      const filter = ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(cutoff(tone.brightness), when);
      filter.frequency.exponentialRampToValueAtTime(cutoff(tone.settled), when + SETTLE_S);
      const env = ac.createGain();
      env.gain.setValueAtTime(0.0001, when);
      env.gain.exponentialRampToValueAtTime(tone.gain * v, when + 0.005);
      env.gain.exponentialRampToValueAtTime(0.0001, when + tone.decay);
      const damp = ac.createGain();
      for (const o of oscs) o.connect(mix);
      mix.connect(filter);
      filter.connect(env);
      env.connect(damp);
      damp.connect(destination);
      const stopAt = when + tone.decay + 0.05;
      for (const o of oscs) {
        o.start(when);
        o.stop(stopAt);
      }
      // Free the graph when the note ends (a strum of six is six of these).
      oscs[0].onended = () => {
        damp.disconnect();
        if (key !== undefined && ringing.get(key)?.damp === damp) ringing.delete(key);
      };
      if (key !== undefined) ringing.set(key, { damp, stopAt });
    },
    close() {
      ringing.clear();
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
  inputs: [
    { name: 'notes', kind: 'note-events' },
    // The player's mute, a tool's hush or the conductor (`muteStrikes`, `hushOf`):
    // true → drop every event, so nothing new sounds. Absent → false.
    { name: 'mute', kind: 'boolean', default: false },
  ],
  outputs: [],
  params: Params,
  make(p) {
    let sink: PluckSink | null = null;
    let sinkAc: AudioContext | null = null;
    return {
      process(inputs, ctx: NodeContext) {
        if (inputs.mute === true) return {};
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
          sink.play(note.midi, note.velocity, when, note.voice);
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
