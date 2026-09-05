/**
 * The Applier (#101 M-D) — applies an {@link Engine} to a set of {@link Source}s under
 * a {@link Clock}.
 *
 * The DAG is *the computation*. **Applying** it to a stream is a separate concern with
 * three independent choices: where the data comes from (the sources), when the engine
 * advances (the clock), and what happens to the outputs (taps for recording, sinks for
 * view/hear). `runHeadless` (batch) and the live loop (paced) differ on **{clock, sinks,
 * taps} jointly** — not "only the clock" — which is why one object owns all three.
 *
 * SSOT: `docs/design/stream-applier.md`. This module implements the `Source` and
 * `Applier` shapes defined there, with two deliberate departures, both recorded below.
 *
 * ## It takes a live Engine, not a spec+registry
 *
 * The design's sketch has the Applier construct the engine. The lifecycle section added
 * later supersedes that: *"M-D's Applier owns which graph and which clock; it does not
 * need to own engine construction. `useEngine` and `runHeadless` can both hand it a live
 * engine."* Taking an engine is what keeps this refactor byte-identical — `runHeadless`
 * keeps its own `validatePorts` default and its own tap wiring, and the live hook keeps
 * its browser resources and its `applyGraph` lifecycle. An Applier that built engines
 * would have to reproduce both, exactly, forever.
 *
 * ## The tick is forwarded verbatim, including `undefined`
 *
 * `BatchClock` calls `onTick()` with **no argument** so the engine synthesizes
 * `tickIndex * nominalDt`; every committed fixture was recorded that way. `Engine.tick`
 * reads `time ?? tickIndex * nominalDt`, so forwarding the optional parameter is exactly
 * equivalent to omitting it. What is **not** equivalent — and is the trap this module
 * exists to avoid — is `src/app/engineLoop.ts`'s `const seconds = t ?? now()`, which
 * substitutes the *wall clock* when the clock passes nothing. That is right for the live
 * loop (its reporters need a real millisecond stamp) and would silently move every batch
 * run's time base. `test/applier_byte_identity.test.ts` is the gate on it.
 */
import type { Engine } from './engine';
import type { Clock } from './clock';
import type { Tap } from './types';

/** What a source's generator is handed when the Applier starts pumping it. */
export interface SourceContext {
  /** Aborted when the Applier is disposed, so a live generator can stop cleanly. */
  readonly signal: AbortSignal;
}

/**
 * A stream of frames, origin-independent (design R1). A live camera, a video file, a
 * recorded NDJSON replay and a pure generator are the same interface; the origin lives
 * entirely inside `frames()`.
 *
 * `kind` decides how the Applier samples it between ticks:
 * - **`signal`** (hand landmarks, video frames) — the newest frame wins; intermediate
 *   frames are dropped, because a stale pose is worse than no pose.
 * - **`event`** (keyboard, MIDI) — every frame since the last tick accumulates into a
 *   list, because dropping a keypress loses information a later frame cannot recover.
 */
export interface Source<Frame = unknown> {
  readonly id: string;
  readonly kind: 'signal' | 'event';
  /** The `ctx.resources` key the in-graph node reads (e.g. 'video', 'hands'). */
  readonly outputResource: string;
  /** The origin. An `async function*` yielding frames at its own rate. */
  frames(ctx: SourceContext): AsyncIterable<Frame>;
  /** EOF: the video ended, the records drained. Polled as a stop condition. */
  exhausted(): boolean;
  dispose(): void;
}

export interface ApplierOptions {
  engine: Engine;
  clock: Clock;
  /**
   * The SAME object the engine was constructed with (`EngineOptions.resources`). The
   * pump writes latched/accumulated frames into it in place; the engine hands that
   * object to every node as `ctx.resources` on every tick, so nodes see updates without
   * any engine API for it. This mirrors what `useEngine` already does with its
   * `resourcesRef`. Omit when there are no sources.
   */
  resources?: Record<string, unknown>;
  /** Open-closed over origin (R4). Empty is normal: a graph whose sources are ordinary
   *  zero-input nodes (replay/synthetic) needs none. */
  sources?: readonly Source[];
  /** Extra stop conditions, OR-ed with source exhaustion and `dispose()`. */
  shouldStop?: () => boolean;
  /** Called after each successful tick — the paced path's view/hear fan-out. */
  sinks?: readonly ((time: number | undefined) => void)[];
  /** Where a tick error is reported. Default: rethrow (batch must fail loudly). */
  onError?: (err: unknown) => void;
}

/**
 * Applies an engine to its sources under a clock. Construct, `run()`, then `dispose()`.
 *
 * With no sources this is exactly "drive the engine from the clock", which is what makes
 * `runHeadless` a config of it rather than a rewrite.
 */
export class Applier {
  private readonly engine: Engine;
  private readonly clock: Clock;
  private readonly resources: Record<string, unknown>;
  private readonly sources: readonly Source[];
  private readonly sinks: readonly ((time: number | undefined) => void)[];
  private readonly extraStop?: () => boolean;
  private readonly onError?: (err: unknown) => void;
  private readonly abort = new AbortController();
  /** Per-source accumulated frames, drained into `resources` at each tick. */
  private readonly pending = new Map<string, unknown[]>();
  private readonly pumps: Promise<void>[] = [];
  private stopped = false;
  private disposed = false;
  private started = false;
  private readonly resourcesGiven: boolean;
  /** Detach functions for taps attached through {@link addTap}, released on dispose. */
  private readonly tapDetachers: (() => void)[] = [];
  /** First error from a source, a tick or a sink. Raised by `run()` once the loop has
   *  ended, so no failure escapes a frame callback and none is silent. */
  private runError: unknown;

  constructor(o: ApplierOptions) {
    this.engine = o.engine;
    this.clock = o.clock;
    this.resources = o.resources ?? {};
    this.resourcesGiven = o.resources !== undefined;
    this.sources = o.sources ?? [];
    this.sinks = o.sinks ?? [];
    this.extraStop = o.shouldStop;
    this.onError = o.onError;
  }

  /**
   * Attach a tap for the lifetime of this run. Returns the detach function.
   *
   * The Applier takes a **live, caller-owned** engine that outlives it — across
   * `applyGraph` swaps and StrictMode remounts — so a tap attached here and never
   * detached would keep receiving values from every later run. `dispose()` releases
   * every tap attached through this method, which is what makes "for the lifetime of
   * this run" true rather than aspirational.
   */
  addTap(tap: Tap): () => void {
    const detach = this.engine.addTap(tap);
    this.tapDetachers.push(detach);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      detach();
    };
  }

  /**
   * Drive the sources and the clock until the clock finishes, every source is exhausted,
   * `shouldStop()` returns true, or `dispose()` is called.
   *
   * **Stopping is one tick coarse, by design.** Both shipped clocks poll `shouldStop`
   * *before* each tick, never after, so a source that drains mid-tick ends the run at
   * the top of the next iteration. That is the existing `BatchClock` semantics and the
   * `ticks: N` → "exactly N samples" contract depends on it, so exhaustion must not be
   * able to cut a run short when there are no sources — hence `sourcesExhausted()`
   * returns false for an empty set rather than the vacuous truth of `every()`.
   */
  async run(): Promise<void> {
    // A second run() would start a second iterator per source (two consumers of one
    // camera), replace the pending buffers under the live pumps, and tick one engine
    // from two clock loops. A React effect under StrictMode is enough to reach it.
    if (this.started) throw new Error('Applier: run() called twice — construct a new Applier per run.');
    this.started = true;
    if (this.sources.length > 0 && this.resourcesGiven === false) {
      // The same failure the paced check exists to prevent, reached a different way:
      // the pump would publish every latched frame into a private object no node can
      // read, and the engine's own `resources` is a DIFFERENT reference, so the graph
      // ticks on a resource nothing ever wrote. Nothing looks missing at the call site,
      // because the engine was constructed with resources of its own.
      throw new Error(
        `Applier: ${this.sources.length} source(s) given with no resources object. Pass the SAME one the ` +
          `engine was constructed with (EngineOptions.resources) — the pump writes latched frames into it ` +
          `in place, and that is the only way a node sees them.`,
      );
    }
    const ids = new Set<string>();
    for (const src of this.sources) {
      // `pending` is keyed by id; two sources sharing one would share a buffer, and the
      // first one's drain would blank the second's resource on every tick.
      if (ids.has(src.id)) throw new Error(`Applier: duplicate Source id "${src.id}" — ids key the frame buffers and must be unique.`);
      ids.add(src.id);
    }
    if (this.sources.length > 0 && this.clock.paced !== true) {
      // Fail here rather than at the end of a run that produced nothing. `onTick` is
      // synchronous, so an unpaced clock never gives a source's async iterator a turn:
      // the graph would tick to completion against a resource that was never written,
      // which reads as "my source did nothing" and is genuinely hard to trace back.
      throw new Error(
        `Applier: ${this.sources.length} source(s) given with an unpaced clock ` +
          `(paced=${String(this.clock.paced)}). A host-side Source is an async iterator and needs a clock ` +
          `that yields between ticks; a synchronous one starves it. For batch, replay through a ` +
          `zero-input NODE (replay-source / synthetic-hands) instead — see design invariant 4.`,
      );
    }
    this.startPumps();
    await this.clock.run(
      (time) => this.tick(time),
      () => this.stopped || this.disposed || this.extraStop?.() === true || this.sourcesExhausted(),
    );
    // Every deferred failure — a source, a tick, a sink — surfaces here rather than as
    // an unhandled rejection or an escaped frame callback. The run has already stopped;
    // this is how the caller learns why.
    if (this.runError !== undefined) throw this.runError;
  }

  /**
   * One tick: publish what the pumps collected, advance the engine, fan out to sinks.
   *
   * **Nothing may throw out of here.** A paced clock calls this from inside its frame
   * callback and schedules the next frame *after* the call returns
   * (`RealtimeClock.run`: `onTick(...)` then `this.schedule(frame)`). An exception
   * escaping would skip that scheduling, so the loop would stop AND the promise
   * `run()` is awaiting would never settle — a silent, permanent hang rather than a
   * failure. So the error is stashed and `run()` raises it once the loop has ended,
   * which is the same discipline the pump uses.
   *
   * The sinks are inside the guard for the same reason: a sink is host code (canvas,
   * audio, a React bridge), it is the most likely thing here to throw, and a lost
   * canvas context freezing the instrument forever is exactly the failure this shape
   * exists to prevent.
   */
  private tick(time?: number): void {
    const drained = this.publish();
    try {
      // Forwarded verbatim. `tick(undefined)` === `tick()` (Engine reads `time ??
      // tickIndex * nominalDt`); substituting a wall clock here is the one change that
      // would move every recorded golden. See the module docstring.
      this.engine.tick(time);
    } catch (err) {
      // The engine did not consume what publish() drained, so put it back rather than
      // dropping it. For an `event` source those frames are the only record of a
      // keypress; silently losing them on a recoverable node error is data loss.
      this.restore(drained);
      this.fail(err, { stop: false });
      return;
    }
    for (const sink of this.sinks) {
      try {
        sink(time);
      } catch (err) {
        this.fail(err, { stop: false });
      }
    }
  }

  /**
   * Route a failure, without ever letting it escape a frame callback.
   *
   * Two policies, split on whether the caller supplied `onError`:
   *
   * - **`onError` given** — the caller has said "hand me errors, keep going". The error
   *   is reported and `run()` does **not** reject. This is the live path's rule, already
   *   stated in `runEngineLoop`: *one bad frame must never stop the instrument*. A
   *   degenerate landmark or a transient audio state should cost a frame, not a session.
   * - **`onError` absent** — batch must fail loudly, so the first error is stashed and
   *   `run()` raises it. Stashed rather than thrown, because a throw here would skip the
   *   paced clock's `schedule()` and leave `run()`'s promise permanently pending.
   *
   * `stop` is separate from either: a *source* failure ends the run whatever the policy,
   * because a dead source will never produce another frame and ticking on a frozen
   * resource is indistinguishable from a hang. A *tick* or *sink* failure does not.
   */
  private fail(err: unknown, opts: { stop: boolean }): void {
    if (opts.stop) this.stopped = true;
    if (this.onError) {
      this.onError(err);
      return;
    }
    this.stopped = true;
    if (this.runError === undefined) this.runError = err;
  }

  /**
   * Move each source's collected frames into `resources` under its output key, and
   * return what was drained so a failed tick can put it back.
   */
  private publish(): Map<string, unknown[]> {
    const drained = new Map<string, unknown[]>();
    for (const src of this.sources) {
      const buf = this.pending.get(src.id);
      if (!buf || buf.length === 0) {
        // A signal source with nothing new keeps its last latched value — a held pose is
        // the correct reading of "the camera produced no new frame this tick". An event
        // source publishes an empty list, because "no keys were pressed" is information.
        if (src.kind === 'event') this.resources[src.outputResource] = [];
        continue;
      }
      this.resources[src.outputResource] = src.kind === 'signal' ? buf[buf.length - 1] : buf.slice();
      drained.set(src.id, buf.slice());
      buf.length = 0;
    }
    return drained;
  }

  /** Put drained frames back at the FRONT of their buffers, preserving arrival order,
   *  after a tick that did not consume them. */
  private restore(drained: Map<string, unknown[]>): void {
    for (const [id, frames] of drained) {
      const buf = this.pending.get(id);
      if (buf) buf.unshift(...frames);
    }
  }

  /**
   * True only when there is at least one source, all of them are exhausted, **and every
   * buffered frame has been published**.
   *
   * The second half is not pedantry. A source that finishes producing before the clock's
   * first frame — a short replay, anything already in memory — reports `exhausted()`
   * immediately, and since `shouldStop` is polled *before* each tick, a check on
   * exhaustion alone ends the run at tick zero with every frame it produced still sitting
   * in the pump's buffer. The source did its job and the graph never saw a single frame.
   */
  private sourcesExhausted(): boolean {
    if (this.sources.length === 0) return false;
    return this.sources.every((s) => s.exhausted() && (this.pending.get(s.id)?.length ?? 0) === 0);
  }

  /**
   * Start one background pump per source. The pump is deliberately NOT part of the
   * `Source` contract: it is how the Applier bridges an async iterator to a synchronous
   * `process()`, and a source that knew about it could not be a plain generator.
   */
  private startPumps(): void {
    const ctx: SourceContext = { signal: this.abort.signal };
    for (const src of this.sources) {
      this.pending.set(src.id, []);
      this.pumps.push(
        (async () => {
          try {
            for await (const frame of src.frames(ctx)) {
              if (this.disposed) break;
              this.pending.get(src.id)?.push(frame);
            }
          } catch (err) {
            // A source that dies must stop the run rather than starve it silently: an
            // engine ticking forever on a frozen last frame looks like a hang, and the
            // error that caused it would be lost.
            // Deliberately NOT rethrown. These promises are never awaited — they outlive
            // the tick loop by design — so a throw here is an UNHANDLED REJECTION, which
            // in Node is a process-level crash: a bad source would take down a whole test
            // run rather than failing its own. `fail` stashes it for `run()` to raise, so
            // the caller gets it from the `await` they already have.
            this.fail(err, { stop: true });
          }
        })(),
      );
    }
  }

  /** Stop the run at the next tick boundary and release every source. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    for (const detach of this.tapDetachers) {
      try {
        detach();
      } catch {
        // One tap failing to detach must not strand the others.
      }
    }
    this.tapDetachers.length = 0;
    for (const src of this.sources) {
      try {
        src.dispose();
      } catch {
        // One source failing to close must not strand the others.
      }
    }
  }
}
