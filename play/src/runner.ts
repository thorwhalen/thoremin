/**
 * The standalone game loop: what thoremin's game node does inside the graph, done in a plain
 * animation loop on a page of its own. Each tick it drains the page's audio lease, moves each
 * event from its context frame to the context clock minus the input stage (the same arithmetic
 * as the `audio-events` node, with the context clock as the game's clock), feeds the session,
 * hands the cues to the page's synth and returns the view for the stage.
 *
 * DOM-free and clock-free (every browser piece is a dependency), so a test runs a whole game with
 * a scripted lease.
 */
import { heardAtContextTime, type InputStage } from '@thoremin/sdk/timing/input_stage';
import type { LeaseEvent } from '@thoremin/sdk-ui/audio/hub';
import { heardFrom, micNotice, type Heard, type TimedAudioEvent } from '@thoremin/games/listen';
import type { Cue } from '@thoremin/games/cues';
import type { GameView } from '@thoremin/games/view';

/** A game session, as `@thoremin/games` makes them. */
export interface Session {
  tick(now: number, heard: Heard): { view: GameView; cues: Cue[] };
}

export interface RunnerDeps {
  /** This page's lease on the audio-input hub. */
  drain(): LeaseEvent[];
  /** The context clock, seconds (null before the context exists). */
  now(): number | null;
  sampleRate(): number;
  inputStage(): InputStage;
  /** The hub's state (`live`, `denied`, ...), shown over the stage while it is not live. */
  micState(): string;
  /** Play a cue at its context time. */
  play(cue: Cue): void;
}

/** One tick: the view to draw, or null before the context exists. */
export function createRunner(session: Session, deps: RunnerDeps): { tick(): GameView | null } {
  return {
    tick() {
      const now = deps.now();
      if (now === null) return null;
      const sr = deps.sampleRate();
      const stage = deps.inputStage();
      const events: TimedAudioEvent[] = deps.drain().map(({ source, event }) => ({ ...event, source, t: heardAtContextTime(event.frame, sr, stage) }));
      const { view, cues } = session.tick(now, heardFrom(events));
      for (const c of cues) deps.play(c);
      const notice = micNotice(deps.micState());
      return notice ? { ...view, notice } : view;
    },
  };
}
