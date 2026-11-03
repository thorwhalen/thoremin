/**
 * The face session's gestures (#754, phase 4 of `docs/design/dynamic-gestures.md`): recording a
 * named moving gesture into the ONE editable carve, and the Gestures section's edits. A concern of
 * `createFaceSessionStore` (#746).
 *
 * A gesture take is recorded FROM a working categorizer (a fresh carve or an open one) and returns
 * to it: the document, its edit history, its stills and its name are left exactly where they
 * were (nothing is reset), the phase is `gesture` meanwhile, and the repetitions join the
 * document as ONE undoable edit (`addGestureTraces`), like a merged take. Stopping early keeps
 * what was cut; cancelling (or closing the tool) keeps nothing.
 *
 * The take reads the source the way the carve does (the modality's projection, the working
 * categorizer's hand and mirror), through the GESTURE source (`deps.gestureSource`: the scripted
 * source plays a wave there), claims the modality's features and hushes the instrument (a wave at
 * the camera is not playing it), as every live phase does.
 *
 * The overlap of the new gesture with the held categories is measured once, on the take's whole
 * frames, and said in the notice (`gestureOverlapNotice`; why only then: `lib/gestureView.ts`).
 */
import { addGestureTraces, deleteGesture, dropGestureTrace, mergeGestures, renameGesture } from '@thoremin/sdk/enroll/gestures/edit';
import { modelFromCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { createReader } from '@thoremin/sdk/enroll/modality';
import { createGestureTake, GESTURE_TAKE_DEFAULTS, recordsGestures, type GestureTake } from '../../lib/gestureTake';
import { gestureOverlapNotice } from '../../lib/gestureView';
import { FACE_SESSION_DEFAULTS, type GestureTakeView } from './state';
import type { createCarve } from './carve';
import type { SessionCtx } from './locals';
import type { FaceSessionState } from './state';

/** The gesture concern over the store's shared state. */
export function createGesture(ctx: SessionCtx, h: Pick<ReturnType<typeof createCarve>, 'edit'>) {
  const { deps, get, loc, modality, set } = ctx;
  const { edit } = h;
  /** The take under way and what it returns to. */
  let run: { take: GestureTake; returnTo: 'carved' | 'saved'; into: string | null; name: string } | null = null;

  /** The view the panel shows, from the take now. */
  const viewOf = (r: NonNullable<typeof run>): GestureTakeView => {
    const step = r.take.step();
    const progress = r.take.restProgress();
    const stepped = progress === null ? null : Math.floor(progress / FACE_SESSION_DEFAULTS.restProgressStep) * FACE_SESSION_DEFAULTS.restProgressStep;
    return { name: r.name, into: r.into, step: step === 'gesture' || step === 'done' ? 'gesture' : 'rest', say: r.take.say() ?? '', restProgress: stepped, count: r.take.count(), target: r.take.target() };
  };
  const sameView = (a: GestureTakeView | null, b: GestureTakeView): boolean =>
    a !== null && a.step === b.step && a.say === b.say && a.count === b.count && a.restProgress === b.restProgress;

  /** End the take: its poll, source and claim; back to the phase it came from. */
  const end = (): NonNullable<typeof run> | null => {
    const r = run;
    loc.gestureRun?.stop();
    loc.gestureRun = null;
    if (!r) return null;
    run = null;
    r.take.stop(deps.now());
    set({ phase: r.returnTo, gesture: null });
    return r;
  };

  const begin = (name: string, into: string | null): boolean => {
    const { phase, working } = get();
    const label = name.trim();
    if (!working || (phase !== 'carved' && phase !== 'saved') || !label || !recordsGestures(modality)) return false;
    const take = createGestureTake({ modality, name: label, cueId: `${modality.words.slug}-gesture-${deps.newTakeId()}`, repetitions: GESTURE_TAKE_DEFAULTS.repetitions });
    const source = (deps.gestureSource ?? deps.source)();
    // Read as the carve reads: one hand, side-relative; a mirrored body on the side nearer its model.
    const read = createReader(modality, { hand: working.hand ?? 'either', mirror: working.mirror === true }, working.mirror ? modelFromCategorizer(working) : undefined);
    deps.claim(true);
    const timer = setInterval(() => {
      if (!run) return;
      const live = source.read();
      if (live) run.take.push(read(live.vector), live.t);
      else run.take.tick(deps.now());
      if (run.take.step() === 'done') {
        get().finishGesture();
        return;
      }
      const view = viewOf(run);
      if (!sameView(get().gesture, view)) set({ gesture: view });
    }, deps.pollMs);
    loc.gestureRun = {
      // Also what `reset` calls: the take is dropped with its poll.
      stop() {
        clearInterval(timer);
        source.dispose();
        deps.claim(false);
        run = null;
      },
    };
    run = { take, returnTo: phase, into, name: label };
    take.start(deps.now());
    set({ phase: 'gesture', gesture: viewOf(run), notice: null });
    return true;
  };

  const actions: Pick<FaceSessionState, 'recordGesture' | 'recordMoreGesture' | 'finishGesture' | 'cancelGesture' | 'renameGesture' | 'deleteGesture' | 'dropGestureTrace' | 'mergeGestures'> = {
    recordGesture(name) {
      return begin(name, null);
    },
    recordMoreGesture(id) {
      const g = get().working?.gestures?.items.find((x) => x.id === id);
      return g ? begin(g.label, g.id) : false;
    },
    finishGesture() {
      const r = end();
      if (!r) return;
      const traces = r.take.traces();
      if (traces.length === 0) {
        set({ notice: `No repetition of "${r.name}" was cut: move, then let your ${modality.words.part} come to rest, each time. Nothing was added.` });
        return;
      }
      const working = get().working!;
      const features = r.take.features();
      const weights = r.take.weights();
      const overlap = working.categories.length > 0
        ? gestureOverlapNotice(r.name, traces, { features, weights, holds: modelFromCategorizer(working), labelOf: (id) => working.categories.find((c) => c.id === id)?.label || id })
        : null;
      if (!edit((w) => addGestureTraces(w, traces, { features, weights, ...(r.into ? { into: r.into } : {}) }))) return;
      const short = traces.length < r.take.target() ? ` (${r.take.target()} were asked for; Record more adds others)` : '';
      set({ notice: `Added ${traces.length} ${traces.length === 1 ? 'repetition' : 'repetitions'} of "${r.name}"${short}.${overlap ? ` ${overlap}` : ''} Save to keep it.` });
    },
    cancelGesture() {
      if (end()) set({ notice: 'The gesture take was stopped. Nothing was added.' });
    },
    renameGesture(id, label) {
      return edit((w) => renameGesture(w, id, label));
    },
    deleteGesture(id) {
      return edit((w) => deleteGesture(w, id));
    },
    dropGestureTrace(id, traceId) {
      return edit((w) => dropGestureTrace(w, id, traceId));
    },
    mergeGestures(from, into) {
      return edit((w) => mergeGestures(w, from, into));
    },
  };
  return { actions };
}
