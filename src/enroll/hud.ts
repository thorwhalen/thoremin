/**
 * The trainer HUD snapshot (#163 §5) — what the overlay draws ON THE VIDEO while a
 * routine runs.
 *
 * The player is looking at the camera, not at a panel in the corner. The written
 * guidance therefore has to live where they are looking: the instruction, large,
 * across the bottom of the frame; the latest nudge beneath it; a coverage bar that
 * fills as the cue gets what it needs. This is the written channel of the same `say`
 * strings the runner emits — voice (PR 3) is a toggle layered on the same strings.
 *
 * The type lives in the pure library so the overlay NODE can depend on it without
 * reaching into the app (nodes never import `src/app`). The app produces it from the
 * trainer store (`src/app/enroll/hud.ts`) and installs a reader on the engine's
 * resources, the same seam shape as the tag HUD (`ctx.resources.tagOverlay`).
 */

export interface TrainerHudSnapshot {
  /** `'running'`: the instruction is up. `'between'`: the beat after a cue ended. */
  status: 'running' | 'between';
  /** Short name of the active (or next) cue. */
  cueName: string;
  /** Position in the routine, 1-based, and the routine's length. */
  index: number;
  total: number;
  /** The large line: the instruction while running; the end phrase during the beat. */
  say: string;
  /** The latest guidance ("a bit further, if you can"), or null. */
  guidance: string | null;
  /** 0..1 — how much of the cue's own minimum has been captured. */
  coverage: number;
}

/** Wrap `text` into lines of at most `maxChars`, on spaces; never splits a word. */
export function wrapLines(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const next = current ? `${current} ${w}` : w;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = w;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}
