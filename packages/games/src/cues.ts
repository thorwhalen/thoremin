/**
 * The sounds a game makes on its own: count-in clicks and reference notes, scheduled at exact
 * engine times and handed out a little ahead, each exactly once (a scheduled sound is never
 * moved: the plucked-note sink's discipline).
 *
 * Why so few sounds: the microphone hears the loudspeaker. A click during a rhythm lesson would be
 * heard as a clap, and a guide melody as the singer; so a game plays its count-in BEFORE the first
 * target and a reference note before the player answers, and anything during play is opt-in, with
 * headphones recommended in the game's words (the research doc, section 6).
 */
export interface Cue {
  t: number;
  midi: number;
  velocity: number;
  kind: 'click' | 'reference';
}

/** A click's pitch: high and short in the plucked timbre, far above any sung note. */
export const CLICK_MIDI = 96;
export const ACCENT_VELOCITY = 0.9;
export const CLICK_VELOCITY = 0.6;

/** Clicks for a count-in, the first accented. */
export const countInCues = (times: readonly number[]): Cue[] =>
  times.map((t, i) => ({ t, midi: CLICK_MIDI, velocity: i === 0 ? ACCENT_VELOCITY : CLICK_VELOCITY, kind: 'click' }));

/** Hands out cues inside a horizon ahead of now, each once, in time order. */
export function createCueFeed(horizon: number) {
  const queue: Cue[] = [];
  return {
    add(cues: readonly Cue[]) {
      queue.push(...cues);
      queue.sort((a, b) => a.t - b.t);
    },
    /** Every queued cue due before `now + horizon`; a cue already in the past is dropped, not burst. */
    due(now: number): Cue[] {
      const out: Cue[] = [];
      while (queue.length > 0 && queue[0].t <= now + horizon) {
        const c = queue.shift()!;
        if (c.t >= now) out.push(c);
      }
      return out;
    },
  };
}
