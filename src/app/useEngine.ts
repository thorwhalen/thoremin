/**
 * useThoreminEngine — the React ↔ DAG bridge. Owns the webcam, the AudioContext
 * (created lazily on a user gesture, as browsers require), builds the default
 * graph against the browser registry, runs `engine.init()` (loads the ML model)
 * and drives `engine.tick()` from a requestAnimationFrame loop. The engine and
 * its nodes do the real work; this hook just supplies host resources and timing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Engine } from '@/dag';
import { createAppRegistry } from '@/nodes/browser';
import { defaultGraph } from './graph';
import { DEFAULT_SOURCE, type SourceSpec } from './sourceSpec';
import { useControls } from './store';
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
import type { FaceStatus } from '@/nodes';
import type { ExpressionScores } from '@/music/expression';

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Min interval (ms) between face-status reports to React (throttle the readout). */
const FACE_REPORT_MS = 100;

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

export function useThoreminEngine(source: SourceSpec = DEFAULT_SOURCE) {
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
  const rafRef = useRef<number | null>(null);

  const [status, setStatus] = useState<EngineStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [audioOn, setAudioOn] = useState(false);
  const [recPhase, setRecPhase] = useState<RecordingPhase>('idle');
  const [recElapsedMs, setRecElapsedMs] = useState(0);
  const [recSession, setRecSessionState] = useState<RecordingSession>(loadRecordingSession);

  const masterVolume = useControls((s) => s.masterVolume);
  const muted = useControls((s) => s.muted);

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
        if (source.kind === 'video') {
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
        await new Promise<void>((resolve, reject) => {
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

        const engine = new Engine(defaultGraph(), createAppRegistry(), { resources });
        await engine.init(); // loads the MediaPipe model
        if (disposed) {
          engine.dispose();
          return;
        }
        engineRef.current = engine;
        setStatus('ready');

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

        const loop = () => {
          // Guard the tick: one node throwing on a frame (e.g. a degenerate
          // value) must never stop the loop — drop that frame and keep going,
          // so audio + video recover instead of freezing permanently.
          try {
            const t = performance.now();
            engine.tick(t / 1000);
            reportFace(t);
            // (#90) Mute is now a store flag toggled by the app-level keyboard
            // handler (the `m` key → toggleMuted) and flows INTO the graph via
            // store-controls, so there is no longer a graph→store mute mirror here.
          } catch (err) {
            console.error('[thoremin] engine tick error (frame dropped)', err);
          }
          rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
      } catch (e) {
        if (disposed) return;
        console.error('[thoremin] engine setup failed', e);
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    })();

    return () => {
      disposed = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      engineRef.current?.dispose();
      engineRef.current = null;
      useFaceStatus.getState().reset();
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
      if (res.cancelled) {
        // The take recorded fine but the user dismissed the Save-As dialog — be
        // honest that nothing was written rather than toasting a false "Saved".
        useToasts.getState().push('Recording not saved (save cancelled)', 5000, 'error');
      } else {
        const suffix = res.count > 1 ? ` (${res.count} files)` : '';
        useToasts.getState().push(`Saved ${res.label}${suffix}`);
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
