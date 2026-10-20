/**
 * The face session's live tuning and checks, and the actions that start a take for a
 * categorizer (a merge, Record more, Show me on the bars). A concern of `createFaceSessionStore` (#746).
 */
import { clampTuning, sameTuning } from '@thoremin/sdk/enroll/live';
import { isRecording, type BarFocus } from './state';
import { fullMean } from '../../lib/carving';
import { NEUTRAL_TARGET } from '@thoremin/sdk/enroll/quality';
import type { SessionCtx } from './locals';
import type { FaceSessionState } from './state';

/** The live concern over the store's shared state. */
export function createLive(ctx: SessionCtx) {
  const { get, loc, modality, set } = ctx;
  const actions: Pick<FaceSessionState, 'setTuning' | 'setChecks' | 'startMerge' | 'recordMore' | 'showOnBars'> = {
    setTuning(tuning) {
      if (get().phase !== 'saved') return;
      const next = clampTuning({ ...get().tuning, ...tuning });
      const cur = get().tuning;
      if (sameTuning(next, cur)) return;
      set({ tuning: next, dirty: true });
    },
    setChecks(checks) {
      if (get().phase !== 'saved') return;
      set({ checks: { ...get().checks, ...checks }, dirty: true });
    },
    startMerge(seed, options = {}) {
      const { phase, working, openId, name, tuning, checks, hasStills } = get();
      // A fresh carve too (#421): the same document, so the new holds are added to it, its
      // pins kept, and its first take's rest kept for the reject radius.
      if ((phase !== 'saved' && phase !== 'carved') || !working) return;
      loc.mergeBase = { seed, phase, hasStills, working, record: loc.openRecord, openId, name: options.name ?? name, tuning, checks, dirty: get().dirty, ...(options.holdsIn ? { holdsIn: options.holdsIn } : {}), edits: { sources: loc.sources, undo: loc.undoStack, redo: loc.redoStack, baseRadius: loc.baseRadius, fresh: loc.fresh } };
      loc.pauseOnCapture = false;
      get().start();
      // After the start (which resets): the take's bursts carry this name.
      const into = options.holdsIn ? working.categories.find((c) => c.id === options.holdsIn) : undefined;
      set({ burstName: options.burstName ?? '', holdsAs: into ? into.label || into.id : null });
    },
    recordMore(id) {
      const { working, phase } = get();
      const cat = working?.categories.find((c) => c.id === id);
      if (!cat || !cat.label.trim() || (phase !== 'saved' && phase !== 'carved')) return false;
      get().startMerge('samples', { burstName: cat.label, holdsIn: cat.id });
      return isRecording(get().phase);
    },
    showOnBars(id) {
      const { working, view } = get();
      const hint = view?.hints.get(id);
      const cat = working?.categories.find((c) => c.id === id);
      if (!working || !hint || !cat) return false;
      const vectors = working.samples.map((x) => x.vector);
      const at = new Map(working.samples.map((x, i) => [x.id, i]));
      const centre = (ids: readonly string[]) => fullMean(vectors, ids.flatMap((x) => (at.has(x) ? [at.get(x)!] : [])));
      const other = hint.other === NEUTRAL_TARGET ? null : working.categories.find((c) => c.id === hint.other);
      const otherIds = other ? other.members : working.neutral;
      const otherLabel = other ? other.label || other.id : modality.words.neutral;
      const focus: BarFocus = {
        category: id,
        label: cat.label || cat.id,
        features: [...new Set(hint.movements.map((m) => m.feature))],
        marks: [
          { label: cat.label || cat.id, vector: centre(cat.members) },
          ...(otherIds.length > 0 ? [{ label: otherLabel, vector: centre(otherIds) }] : []),
        ],
      };
      if (!get().recordMore(id)) return false;
      loc.pauseOnCapture = true;
      set({ focus });
      return true;
    },
  };
  return { actions };
}
