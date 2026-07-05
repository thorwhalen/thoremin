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
import { useControls } from './store';
import { PerformanceRecorder, recordingFilename, extForMime } from './recorder';
import { recordingFormat } from './recording/formats';
import { saveBlob } from './recording/save';
import { useToasts } from './toasts';
import { useFaceStatus } from './faceStatus';
import type { FaceStatus } from '@/nodes';
import type { ExpressionScores } from '@/music/expression';

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Min interval (ms) between face-status reports to React (throttle the readout). */
const FACE_REPORT_MS = 100;

/**
 * Convert the native (WebM/Opus) recording into each selected output format and
 * save it, surfacing a toast per saved file. Decodes the audio once if any
 * selected format needs it. Never throws — a per-format failure toasts and the
 * remaining formats still save.
 */
async function saveRecording(
  native: Blob,
  mimeType: string,
  audioContext: AudioContext | undefined,
): Promise<void> {
  const { push } = useToasts.getState();
  const ids = useControls.getState().recordingFormats;
  const stamp = new Date().toISOString();

  let audio: AudioBuffer | null = null;
  if (audioContext && ids.some((id) => recordingFormat(id)?.needsDecode)) {
    try {
      // arrayBuffer() returns a fresh copy each call, so decoding here never
      // detaches the buffer the native passthrough reuses.
      audio = await audioContext.decodeAudioData(await native.arrayBuffer());
    } catch (e) {
      console.error('[thoremin] could not decode recording for conversion', e);
      push('Could not decode audio for conversion');
    }
  }

  // Offer the "Save As" picker for the first saved file only; the rest download
  // directly, so selecting several formats doesn't trigger one dialog per format.
  let first = true;
  for (const id of ids) {
    const fmt = recordingFormat(id);
    if (!fmt) continue;
    try {
      const convert = await fmt.load();
      const out = await convert({ native, audio });
      const ext = id === 'webm' ? extForMime(mimeType) : fmt.ext;
      const result = await saveBlob(out, recordingFilename(stamp, ext), { allowPicker: first });
      first = false;
      if (result) push(`Saved ${result.filename}`);
    } catch (e) {
      console.error(`[thoremin] failed to save recording as ${fmt.id}`, e);
      push(`Couldn't save ${fmt.label}`);
    }
  }
}

export function useThoreminEngine() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const resourcesRef = useRef<Record<string, unknown>>({});
  const masterGainRef = useRef<GainNode | null>(null);
  const recorderRef = useRef<PerformanceRecorder | null>(null);
  const recBusyRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const [status, setStatus] = useState<EngineStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [audioOn, setAudioOn] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

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
        await new Promise<void>((resolve) => {
          video.onloadedmetadata = () => {
            void video.play();
            resolve();
          };
        });
        if (disposed) return; // cleanup stops the now-assigned stream

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
        // Mirror the graph's mute (toggled by the `m` key in `keyboard-control`)
        // into the store so the HUD "muted" cue + the host master mute follow the
        // keyboard. Seeded from the store so a mid-session engine rebuild doesn't
        // spuriously re-announce the current state.
        let lastMute = useControls.getState().muted;
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
            // Reflect a keyboard mute toggle into the store (only on change, so
            // this is not a per-frame setState). Drives the master gain + HUD cue.
            const m = engine.getOutput('kctrl', 'mute') === true;
            if (m !== lastMute) {
              lastMute = m;
              useControls.getState().setMuted(m);
            }
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
      recorderRef.current?.dispose();
      recorderRef.current = null;
      stream?.getTracks().forEach((t) => t.stop());
      // Close the AudioContext so its nodes (master, recorder tap, voices) are
      // released instead of leaking one un-closed context per unmount.
      const ac = resourcesRef.current.audioContext as AudioContext | undefined;
      if (ac && ac.state !== 'closed') void ac.close().catch(() => {});
      resourcesRef.current.audioContext = undefined;
      masterGainRef.current = null;
    };
  }, []);

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
    // Set up the recorder once audio exists, tapping the master bus.
    if (!recorderRef.current && masterGainRef.current) {
      recorderRef.current = new PerformanceRecorder({ audioContext: ac, source: masterGainRef.current });
    }
    setAudioOn(true);
  }, []);

  // Start/stop recording the live output; stopping downloads the audio file.
  // recBusyRef guards against a double-click racing stop() against a new
  // start() (which would clear the chunks mid-stop and download an empty file).
  const toggleRecording = useCallback(async () => {
    const r = recorderRef.current;
    if (!r || recBusyRef.current) return;
    recBusyRef.current = true;
    try {
      if (r.recording) {
        const native = await r.stop();
        setIsRecording(false);
        const ac = resourcesRef.current.audioContext as AudioContext | undefined;
        // Converting + the save dialog can take a moment; surface a "saving"
        // state so the UI is honest while a new record is briefly blocked.
        setIsSaving(true);
        try {
          await saveRecording(native, r.mimeType, ac);
        } finally {
          setIsSaving(false);
        }
      } else {
        r.start();
        setIsRecording(true);
      }
    } finally {
      recBusyRef.current = false;
    }
  }, []);

  return { videoRef, canvasRef, status, error, audioOn, isRecording, isSaving, startAudio, toggleRecording };
}
