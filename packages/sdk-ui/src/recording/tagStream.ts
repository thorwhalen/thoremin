/**
 * TagStreamSource (#92) — the seam between the multi-stream recorder and the live-
 * annotation runtime. `annotations.jsonl` is "just another stream" in the recording folder
 * (recording-v2 doc), sharing the take's `t0` and JSONL convention, so the
 * {@link SessionRecorder} treats annotating as an injected source it asks three things:
 *
 *  - is annotating active for this take? (`active`)
 *  - here is the shared `t0` — begin the take (write the anchor, reset the log)
 *  - the take ended at this media-time — hand back the `annotations.jsonl` text
 *
 * The recorder never imports the tagging store; the runtime implements this contract
 * over it. Keeping the interface here (not in `session.ts`) lets both sides depend on
 * it without a cycle.
 */

export interface TagTakeMeta {
  /** The recording anchor `t0` (engine-clock seconds) shared by every stream. */
  t0: number;
  /** Wall-clock ISO of record start (for the anchor record's human field). */
  startedAt: string;
  /** The take/session id (= recording stem), for cross-file correlation. */
  session: string;
}

/** How the take ended — see {@link TagStreamSource.endTake}. */
export interface TagTakeEnd {
  /** True when the recorder was torn down WITHOUT a clean stop (`dispose`), so no media
   *  files were written. The runtime uses this to decide whether the take is worth
   *  keeping as the exportable "last take" — an aborted, empty one must not displace the
   *  previous, cleanly-finished take. */
  abandoned?: boolean;
}

export interface TagStreamSource {
  /** True if annotation mode is on with annotations defined — this take should write an
   *  `annotations.jsonl`. Read once at record start. */
  active(): boolean;
  /** Begin a take on the shared clock: write the anchor, start a fresh event log. */
  beginTake(meta: TagTakeMeta): void;
  /** End the take at `endT` media-seconds: close still-open annotations, return the JSONL
   *  (already including the anchor). '' if nothing was captured. */
  endTake(endT: number, end?: TagTakeEnd): string;
}
