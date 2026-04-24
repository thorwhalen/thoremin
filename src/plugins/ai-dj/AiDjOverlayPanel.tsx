import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronUp, Play, Pause, Square, Edit3, Plus, Loader2, Settings, Volume2 } from 'lucide-react';
import { Scale, MusicGenerationMode } from '@google/genai';
import { AnimatePresence } from 'motion/react';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { usePluginManager } from '../PluginProvider';
import { Vibe, Strain, AiDjSettings, DEFAULT_VIBES, PlaybackState, createStrain } from './types';
import { LyriaSessionManager } from './LyriaSession';
import { VibeEditor } from './VibeEditor';

const SCALE_OPTIONS: { value: Scale; label: string }[] = [
  { value: Scale.SCALE_UNSPECIFIED, label: 'Auto' },
  { value: Scale.C_MAJOR_A_MINOR, label: 'C / Am' },
  { value: Scale.D_FLAT_MAJOR_B_FLAT_MINOR, label: 'Db / Bbm' },
  { value: Scale.D_MAJOR_B_MINOR, label: 'D / Bm' },
  { value: Scale.E_FLAT_MAJOR_C_MINOR, label: 'Eb / Cm' },
  { value: Scale.E_MAJOR_D_FLAT_MINOR, label: 'E / C#m' },
  { value: Scale.F_MAJOR_D_MINOR, label: 'F / Dm' },
  { value: Scale.G_FLAT_MAJOR_E_FLAT_MINOR, label: 'Gb / Ebm' },
  { value: Scale.G_MAJOR_E_MINOR, label: 'G / Em' },
  { value: Scale.A_FLAT_MAJOR_F_MINOR, label: 'Ab / Fm' },
  { value: Scale.A_MAJOR_G_FLAT_MINOR, label: 'A / F#m' },
  { value: Scale.B_FLAT_MAJOR_G_MINOR, label: 'Bb / Gm' },
  { value: Scale.B_MAJOR_A_FLAT_MINOR, label: 'B / Abm' },
];

interface AiDjOverlayPanelProps {
  session: LyriaSessionManager;
}

export function AiDjOverlayPanel({ session }: AiDjOverlayPanelProps) {
  const { getPluginSettings, updatePluginSettings } = usePluginManager();
  const settings = getPluginSettings<AiDjSettings>('ai-dj');
  const [vibes, setVibes] = useLocalStorage<Vibe[]>('thoremin:plugin:ai-dj:vibes', DEFAULT_VIBES);
  const [activeVibeId, setActiveVibeId] = useLocalStorage<string | null>('thoremin:plugin:ai-dj:activeVibe', null);
  const [collapsed, setCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showVibeEditor, setShowVibeEditor] = useState(false);
  const [playbackState, setPlaybackState] = useState<PlaybackState>('stopped');
  const [remainingTime, setRemainingTime] = useState(600);
  const [error, setError] = useState<string | null>(null);

  const activeVibe = vibes.find(v => v.id === activeVibeId) ?? vibes[0] ?? null;

  const update = (patch: Partial<AiDjSettings>) => {
    updatePluginSettings('ai-dj', patch);
    // Apply config to running session
    if (playbackState === 'playing') {
      const merged = { ...settings, ...patch };
      session.applyConfig(merged);
    }
    // Apply volume immediately
    if (patch.volume !== undefined) {
      session.setVolume(patch.volume);
    }
  };

  // Apply initial volume when playing starts
  useEffect(() => {
    if (playbackState === 'playing') {
      session.setVolume(settings.volume);
    }
  }, [playbackState]);

  // Listen to session events
  useEffect(() => {
    const onStateChange = (e: Event) => {
      setPlaybackState((e as CustomEvent<PlaybackState>).detail);
    };
    const onError = (e: Event) => {
      setError((e as CustomEvent<string>).detail);
      setTimeout(() => setError(null), 5000);
    };

    session.addEventListener('playback-state-changed', onStateChange);
    session.addEventListener('error', onError);
    return () => {
      session.removeEventListener('playback-state-changed', onStateChange);
      session.removeEventListener('error', onError);
    };
  }, [session]);

  // Update remaining time
  useEffect(() => {
    if (playbackState !== 'playing' && playbackState !== 'loading') return;
    const id = setInterval(() => {
      setRemainingTime(session.remainingSeconds);
    }, 1000);
    return () => clearInterval(id);
  }, [playbackState, session]);

  const sendPrompts = useCallback((strains: Strain[]) => {
    if (playbackState === 'playing') {
      session.setWeightedPrompts(strains);
    }
  }, [session, playbackState]);

  const updateStrainWeight = (strainId: string, weight: number) => {
    if (!activeVibe) return;
    const updated = vibes.map(v => {
      if (v.id !== activeVibe.id) return v;
      return { ...v, strains: v.strains.map(s => s.id === strainId ? { ...s, weight } : s) };
    });
    setVibes(updated);
    const updatedVibe = updated.find(v => v.id === activeVibe.id);
    if (updatedVibe) sendPrompts(updatedVibe.strains);
  };

  const addStrainToActive = () => {
    if (!activeVibe) return;
    const updated = vibes.map(v => {
      if (v.id !== activeVibe.id) return v;
      return { ...v, strains: [...v.strains, createStrain('New strain', 1.0)] };
    });
    setVibes(updated);
  };

  const handlePlayPause = async () => {
    if (!activeVibe || activeVibe.strains.length === 0) {
      setError('Select a vibe with at least one strain.');
      return;
    }
    await session.playPause(activeVibe.strains, settings);
  };

  const handleStop = async () => {
    await session.stop();
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (collapsed) {
    return (
      <div className="absolute bottom-24 right-4 z-40 bg-[#111]/95 border border-white/10 rounded-xl px-4 py-2 flex items-center gap-3 backdrop-blur-sm shadow-lg">
        <div className="w-2 h-2 rounded-full" style={{
          backgroundColor: playbackState === 'playing' ? '#10b981' : playbackState === 'loading' ? '#eab308' : '#666'
        }} />
        <span className="text-xs font-mono text-white/60">
          AI DJ{activeVibe ? `: ${activeVibe.name}` : ''}
        </span>
        <button onClick={() => setCollapsed(false)} className="p-1 hover:bg-white/10 rounded transition-colors">
          <ChevronUp className="w-4 h-4 text-white/40" />
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="absolute bottom-24 right-4 z-40 w-80 bg-[#111]/95 border border-white/10 rounded-2xl backdrop-blur-sm shadow-2xl overflow-hidden max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 shrink-0">
          <span className="text-xs font-bold uppercase tracking-widest">AI DJ</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`p-1 rounded transition-colors ${showSettings ? 'bg-emerald-500/20 text-emerald-400' : 'hover:bg-white/10 text-white/40'}`}
            >
              <Settings className="w-4 h-4" />
            </button>
            <button onClick={() => setCollapsed(true)} className="p-1 hover:bg-white/10 rounded transition-colors">
              <ChevronDown className="w-4 h-4 text-white/40" />
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1">
          {/* Volume */}
          <div className="px-4 py-2 border-b border-white/5">
            <div className="flex items-center gap-2">
              <Volume2 className="w-3.5 h-3.5 text-white/30 shrink-0" />
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.volume}
                onChange={e => update({ volume: parseFloat(e.target.value) })}
                className="flex-1 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
              <span className="text-[10px] font-mono text-white/30 w-8 text-right">{Math.round(settings.volume * 100)}%</span>
            </div>
          </div>

          {/* Vibe Selector */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5">
            <select
              value={activeVibe?.id ?? ''}
              onChange={e => setActiveVibeId(e.target.value)}
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-emerald-500"
            >
              {vibes.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <button
              onClick={() => setShowVibeEditor(true)}
              className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
              title="Edit Vibes"
            >
              <Edit3 className="w-3.5 h-3.5 text-white/40" />
            </button>
          </div>

          {/* Strain Sliders */}
          {activeVibe && (
            <div className="px-4 py-3 space-y-2">
              {activeVibe.strains.map(strain => (
                <div key={strain.id} className="space-y-0.5">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-white/50 truncate max-w-[60%]">{strain.text}</span>
                    <span className="text-emerald-500/70 font-mono">{strain.weight.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.05"
                    value={strain.weight}
                    onChange={e => updateStrainWeight(strain.id, parseFloat(e.target.value))}
                    className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  />
                </div>
              ))}
              <button
                onClick={addStrainToActive}
                className="w-full py-1 border border-dashed border-white/10 rounded text-[9px] uppercase tracking-widest text-white/20 hover:text-white/40 hover:border-white/20 transition-colors flex items-center justify-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add Strain
              </button>
            </div>
          )}

          {/* Generation Settings (collapsible) */}
          {showSettings && (
            <div className="px-4 py-3 space-y-3 border-t border-white/5">
              <p className="text-[10px] uppercase tracking-widest text-white/40">Generation Config</p>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[9px] uppercase tracking-widest text-white/30">BPM</label>
                  <div className="flex items-center gap-1">
                    <button onClick={() => update({ bpm: Math.max(60, settings.bpm - 5) })} className="w-6 h-6 bg-white/5 border border-white/10 rounded text-[10px] hover:bg-white/10">-</button>
                    <input type="number" value={settings.bpm} min={60} max={200}
                      onChange={e => update({ bpm: Math.min(200, Math.max(60, Number(e.target.value))) })}
                      className="flex-1 bg-white/5 border border-white/10 rounded p-1 text-[10px] text-center font-mono focus:outline-none focus:border-emerald-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <button onClick={() => update({ bpm: Math.min(200, settings.bpm + 5) })} className="w-6 h-6 bg-white/5 border border-white/10 rounded text-[10px] hover:bg-white/10">+</button>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] uppercase tracking-widest text-white/30">Scale</label>
                  <select value={settings.scale} onChange={e => update({ scale: e.target.value as Scale })}
                    className="w-full bg-white/5 border border-white/10 rounded p-1 text-[10px] focus:outline-none focus:border-emerald-500"
                  >
                    {SCALE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>

              <p className="text-[8px] text-white/15">BPM/Scale changes reset context (~5s settling)</p>

              {/* Sliders */}
              {([
                { key: 'density' as const, label: 'Density', min: 0, max: 1, step: 0.05 },
                { key: 'brightness' as const, label: 'Brightness', min: 0, max: 1, step: 0.05 },
                { key: 'guidance' as const, label: 'Guidance', min: 0, max: 6, step: 0.1 },
                { key: 'temperature' as const, label: 'Temperature', min: 0, max: 3, step: 0.1 },
              ]).map(s => (
                <div key={s.key} className="space-y-0.5">
                  <div className="flex justify-between text-[9px] uppercase tracking-widest text-white/30">
                    <span>{s.label}</span>
                    <span className="text-emerald-500/60">{settings[s.key].toFixed(1)}</span>
                  </div>
                  <input type="range" min={s.min} max={s.max} step={s.step} value={settings[s.key]}
                    onChange={e => update({ [s.key]: parseFloat(e.target.value) })}
                    className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  />
                </div>
              ))}

              {/* Top K */}
              <div className="space-y-1">
                <div className="flex justify-between text-[9px] uppercase tracking-widest text-white/30">
                  <span>Top K</span>
                  <span className="text-emerald-500/60">{settings.topK}</span>
                </div>
                <input type="range" min={1} max={1000} step={10} value={settings.topK}
                  onChange={e => update({ topK: parseInt(e.target.value) })}
                  className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
              </div>

              {/* Checkboxes */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
                {([
                  { key: 'muteBass' as const, label: 'Mute Bass' },
                  { key: 'muteDrums' as const, label: 'Mute Drums' },
                  { key: 'onlyBassAndDrums' as const, label: 'Bass+Drums Only' },
                ] as const).map(cb => (
                  <label key={cb.key} className="flex items-center gap-1.5 text-[10px] text-white/50 cursor-pointer">
                    <input type="checkbox" checked={settings[cb.key]} onChange={e => update({ [cb.key]: e.target.checked })} className="accent-emerald-500 w-3 h-3" />
                    {cb.label}
                  </label>
                ))}
              </div>

              {/* Generation Mode */}
              <div className="flex gap-1 pt-1">
                {([
                  { value: MusicGenerationMode.QUALITY, label: 'Quality' },
                  { value: MusicGenerationMode.DIVERSITY, label: 'Diversity' },
                  { value: MusicGenerationMode.VOCALIZATION, label: 'Vocal' },
                ]).map(mode => (
                  <button key={mode.value}
                    onClick={() => update({ musicGenerationMode: mode.value })}
                    className={`flex-1 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-colors ${
                      settings.musicGenerationMode === mode.value ? 'bg-emerald-500 text-black' : 'bg-white/5 text-white/30 hover:text-white/50'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>

              {/* Remove API Key */}
              <button
                onClick={() => { localStorage.removeItem('thoremin:plugin:ai-dj:apiKey'); window.location.reload(); }}
                className="text-[9px] text-red-400/40 hover:text-red-400 transition-colors uppercase tracking-widest pt-1"
              >
                Remove API Key
              </button>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-2 bg-red-500/10 border-t border-red-500/20 shrink-0">
            <p className="text-[10px] text-red-400">{error}</p>
          </div>
        )}

        {/* Transport */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-white/5 shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={handlePlayPause}
              className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center hover:bg-emerald-400 transition-colors"
            >
              {playbackState === 'loading' ? (
                <Loader2 className="w-4 h-4 text-black animate-spin" />
              ) : playbackState === 'playing' ? (
                <Pause className="w-4 h-4 text-black" />
              ) : (
                <Play className="w-4 h-4 text-black ml-0.5" />
              )}
            </button>
            <button
              onClick={handleStop}
              disabled={playbackState === 'stopped'}
              className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors disabled:opacity-30"
            >
              <Square className="w-3.5 h-3.5 text-white" />
            </button>
          </div>

          <span className="text-[10px] font-mono text-white/30">
            {playbackState === 'playing' || playbackState === 'loading'
              ? formatTime(remainingTime)
              : '10:00'
            }
          </span>
        </div>
      </div>

      {/* Vibe Editor Modal */}
      <AnimatePresence>
        {showVibeEditor && (
          <VibeEditor
            vibes={vibes}
            onUpdate={setVibes}
            onClose={() => setShowVibeEditor(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
