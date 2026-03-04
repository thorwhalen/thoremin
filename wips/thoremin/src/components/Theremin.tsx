import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import * as handPoseDetection from '@tensorflow-models/hand-pose-detection';
import '@tensorflow/tfjs-backend-webgl';
import { useAudioEngine, VoiceSettings } from '../hooks/useAudioEngine';
import { Activity, Sliders, Info } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { NOTES, SCALE_TYPES, HandSettings, defaultSettings, generateScale } from '../constants';
import SettingsPanel from './SettingsPanel';
import InfoModal from './InfoModal';
import { usePluginManager } from '../plugins/PluginProvider';

const detectorConfig = {
  runtime: 'mediapipe',
  solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/hands',
  modelType: 'full'
};

export default function Theremin() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detectorRef = useRef<handPoseDetection.HandDetector | null>(null);
  const rafRef = useRef<number | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handsCount, setHandsCount] = useState(0);
  const [showInfo, setShowInfo] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [rightSettings, setRightSettings] = useState<HandSettings>(defaultSettings);
  const [leftSettings, setLeftSettings] = useState<HandSettings>(defaultSettings);
  const [syncHands, setSyncHands] = useState(true);

  const { audioContextRef, masterGainRef } = usePluginManager();
  const { initAudio, updateVoice } = useAudioEngine({ audioContextRef, masterGainRef });

  const activeLeftSettings = syncHands ? rightSettings : leftSettings;

  const rightVoiceSettings = useMemo<VoiceSettings>(() => ({
    instrument: rightSettings.instrument,
    magnetism: rightSettings.magnetism,
    scale: generateScale(rightSettings)
  }), [rightSettings]);

  const leftVoiceSettings = useMemo<VoiceSettings>(() => ({
    instrument: activeLeftSettings.instrument,
    magnetism: activeLeftSettings.magnetism,
    scale: generateScale(activeLeftSettings)
  }), [activeLeftSettings]);

  const setupCamera = async () => {
    if (!videoRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: false
      });
      videoRef.current.srcObject = stream;
      return new Promise((resolve) => {
        videoRef.current!.onloadedmetadata = () => resolve(videoRef.current);
      });
    } catch (err) {
      setError('Camera access denied or not available.');
      console.error(err);
    }
  };

  const initDetector = async () => {
    try {
      const model = handPoseDetection.SupportedModels.MediaPipeHands;
      detectorRef.current = await handPoseDetection.createDetector(model, detectorConfig as any);
      setIsReady(true);
    } catch (err) {
      setError('Failed to load hand tracking model.');
      console.error(err);
    }
  };

  const detect = useCallback(async () => {
    if (!detectorRef.current || !videoRef.current || !canvasRef.current) return;

    const hands = await detectorRef.current.estimateHands(videoRef.current);
    setHandsCount(hands.length);

    const ctx = canvasRef.current.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

      ctx.save();
      ctx.scale(-1, 1);
      ctx.translate(-canvasRef.current.width, 0);
      ctx.globalAlpha = 0.3;
      ctx.drawImage(videoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);
      ctx.restore();

      hands.forEach((hand) => {
        const indexTip = hand.keypoints.find(kp => kp.name === 'index_finger_tip');
        if (indexTip) {
          const handednessStr = typeof hand.handedness === 'string' ? hand.handedness : (hand as any).label || 'Right';
          const isRightHand = handednessStr.toLowerCase().includes('left');

          const x = 1 - (indexTip.x / videoRef.current!.videoWidth);
          const y = indexTip.y / videoRef.current!.videoHeight;

          const voiceId = isRightHand ? 0 : 1;
          const settings = isRightHand ? rightVoiceSettings : leftVoiceSettings;
          updateVoice(voiceId, x, y, true, settings);

          const drawX = canvasRef.current!.width - indexTip.x;

          ctx.beginPath();
          ctx.arc(drawX, indexTip.y, 15, 0, Math.PI * 2);
          ctx.fillStyle = isRightHand ? '#10b981' : '#3b82f6';
          ctx.fill();
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 2;
          ctx.stroke();

          ctx.fillStyle = '#FFFFFF';
          ctx.font = '10px monospace';
          ctx.fillText(isRightHand ? 'RIGHT HAND' : 'LEFT HAND', drawX + 20, indexTip.y + 5);

          ctx.beginPath();
          ctx.moveTo(drawX, indexTip.y);
          ctx.lineTo(drawX, isRightHand ? 0 : canvasRef.current!.height);
          ctx.strokeStyle = isRightHand ? 'rgba(16, 185, 129, 0.4)' : 'rgba(59, 130, 246, 0.4)';
          ctx.setLineDash([5, 5]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      });

      const presentHandedness = hands.map(h => typeof h.handedness === 'string' ? h.handedness : (h as any).label || 'Right');
      if (!presentHandedness.some(h => h.toLowerCase().includes('left'))) updateVoice(0, 0, 0, false, rightVoiceSettings);
      if (!presentHandedness.some(h => h.toLowerCase().includes('right'))) updateVoice(1, 0, 0, false, leftVoiceSettings);
    }

    rafRef.current = requestAnimationFrame(detect);
  }, [updateVoice, rightVoiceSettings, leftVoiceSettings]);

  useEffect(() => {
    const start = async () => {
      await setupCamera();
      await initDetector();
    };
    start();
  }, []);

  useEffect(() => {
    if (isReady) {
      detect();
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isReady, detect]);

  const handleStart = () => {
    initAudio();
  };

  return (
    <div className="relative w-full h-screen bg-[#0a0a0a] text-white overflow-hidden font-mono selection:bg-emerald-500/30">
      <div className="absolute inset-0 opacity-20 pointer-events-none">
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_30%,#1a1a1a_0%,transparent_70%)]" />
        <div className="absolute bottom-0 right-0 w-1/2 h-1/2 bg-[radial-gradient(circle_at_100%_100%,#059669_0%,transparent_60%)]" />
      </div>

      <header className="absolute top-0 left-0 w-full p-6 flex justify-between items-center z-20 border-b border-white/5 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500 flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.4)]">
            <Activity className="text-black w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tighter uppercase italic">Thoremin</h1>
            <p className="text-[10px] text-emerald-500/70 uppercase tracking-widest">Polyphonic Vision Synth v1.1</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
          >
            <Sliders className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowInfo(true)}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
          >
            <Info className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="relative w-full h-full flex items-center justify-center">
        {error ? (
          <div className="text-center p-8 max-w-md bg-red-500/10 border border-red-500/20 rounded-2xl backdrop-blur-xl">
            <p className="text-red-400 mb-4">{error}</p>
            <button onClick={() => window.location.reload()} className="px-6 py-2 bg-red-500 text-white rounded-full text-sm font-bold hover:bg-red-600 transition-colors">Retry Connection</button>
          </div>
        ) : (
          <div className="relative group">
            <div className="relative w-[640px] h-[480px] rounded-3xl overflow-hidden border border-white/10 shadow-2xl bg-black/40 backdrop-blur-md">
              <video ref={videoRef} autoPlay playsInline className="hidden" />
              <canvas ref={canvasRef} width={640} height={480} className="w-full h-full object-cover" />

              {/* Scale Markers */}
              <div className="absolute inset-0 pointer-events-none">
                {/* Right Hand Scale (Top) */}
                <div className="absolute top-0 left-0 w-full h-8 flex items-end px-0">
                  {rightVoiceSettings.scale.map((midi, i) => {
                    const min = rightVoiceSettings.scale[0];
                    const max = rightVoiceSettings.scale[rightVoiceSettings.scale.length - 1];
                    const nx = (midi - min) / (max - min);
                    return (
                      <div
                        key={`r-${midi}-${i}`}
                        className="absolute h-2 w-px bg-emerald-500/40"
                        style={{ left: `${nx * 100}%` }}
                      >
                        <span className="absolute top-[-14px] left-1/2 -translate-x-1/2 text-[8px] text-emerald-500/60">
                          {NOTES[midi % 12]}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {/* Left Hand Scale (Bottom) */}
                <div className="absolute bottom-0 left-0 w-full h-8 flex items-start px-0">
                  {leftVoiceSettings.scale.map((midi, i) => {
                    const min = leftVoiceSettings.scale[0];
                    const max = leftVoiceSettings.scale[leftVoiceSettings.scale.length - 1];
                    const nx = (midi - min) / (max - min);
                    return (
                      <div
                        key={`l-${midi}-${i}`}
                        className="absolute h-2 w-px bg-blue-500/40"
                        style={{ left: `${nx * 100}%` }}
                      >
                        <span className="absolute bottom-[-14px] left-1/2 -translate-x-1/2 text-[8px] text-blue-500/60">
                          {NOTES[midi % 12]}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="absolute inset-0 pointer-events-none opacity-10">
                <div className="w-full h-full grid grid-cols-12 grid-rows-8">
                  {Array.from({ length: 96 }).map((_, i) => <div key={i} className="border-[0.5px] border-white/20" />)}
                </div>
              </div>
            </div>
            <AnimatePresence>
              {!isReady && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm rounded-3xl z-30">
                  <div className="text-center">
                    <div className="w-16 h-16 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-sm uppercase tracking-widest text-emerald-500">Loading Neural Engine</p>
                  </div>
                </div>
              )}
            </AnimatePresence>
          </div>
        )}
      </main>

      <footer className="absolute bottom-0 left-0 w-full p-8 flex justify-between items-end z-20">
        <div className="flex flex-col gap-6">
          <button onClick={handleStart} className="group relative px-8 py-4 bg-white text-black rounded-xl font-bold uppercase tracking-widest text-xs overflow-hidden transition-all hover:scale-105 active:scale-95">
            <span className="relative z-10">Initialize Audio Engine</span>
            <div className="absolute inset-0 bg-emerald-500 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
          </button>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-white/20 uppercase tracking-[0.3em] mb-2">Technical Specifications</p>
          <div className="flex flex-col gap-1 text-[11px] font-mono text-white/40">
            <p>LATENCY: &lt; 20MS</p>
            <p>SCALE: {SCALE_TYPES[rightSettings.type].name}</p>
            <p>ROOT: {NOTES[rightSettings.root]}</p>
          </div>
        </div>
      </footer>

      {/* Settings Panel */}
      <AnimatePresence>
        {showSettings && (
          <SettingsPanel
            onClose={() => setShowSettings(false)}
            rightSettings={rightSettings}
            setRightSettings={setRightSettings}
            leftSettings={leftSettings}
            setLeftSettings={setLeftSettings}
            syncHands={syncHands}
            setSyncHands={setSyncHands}
          />
        )}
      </AnimatePresence>

      {/* Info Modal */}
      <AnimatePresence>
        {showInfo && <InfoModal onClose={() => setShowInfo(false)} />}
      </AnimatePresence>
    </div>
  );
}
