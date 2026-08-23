/**
 * Guidance sinks (#163 §4-§5) — where what the runner SAYS goes.
 *
 * The runner emits `say` strings (instruction, nudge, end phrase, done); the trainer
 * store turns them into transcript lines. A {@link GuidanceSink} is anything that
 * renders those lines: the written channel (the panel's transcript and the on-video
 * HUD read the store directly and are always on), and — behind a toggle — the spoken
 * channel (PR 3 plays a cached clip per line). Text is never a sink you can turn off;
 * voice is a sink you can add.
 *
 * Sinks are called synchronously from the store's event handler, at human frequency
 * (a few times per cue). A sink must not throw and must not block.
 */
import type { TranscriptLine } from './store';

export interface GuidanceSink {
  /** One utterance. Called in order, once each. */
  say(line: TranscriptLine): void;
  /** The routine stopped (Stop, or the panel closed): drop anything not yet rendered,
   *  and silence anything in flight. Optional — the written channel has nothing to drop. */
  stop?(): void;
}

const sinks = new Set<GuidanceSink>();

/** Register a sink. Returns the unregister. */
export function addGuidanceSink(sink: GuidanceSink): () => void {
  sinks.add(sink);
  return () => {
    sinks.delete(sink);
  };
}

/** Fan a line out to every sink (the store calls this). A throwing sink is isolated. */
export function emitGuidance(line: TranscriptLine): void {
  for (const s of sinks) {
    try {
      s.say(line);
    } catch {
      // A sink's failure (a blocked autoplay, say) must never stop the routine.
    }
  }
}

/** The routine stopped: tell every sink (a throwing sink is isolated). */
export function emitGuidanceStop(): void {
  for (const s of sinks) {
    try {
      s.stop?.();
    } catch {
      // see emitGuidance
    }
  }
}

/** For tests. */
export function resetGuidanceSinks(): void {
  sinks.clear();
}
