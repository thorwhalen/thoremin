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
 */
import type { Click } from '@thoremin/sdk/enroll';

export interface ClickPlayer {
  /** Schedule these clicks (times in ms on the engine clock, `performance.now()`). */
  play(clicks: readonly Click[]): void;
  /** Silence everything scheduled and not yet played. */
  stop(): void;
  /** Called inside the Start gesture, so the context may start. Optional. */
  unlock?(): void;
}

/** Click pitches (Hz) and shape. The count-in sits a fifth below the beats. */
const CLICK_HZ = { count: 880, beat: 1320, accent: 1760 } as const;
const CLICK_MS = 40;
const CLICK_GAIN = 0.5;

/** A click player on its own Web Audio context. */
export function createWebAudioClickPlayer(): ClickPlayer {
  let ctx: AudioContext | null = null;
  let voices: OscillatorNode[] = [];

  const context = (): AudioContext | null => {
    if (ctx) return ctx;
    const Ctor = typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
    if (!Ctor) return null;
    ctx = new Ctor({ latencyHint: 'interactive' });
    return ctx;
  };

  /** Engine-clock ms → this context's time. `getOutputTimestamp` pairs the two clocks
   *  at the output, which is where a click is heard; `currentTime` is the fallback. */
  const toContextTime = (c: AudioContext, tMs: number): number => {
    const ts = c.getOutputTimestamp?.();
    if (ts && typeof ts.contextTime === 'number' && typeof ts.performanceTime === 'number' && ts.performanceTime > 0) {
      return ts.contextTime + (tMs - ts.performanceTime) / 1000;
    }
    // Without the pairing, `currentTime` is what the context is RENDERING now, which
    // reaches the ear `outputLatency` later: schedule that much earlier.
    const outLatency = (c as AudioContext & { outputLatency?: number }).outputLatency ?? c.baseLatency ?? 0;
    return c.currentTime + (tMs - performance.now()) / 1000 - outLatency;
  };

  return {
    unlock() {
      const c = context();
      if (c && c.state === 'suspended') void c.resume();
    },
    play(clicks) {
      const c = context();
      if (!c) return;
      if (c.state === 'suspended') void c.resume();
      for (const click of clicks) {
        const at = toContextTime(c, click.t);
        if (at < c.currentTime) continue;
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
    },
    stop() {
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
