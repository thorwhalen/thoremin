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

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error';

export function useThoreminEngine() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const resourcesRef = useRef<Record<string, unknown>>({});
  const masterGainRef = useRef<GainNode | null>(null);
  const rafRef = useRef<number | null>(null);

  const [status, setStatus] = useState<EngineStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [audioOn, setAudioOn] = useState(false);

  const masterVolume = useControls((s) => s.masterVolume);

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
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
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

        const loop = () => {
          engine.tick(performance.now() / 1000);
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
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Keep master gain synced to the UI volume.
  useEffect(() => {
    const ac = resourcesRef.current.audioContext as AudioContext | undefined;
    if (masterGainRef.current && ac) {
      masterGainRef.current.gain.setTargetAtTime(masterVolume, ac.currentTime, 0.05);
    }
  }, [masterVolume]);

  const startAudio = useCallback(async () => {
    const resources = resourcesRef.current;
    let ac = resources.audioContext as AudioContext | undefined;
    if (!ac) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ac = new Ctor({ latencyHint: 'interactive' });
      const master = ac.createGain();
      master.gain.setValueAtTime(useControls.getState().masterVolume, ac.currentTime);
      master.connect(ac.destination);
      resources.audioContext = ac;
      resources.masterGain = master;
      masterGainRef.current = master;
    }
    if (ac.state === 'suspended') await ac.resume();
    setAudioOn(true);
  }, []);

  return { videoRef, canvasRef, status, error, audioOn, startAudio };
}
