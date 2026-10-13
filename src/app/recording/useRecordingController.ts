/**
 * useRecordingController — the take's lifecycle (#88, #163), out of `useEngine` (#392).
 *
 * A take is started by two surfaces: the Record button ("Rec now", with the sheet's session
 * config) and the recording controller (`./controller`, which the trainer store calls with its
 * own streams and annotation source). Both go through the one {@link startTake} here, built
 * from the host's live resources, which this hook reads through REFS at call time: the engine
 * hook owns the audio context, the canvas, the video, the camera stream and the engine, and
 * hands the refs in. So the take's rules (one at a time, audio only when the take records it, a
 * dismissed picker is a quiet cancel, an honest toast for every outcome of a save) are testable
 * with fake refs and a fake recorder, without booting the engine.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Engine } from '@thoremin/dag';
import { useToasts } from '../toasts';
import { SessionRecorder, activeStreamLabels, type RecordingResult, type SessionRecorderDeps } from './session';
import { registerRecordingController, type StartTakeOptions } from './controller';
import { SinkCancelled } from './sink';
import { type RecordingSession } from './schema';
import { useRecordingConfig } from './configStore';
import { prefillName } from './naming';
import { tagStreamSource } from '../tagging/runtime';

/** Which phase the recording UI is in: the idle button, the settings sheet, an
 * active take (HUD), or the brief save/convert step after Stop. */
export type RecordingPhase = 'idle' | 'settings' | 'recording' | 'saving';

/** A mutable box, the shape of a React ref (React ships untyped here). */
interface Ref<T> {
  current: T;
}

/** The host resources a take records from, as the engine hook's refs (read at start). */
export interface RecordingHostRefs {
  /** The engine's resources bag: the take reads `audioContext` from it and hands it on. */
  resources: Ref<Record<string, unknown>>;
  masterGain: Ref<AudioNode | null>;
  canvas: Ref<HTMLCanvasElement | null>;
  video: Ref<HTMLVideoElement | null>;
  engine: Ref<Engine | null>;
  /** The raw camera stream (camera source only), for the pure-webcam stream. */
  cameraStream: Ref<MediaStream | null>;
}

/** What the controller needs of a recorder: the {@link SessionRecorder} surface it drives. */
export type TakeRecorder = Pick<SessionRecorder, 'start' | 'stop' | 'dispose' | 'elapsedMs'>;

export interface RecordingControllerOptions {
  /** Build the recorder for a take; default a {@link SessionRecorder}. A seam for tests. */
  createRecorder?: (deps: SessionRecorderDeps, session: RecordingSession) => TakeRecorder;
}

/** The instrument name a take is filed under when the caller names none. */
const DEFAULT_INSTRUMENT = 'thoremin';

/** How often (ms) the HUD's elapsed-time readout updates while a take runs. */
const ELAPSED_TICK_MS = 250;

/** How long (ms) each kind of recording toast stays up. */
const TOAST_MS = { busy: 4000, notReady: 4000, cancelled: 3000, failed: 6000, encodeFailed: 7000, notSaved: 5000, empty: 6000 } as const;

const defaultRecorder = (deps: SessionRecorderDeps, session: RecordingSession): TakeRecorder => new SessionRecorder(deps, session);

/** Toast what a finished take wrote (or did not). */
function toastResult(res: RecordingResult): void {
  const toasts = useToasts.getState();
  // An output format whose encoder failed to load/run wrote NO file (#143).
  // Name it: the rest of the take was still saved, but the player must not
  // believe they have a FLAC they don't have.
  if (res.failedFormats.length) {
    const names = res.failedFormats.map((f) => f.toUpperCase()).join(', ');
    toasts.push(`Couldn't encode ${names} — that file was not saved`, TOAST_MS.encodeFailed, 'error');
  }
  if (res.cancelled) {
    // The take recorded fine but the user dismissed the Save-As dialog — be
    // honest that nothing was written rather than toasting a false "Saved".
    toasts.push('Recording not saved (save cancelled)', TOAST_MS.notSaved, 'error');
  } else if (res.streamCount > 0) {
    // streamCount, not count: the manifest is always written, so `count` is >= 1 even
    // on a take where every audio format failed to encode and nothing else was
    // selected. "Saved" must mean a stream actually landed.
    const suffix = res.count > 1 ? ` (${res.count} files)` : '';
    toasts.push(`Saved ${res.label}${suffix}`);
  } else if (!res.failedFormats.length) {
    toasts.push('Nothing was recorded — no streams were saved', TOAST_MS.empty, 'error');
  }
}

/**
 * The recording session (#88): the Record button's sheet and HUD state, the take's start and
 * stop, and the controller registration (#163) that lets the trainer use the same two.
 *
 * Returns the `recording` surface the shell renders, and `releaseTake`, which the engine's
 * teardown calls to drop a running take with the engine it records.
 *
 * @param refs - read when a take starts, never captured: the refs must be stable (React refs);
 *   the object holding them may be a new literal on every render.
 */
export function useRecordingController(refs: RecordingHostRefs, { createRecorder = defaultRecorder }: RecordingControllerOptions = {}) {
  // Refs, not state: the controller and the teardown read them synchronously.
  const sessionRecRef = useRef<TakeRecorder | null>(null);
  const activeSessionRef = useRef<RecordingSession | null>(null);
  const recInstrumentRef = useRef<string>(DEFAULT_INSTRUMENT);
  const recBusyRef = useRef(false);
  const [recPhase, setRecPhase] = useState<RecordingPhase>('idle');
  const [recElapsedMs, setRecElapsedMs] = useState(0);
  // The config lives in its own store (#257) so the trainer's folder control, a command
  // or the palette can change it and the sheet shows the change without a reload.
  const recSession = useRecordingConfig((s) => s.session);

  /** Update the working session config and persist it (auto-save — the sheet is a
   * settings surface, not a form to submit). The store's setter is stable. */
  const setRecSession = useCallback(
    (next: RecordingSession | ((prev: RecordingSession) => RecordingSession)) => useRecordingConfig.getState().setSession(next),
    [],
  );

  /** Click Record → the settings sheet. Prefills a fresh, overwritable name (a new
   * timestamp each open, since a recording name is inherently per-take). */
  const openRecording = useCallback(
    (instrument?: string) => {
      recInstrumentRef.current = instrument || DEFAULT_INSTRUMENT;
      setRecSession((prev) => ({
        ...prev,
        name: prefillName({ instrument: recInstrumentRef.current, date: new Date() }),
      }));
      setRecPhase('settings');
    },
    [setRecSession],
  );

  /** Close the sheet without recording (config already auto-saved on every edit). */
  const closeRecording = useCallback(() => setRecPhase('idle'), []);

  /** Start a take: build the session recorder from the live host resources and start
   * capture. Shared by the Record button ("Rec now") and the recording controller
   * (#163: the trainer records its take with its own annotation source). Resolves
   * true once recording; false (with a toast) if audio isn't running yet, a stream
   * fails to start, or a take is already running. */
  const startTake = useCallback(
    async (session: RecordingSession, opts: StartTakeOptions = {}): Promise<boolean> => {
      if (recBusyRef.current || sessionRecRef.current) {
        // The seam is used by more than one surface (the Record button and the trainer);
        // an honest "why not" beats a silent false (its own doc promised a toast).
        useToasts.getState().push(
          sessionRecRef.current ? 'Already recording — stop the current take first' : 'Still saving the last take — try again in a moment',
          TOAST_MS.busy,
          'error',
        );
        return false;
      }
      // `fromSheet` is the Record-button flow: only it drives the settings sheet. A
      // controller-started take (the trainer) must never pop the button's sheet.
      const fromSheet = opts.fromSheet ?? false;
      const ac = refs.resources.current.audioContext as AudioContext | undefined;
      const master = refs.masterGain.current;
      const canvas = refs.canvas.current;
      const video = refs.video.current;
      const engine = refs.engine.current;
      // Audio is only needed when the take actually records the master bus. A camera +
      // features take (the trainer's) must not demand the player start audio first.
      const needsAudio = session.streams.audio;
      if (!canvas || !video || !engine || (needsAudio && (!ac || !master))) {
        useToasts.getState().push(needsAudio ? 'Start audio before recording' : 'The camera is not ready yet', TOAST_MS.notReady, 'error');
        return false;
      }
      recBusyRef.current = true;
      const rec = createRecorder(
        {
          audioContext: ac as AudioContext,
          masterGain: master as AudioNode,
          canvas,
          video,
          cameraStream: refs.cameraStream.current,
          engine,
          resources: refs.resources.current,
          instrument: opts.instrument ?? recInstrumentRef.current,
          // If annotation mode is on, annotations.jsonl rides in the folder on the shared t0 (#92).
          tagSource: opts.tagSource ?? tagStreamSource,
          meta: opts.meta,
        },
        session,
      );
      sessionRecRef.current = rec;
      activeSessionRef.current = session;
      try {
        await rec.start();
        setRecElapsedMs(0);
        setRecPhase('recording');
        return true;
      } catch (e) {
        rec.dispose();
        sessionRecRef.current = null;
        if (fromSheet) setRecPhase('settings');
        // A dismissed folder picker is a deliberate cancel (nothing recorded yet),
        // not an error — return to the sheet quietly.
        if (e instanceof SinkCancelled) {
          useToasts.getState().push('Recording cancelled', TOAST_MS.cancelled);
        } else {
          console.error('[thoremin] could not start recording', e);
          useToasts.getState().push("Couldn't start recording", TOAST_MS.failed, 'error');
        }
        return false;
      } finally {
        recBusyRef.current = false;
      }
    },
    [],
  );

  /** "Rec now": the button's take, with the sheet's session config. */
  const recNow = useCallback(async () => {
    await startTake(recSession, { fromSheet: true });
  }, [recSession, startTake]);

  /** Stop the take: convert audio, write every file + the manifest, toast the
   * result. `saving` covers the convert/write window (honest UI while it works). */
  const stopRecording = useCallback(async () => {
    if (recBusyRef.current) return;
    const rec = sessionRecRef.current;
    if (!rec) return;
    recBusyRef.current = true;
    setRecPhase('saving');
    try {
      toastResult(await rec.stop());
    } catch (e) {
      console.error('[thoremin] recording save failed', e);
      useToasts.getState().push("Couldn't save the recording", TOAST_MS.failed, 'error');
    } finally {
      rec.dispose();
      sessionRecRef.current = null;
      activeSessionRef.current = null;
      recBusyRef.current = false;
      setRecPhase('idle');
    }
  }, []);

  // The recording controller (#163): the same start/stop the button uses, reachable
  // from a store. Registered for the hook's life.
  useEffect(
    () =>
      registerRecordingController({
        start: startTake,
        stop: stopRecording,
        isRecording: () => sessionRecRef.current !== null,
      }),
    [startTake, stopRecording],
  );

  // Tick the elapsed-time readout for the HUD while a take is running.
  useEffect(() => {
    if (recPhase !== 'recording') return;
    const id = setInterval(() => setRecElapsedMs(sessionRecRef.current?.elapsedMs ?? 0), ELAPSED_TICK_MS);
    return () => clearInterval(id);
  }, [recPhase]);

  /** Drop a running take with the engine it records (the engine's teardown). */
  const releaseTake = useCallback(() => {
    sessionRecRef.current?.dispose();
    sessionRecRef.current = null;
  }, []);

  return {
    recording: {
      phase: recPhase,
      session: recSession,
      setSession: setRecSession,
      open: openRecording,
      close: closeRecording,
      recNow,
      stop: stopRecording,
      elapsedMs: recElapsedMs,
      // While a take records, the chips reflect THAT take (the trainer's camera+features),
      // not the button sheet's config; the sheet's config otherwise.
      activeStreams: activeStreamLabels(recPhase === 'recording' ? activeSessionRef.current ?? recSession : recSession),
    },
    releaseTake,
  };
}
