/**
 * The trainer's click (#247) — the metronome a real-versus-air phrase is played to.
 *
 * WHEN the clicks sound is decided elsewhere, once: `clickPlan` (`packages/sdk/src/enroll/cue.ts`)
 * turns a clicked cue and its start time into a list of times on the engine clock, the
 * trainer store writes those same times into the take's annotations, and this module
 * only makes them audible. So what the player heard and what the take says they heard
 * come from one list and cannot disagree; a click this module fails to play (a
 * suspended context, a time already past) is a click the player missed, never a click
 * the recording invents.
 *
 * It has its OWN `AudioContext`, like the latency probe's answer tone: the trainer never
 * touches the instrument's sound, the click must play before the player has started
 * the synth, and it must not ride the master bus into a recording of what thoremin
 * played. Pitches: the count-in lower than the beats, each bar's first click higher, so
 * a player hears where the phrase starts without counting.
 *
 * The player hears it in headphones, so the microphone records only the taps (a click
 * from a speaker would be recorded on top of the tap it prompted, and cannot be masked
 * out by its time, because the taps land on the clicks by design). Bluetooth
 * headphones are fine: they deliver every click 150 to 300 ms late, but steadily, and a
 * steady delay is part of the lag the real half measures and the air half inherits
 * (`scripts/cue/lib_pair_take.ts`, `gridLag`). The times written into the take stay the
 * scheduled ones: nothing here can know the headphones' delay, and nothing needs to.
 *
 * The engine-to-context map is the one every scheduler shares
 * (`@thoremin/sdk/timing/clock_map`), with the output stage read from THIS context by the
 * shared rule (`output_stage.ts`): on WebKit the `getOutputTimestamp` pair stops before
 * the device, so the pair branch this module used to carry and its `outputLatency`
 * fallback disagreed by exactly the output latency. A click whose time is already past
 * on the context clock is dropped and COUNTED (`dropped()`): on Safari 17 the pair was
 * off by the sample rate, which silently dropped every click while the take's
 * annotations said they sounded; a take with a non-zero count is not to be trusted.
 *
 * A context that is not running (Safari starts one suspended; the pattern trainer calls
 * `unlock()` and `play()` in the same gesture) has a FROZEN `currentTime`, so a click
 * mapped against it would sound late by however long the resume takes, while the take
 * says it sounded on time (#393 item 5). So `play()` waits for the resume and maps the
 * clicks against the running clock then: a click still ahead sounds at its time, one
 * that passed meanwhile is dropped and counted like any other, and once every resume
 * request has been refused they are all dropped and counted. `unlock()` always asks again:
 * Chrome leaves a resume asked for outside a gesture pending, and only the one asked
 * for inside the Start gesture can succeed. Dropping every click while suspended (as `drum-out` drops
 * hits) would be simpler, but it would silence the whole count-in of a take started in
 * one gesture on Safari; a drum hit has no such schedule to keep. `stop()` cancels the
 * clicks still waiting, which are not counted: the player stopped, nothing was missed.
 */
import type { Click } from '@thoremin/sdk/enroll';
import { engineToContextTime } from '@thoremin/sdk/timing/clock_map';
import { readOutputStage } from '@thoremin/sdk/timing/output_stage';

export interface ClickPlayer {
  /** Schedule these clicks (times in ms on the engine clock, `performance.now()`). */
  play(clicks: readonly Click[]): void;
  /** Silence everything scheduled and not yet played. */
  stop(): void;
  /** Called inside the Start gesture, so the context may start. Optional. */
  unlock?(): void;
  /** Clicks dropped because their time was already past on the audio clock, in total.
   *  Optional (a mock may not count). */
  dropped?(): number;
}

/** Click pitches (Hz) and shape. The count-in sits a fifth below the beats. */
const CLICK_HZ = { count: 880, beat: 1320, accent: 1760 } as const;
const CLICK_MS = 40;
const CLICK_GAIN = 0.5;

/** A click player on its own Web Audio context. */
export function createWebAudioClickPlayer(): ClickPlayer {
  let ctx: AudioContext | null = null;
  let voices: OscillatorNode[] = [];
  let dropped = 0;

  const context = (): AudioContext | null => {
    if (ctx) return ctx;
    const Ctor = typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
    if (!Ctor) return null;
    ctx = new Ctor({ latencyHint: 'interactive' });
    return ctx;
  };

  /** Engine-clock ms → this context's time, through the shared map: `currentTime` is
   *  what the context is RENDERING now, which reaches the ear one output stage later. */
  const toContextTime = (c: AudioContext, tMs: number): number => {
    const nowMs = performance.now();
    return engineToContextTime(c, tMs / 1000, nowMs / 1000, readOutputStage(c, nowMs).value);
  };

  /** Bumped by `stop()`, so clicks waiting on a resume from before it never play. */
  let generation = 0;
  /** Resume requests not yet settled. Chrome leaves a `resume()` made outside a user
   *  gesture pending, so each request is its own: `unlock()` always asks again inside the
   *  Start gesture, and any one that succeeds is enough. */
  let pendingResumes = 0;
  /** What the waiting clicks wait on: true once a resume succeeds, false once every
   *  request has been refused. One per suspension, shared by every waiting `play()`. */
  let waiting: { promise: Promise<boolean>; settle: (ok: boolean) => void } | null = null;
  const settle = (ok: boolean): void => {
    const w = waiting;
    waiting = null;
    w?.settle(ok);
  };
  /** Ask the context to resume; the rejection is always handled here. */
  const requestResume = (c: AudioContext): void => {
    pendingResumes++;
    c.resume().then(
      () => {
        pendingResumes--;
        settle(true);
      },
      () => {
        pendingResumes--;
        // A refusal ends the wait only when no other request can still succeed.
        if (pendingResumes === 0) settle(false);
      },
    );
  };
  const whenRunning = (c: AudioContext): Promise<boolean> => {
    if (!waiting) {
      let resolve!: (ok: boolean) => void;
      const promise = new Promise<boolean>((r) => (resolve = r));
      waiting = { promise, settle: resolve };
    }
    const { promise } = waiting;
    if (pendingResumes === 0) requestResume(c);
    return promise;
  };

  const schedule = (c: AudioContext, clicks: readonly Click[]): void => {
    for (const click of clicks) {
      const at = toContextTime(c, click.t);
      if (at < c.currentTime) {
        dropped++;
        continue;
      }
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.frequency.value = click.kind === 'count' ? CLICK_HZ.count : click.accent ? CLICK_HZ.accent : CLICK_HZ.beat;
      gain.gain.setValueAtTime(CLICK_GAIN, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + CLICK_MS / 1000);
      osc.connect(gain).connect(c.destination);
      osc.start(at);
      osc.stop(at + CLICK_MS / 1000);
      osc.onended = () => {
        voices = voices.filter((v) => v !== osc);
        gain.disconnect();
      };
      voices.push(osc);
    }
  };

  return {
    unlock() {
      const c = context();
      if (c && c.state !== 'running') requestResume(c);
    },
    play(clicks) {
      const c = context();
      if (!c) return;
      if (c.state === 'running') {
        schedule(c, clicks);
        return;
      }
      // Never against the frozen clock: map them once the context runs (see the header).
      const gen = generation;
      void whenRunning(c).then((ok) => {
        if (gen !== generation) return;
        if (ok && c.state === 'running') schedule(c, clicks);
        else dropped += clicks.length;
      });
    },
    dropped() {
      return dropped;
    },
    stop() {
      generation++;
      for (const osc of voices) {
        try {
          osc.stop();
        } catch {
          /* not started yet, or already ended */
        }
      }
      voices = [];
    },
  };
}

let player: ClickPlayer | null = null;

/** The click player: the Web Audio one, created on first use. */
export function clickPlayer(): ClickPlayer {
  return (player ??= createWebAudioClickPlayer());
}

/** Tests (and a future host with its own audio): replace the player; null restores the default. */
export function setClickPlayer(next: ClickPlayer | null): void {
  player?.stop();
  player = next;
}
