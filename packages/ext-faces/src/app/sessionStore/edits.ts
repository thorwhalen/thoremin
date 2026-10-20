/**
 * The face session's edits of the working categorizer (#385 E4), each one undo step: the
 * strangers, hand, mirror and vocabulary, k, names, moves, merges, splits, undo and redo, and
 * the live corrections (P3). A concern of `createFaceSessionStore` (#746).
 */
import { setStrangers as setStrangersOf, mirrorOffable, mirrorOn, mirrorOff, setNeutralTrained, setRadiusFrom as setRadiusFromOf, recut, anchorNames, nameCategory, NEW_CATEGORY, moveHolds as moveHoldsIn, deleteHolds as deleteHoldsFrom, mergeCategories, splitCategory } from '@thoremin/sdk/enroll/sorting';
import { withHand } from './ops';
import type { PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { generalContextOf } from '../../lib/carving';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import { FACE_SESSION_DEFAULTS } from './state';
import { addSample, moveSample } from '../../lib/corrections';
import { holdId } from '../thumbnails';
import type { createCarve } from './carve';
import type { SessionCtx } from './locals';
import type { FaceSessionState } from './state';

/** The edits concern over the store's shared state. */
export function createEdits(ctx: SessionCtx, h: Pick<ReturnType<typeof createCarve>, 'edit' | 'recutOptions' | 'showDoc' | 'roomFor'>) {
  const { deps, freshTakeId, get, loc, modality, modalityOnly, set } = ctx;
  const { edit, recutOptions, showDoc, roomFor } = h;
  const actions: Pick<FaceSessionState, 'setStrangers' | 'setHand' | 'setMirror' | 'setVocabulary' | 'teachNeutral' | 'setRadiusFrom' | 'setK' | 'rename' | 'moveHolds' | 'deleteHolds' | 'merge' | 'split' | 'undo' | 'redo' | 'correct' | 'move'> = {
    setStrangers(strangers) {
      const { phase, working } = get();
      if (!working || (phase !== 'carved' && phase !== 'saved')) {
        if (phase === 'idle' || phase === 'empty') set({ strangers });
        return;
      }
      if (strangers === working.strangers) return;
      // Neutral is taught by example in both settings: the switch moves no hold, re-cuts nothing.
      edit((w) => setStrangersOf(w, strangers, recutOptions()));
    },
    setHand(hand) {
      const { phase, working } = get();
      if (!working || (phase !== 'carved' && phase !== 'saved')) {
        if (phase === 'idle' || phase === 'empty') set({ hand });
        return;
      }
      if (hand === (working.hand ?? 'either')) return;
      edit((w) => ({ ok: true, categorizer: withHand(w, hand) }));
    },
    setMirror(on) {
      const { phase, working } = get();
      if (working && (phase === 'carved' || phase === 'saved')) {
        // After the take (#459): ON is one undoable edit (every hold on one side, re-cut at the
        // suggested k); OFF too (#529), where every hold kept the side it was read on.
        if (on === (working.mirror === true) || !modality.mirrorImage || !modality.mirrorSide) return;
        if (!on && !mirrorOffable(working)) {
          set({ notice: `Not changed: some ${modality.words.many} did not keep the side they were read on (recorded before this was kept, or added from Trying), so left and right cannot be told apart again.` });
          return;
        }
        if (!get().view?.recutable) {
          set({ notice: `Not changed: ${working.samples.length} ${modality.words.many} are too many to sort again here; merge categories or delete some first.` });
          return;
        }
        const image = modality.mirrorImage;
        const side = modality.mirrorSide;
        // A name carries when it is the player's, and never a default name of the side it leaves
        // ("right arm up", the general model's without the mirror and not with it; or the
        // reverse when the mirror goes off), which a reopened categorizer cannot tell from a
        // typed one: the new side's words name that category afresh.
        const labelsOf = (c: PersonalCategorizer) => new Set((modality.general?.(generalContextOf(c))?.labels ?? []).map((l) => l.toLowerCase()));
        const { mirror: _mirror, ...unmirrored } = working;
        void _mirror;
        const mirroredLabels = labelsOf({ ...working, mirror: true });
        const plainLabels = labelsOf(unmirrored);
        const [leaving, arriving] = on ? [plainLabels, mirroredLabels] : [mirroredLabels, plainLabels];
        const stale = [...leaving].filter((l) => !arriving.has(l));
        const carry = (cat: PersonalCategorizer['categories'][number]) =>
          ['kept', 'edited'].includes(loc.sources.get(cat.id)?.source ?? 'kept') && cat.label.trim() !== '' && !stale.includes(cat.label.trim().toLowerCase());
        const tools = { image, side, skeleton: modality.skeleton ? (v: FeatureVector) => modality.skeleton!(v) : undefined };
        const turn = on ? mirrorOn : mirrorOff;
        edit((w) => turn(w, tools, { ...recutOptions(), carry, maxCategories: FACE_SESSION_DEFAULTS.maxCategories }));
        return;
      }
      if (phase !== 'idle' && phase !== 'empty') return;
      loc.chosenMirror = on;
      set({ mirror: on });
    },
    setVocabulary(vocabulary) {
      // Read when a take becomes a categorizer, so any time before that is in time.
      if (get().working) return;
      loc.chosenVocabulary = vocabulary;
      set({ vocabulary });
    },
    teachNeutral() { return edit((w) => setNeutralTrained(w, true)); },
    setRadiusFrom(from) { return edit((w) => setRadiusFromOf(w, from)); },
    setK(k) {
      const { working, view } = get();
      const want = Math.min(Math.round(k), FACE_SESSION_DEFAULTS.maxCategories);
      if (!working || !view || want === view.k) return;
      if (!view.recutable) {
        set({ notice: `Not changed: ${working.samples.length} ${modality.words.many} are too many to re-cut here; merge categories or delete some instead.` });
        return;
      }
      // A name saved before pins existed (or kept from the file) is the player's: anchored
      // first, so the re-cut keeps it (the general model's proposals are not).
      const kept = (cat: PersonalCategorizer['categories'][number]) => ['kept', 'edited'].includes(loc.sources.get(cat.id)?.source ?? 'kept') && cat.label.trim() !== '';
      const cut = () => edit((w) => recut(anchorNames(w, kept), want, recutOptions()), { k: true });
      // A pool past the suggestion's size has its forest built in the worker after each edit
      // (#499): wait for that build rather than race it onto the page, and let a later move of
      // the slider win over an earlier one still waiting.
      const wait = deps.forests && working.samples.length > FACE_SESSION_DEFAULTS.suggestUpTo ? deps.forests.whenReady(anchorNames(working, kept), recutOptions()) : null;
      if (!wait) {
        cut();
        return;
      }
      const mine = ++loc.cutToken;
      void wait.then(() => {
        if (mine === loc.cutToken && get().working === working) cut();
      });
    },
    rename(id, label) {
      const name = label.trim();
      const working = get().working;
      if (!working || !name) return;
      const same = (x: string) => x.trim().toLowerCase() === name.toLowerCase();
      const clash = working.categories.find((c) => c.id !== id && same(c.label));
      const yields = clash && !['edited', 'kept'].includes(loc.sources.get(clash.id)?.source ?? 'kept');
      if (clash && !yields) {
        set({ notice: `Another category is already called "${clash.label}".` });
        return;
      }
      // A default name the player takes yields (it is proposed again elsewhere); the player's
      // own names, and an opened categorizer's, do not.
      const cleared = yields ? { ...working, categories: working.categories.map((c) => (c.id === clash.id ? { ...c, label: '' } : c)) } : working;
      if (edit(() => nameCategory(cleared, id, name))) {
        loc.sources = new Map(loc.sources).set(id, { source: 'edited', matched: null });
        showDoc(get().working!);
      }
    },
    moveHolds(ids, to) {
      return edit((w) => (to === NEW_CATEGORY && roomFor(w)) || moveHoldsIn(w, ids, to));
    },
    deleteHolds(ids) {
      return edit((w) => deleteHoldsFrom(w, ids));
    },
    merge(from, into) {
      return edit((w) => mergeCategories(w, from, into));
    },
    split(id) {
      return edit((w) => roomFor(w) ?? splitCategory(w, id));
    },
    undo() {
      const cur = get().working;
      const prev = loc.undoStack.at(-1);
      if (!cur || !prev) return;
      loc.undoStack = loc.undoStack.slice(0, -1);
      loc.redoStack = [...loc.redoStack, { working: cur, sources: loc.sources }];
      loc.lastWasK = false;
      loc.sources = prev.sources;
      showDoc(prev.working, { dirty: true, notice: null });
    },
    redo() {
      const cur = get().working;
      const next = loc.redoStack.at(-1);
      if (!cur || !next) return;
      loc.redoStack = loc.redoStack.slice(0, -1);
      loc.undoStack = [...loc.undoStack, { working: cur, sources: loc.sources }];
      loc.lastWasK = false;
      loc.sources = next.sources;
      showDoc(next.working, { dirty: true, notice: null });
    },
    correct(id, vector) {
      const working = get().working;
      if (get().phase !== 'saved' || !working) return false;
      return edit((w) => addSample(w, id, modalityOnly(vector), { sampleId: holdId(freshTakeId(w.samples), 0), t: deps.now(), modality }));
    },
    move(index, to) {
      return edit((w) => moveSample(w, index, to));
    },
  };
  return { actions };
}
