/**
 * The Trainer panel's controller (#600 S16c; the Trainer slice's since S16d): every store the
 * panel reads and every write it makes, so `TrainerPanel.tsx` only renders. The panel reads ONE
 * view (`useTrainerView`), calls named actions (`trainerActions`), and runs the open panel's
 * effects through one hook (`useTrainerSession`: load on open, the hush, the sampling poll, Enter,
 * stop on close). The host mounts the panel only while the tool is open, so mounting is opening.
 *
 * What it reaches outside the Trainer's own stores, it reaches through the SDK's app half: the
 * recording config and the take's destination (`@thoremin/sdk-ui/recording`), the recording
 * commands (`dispatchCommand`), the hush and the HUD pref (`controls()`), the voice
 * (`@thoremin/sdk-ui/enroll/voiceRuntime`) and the category binder (`categoryBinder()`: save the
 * model, the default name, the saved list). Closing and opening another tool are the host's panel
 * props.
 */
import { useEffect, useRef } from 'react';
import { categoryKey, type Category, type TrainedModel } from '@thoremin/sdk/enroll';
import { TRAINED_KIND, trainedId } from '@thoremin/sdk/enroll/record';
import { controls } from '@thoremin/sdk-ui/host';
import { clickPlayer } from '@thoremin/sdk-ui/enroll/click';
import { dispatchCommand } from '@thoremin/sdk-ui/dials';
import { categoryBinder, type CategoryBinder } from '@thoremin/sdk-ui/enroll/binder';
import { useRecordingConfig } from '@thoremin/sdk-ui/recording/config';
import { describeTakeDestination, folderPickerSupported } from '@thoremin/sdk-ui/recording/destination';
import { readLiveVector } from '@thoremin/sdk-ui/enroll/liveVector';
import { useTrainer } from './store';
import { useTrainerPrefs } from './prefs';
import { installVoice, useVoice } from '@thoremin/sdk-ui/enroll/voiceRuntime';
import { routineRecordsPerformance } from './realVsAirCues';
import { setTrainerHud, useTrainerHud } from './hud';
import { TRAINER_TOOL } from '../tool';

/** The tool id, and the id of the Trainer's hush claim (see `controls().setHush`). */
export const TRAINER_TOOL_ID = TRAINER_TOOL.id;
/** ~30 Hz: fast enough that the sampler's dwell logic sees a smooth signal, slow enough
 *  that the panel is not doing frame-rate work. */
const SAMPLE_INTERVAL_MS = 33;

/** Now, on the engine's clock (ms): the tap's stamp, or the same wall clock before the
 *  first tick. */
export const nowMs = (): number => readLiveVector()?.t ?? performance.now();

/** Everything the panel shows, read reactively. */
export function useTrainerView() {
  const routine = useTrainer((s) => s.routine);
  const status = useTrainer((s) => s.status);
  const view = {
    routine,
    routineName: useTrainer((s) => s.routineName),
    missing: useTrainer((s) => s.missing),
    status,
    index: useTrainer((s) => s.index),
    samples: useTrainer((s) => s.samples),
    coverage: useTrainer((s) => s.coverage),
    say: useTrainer((s) => s.say),
    outcomes: useTrainer((s) => s.outcomes),
    transcript: useTrainer((s) => s.transcript),
    built: useTrainer((s) => s.built),
    k: useTrainer((s) => s.k),
    suggestedK: useTrainer((s) => s.suggestedK),
    model: useTrainer((s) => s.model),
    categorySource: useTrainer((s) => s.categorySource),
    labels: useTrainer((s) => s.labels),
    lastEndSay: useTrainer((s) => s.lastEndSay),
    recording: useTrainer((s) => s.recording),
    notice: useTrainer((s) => s.notice),
    hudShow: useTrainerHud().show,
    recordTake: useTrainerPrefs((s) => s.recordTake),
    manualAdvance: useTrainerPrefs((s) => s.manualAdvance),
    voiceOn: useVoice((s) => s.enabled),
    // Where the take goes (#257): the recording location, the remembered folder and whether this
    // browser can pick one. Written only through the recording commands.
    destination: describeTakeDestination({
      location: useRecordingConfig((s) => s.session.location),
      folder: useRecordingConfig((s) => s.folder),
      supported: folderPickerSupported(),
      remembered: useRecordingConfig((s) => s.folderRemembered),
    }),
    /** The tool's data (its strapline). */
    tool: TRAINER_TOOL,
  };
  const running = status === 'running' || status === 'between';
  return {
    ...view,
    running,
    // A real-versus-air routine (#247): always recorded with the microphone, played to a
    // click, and nothing to build afterwards — the take goes to the offline pairing script.
    pairRoutine: routineRecordsPerformance(routine),
    hasVocabulary: routine.some((c) => c.produces === 'vocabulary'),
  };
}

/** Every write the panel makes. */
export const trainerActions = {
  /** Start the take; `unlockClick` (a clicked routine) lets the click's audio context start, so
   *  call it inside the gesture. */
  startTake: ({ unlockClick = false }: { unlockClick?: boolean } = {}) => {
    if (unlockClick) clickPlayer().unlock?.();
    void useTrainer.getState().startTake(nowMs);
  },
  complete: () => useTrainer.getState().complete(nowMs()),
  skip: () => useTrainer.getState().skip(nowMs()),
  stop: () => useTrainer.getState().stop(nowMs()),
  build: () => useTrainer.getState().build(),
  reset: () => useTrainer.getState().reset(),
  setK: (k: number) => useTrainer.getState().setK(k),
  setLabel: (c: Category, label: string) => useTrainer.getState().setLabel(categoryKey(c), label),
  useAutomaticCut: () => useTrainer.getState().useAutomaticCut(),
  useRoutine: (id: string | null) => void useTrainer.getState().useRoutine(id),
  project: () => useTrainer.getState().project(),
  /** Whether the take has something to carve: a routine that ended with every vocabulary cue
   *  skipped or `cannot` is "done" and still has no still-points. */
  canBuild: () => useTrainer.getState().session().ready(),
  setHudShow: (show: boolean) => setTrainerHud({ show }),
  setRecordTake: (on: boolean) => useTrainerPrefs.getState().setRecordTake(on),
  setManualAdvance: (on: boolean) => useTrainerPrefs.getState().setManualAdvance(on),
  setVoice: (on: boolean) => useVoice.getState().setEnabled(on),
  chooseFolder: () => void dispatchCommand('recording.folder.choose', {}),
  useDownloads: () => void dispatchCommand('recording.location.set', { location: 'downloads' }),
};

/** The routine chooser's reads. */
export function useRoutineChoice() {
  return {
    routineId: useTrainer((s) => s.routineId),
    routineName: useTrainer((s) => s.routineName),
    savedRoutines: useTrainer((s) => s.savedRoutines),
  };
}

/** Where a clicked cue is in its phrase. */
export const useBeat = () => useTrainer((s) => s.beat);

/** The projection section's reads. */
export function useProjection() {
  return {
    hasLayout: useTrainer((s) => s.layout.length > 0),
    groups: useTrainer((s) => s.labelGroups.length),
  };
}

/**
 * The open panel's effects (the panel is mounted only while open). Read the cue and routine stores
 * and register the spoken channel; hush the instrument while it is open; poll the live vector into
 * the runner while it runs; Enter completes the running cue; closing the panel stops a running
 * routine.
 */
export function useTrainerSession(running: boolean): void {
  // The spoken channel fetches its clip manifest lazily and says nothing until it has one.
  useEffect(() => {
    void useTrainer.getState().load();
    installVoice();
    void useRecordingConfig.getState().refreshFolder();
  }, []);

  // Hush the instrument while the panel is open: a theremin sounding under the click and
  // the spoken cues drowned both. A claim, not the player's mute, so closing the panel
  // restores exactly what was there (a player who had muted stays muted).
  useEffect(() => {
    controls().setHush(TRAINER_TOOL_ID, true);
    return () => controls().setHush(TRAINER_TOOL_ID, false);
  }, []);

  // Poll the live vector into the runner while it runs. The interval is recreated only
  // when `running` flips, so it is not restarted every render.
  const runningRef = useRef(running);
  runningRef.current = running;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      if (!runningRef.current) return;
      const live = readLiveVector();
      if (live) useTrainer.getState().sample(live.vector, live.t);
      else useTrainer.getState().tick(performance.now());
    }, SAMPLE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [running]);

  // Enter = "I've done it, move on" while a cue is running — the manual override, and
  // the only way forward in manual mode. Ignored when a form field OR another
  // interactive element is focused: a focused button (Done/Skip/Stop) already activates
  // on Enter, so handling it here too would fire complete() twice and skip a cue.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      // One advance per physical press, never per auto-repeat: holding Enter would else
      // march through every cue (each freshly begun after the beat, with ~0 samples).
      // (Same guard as src/app/tagging/keymap.ts.)
      if (e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(el.tagName) || el.isContentEditable)) return;
      if (useTrainer.getState().status === 'running') {
        e.preventDefault();
        useTrainer.getState().complete(nowMs());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Closing the panel (the X, or switching tools) must stop a running routine: otherwise
  // the poll keeps sampling and the feature-demand claim (#163) keeps the catalog
  // computing every tick, with nothing on screen to say so. Closing unmounts the panel.
  useEffect(
    () => () => {
      if (runningRef.current) useTrainer.getState().stop(nowMs());
    },
    [],
  );
}

/** The default name for a kept model: the active set's when it is a Trainer's (retraining the
 *  same vocabulary is the common case, and a re-save under its name carries its bindings over by
 *  category name); a carved categorizer's name would save a second record beside it. */
export function defaultKeepName(binder: CategoryBinder, fallback: string): string {
  const active = binder.active();
  return active && active.kind === TRAINED_KIND ? active.name : fallback;
}

/** The saved record a keep under `name` would overwrite, if any. */
export function keepReplaces(saved: readonly { id: string; name: string }[], name: string) {
  return saved.find((s) => s.id === trainedId(name));
}

/** The tool *Save and bind* opens next: the Gestures tool, where each category gets a command. */
export const BINDINGS_TOOL = 'gestures';

/** Keep the model under `name` (carrying bindings by category name), then open the bindings. */
export async function keepModel(binder: CategoryBinder, name: string, model: TrainedModel, openTool: (id: string) => void): Promise<void> {
  await binder.saveModel(name, model);
  openTool(BINDINGS_TOOL);
}

export { categoryBinder };
