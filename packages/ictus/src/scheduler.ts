/**
 * The pending-event scheduler (#187 PR 5; research map §6.3 part 2 and §7.3): a score's
 * notes, in beats, become note-on / note-off commands with times, committed a short
 * horizon ahead of a follower's musical time.
 *
 * Why commit late and never move. A follower publishes where the music is (`beat`) and
 * how fast it is going (`bpm`), and both change with every stroke. A note at beat `B` is
 * predicted to sound at `T = now + (B - beat) / (bpm / 60)`, recomputed every tick; it
 * is committed to the synth only once `T` falls inside `now + horizon`, where the
 * horizon is the output stage plus a couple of frames (the smallest look-ahead that
 * still lets the synth start it on time). From then on it is the synth's: a committed
 * start is never moved or retracted (a Web Audio or worklet event cannot be moved
 * without being heard), so the tempo's late changes land on the notes not yet committed.
 * Waiting for the ictus before sounding the beat would always be late (the CACM survey
 * [143]); predicting it is what the follower is for.
 *
 * The rules, each pinned by a test:
 *
 *  - **Held is held.** `bpm` 0 (the follower is waiting for its first stroke, holding,
 *    or stopped on a fermata) commits nothing ahead of `beat`, and releases nothing that
 *    is still sounding: a fermata note sustains until the beat moves on.
 *  - **Due now plays now; passed is skipped.** A note whose onset the beat has already
 *    reached (a forward jump, a fermata note at the stop) starts at `now` if any of it
 *    is still ahead; a note entirely behind the beat is skipped, never played late as a
 *    ghost of a passage the conductor has left.
 *  - **One voice per key and channel.** Two parts on one channel playing the same key
 *    (first and second violins in unison) are one voice that ends with the later of the
 *    two; a key struck again while it sounds is released a hair (`retriggerGap`) before
 *    the new onset. So on and off strictly alternate per key, and no note-off ever cuts
 *    a note it did not start.
 *  - **A rewind releases everything.** A beat that goes backwards (the conductor
 *    re-enabled from the top) releases every sounding voice at `now` and re-positions.
 *  - **An announced wrap is not a rewind** (#508). A looped piece's follower says where its
 *    beat will jump (`wrap`: from `at` back to `to`, keeping the overshoot). Once that
 *    jump is predicted inside the horizon, the next pass's first notes are committed
 *    ahead at their predicted times like any other, and when the beat does jump (by the
 *    amount announced, as the tempo predicts) nothing is released or re-positioned: the
 *    voices already sounding and the notes already committed carry across.
 *  - **Releases are lazy.** A note-off is committed by the same horizon rule as an
 *    onset, so the tempo keeps shaping a held note's length until just before it ends.
 *
 * Articulation reaches the scheduler as `durationScale` (0..1], applied to a note when
 * its onset is committed: a staccato conductor shortens what is about to start, never
 * what is already sounding.
 *
 * Times are in whatever seconds `now` is in: the caller maps them to its output clock
 * (thoremin's `orchestra` node maps engine time to `AudioContext` time through the one
 * clock map, `packages/sdk/src/timing/clock_map.ts`). Pure and causal: no clock, no
 * audio, no DOM.
 */

/** One note of the score, in beats. */
export interface ScoreEvent {
  /** MIDI key. */
  key: number;
  /** The synth channel it plays on. */
  channel: number;
  /** Onset, beats from the start of the piece. */
  start: number;
  /** Length in beats. */
  duration: number;
  /** 0..1. */
  velocity: number;
}

export type ScheduleCommand =
  | { type: 'noteOn'; channel: number; key: number; velocity: number; time: number }
  | { type: 'noteOff'; channel: number; key: number; time: number };

/** One tick of the follower, as the scheduler reads it. */
export interface ScheduleTick {
  /** Seconds, in the caller's time domain: the time at which `beat` is heard. */
  now: number;
  /** The musical position heard at `now`, beats. */
  beat: number;
  /** The tempo the beat advances at; 0 = held (nothing ahead is committed). */
  bpm: number;
  /** Commit what is predicted before `now + horizon`, seconds. */
  horizon: number;
  /** Articulation: the fraction of its written length a note starting now is held for,
   *  (0, 1]. Default 1. */
  durationScale?: number;
  /** The beat's next jump (a looped piece, #508): it goes from `at` to `to` when it gets
   *  there at this tempo. Absent: none expected. */
  wrap?: { at: number; to: number };
}

export interface SchedulerOptions {
  /** Repeat the events every this many beats (0 = play once). Every event's onset must
   *  then be below it: `createScheduler` throws a `RangeError` otherwise. */
  loopBeats?: number;
  /** A key struck again while it sounds is released this long before the new onset,
   *  seconds. */
  retriggerGap?: number;
  /** The shortest note the scheduler sends (a release never lands closer than this to
   *  its own onset), seconds. */
  minNoteSeconds?: number;
}

export interface Scheduler {
  /** Advance to this tick; returns the commands that became due, sorted by time (a
   *  release before an onset at the same time). */
  tick(t: ScheduleTick): ScheduleCommand[];
  /** Release every sounding voice at `now` and forget the position (the caller stopped). */
  stop(now: number): ScheduleCommand[];
  /** Voices started and not yet released. */
  readonly sounding: number;
  /** Notes skipped because the beat had passed them entirely. */
  readonly skipped: number;
}

export const SCHEDULER_DEFAULTS = { loopBeats: 0, retriggerGap: 0.005, minNoteSeconds: 0.02 } as const;

/** How far the beat may have advanced past what the tempo predicts for a jump to still be
 *  the announced wrap (a late tick), as a factor and as a floor in beats. */
const WRAP_STEP_SLACK = 1.5;
const WRAP_STEP_BEATS = 0.05;

/** Two onsets closer than this (beats) are one unison. */
const UNISON_BEATS = 1e-6;

interface Voice {
  channel: number;
  key: number;
  /** When its onset was sent (caller's seconds). */
  onTime: number;
  /** Beat of its latest onset (for the unison test). */
  lastOnset: number;
  /** Where it ends, beats (the later of the notes it covers). */
  endBeat: number;
}

export function createScheduler(events: readonly ScoreEvent[], options: SchedulerOptions = {}): Scheduler {
  const o = { ...SCHEDULER_DEFAULTS, ...options };
  const notes = [...events].sort((a, b) => a.start - b.start || a.channel - b.channel || a.key - b.key);
  const n = notes.length;
  const loop = o.loopBeats > 0 ? o.loopBeats : 0;
  // An onset at or past the loop would sort before the next pass's first notes in the
  // looped sequence, break its monotone order, and count that pass's notes as skipped
  // without a trace (#393). It is a contract violation by the caller, so say so.
  if (loop) {
    const past = notes.find((e) => !(e.start < loop));
    if (past) throw new RangeError(`createScheduler: an event starts at beat ${past.start}, not below loopBeats ${loop}`);
  }
  let maxDuration = 0;
  for (const e of notes) maxDuration = Math.max(maxDuration, e.duration);

  /** Index into the (possibly looped) event sequence of the next event to consider. */
  let next = 0;
  let lastBeat = -Infinity;
  let lastNow = -Infinity;
  let lastBpm = 0;
  /** The announced wrap, as of the last tick, and how many of the next pass's notes (from
   *  `aheadBase` in the sequence) were committed ahead of it (#508). */
  let announced: { at: number; to: number; length: number } | null = null;
  let aheadBase = 0;
  let ahead = 0;
  let skipped = 0;
  const voices = new Map<string, Voice>();
  /** When each key's last release was sent: an onset never lands on or before it. */
  const lastOff = new Map<string, number>();
  const keyOf = (channel: number, key: number) => `${channel}:${key}`;

  /** The `i`th event of the sequence (looped when `loop` > 0), with its absolute onset. */
  const eventAt = (i: number): { e: ScoreEvent; start: number } | null => {
    if (n === 0) return null;
    if (!loop) return i < n ? { e: notes[i], start: notes[i].start } : null;
    const pass = Math.floor(i / n);
    const e = notes[i % n];
    return { e, start: e.start + pass * loop };
  };

  /** First index whose onset is >= `beat`. */
  const lowerBound = (beat: number): number => {
    if (n === 0) return 0;
    let base = 0;
    let local = beat;
    if (loop) {
      const pass = Math.max(0, Math.floor(beat / loop));
      base = pass * n;
      local = beat - pass * loop;
    }
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (notes[mid].start < local) lo = mid + 1;
      else hi = mid;
    }
    return base + lo;
  };

  const release = (v: Voice, time: number, out: ScheduleCommand[]): void => {
    out.push({ type: 'noteOff', channel: v.channel, key: v.key, time });
    lastOff.set(keyOf(v.channel, v.key), time);
    voices.delete(keyOf(v.channel, v.key));
  };
  const releaseAll = (now: number, out: ScheduleCommand[]): void => {
    for (const v of [...voices.values()]) release(v, Math.max(now, v.onTime), out);
  };

  const sortCommands = (out: ScheduleCommand[]): ScheduleCommand[] =>
    out
      .map((c, i) => ({ c, i }))
      .sort((a, b) => a.c.time - b.c.time || (a.c.type === b.c.type ? a.i - b.i : a.c.type === 'noteOff' ? -1 : 1))
      .map((x) => x.c);

  return {
    tick({ now, beat, bpm, horizon, durationScale = 1, wrap }) {
      const out: ScheduleCommand[] = [];
      // A non-finite clock would never satisfy the not-yet-due test below, so a looped
      // score would emit onsets forever (NaN, or an infinite tempo making every onset due
      // now) or throw (±Infinity): do nothing instead. A NaN tempo reads as held.
      if (!Number.isFinite(now) || !Number.isFinite(beat) || !Number.isFinite(horizon) || bpm === Infinity) return out;
      const scale = durationScale > 0 && durationScale <= 1 ? durationScale : 1;
      const secPerBeat = bpm > 0 ? 60 / bpm : Infinity;
      /** Predicted time of beat `b`, or Infinity while held and `b` is ahead. */
      const timeOf = (b: number): number => (b <= beat ? now : now + (b - beat) * secPerBeat);

      /** Send one onset (and the release it forces), at its predicted time. */
      const commit = (e: ScoreEvent, start: number, end: number): void => {
        const k = keyOf(e.channel, e.key);
        // Never on or before this key's last release: a tempo that sped up between the
        // tick that committed the release and this one must not let the release cut the
        // new note (a few milliseconds late beats a note that never sounds).
        const t = Math.max(now, timeOf(start), (lastOff.get(k) ?? -Infinity) + o.retriggerGap);
        const v = voices.get(k);
        if (v && Math.abs(start - v.lastOnset) <= UNISON_BEATS) {
          v.endBeat = Math.max(v.endBeat, end); // unison: one voice, the longer note
          return;
        }
        let tOn = t;
        if (v) {
          // Struck again while sounding: release a hair before the new onset.
          const tOff = Math.max(v.onTime + o.minNoteSeconds, t - o.retriggerGap);
          release(v, tOff, out);
          tOn = Math.max(t, tOff + o.retriggerGap);
        }
        out.push({ type: 'noteOn', channel: e.channel, key: e.key, velocity: e.velocity, time: tOn });
        voices.set(k, { channel: e.channel, key: e.key, onTime: tOn, lastOnset: start, endBeat: Math.max(end, start) });
      };

      // A rewind: release everything, then re-position (notes already under way at the
      // new beat are picked up by the due-now rule below).
      // An announced wrap that came true: the beat moved on as the tempo predicts, into the
      // next pass (#508). Nothing is released; the voices and the notes committed ahead
      // are re-expressed in the new pass's beats.
      const wrapped =
        announced !== null &&
        beat < lastBeat - 1e-9 &&
        beat >= announced.to - 1e-9 &&
        beat + announced.length - lastBeat >= -1e-9 &&
        beat + announced.length - lastBeat <= Math.max(0, now - lastNow) * (lastBpm / 60) * WRAP_STEP_SLACK + WRAP_STEP_BEATS;
      if (wrapped && announced) {
        for (const v of voices.values()) {
          v.endBeat -= announced.length;
          v.lastOnset -= announced.length;
        }
        next = aheadBase + ahead;
        ahead = 0;
        announced = null;
      } else if (beat < lastBeat - 1e-9) {
        releaseAll(now, out);
        next = lowerBound(beat - maxDuration);
        announced = null;
        ahead = 0;
      } else if (lastBeat === -Infinity) {
        next = lowerBound(beat - maxDuration);
      }
      lastBeat = beat;
      lastNow = now;
      lastBpm = bpm;

      // 1. Releases due within the horizon (before onsets, so a retrigger sees the voice
      //    it replaces only if it is still sounding).
      for (const v of [...voices.values()]) {
        const tEnd = timeOf(v.endBeat);
        if (tEnd < now + horizon) release(v, Math.max(tEnd, v.onTime + o.minNoteSeconds), out);
      }

      // 2. Onsets due within the horizon.
      for (;;) {
        const at = eventAt(next);
        if (!at) break;
        const { e, start } = at;
        const end = start + e.duration * scale;
        if (start > beat && !(timeOf(start) < now + horizon)) break; // not yet due (or held)
        next++;
        // Entirely behind the beat: skipped. A zero-length note (a grace note) is behind
        // once the beat is past its onset; exactly on the beat it still plays.
        if (end <= beat && (e.duration > 0 || start < beat)) {
          skipped++;
          continue;
        }
        commit(e, start, end);
      }

      // 3. A wrap announced by the follower (#508): once it falls inside the horizon, the
      //    next pass's first notes are committed ahead, at the times the jump predicts.
      const length = wrap && !loop ? wrap.at - wrap.to : 0;
      if (wrap && length > 0 && Number.isFinite(length) && bpm > 0) {
        if (!announced || announced.at !== wrap.at || announced.to !== wrap.to) {
          announced = { at: wrap.at, to: wrap.to, length };
          aheadBase = lowerBound(wrap.to);
          ahead = 0;
        }
        if (timeOf(wrap.at) < now + horizon) {
          for (;;) {
            const idx = aheadBase + ahead;
            if (idx >= n) break;
            const e = notes[idx];
            const start = e.start + length;
            if (!(timeOf(start) < now + horizon)) break;
            ahead++;
            commit(e, start, start + e.duration * scale);
          }
        }
      } else if (!wrap) {
        // The follower no longer expects a wrap (held, stopped): what was committed ahead
        // stays committed (never retracted), and the announcement is dropped.
        announced = null;
        ahead = 0;
      }
      return sortCommands(out);
    },
    stop(now) {
      const out: ScheduleCommand[] = [];
      releaseAll(now, out);
      lastBeat = -Infinity;
      lastNow = -Infinity;
      announced = null;
      ahead = 0;
      next = 0;
      return out;
    },
    get sounding() {
      return voices.size;
    },
    get skipped() {
      return skipped;
    },
  };
}
