/**
 * taglog — resolve a stream of {@link EdgeEvent}s into {@link ResolvedInterval}s
 * (the shape a segmentation / ML-training consumer cuts on).
 *
 * Pairs each `open` with the next `close` of the same tag (by `seq` order), turns a
 * `point` into a zero-length interval, and reports lead-in degeneracy and still-open
 * ("open-ended") intervals. This is the offline / read-side counterpart to the live
 * {@link applyToggle}; Allen's interval algebra belongs in the *consumer* on top of
 * this, not here (design §2). Pure — no state, no I/O.
 */
import { isDegenerate } from './leadIn';
import type { EdgeEvent, ResolvedInterval } from './schema';

export interface ResolveOptions {
  /** Media time the recording ended, used to close still-open intervals. When
   *  absent, an open-ended interval ends at its own start (flagged `openEnded`). */
  endT?: number;
}

/** Build one resolved interval from a matched open/close (or a point). Applies the
 *  lead-in-degeneracy fallback: if corrected times invert, fall back to raw. */
function resolveClosed(open: EdgeEvent, close: EdgeEvent): ResolvedInterval {
  const degenerate = isDegenerate(open.tCorrected, close.tCorrected) || close.degenerate === true;
  return {
    tag: open.tag,
    kind: 'interval',
    start: open.t,
    end: close.t,
    startCorrected: degenerate ? open.t : open.tCorrected,
    endCorrected: degenerate ? close.t : close.tCorrected,
    degenerate,
    openEnded: false,
    openSeq: open.seq,
    closeSeq: close.seq,
  };
}

/**
 * Resolve edges to intervals. Edges may arrive unsorted; we sort by `seq` (the
 * monotonic counter) so an auto-close always precedes its triggering open. Unmatched
 * opens at the end are returned `openEnded`.
 */
export function resolveIntervals(
  edges: readonly EdgeEvent[],
  options: ResolveOptions = {},
): ResolvedInterval[] {
  const sorted = [...edges].sort((a, b) => a.seq - b.seq);
  const out: ResolvedInterval[] = [];
  // Multiple opens of the same tag can stack only in non-exclusive overlapping use;
  // we match close -> the most recent still-open of that tag (LIFO), which is the
  // intuitive pairing for nested/overlapping toggles.
  const openStacks = new Map<string, EdgeEvent[]>();

  for (const e of sorted) {
    if (e.status === 'point') {
      out.push({
        tag: e.tag,
        kind: 'point',
        start: e.t,
        end: e.t,
        startCorrected: e.tCorrected,
        endCorrected: e.tCorrected,
        degenerate: false,
        openEnded: false,
        openSeq: e.seq,
      });
      continue;
    }
    if (e.status === 'open') {
      const stack = openStacks.get(e.tag) ?? [];
      stack.push(e);
      openStacks.set(e.tag, stack);
      continue;
    }
    // close: pair with the most recent open of this tag, if any (else a stray close
    // — a log that opened before the window; ignored rather than throwing).
    const stack = openStacks.get(e.tag);
    const open = stack?.pop();
    if (open) out.push(resolveClosed(open, e));
  }

  // Any opens never closed -> open-ended intervals (open at recording end). The
  // take end is an uncorrected boundary (there is no close event to shift), so it
  // can fall INSIDE the open's lead-in window — apply the same §6 degeneracy guard
  // as the closed path (fall back to raw rather than emit an inverted interval).
  for (const stack of openStacks.values()) {
    for (const open of stack) {
      const end = options.endT ?? open.t;
      const endCorrected = options.endT ?? open.tCorrected;
      const degenerate = options.endT !== undefined && isDegenerate(open.tCorrected, options.endT);
      out.push({
        tag: open.tag,
        kind: 'interval',
        start: open.t,
        end,
        startCorrected: degenerate ? open.t : open.tCorrected,
        endCorrected: degenerate ? end : endCorrected,
        degenerate,
        openEnded: true,
        openSeq: open.seq,
      });
    }
  }

  // Deterministic output order: by start time, then open seq.
  return out.sort((a, b) => a.start - b.start || a.openSeq - b.openSeq);
}
