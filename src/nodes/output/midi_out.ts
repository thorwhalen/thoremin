/**
 * `midi-out` node (issue #13) — turns the merged {@link SynthParams} voice stream
 * into Web MIDI note-on/off + Control Change so the same gestures that drive the
 * built-in synth can play an external hardware/software instrument or a DAW.
 *
 * Why a facade, not raw Web MIDI here: the vendor library (WEBMIDI.js) and
 * `navigator.requestMIDIAccess` are browser-only and async to enable, so — exactly
 * like the `lyria` node hides its websocket/audio behind a {@link GenerativeEngine}
 * — this node depends only on a small {@link MidiSink} contract. The browser
 * implementation ({@link MidiSinkFactory}) is lazy-loaded from `./midi_engine`
 * (which imports WEBMIDI.js) the first time output is enabled, so nothing MIDI is
 * pulled in until asked for, and a mock sink makes the note/CC contract logic
 * — where the real bugs live (stuck notes, retrigger thrash, CC flooding) —
 * headlessly testable with no browser.
 *
 * Capability gating: on Safari/iOS (no Web MIDI) the node never throws — it opens
 * nothing, reports `phase: 'unsupported'` on its `status` port with a clear message,
 * and a UI can disable its control from that. Output is OFF by default (`enabled`
 * input defaults false), so wiring the node into the graph costs nothing until a
 * player turns it on.
 *
 * Pitch is quantized to the nearest semitone (with a small hysteresis so jitter at
 * a semitone boundary doesn't machine-gun note-on/off); continuous expression rides
 * on Control Change. Because CC is per-channel, the channel's continuous CCs follow
 * the *primary* (lowest-id) sounding voice — per-voice continuous control needs
 * per-channel (MPE) voicing and continuous pitch-bend, a deliberate follow-up.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';
import { freqToMidi } from '@/music/theory';
import type { SynthParams, VoiceParams } from '../domain';

// ---- The sink facade the node drives (implemented by ./midi_engine or a mock) --

/**
 * A minimal MIDI output the node writes to. Every argument is already in the MIDI
 * domain: `channel` 1..16, `note`/`velocity`/CC `value` 0..127. Implemented by the
 * browser WEBMIDI.js adapter (`./midi_engine`) or by a mock in tests — the node
 * never touches the vendor library or `navigator` directly.
 */
export interface MidiSink {
  /** The resolved output port name this sink targets (for the status readout). */
  readonly portName: string;
  noteOn(channel: number, note: number, velocity: number): void;
  noteOff(channel: number, note: number): void;
  controlChange(channel: number, controller: number, value: number): void;
  /** Silence everything: all-notes-off (+ all-sound-off) across the port. */
  allNotesOff(): void;
  /** Release the underlying port (best effort; silences first). */
  close(): void;
}

/** Why a sink could not be opened — reported, never thrown, so a UI can show an
 *  actionable message and disable the control. */
export type MidiUnavailable = 'unsupported' | 'no-ports' | 'port-not-found' | 'error';

export interface MidiOpenResult {
  /** The opened sink, or null when unavailable (see `reason`). */
  sink: MidiSink | null;
  /** Every available output port name (for selection + status). */
  ports: string[];
  /** Set when `sink` is null. */
  reason?: MidiUnavailable;
}

/**
 * (Lazy-)opens a MIDI output bound to `portName` (or the first available when
 * empty). Injected via `ctx.resources.createMidiSink` (tests + custom hosts), else
 * defaulted to the browser WEBMIDI.js adapter. Resolves a {@link MidiOpenResult};
 * it should only reject on a truly unexpected fault — the node catches that and
 * reports `phase: 'error'` rather than letting the tick throw.
 */
export type MidiSinkFactory = (opts: { portName: string }) => Promise<MidiOpenResult>;

/** Lifecycle/capability phase surfaced on the node's `status` port. */
export type MidiPhase = 'off' | 'unsupported' | 'connecting' | 'ready' | 'no-ports' | 'error';

/** What the node reports each tick so a UI can render + gate a MIDI-output control. */
export interface MidiStatus {
  phase: MidiPhase;
  /** Web MIDI is usable in this environment (false → a UI should disable the control). */
  supported: boolean;
  /** The resolved output port name, when ready (else null). */
  portName: string | null;
  /** Available output port names (for a selector). */
  ports: string[];
  /** Count of currently-held notes (0 when idle/off). */
  activeNotes: number;
  /** Short, human-readable explanation of the current phase. */
  message: string;
}

// ---- params ----------------------------------------------------------------

/** Controller numbers for the four continuous dimensions; null mutes a dimension.
 *  Give each dimension a DISTINCT controller — two dimensions sharing one CC number
 *  would fight for it; the node keeps only the higher-priority one (expression >
 *  brightness > vibrato > pan) to avoid flooding the port, but that is a footgun,
 *  not a feature. */
const CcMap = z.object({
  /** Continuous loudness (voice gain) → CC (default 11, Expression). */
  expression: z.number().int().min(0).max(127).nullable().default(11),
  /** Tone brightness 0..1 → CC (default 74, Sound Controller 5 / brightness). */
  brightness: z.number().int().min(0).max(127).nullable().default(74),
  /** Vibrato amount 0..1 → CC (default 1, Modulation wheel). */
  vibrato: z.number().int().min(0).max(127).nullable().default(1),
  /** Stereo pan -1..1 → CC (default 10, Pan; centre = 64). */
  pan: z.number().int().min(0).max(127).nullable().default(10),
});

const Params = z.object({
  /** Base MIDI channel (1..16) every voice plays on. */
  channel: z.number().int().min(1).max(16).default(1),
  /** Voice gain that maps to maximum MIDI velocity/expression (127). The default
   *  voice-mapping caps gain near 0.5, so 0.5 lets a full-strength gesture reach full
   *  velocity (a MIDI controller that only ever hit mezzo would feel broken). Raise it
   *  if your voices run hotter, lower it for an even hotter MIDI output. */
  fullVelocityGain: z.number().min(0.01).max(1).default(0.5),
  /** Velocity floor (many synths read a velocity-0 note-on as a note-off). */
  minVelocity: z.number().int().min(1).max(127).default(1),
  /** Extra semitones (beyond the 0.5 rounding boundary) a sustained voice's pitch
   *  must move before it re-triggers to a new note — damps flutter at a boundary. */
  noteHysteresis: z.number().min(0).max(1).default(0.1),
  /** Channel-level continuous CCs, taken from the primary (lowest-id) sounding
   *  voice. Set any controller to null to mute that dimension. */
  cc: CcMap.default({ expression: 11, brightness: 74, vibrato: 1, pan: 10 }),
});
type Params = z.infer<typeof Params>;

// ---- pure helpers (module-scoped, reusable within this module) --------------

function _clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Map a 0..1 value to a 7-bit CC value (0..127). NaN-safe (→ 0). */
function _cc7(x01: number): number {
  return Math.round(_clamp(Number.isFinite(x01) ? x01 : 0, 0, 1) * 127);
}

/** Map a voice gain to a 0..127 MIDI value, reaching full scale at `fullGain`. */
function _gainTo127(gain: number, fullGain: number): number {
  return _clamp(Math.round((gain / fullGain) * 127), 0, 127);
}

/**
 * Nearest MIDI note (0..127) for a frequency, with hysteresis: keep the `held` note
 * unless the continuous pitch has moved more than `0.5 + hysteresis` semitones from
 * it, so a hand hovering on a semitone edge doesn't retrigger every frame.
 */
function _quantizeNote(freq: number, hysteresis: number, held: number | undefined): number {
  const cont = freqToMidi(freq);
  if (held !== undefined && Math.abs(cont - held) <= 0.5 + hysteresis) return held;
  return _clamp(Math.round(cont), 0, 127);
}

/** True when the host environment exposes the Web MIDI API. False in Node and on
 *  Safari/iOS, which is exactly where the node must degrade instead of throwing. */
export function webMidiSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof (navigator as Navigator & { requestMIDIAccess?: unknown }).requestMIDIAccess === 'function'
  );
}

/** Send a CC only when its per-channel value actually changed (diffed to avoid
 *  flooding the port at frame rate). A null controller is a muted dimension. */
function _sendCc(
  sink: MidiSink,
  state: Map<number, Map<number, number>>,
  channel: number,
  controller: number | null,
  value: number,
): void {
  if (controller === null) return;
  let byController = state.get(channel);
  if (!byController) {
    byController = new Map();
    state.set(channel, byController);
  }
  if (byController.get(controller) === value) return;
  byController.set(controller, value);
  sink.controlChange(channel, controller, value);
}

/** The default browser factory: lazy-load the WEBMIDI.js adapter only when needed,
 *  so nothing MIDI is imported until output is actually enabled in a browser. */
const _defaultFactory: MidiSinkFactory = async (opts) => {
  const { openWebMidiSink } = await import('./midi_engine');
  return openWebMidiSink(opts);
};

// ---- node ------------------------------------------------------------------

export const midiOutNode = defineNode<Params>({
  type: 'midi-out',
  roles: ['synth'],
  title: 'MIDI Output',
  description:
    'Sends the merged voices to a Web MIDI output as note-on/off + CC (WEBMIDI.js). ' +
    'Off by default; gracefully disabled where Web MIDI is unsupported (Safari/iOS).',
  inputs: [
    { name: 'params', kind: 'synth-params' },
    { name: 'enabled', kind: 'boolean', default: false },
    { name: 'port', kind: 'string', default: '' },
  ],
  outputs: [{ name: 'status', kind: 'midi-status' }],
  params: Params,
  make(p) {
    let sink: MidiSink | null = null;
    let phase: MidiPhase = 'off';
    let message = 'MIDI output off';
    let supported = false;
    let ports: string[] = [];
    let opening = false; // an async open is in flight
    let attempted = false; // an open resolved for the current port (don't hammer on failure)
    let openedPort = ''; // the `port` value the current sink/attempt targets
    let wantSink = false; // latest `enabled` — lets an in-flight open bail if turned off
    let disposed = false; // teardown — an in-flight open must close its sink, not attach it
    let supportLogged = false;
    let errorLogged = false;

    // Per-instance state (must close over `sink`/maps), so these stay inner:
    // `active` is each voice's currently-held (channel, note); `noteRefs` counts how
    // many voices hold each (channel, note) so a note-off fires only when the LAST
    // voice on that pitch releases — two hands playing the same note in unison don't
    // cut each other off (MIDI has no per-source note identity within a channel).
    const active = new Map<number, { channel: number; note: number }>();
    const noteRefs = new Map<number, number>();
    const ccState = new Map<number, Map<number, number>>();
    const _noteKey = (channel: number, note: number): number => channel * 128 + note;

    /** Reference-counted note-on: sound the note only on the first voice to hold it. */
    const noteOn = (s: MidiSink, channel: number, note: number, velocity: number): void => {
      const k = _noteKey(channel, note);
      const c = noteRefs.get(k) ?? 0;
      if (c === 0) s.noteOn(channel, note, velocity);
      noteRefs.set(k, c + 1);
    };
    /** Reference-counted note-off: release the note only when the last holder lets go. */
    const noteOff = (s: MidiSink, channel: number, note: number): void => {
      const k = _noteKey(channel, note);
      const c = noteRefs.get(k) ?? 0;
      if (c <= 1) {
        noteRefs.delete(k);
        if (c >= 1) s.noteOff(channel, note);
      } else {
        noteRefs.set(k, c - 1);
      }
    };

    const status = (): MidiStatus => ({
      phase,
      supported,
      portName: sink?.portName ?? null,
      ports,
      activeNotes: noteRefs.size, // distinct sounding (channel,note) pairs, not voices
      message,
    });

    /** Silence + release everything and forget all tracked state. Safe to call with
     *  no sink. The belt-and-suspenders per-note off (each sounding note once, before
     *  the port-wide all-notes-off) guarantees no stuck note even if a device ignores
     *  CC 123. */
    const panic = (): void => {
      if (sink) {
        for (const k of noteRefs.keys()) sink.noteOff(Math.floor(k / 128), k % 128);
        sink.allNotesOff();
        sink.close();
      }
      sink = null;
      active.clear();
      noteRefs.clear();
      ccState.clear();
    };

    return {
      process(inputs, ctx: NodeContext) {
        const factory = ctx.resources.createMidiSink as MidiSinkFactory | undefined;
        // An injected factory means the host vouches for capability (tests / custom
        // hosts); otherwise gate on the real Web MIDI feature test.
        supported = factory !== undefined || webMidiSupported();
        const enabled = inputs.enabled === true;
        wantSink = enabled;
        const requestedPort = typeof inputs.port === 'string' ? inputs.port : '';

        // --- disabled: guarantee silence, hold no port, request no MIDI access ---
        if (!enabled) {
          if (sink) panic();
          attempted = false; // a later re-enable should retry
          phase = 'off';
          message = 'MIDI output off';
          return { status: status() };
        }

        // --- capability gate: never import the vendor lib / throw where unsupported ---
        if (!supported) {
          if (!supportLogged) {
            supportLogged = true;
            (ctx.log ?? console.warn)(
              '[midi-out] Web MIDI is not supported in this browser; MIDI output stays disabled.',
            );
          }
          phase = 'unsupported';
          message =
            'Web MIDI is not supported in this browser (use Chrome or Edge; Safari and iOS have no Web MIDI).';
          return { status: status() };
        }

        // --- a live port change: drop the old port cleanly and re-open ---
        if (requestedPort !== openedPort) {
          if (sink) panic();
          attempted = false;
        }

        // --- (re)open once per port; don't re-hammer a failed open ---
        if (!sink && !opening && !attempted) {
          opening = true;
          openedPort = requestedPort;
          phase = 'connecting';
          message = requestedPort ? `Connecting to MIDI output "${requestedPort}"...` : 'Connecting to MIDI output...';
          const open = factory ?? _defaultFactory;
          void open({ portName: requestedPort })
            .then((res) => {
              opening = false;
              ports = res.ports;
              if (disposed || !wantSink) {
                // Disabled, port changed, or torn down while opening: drop the fresh
                // sink (so it can't leak past dispose) and clear `attempted` so a later
                // re-enable opens again instead of staying wedged.
                res.sink?.close();
                attempted = false;
                return;
              }
              attempted = true;
              if (res.sink) {
                sink = res.sink;
                phase = 'ready';
                message = `MIDI output to "${res.sink.portName}"`;
              } else if (res.reason === 'no-ports') {
                phase = 'no-ports';
                message = 'No MIDI output ports found — connect a device or a virtual port, then re-enable.';
              } else if (res.reason === 'port-not-found') {
                phase = 'no-ports';
                message = `MIDI output "${requestedPort}" not found. Available: ${res.ports.join(', ') || 'none'}.`;
              } else if (res.reason === 'unsupported') {
                phase = 'unsupported';
                message = 'Web MIDI is not supported in this browser.';
              } else {
                phase = 'error';
                message = 'Could not open a MIDI output.';
              }
            })
            .catch((err) => {
              opening = false;
              if (disposed || !wantSink) {
                attempted = false; // disabled/torn down while opening; allow a fresh retry later
                return;
              }
              attempted = true;
              if (!errorLogged) {
                errorLogged = true;
                (ctx.log ?? console.error)('[midi-out] failed to open MIDI output', err);
              }
              phase = 'error';
              message = 'Could not open a MIDI output.';
            });
        }

        // If an open is still in flight (including one re-requested after an
        // intervening disable left phase='off'), reflect the connecting state so
        // status never reports a stale 'off' while enabled and connecting.
        if (opening) {
          phase = 'connecting';
          message = openedPort ? `Connecting to MIDI output "${openedPort}"...` : 'Connecting to MIDI output...';
        }

        // Still connecting / no port / errored: report status, send nothing.
        if (!sink) return { status: status() };
        const s = sink; // non-null for the rest of the tick

        // --- note + CC from the merged voices ---
        const sp = inputs.params as SynthParams | undefined;
        const voices = sp?.voices ?? [];
        const seen = new Set<number>();
        let primary: VoiceParams | undefined;

        for (const v of voices) {
          // freq must be a real, positive Hz value: a non-positive or non-finite freq
          // would make freqToMidi() return NaN/-Infinity → a malformed note that
          // re-triggers every tick (NaN !== NaN). Treat such a voice as not sounding.
          const sounding =
            v.present && Number.isFinite(v.freq) && v.freq > 0 && Number.isFinite(v.gain) && v.gain > 0;
          if (!sounding) continue; // released below (absent from `seen`)
          seen.add(v.id);
          if (primary === undefined || v.id < primary.id) primary = v;

          const prev = active.get(v.id);
          const note = _quantizeNote(v.freq, p.noteHysteresis, prev?.note);
          const channel = p.channel;
          const velocity = Math.max(p.minVelocity, _gainTo127(v.gain, p.fullVelocityGain));

          if (!prev) {
            noteOn(s, channel, note, velocity);
            active.set(v.id, { channel, note });
          } else if (note !== prev.note || channel !== prev.channel) {
            // The held pitch crossed to a new semitone (or the channel changed):
            // release the old note and strike the new one (legato retrigger).
            noteOff(s, prev.channel, prev.note);
            noteOn(s, channel, note, velocity);
            active.set(v.id, { channel, note });
          }
        }

        // Release every voice no longer sounding (present=false, gain 0, non-finite,
        // or gone from the frame) so a note can never get stuck on.
        for (const [id, held] of active) {
          if (!seen.has(id)) {
            noteOff(s, held.channel, held.note);
            active.delete(id);
          }
        }

        // Channel-wide continuous CC, owned by the primary voice (CC is per-channel).
        // In priority order, skipping a controller already claimed this tick so two
        // dimensions accidentally sharing a CC number can't flood it (they'd otherwise
        // overwrite each other's diff state and send every frame).
        if (primary) {
          const ch = p.channel;
          // Pan's neutral is centre (64), not 0, so a non-finite pan must fall back
          // to 0 (centre) before mapping — otherwise `_cc7`'s NaN→0 would send hard
          // left. brightness/vibrato are fine because their neutral already is 0.
          const panVal = Number.isFinite(primary.pan) ? (primary.pan as number) : 0;
          const dims: Array<[number | null, number]> = [
            [p.cc.expression, _gainTo127(primary.gain, p.fullVelocityGain)],
            [p.cc.brightness, _cc7(primary.brightness ?? 1)],
            [p.cc.vibrato, _cc7(primary.vibrato ?? 0)],
            [p.cc.pan, _cc7((panVal + 1) / 2)],
          ];
          const claimed = new Set<number>();
          for (const [controller, value] of dims) {
            if (controller === null || claimed.has(controller)) continue;
            claimed.add(controller);
            _sendCc(s, ccState, ch, controller, value);
          }
        }

        phase = 'ready';
        return { status: status() };
      },
      dispose() {
        // Mark disposed BEFORE panic so an open still in flight closes its sink on
        // resolve instead of attaching a port that would then leak (no more ticks run).
        disposed = true;
        panic();
      },
    };
  },
});
