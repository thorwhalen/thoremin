/**
 * Trainer annotations (#163 §6) — the runner's events as tags in the EXISTING
 * annotation stream, so a training take's `annotations.jsonl` reads like any other
 * (#92): one interval per cue (open at `cue-start`, closed at `cue-end`), a point per
 * verdict and per nudge. The exporters (Audacity labels, WebVTT, CSV) then come free,
 * and a feature-vector row in `features.jsonl` can be joined to the cue that was
 * active when it was recorded.
 *
 * Implemented as a {@link TagStreamSource} — the seam the `SessionRecorder` already
 * asks three things of (is annotating active; begin on the shared `t0`; end and hand
 * back the JSONL) — over taglog's own state machine and sink, with `src: 'auto'`
 * (the provenance taglog reserves for programmatic events). No parallel format.
 *
 * Clocks: a `RunnerEvent.t` is the tap's stamp in MILLISECONDS on the engine clock;
 * the recorder's `t0` is the same clock in seconds. Divide by 1000, subtract nothing —
 * the anchor carries `t0` and every consumer applies the offset itself (§5 of the
 * taglog design).
 */
import type { Cue, RunnerEvent } from '@/enroll';
import { TagEventSink } from '@/taglog/provider/sink';
import { applyToggle, closeAll } from '@/taglog/affordances/toggle';
import {
  ANNOTATIONS_SCHEMA_ID,
  DEFAULT_TAGGING_CONFIG,
  emptyTagState,
  type TagDef,
  type TagState,
  type TaggingConfig,
} from '@/taglog/affordances/schema';
import type { TagStreamSource, TagTakeMeta } from '../recording/tagStream';

/** Tag ids the trainer writes, so a consumer can find them without guessing. */
export const TRAINER_TAGS = {
  /** An interval per cue: `cue:<cueId>`. */
  cue: (cueId: string) => `cue:${cueId}`,
  /** A point per outcome: `verdict:enough` / `verdict:cannot` / `verdict:skipped`. */
  verdict: (outcome: string) => `verdict:${outcome}`,
  /** A point per spoken nudge. */
  guidance: 'guidance',
} as const;

const CUE_COLOR: Record<Cue['produces'], string> = {
  baseline: '#94a3b8',
  nuisance: '#f59e0b',
  vocabulary: '#34d399',
};

/** The tag set a routine's take is annotated with. */
export function trainerTagDefs(cues: readonly Cue[]): TagDef[] {
  const defs: TagDef[] = cues.map((c, i) => ({
    id: TRAINER_TAGS.cue(c.id),
    label: c.name,
    number: null,
    kind: 'interval',
    leadIn: 0,
    group: null,
    color: CUE_COLOR[c.produces],
    order: i,
  }));
  let order = cues.length;
  for (const outcome of ['enough', 'cannot', 'skipped']) {
    defs.push({ id: TRAINER_TAGS.verdict(outcome), label: outcome, number: null, kind: 'point', leadIn: 0, group: null, color: outcome === 'enough' ? '#34d399' : outcome === 'cannot' ? '#f87171' : '#a1a1aa', order: order++ });
  }
  defs.push({ id: TRAINER_TAGS.guidance, label: 'guidance', number: null, kind: 'point', leadIn: 0, group: null, color: '#67e8f9', order: order++ });
  return defs;
}

export interface TrainerTagSource extends TagStreamSource {
  /** Feed a runner event (the store subscribes this to the runner). */
  onEvent(e: RunnerEvent): void;
  /** True between `beginTake` and `endTake`. */
  inTake(): boolean;
}

export interface TrainerTagSourceOptions {
  /** Whether a take should write annotations at all (the trainer's "record" pref). */
  active: () => boolean;
  /** The cues of the routine being recorded (for the tag set). */
  cues: () => readonly Cue[];
  config?: TaggingConfig;
}

export function createTrainerTagSource(options: TrainerTagSourceOptions): TrainerTagSource {
  const config = options.config ?? DEFAULT_TAGGING_CONFIG;
  let sink: TagEventSink | null = null;
  let defs: TagDef[] = [];
  let state: TagState = emptyTagState();
  /** The take's origin in seconds (the anchor's t). Events before it are clamped to it,
   *  so the stream's own `t >= t0` invariant holds even if the first cue-start's tap
   *  stamp is one ~30 ms poll older than the recorder's t0. */
  let t0 = 0;

  const apply = (tagId: string, tSeconds: number) => {
    if (!sink) return;
    const r = applyToggle(state, defs, { tagId, t: tSeconds, src: 'auto' }, config);
    state = r.state;
    sink.append(r.edges);
  };

  return {
    active: () => options.active(),
    beginTake(meta: TagTakeMeta) {
      sink = new TagEventSink(config.codec);
      defs = trainerTagDefs(options.cues());
      state = emptyTagState();
      t0 = meta.t0;
      sink.writeAnchor({
        anchor: true,
        t: meta.t0,
        clock: config.clock,
        wallClockISO: meta.startedAt,
        recStartPerf: meta.t0 * 1000,
        session: meta.session,
        schema: ANNOTATIONS_SCHEMA_ID,
      });
    },
    endTake(endT) {
      if (!sink) return '';
      const r = closeAll(state, defs, endT, config, 'auto');
      state = r.state;
      sink.append(r.edges);
      const out = sink.drain();
      sink = null;
      return out;
    },
    onEvent(e) {
      if (!sink) return;
      const t = Math.max(t0, e.t / 1000);
      switch (e.type) {
        case 'cue-start':
          apply(TRAINER_TAGS.cue(e.cue.id), t);
          break;
        case 'guidance':
          apply(TRAINER_TAGS.guidance, t);
          break;
        case 'cue-end':
          apply(TRAINER_TAGS.verdict(e.outcome), t);
          apply(TRAINER_TAGS.cue(e.cue.id), t); // closes the interval (a second toggle)
          break;
        case 'done':
        case 'stopped': {
          // The recorder's endTake also closeAll's, so this is a belt-and-braces close
          // for a standalone source (a test, a future non-recorder consumer): idempotent
          // because closeAll over an already-closed state emits nothing.
          const r = closeAll(state, defs, t, config, 'auto');
          state = r.state;
          sink.append(r.edges);
          break;
        }
      }
    },
    inTake: () => sink !== null,
  };
}
