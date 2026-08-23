/**
 * useThoreminEngine — the React ↔ DAG bridge. Owns the webcam, the AudioContext
 * (created lazily on a user gesture, as browsers require), builds the graph
 * against the browser registry, runs `engine.init()` (loads the ML model) and
 * drives `engine.tick()` from a {@link Clock}. The engine and its nodes do the
 * real work; this hook just supplies host resources and timing.
 *
 * Two seams the hook deliberately does NOT own:
 *  - **Pacing** is a `Clock` (`src/dag/clock.ts`), driven via `runEngineLoop`.
 *    The hook used to hand-roll its own rAF recursion, which left the shipped
 *    `RealtimeClock` exercised only by unit tests while players ran other code.
 *  - **Which graph** comes from a {@link SlotSelection}. A change to it re-wires
 *    the LIVE engine via `Engine.applyGraph` — it does not rebuild the engine,
 *    so the camera is not re-acquired and the ML models are not reloaded.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Engine } from '@/dag';
import { createAppRegistry } from '@/nodes/browser';
import { defaultGraph, slotSelectionKey, sourceNeedsVideo, NO_SLOTS, type SlotSelection } from './graph';
import { runEngineLoop } from './engineLoop';
import { DEFAULT_SOURCE, type SourceSpec } from './sourceSpec';
import { useControls } from './store';
import { LiveVectorTap, resetLiveVector } from './enroll/liveVector';
import { featureDemandResource } from './featureDemand';
import { useToasts } from './toasts';
import { SessionRecorder, activeStreamLabels } from './recording/session';
import { SinkCancelled } from './recording/sink';
import {
  parseSession,
  DEFAULT_RECORDING_SESSION,
  RECORDING_SESSION_KEY,
  type RecordingSession,
} from './recording/schema';
import { prefillName } from './recording/naming';
import { tagStreamSource, tagOverlayResource } from './tagging/runtime';
import { useFaceStatus } from './faceStatus';
import { useMidiStatus } from './midiStatus';
import { useGestureStatus, type HandPoses } from './gestureStatus';
import { createGestureDispatcher } from './gestureDispatch';
import type { FaceStatus } from '@/nodes';
import type { MidiStatus } from '@/nodes/browser';
import type { ExpressionScores } from '@/music/expression';

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Min interval (ms) between face-status reports to React (throttle the readout). */
const FACE_REPORT_MS = 100;

/** Min interval (ms) between MIDI-status reports while notes are moving (#137).
 *  Phase / port-list changes always report immediately; this only paces the
 *  `activeNotes` counter so held-note changes don't re-render the panel 60×/s. */
const MIDI_REPORT_MS = 250;

/**
 * Max wait (ms) for a file source to deliver metadata before we give up. A URL
 * that returns 200 but never delivers a playable stream (hung CDN, truncated
 * moov atom) fires neither `loadedmetadata` nor `error`, so without this the
 * view would wedge on "loading" forever. Applied to the file path only — the
 * camera keeps its original settle behavior.
 */
const VIDEO_LOAD_TIMEOUT_MS = 15000;

/** Read the persisted last-used recording session (validated), or the default. */
function loadRecordingSession(): RecordingSession {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(RECORDING_SESSION_KEY) : null;
    return parseSession(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_RECORDING_SESSION;
  }
}

/** Which phase the recording UI is in: the idle button, the settings sheet, an
 * active take (HUD), or the brief save/convert step after Stop. */
export type RecordingPhase = 'idle' | 'settings' | 'recording' | 'saving';

/**
 * Report a failed re-wire — unless the engine was torn down while the swap was
 * still preparing. `applyGraph` rejects that case by design (it releases what it
 * built rather than committing onto a dead engine), and it is the ordinary
 * unmount / StrictMode remount path, so logging it would cry wolf on every
 * teardown that happens to overlap a swap. `live` is the hook's engine ref: it is
 * nulled by the same cleanup that disposes, so a mismatch means "we were torn
 * down", which is exactly the case to stay quiet about.
 */
function reportApplyFailure(engine: Engine, live: Engine | null, err: unknown): void {
  if (live !== engine) return;
  console.error('[thoremin] could not apply the slot selection', err);
}

export function useThoreminEngine(source: SourceSpec = DEFAULT_SOURCE, slots: SlotSelection = NO_SLOTS) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const resourcesRef = useRef<Record<string, unknown>>({});
  const masterGainRef = useRef<GainNode | null>(null);
  // The raw camera MediaStream (camera source only), kept reachable for the
  // pure-webcam recording stream (#88); null for a file source.
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const sessionRecRef = useRef<SessionRecorder | null>(null);
  const recInstrumentRef = useRef<string>('thoremin');
  const recBusyRef = useRef(false);
  // The registry the live engine was built against — `applyGraph` must resolve
  // node types against the SAME one, or a swap would compare against a different
  // set of definitions than the running graph was validated with.
  const registryRef = useRef<ReturnType<typeof createAppRegistry> | null>(null);

  const [status, setStatus] = useState<EngineStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [audioOn, setAudioOn] = useState(false);
  const [recPhase, setRecPhase] = useState<RecordingPhase>('idle');
  const [recElapsedMs, setRecElapsedMs] = useState(0);
  const [recSession, setRecSessionState] = useState<RecordingSession>(loadRecordingSession);

  const masterVolume = useControls((s) => s.masterVolume);
  const muted = useControls((s) => s.muted);

  // The slot selection is read through a ref inside the (source-keyed) build
  // effect, so a selection that changes while the engine is still booting is
  // still the one it gets built with; `slotsKey` drives the live re-wire below.
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const slotsKey = slotSelectionKey(slots);

  useEffect(() => {
    let disposed = false;
    // The acquired stream is held here (not read back off video.srcObject) so
    // cleanup can always stop the exact stream this run acquired. Under React
    // StrictMode the effect runs mount→cleanup→mount; an aborted run must stop
    // its own stream and bail *before* building an engine (no leaked camera, no
    // double model load, no clobbered engineRef).
    let stream: MediaStream | null = null;
    (async () => {
      try {
        setStatus('loading');
        const video = videoRef.current!;
        // The registry is built first because the SOURCE SLOT decides whether the
        // host has anything to acquire at all. A finished-frame source (replay /
        // synthetic) produces its own frames and reads no video, so asking for a
        // camera would be asking for hardware the run does not use — and on a
        // machine without one it would fail the whole boot before the engine was
        // ever constructed.
        const registry = createAppRegistry();
        registryRef.current = registry;
        const needsVideo = sourceNeedsVideo(slotsRef.current, registry);
        if (!needsVideo && source.kind === 'camera') {
          // Camera-free: leave the <video> element empty. Every reader of
          // `resources.video` guards on `readyState` (the overlay backdrop skips
          // the draw; the face branch never downloads its model without frames),
          // so nothing needs to know the difference.
        } else if (source.kind === 'video') {
          // Camera-free (Stream Applier M-A): play a pre-recorded clip into the
          // same <video> the webcam would fill, so the overlays + palette run
          // with no camera. The webcam-hands/face nodes read ctx.resources.video
          // origin-blind and time their inference off performance.now(), so the
          // file path needs no node changes.
          //   loop  — REQUIRED: those nodes only run inference while
          //           video.currentTime advances, so a stopped clip freezes the
          //           overlay; looping keeps it live (the wrap costs one cosmetic
          //           position jump, not a MediaPipe error).
          //   muted — keeps autoplay allowed and frees the audio path for the
          //           synth (we never want the clip's own audio).
          //   crossOrigin — lets a CORS-enabled remote clip be read into the
          //           canvas/MediaPipe; a same-origin clip (public/) needs nothing.
          video.srcObject = null;
          video.crossOrigin = 'anonymous';
          video.loop = true;
          video.muted = true;
          video.src = source.url;
        } else {
          // Ask for HD 16:9 so the fullscreen video is crisp, and the front
          // (user-facing) camera so the mirrored view shows your own hands on
          // mobile. All are `ideal` soft constraints: the camera returns the
          // closest mode it supports and never fails.
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              facingMode: { ideal: 'user' },
            },
            audio: false,
          });
          if (disposed) {
            // Cleanup already ran (it saw stream === null), so stop it here.
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          video.srcObject = stream;
          // Expose the raw camera stream for the pure-webcam recording stream (#88).
          cameraStreamRef.current = stream;
        }
        // Nothing to wait for when there is no media: skip straight to building.
        if (needsVideo || source.kind === 'video') await new Promise<void>((resolve, reject) => {
          // File path only: a stalling clip fires neither event, so bound the
          // wait and surface a timeout. The camera path (timer === null) keeps
          // its original "settle only on metadata" behavior.
          const timer =
            source.kind === 'video'
              ? setTimeout(
                  () => reject(new Error(`Timed out loading video source: ${source.url}`)),
                  VIDEO_LOAD_TIMEOUT_MS,
                )
              : null;
          video.onloadedmetadata = () => {
            if (timer) clearTimeout(timer);
            void video.play();
            resolve();
          };
          // A bad clip URL (decode/CORS failure) surfaces as an error instead of
          // hanging; onerror covers *errors*, the timer above covers *stalls*.
          // The camera path effectively never fires either.
          video.onerror = () => {
            if (timer) clearTimeout(timer);
            reject(
              new Error(
                source.kind === 'video'
                  ? `Could not load video source: ${source.url}`
                  : 'Camera video element error',
              ),
            );
          };
        });
        if (disposed) return; // cleanup stops the stream / releases the clip

        // Size the canvas drawing buffer to the camera's native resolution so
        // the overlay renders at full sharpness (CSS object-cover then scales it
        // to fill the viewport). Landmarks normalize by the same video dims, so
        // the overlay stays aligned at any resolution.
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = video.videoWidth || 1280;
          canvas.height = video.videoHeight || 720;
        }

        const resources = resourcesRef.current;
        resources.video = video;
        resources.canvas = canvasRef.current;
        resources.window = window;
        resources.controls = () => useControls.getState();
        // Live tagging (#92): the burned-in corner HUD reads this each tick (null
        // unless a take is recording). Same synchronous-read pattern as `controls`.
        resources.tagOverlay = tagOverlayResource;
        // Feature demand (#163): the vector nodes compute whatever a host consumer
        // (the trainer, while a cue runs) has claimed, even with the Lab closed.
        resources.featureDemand = featureDemandResource;

        // `defaultGraph` validates the selection against the registry and falls
        // back (with a warning) on anything that would not satisfy the slot
        // contract, so a stale URL can never produce an unbuildable graph.
        let builtKey = slotSelectionKey(slotsRef.current);
        const engine = new Engine(defaultGraph(slotsRef.current, registry), registry, { resources });

        // Trainer mode (#160) needs to see the same feature vector the Lab meters read.
        // Attached once, for the engine's whole life: it is one object spread per tick
        // into a module holder, and it is the only path by which the host can observe
        // the feature vector at all. `test/app_graph.test.ts` asserts the edges it names
        // still exist, so renaming a vector node fails the build rather than silently
        // starving the trainer.
        engine.addTap(new LiveVectorTap());

        await engine.init(); // loads the MediaPipe model
        if (disposed) {
          engine.dispose();
          return;
        }
        engineRef.current = engine;
        setStatus('ready');

        // The selection may have changed during the model load, while the
        // re-wire effect below had no engine to talk to yet. Reconcile once.
        if (slotSelectionKey(slotsRef.current) !== builtKey) {
          builtKey = slotSelectionKey(slotsRef.current);
          void engine
            .applyGraph(defaultGraph(slotsRef.current, registry), registry)
            .catch((err) => reportApplyFailure(engine, engineRef.current, err));
        }

        // Bridge the face model's status + classified expression from the DAG
        // back to React for the indicator/readout (#65), throttled so the bars
        // don't re-render 60×/s. A transition into 'error' surfaces a toast once.
        let lastFaceReport = 0;
        let lastPhase: FaceStatus['phase'] | null = null;
        let lastDetected = false;
        const reportFace = (now: number) => {
          const fs = engine.getOutput('camFace', 'status') as FaceStatus | undefined;
          if (!fs) return;
          const phaseChanged = fs.phase !== lastPhase;
          const detectedChanged = fs.faceDetected !== lastDetected;
          // The 10/s cadence is only needed while a face is being read (for the
          // live label); when idle/loading/error we report only on transitions, so
          // an off/idle face control doesn't re-render the UI every 100ms.
          const live = fs.phase === 'ready' && fs.faceDetected;
          if (!phaseChanged && !detectedChanged && (!live || now - lastFaceReport < FACE_REPORT_MS)) {
            return;
          }
          if (fs.phase === 'error' && lastPhase !== null && lastPhase !== 'error') {
            useToasts.getState().push(
              'Face model failed to load — check your connection and re-pick a face mode',
              6000,
              'error',
            );
          }
          const expr = engine.getOutput('faceExpr', 'expression') as ExpressionScores | undefined;
          const detected = fs.phase === 'ready' && fs.faceDetected && expr?.present;
          useFaceStatus.getState().report(fs, detected ? expr!.label : null, detected ? expr!.scores : null);
          lastFaceReport = now;
          lastPhase = fs.phase;
          lastDetected = fs.faceDetected;
        };

        // Bridge the midi-out node's status to React the same way (#137): the
        // settings panel renders the live device list + connection phase from it.
        // Transitions (phase / resolved port / device list) report immediately;
        // the activeNotes counter is paced so it can't re-render the panel 60×/s.
        let lastMidiReport = 0;
        let lastMidiKey = '';
        const reportMidi = (now: number) => {
          const ms = engine.getOutput('midiOut', 'status') as MidiStatus | undefined;
          if (!ms) return;
          const key = `${ms.phase}|${ms.portName ?? ''}|${ms.ports.join(',')}|${ms.message}`;
          const notesChanged = ms.activeNotes !== useMidiStatus.getState().status.activeNotes;
          if (key === lastMidiKey && (!notesChanged || now - lastMidiReport < MIDI_REPORT_MS)) return;
          useMidiStatus.getState().report(ms);
          lastMidiReport = now;
          lastMidiKey = key;
        };

        // Gesture dispatch (#129): the classifier's per-hand poses are read off the
        // DAG each frame — the dispatcher (fresh timing state per engine run) turns
        // held-pose TRANSITIONS into command dispatches per the user's binding map,
        // and the status store is written only when a pose CHANGES (transition-
        // gated, like reportFace/reportMidi), so the Gestures panel's live
        // indicators never re-render at frame rate.
        const gestureDispatcher = createGestureDispatcher();
        let lastPosesKey = '';
        const reportGesture = (now: number) => {
          const poses = engine.getOutput('gesture', 'poses') as HandPoses | undefined;
          if (!poses) return;
          gestureDispatcher.tick(poses, now);
          const key = `${poses.left}|${poses.right}`;
          if (key === lastPosesKey) return;
          useGestureStatus.getState().report(poses);
          lastPosesKey = key;
        };

        // Pacing lives in the Clock, the frame-drop guard and the report fan-out
        // in `runEngineLoop` (headlessly tested); the stop condition is the same
        // `disposed` flag the rest of this effect's cleanup uses.
        // (#90) Mute is a store flag toggled by the app-level keyboard handler
        // (the `m` key → toggleMuted) and flows INTO the graph via store-controls,
        // so there is no graph→store mute mirror in the loop.
        void runEngineLoop(engine, [reportFace, reportMidi, reportGesture], () => disposed);
      } catch (e) {
        if (disposed) return;
        console.error('[thoremin] engine setup failed', e);
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    })();

    return () => {
      // Setting `disposed` is what stops the loop: the clock polls it before
      // every frame, so an already-scheduled frame resolves without ticking.
      disposed = true;
      engineRef.current?.dispose();
      engineRef.current = null;
      registryRef.current = null;
      useFaceStatus.getState().reset();
      resetLiveVector();
      useMidiStatus.getState().reset();
      useGestureStatus.getState().reset();
      sessionRecRef.current?.dispose();
      sessionRecRef.current = null;
      cameraStreamRef.current = null;
      stream?.getTracks().forEach((t) => t.stop());
      // Symmetric to stopping camera tracks: pause a file clip so an aborted
      // (StrictMode) or unmounted run stops decoding instead of playing on, and
      // drop its handlers so a stale rejecter can't fire if the source is ever
      // re-acquired (the effect deps allow it).
      const fileVideo = source.kind === 'video' ? videoRef.current : null;
      if (fileVideo) {
        fileVideo.pause();
        fileVideo.onloadedmetadata = null;
        fileVideo.onerror = null;
      }
      // Close the AudioContext so its nodes (master, recorder tap, voices) are
      // released instead of leaking one un-closed context per unmount.
      const ac = resourcesRef.current.audioContext as AudioContext | undefined;
      if (ac && ac.state !== 'closed') void ac.close().catch(() => {});
      resourcesRef.current.audioContext = undefined;
      masterGainRef.current = null;
    };
    // Primitive deps (not the SourceSpec object) so a stable selection doesn't
    // re-run the effect; a genuine source change tears down and re-acquires.
  }, [source.kind, source.kind === 'video' ? source.url : null]);

  // Re-wire the LIVE engine when the slot selection changes. Deliberately NOT a
  // dependency of the build effect above: rebuilding the engine would re-acquire
  // the camera and reload both MediaPipe models to change one node. `applyGraph`
  // keeps every unchanged node (#51), so a mapping swap is one node rebuilt and
  // the instrument keeps playing through it.
  //
  // On mount this finds no engine yet and no-ops — correct, because the build
  // effect reads the current selection through `slotsRef` when it constructs.
  useEffect(() => {
    const engine = engineRef.current;
    const registry = registryRef.current;
    if (!engine || !registry) return;
    void engine
      .applyGraph(defaultGraph(slotsRef.current, registry), registry)
      .catch((err) => reportApplyFailure(engine, engineRef.current, err));
  }, [slotsKey]);

  // Keep master gain synced to the UI volume, and drop it to zero while muted.
  // This is the host-level catch-all mute (belt-and-suspenders with the in-graph
  // `synth-merge` mute), so ANY audio reaching the master bus — including a
  // non-graph producer like the Lyria plugin — goes silent too. The 50ms target
  // ramp makes both muting and unmuting click-free.
  useEffect(() => {
    const ac = resourcesRef.current.audioContext as AudioContext | undefined;
    if (masterGainRef.current && ac) {
      masterGainRef.current.gain.setTargetAtTime(muted ? 0 : masterVolume, ac.currentTime, 0.05);
    }
  }, [masterVolume, muted]);

  const startAudio = useCallback(async () => {
    const resources = resourcesRef.current;
    let ac = resources.audioContext as AudioContext | undefined;
    if (!ac) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ac = new Ctor({ latencyHint: 'interactive' });
      const master = ac.createGain();
      const { masterVolume: v0, muted: muted0 } = useControls.getState();
      master.gain.setValueAtTime(muted0 ? 0 : v0, ac.currentTime);
      master.connect(ac.destination);
      resources.audioContext = ac;
      resources.masterGain = master;
      masterGainRef.current = master;
    }
    if (ac.state === 'suspended') await ac.resume();
    // The SessionRecorder (#88) creates its own master-bus tap when a take starts,
    // so no persistent recorder is set up here — audio just needs to be running.
    setAudioOn(true);
  }, []);

  // ---- Recording session (#88): out-of-instrument multi-stream recorder --------

  /** Update the working session config and persist it (auto-save — the sheet is a
   * settings surface, not a form to submit). */
  const setRecSession = useCallback(
    (next: RecordingSession | ((prev: RecordingSession) => RecordingSession)) => {
      setRecSessionState((prev) => {
        const value = typeof next === 'function' ? (next as (p: RecordingSession) => RecordingSession)(prev) : next;
        try {
          localStorage.setItem(RECORDING_SESSION_KEY, JSON.stringify(value));
        } catch {
          /* localStorage full/unavailable — the take still records this session. */
        }
        return value;
      });
    },
    [],
  );

  /** Click Record → the settings sheet. Prefills a fresh, overwritable name (a new
   * timestamp each open, since a recording name is inherently per-take). */
  const openRecording = useCallback(
    (instrument?: string) => {
      recInstrumentRef.current = instrument || 'thoremin';
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

  /** "Rec now": build the session recorder from the live host resources and start
   * capture. Falls back to the sheet (not a crash) if audio isn't running yet or a
   * stream fails to start. */
  const recNow = useCallback(async () => {
    if (recBusyRef.current) return;
    const ac = resourcesRef.current.audioContext as AudioContext | undefined;
    const master = masterGainRef.current;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const engine = engineRef.current;
    if (!ac || !master || !canvas || !video || !engine) {
      useToasts.getState().push('Start audio before recording', 4000, 'error');
      return;
    }
    recBusyRef.current = true;
    const rec = new SessionRecorder(
      {
        audioContext: ac,
        masterGain: master,
        canvas,
        video,
        cameraStream: cameraStreamRef.current,
        engine,
        resources: resourcesRef.current,
        instrument: recInstrumentRef.current,
        // If annotation mode is on, annotations.jsonl rides in the folder on the shared t0 (#92).
        tagSource: tagStreamSource,
      },
      recSession,
    );
    sessionRecRef.current = rec;
    try {
      await rec.start();
      setRecElapsedMs(0);
      setRecPhase('recording');
    } catch (e) {
      rec.dispose();
      sessionRecRef.current = null;
      setRecPhase('settings');
      // A dismissed folder picker is a deliberate cancel (nothing recorded yet),
      // not an error — return to the sheet quietly.
      if (e instanceof SinkCancelled) {
        useToasts.getState().push('Recording cancelled', 3000);
      } else {
        console.error('[thoremin] could not start recording', e);
        useToasts.getState().push("Couldn't start recording", 6000, 'error');
      }
    } finally {
      recBusyRef.current = false;
    }
  }, [recSession]);

  /** Stop the take: convert audio, write every file + the manifest, toast the
   * result. `saving` covers the convert/write window (honest UI while it works). */
  const stopRecording = useCallback(async () => {
    if (recBusyRef.current) return;
    const rec = sessionRecRef.current;
    if (!rec) return;
    recBusyRef.current = true;
    setRecPhase('saving');
    try {
      const res = await rec.stop();
      // An output format whose encoder failed to load/run wrote NO file (#143).
      // Name it: the rest of the take was still saved, but the player must not
      // believe they have a FLAC they don't have.
      if (res.failedFormats.length) {
        const names = res.failedFormats.map((f) => f.toUpperCase()).join(', ');
        useToasts.getState().push(`Couldn't encode ${names} — that file was not saved`, 7000, 'error');
      }
      if (res.cancelled) {
        // The take recorded fine but the user dismissed the Save-As dialog — be
        // honest that nothing was written rather than toasting a false "Saved".
        useToasts.getState().push('Recording not saved (save cancelled)', 5000, 'error');
      } else if (res.streamCount > 0) {
        // streamCount, not count: the manifest is always written, so `count` is >= 1 even
        // on a take where every audio format failed to encode and nothing else was
        // selected. "Saved" must mean a stream actually landed.
        const suffix = res.count > 1 ? ` (${res.count} files)` : '';
        useToasts.getState().push(`Saved ${res.label}${suffix}`);
      } else if (!res.failedFormats.length) {
        useToasts.getState().push('Nothing was recorded — no streams were saved', 6000, 'error');
      }
    } catch (e) {
      console.error('[thoremin] recording save failed', e);
      useToasts.getState().push("Couldn't save the recording", 6000, 'error');
    } finally {
      rec.dispose();
      sessionRecRef.current = null;
      recBusyRef.current = false;
      setRecPhase('idle');
    }
  }, []);

  // Tick the elapsed-time readout for the HUD while a take is running.
  useEffect(() => {
    if (recPhase !== 'recording') return;
    const id = setInterval(() => setRecElapsedMs(sessionRecRef.current?.elapsedMs ?? 0), 250);
    return () => clearInterval(id);
  }, [recPhase]);

  return {
    videoRef,
    canvasRef,
    status,
    error,
    audioOn,
    startAudio,
    recording: {
      phase: recPhase,
      session: recSession,
      setSession: setRecSession,
      open: openRecording,
      close: closeRecording,
      recNow,
      stop: stopRecording,
      elapsedMs: recElapsedMs,
      activeStreams: activeStreamLabels(recSession),
    },
  };
}
