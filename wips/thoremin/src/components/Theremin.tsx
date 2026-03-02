import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import * as handPoseDetection from '@tensorflow-models/hand-pose-detection';
import '@tensorflow/tfjs-backend-webgl';
import { useAudioEngine, VoiceSettings, InstrumentType } from '../hooks/useAudioEngine';
import { Activity, Camera, Volume2, Music, Settings, Info, X, Check, ChevronRight, Sliders } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const detectorConfig = {
  runtime: 'mediapipe',
  solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/hands',
  modelType: 'full'
};

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SCALE_TYPES = {
  major: { name: 'Major', intervals: [0, 2, 4, 5, 7, 9, 11] },
  pentatonic: { name: 'Pentatonic', intervals: [0, 2, 4, 7, 9] },
  minorHarmonic: { name: 'Minor Harmonic', intervals: [0, 2, 3, 5, 7, 8, 11] }
};
const INSTRUMENTS: { id: InstrumentType; name: string }[] = [
  { id: 'sine', name: 'Sine' },
  { id: 'square', name: 'Square' },
  { id: 'sawtooth', name: 'Sawtooth' },
  { id: 'triangle', name: 'Triangle' }
];

interface HandSettings {
  root: number;
  type: keyof typeof SCALE_TYPES;
  octaves: number;
  baseOctave: number;
  magnetism: number;
  instrument: InstrumentType;
}

const defaultSettings: HandSettings = {
  root: 0,
  type: 'major',
  octaves: 2,
  baseOctave: 3,
  magnetism: 0.8,
  instrument: 'sine'
};

function generateScale(settings: HandSettings) {
  const { type, octaves, baseOctave, root } = settings;
  const intervals = SCALE_TYPES[type].intervals;
  const scale: number[] = [];
  const baseNote = (baseOctave + 1) * 12 + root;
  
  for (let o = 0; o < octaves; o++) {
    for (const interval of intervals) {
      scale.push(baseNote + o * 12 + interval);
    }
  }
  scale.push(baseNote + octaves * 12);
  return scale.sort((a, b) => a - b);
}

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

  const { initAudio, updateVoice } = useAudioEngine();

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
          // Robust handedness check
          // In mirrored view, MediaPipe 'Left' hand looks like a 'Right' hand and vice versa.
          // If the model says 'Left', it's actually the user's Right hand (on the right of the screen).
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
          // Right hand dashed line goes to top (0), Left hand goes to bottom (height)
          ctx.lineTo(drawX, isRightHand ? 0 : canvasRef.current!.height);
          ctx.strokeStyle = isRightHand ? 'rgba(16, 185, 129, 0.4)' : 'rgba(59, 130, 246, 0.4)';
          ctx.setLineDash([5, 5]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      });

      // Cleanup missing hands
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

  const renderHandSettings = (hand: 'Right' | 'Left', settings: HandSettings, setSettings: React.Dispatch<React.SetStateAction<HandSettings>>, disabled?: boolean, hideHeader?: boolean) => (
    <div className="space-y-6">
      {!hideHeader && (
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-widest text-white/60">{hand} Hand</h3>
          {hand === 'Left' && (
            <button 
              onClick={() => setSyncHands(!syncHands)}
              className="flex items-center gap-2 group cursor-pointer"
            >
              <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${syncHands ? 'bg-emerald-500 border-emerald-500' : 'border-white/20'}`}>
                {syncHands && <Check className="w-3 h-3 text-black" />}
              </div>
              <span className="text-[10px] uppercase tracking-wider group-hover:text-white transition-colors">Sync with Right</span>
            </button>
          )}
        </div>
      )}

      <div className={`space-y-6 transition-opacity duration-300 ${disabled ? 'opacity-30 pointer-events-none grayscale' : ''}`}>
        <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-widest text-white/40">Root Note</label>
          <select 
            value={settings.root} 
            onChange={e => setSettings({ ...settings, root: parseInt(e.target.value) })}
            className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs focus:outline-none focus:border-emerald-500"
          >
            {NOTES.map((note, i) => <option key={note} value={i}>{note}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-widest text-white/40">Scale Type</label>
          <select 
            value={settings.type} 
            onChange={e => setSettings({ ...settings, type: e.target.value as any })}
            className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs focus:outline-none focus:border-emerald-500"
          >
            {Object.entries(SCALE_TYPES).map(([id, { name }]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-widest text-white/40">Range (Octaves)</label>
          <select 
            value={settings.octaves} 
            onChange={e => setSettings({ ...settings, octaves: parseInt(e.target.value) })}
            className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs focus:outline-none focus:border-emerald-500"
          >
            {[1, 2, 3].map(o => <option key={o} value={o}>{o} Octave{o > 1 ? 's' : ''}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-widest text-white/40">Base Octave</label>
          <select 
            value={settings.baseOctave} 
            onChange={e => setSettings({ ...settings, baseOctave: parseInt(e.target.value) })}
            className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs focus:outline-none focus:border-emerald-500"
          >
            {[1, 2, 3, 4, 5].map(o => <option key={o} value={o}>Octave {o} (C{o})</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-widest text-white/40">Instrument</label>
          <select 
            value={settings.instrument} 
            onChange={e => setSettings({ ...settings, instrument: e.target.value as any })}
            className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs focus:outline-none focus:border-emerald-500"
          >
            {INSTRUMENTS.map(inst => <option key={inst.id} value={inst.id}>{inst.name}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-widest text-white/40">Lowest Note</label>
          <div className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs text-emerald-500/60">
            {NOTES[settings.root]}{settings.baseOctave}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between items-center text-[10px] uppercase tracking-widest text-white/40">
          <span>Pitch Magnetism</span>
          <span className="text-emerald-500">{(settings.magnetism * 100).toFixed(0)}%</span>
        </div>
        <input 
          type="range" 
          min="0" 
          max="1" 
          step="0.01" 
          value={settings.magnetism} 
          onChange={e => setSettings({ ...settings, magnetism: parseFloat(e.target.value) })}
          className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-emerald-500"
        />
      </div>
    </div>
  </div>
);

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
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm rounded-3xl z-30">
                  <div className="text-center">
                    <div className="w-16 h-16 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-sm uppercase tracking-widest text-emerald-500">Loading Neural Engine</p>
                  </div>
                </motion.div>
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

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="absolute inset-y-0 right-0 w-96 bg-[#111] border-l border-white/10 z-50 shadow-2xl p-8 overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-10">
              <h2 className="text-2xl font-bold italic tracking-tighter">SETTINGS</h2>
              <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-12">
              {renderHandSettings('Right', rightSettings, setRightSettings)}
              <div className="h-px bg-white/5" />
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-white/60">Left Hand</h3>
                  <button 
                    onClick={() => setSyncHands(!syncHands)}
                    className="flex items-center gap-2 group"
                  >
                    <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${syncHands ? 'bg-emerald-500 border-emerald-500' : 'border-white/20'}`}>
                      {syncHands && <Check className="w-3 h-3 text-black" />}
                    </div>
                    <span className="text-[10px] uppercase tracking-wider group-hover:text-white transition-colors">Sync with Right</span>
                  </button>
                </div>
                {renderHandSettings('Left', leftSettings, setLeftSettings, syncHands, true)}
              </div>
            </div>

            <button 
              onClick={() => setShowSettings(false)}
              className="mt-12 w-full py-4 border border-white/10 rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-white/5 transition-colors"
            >
              Close Settings
            </button>
          </motion.div>
        )}
      </AnimatePresence>


      {/* Info Modal */}
      <AnimatePresence>
        {showInfo && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-xl" onClick={() => setShowInfo(false)}>
            <div className="max-w-lg w-full bg-[#111] border border-white/10 p-10 rounded-3xl shadow-2xl" onClick={e => e.stopPropagation()}>
              <h2 className="text-3xl font-bold mb-6 italic tracking-tighter">HOW TO PLAY</h2>
              <div className="space-y-6 text-white/60 leading-relaxed">
                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0"><span className="text-emerald-500 font-bold">1</span></div>
                  <p>Hold your hand in front of the camera. The system tracks your <span className="text-white">index finger tip</span>.</p>
                </div>
                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0"><span className="text-emerald-500 font-bold">2</span></div>
                  <p>Move <span className="text-white">Left to Right</span> to control the pitch. The sound will glide between notes but snap to the scale when you pause.</p>
                </div>
                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0"><span className="text-emerald-500 font-bold">3</span></div>
                  <p>Move <span className="text-white">Up and Down</span> to control the volume. Higher is louder.</p>
                </div>
                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0"><span className="text-emerald-500 font-bold">4</span></div>
                  <p>Use <span className="text-white">two hands</span> for polyphonic performance. Each hand can have unique scale and instrument settings.</p>
                </div>
              </div>
              <button onClick={() => setShowInfo(false)} className="mt-10 w-full py-4 border border-white/10 rounded-xl hover:bg-white/5 transition-colors uppercase tracking-widest text-xs font-bold">Close Transmission</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
