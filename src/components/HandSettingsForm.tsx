import React from 'react';
import { Check } from 'lucide-react';
import { HandSettings, NOTES, SCALE_TYPES, INSTRUMENTS } from '../constants';

interface HandSettingsFormProps {
  hand: 'Right' | 'Left';
  settings: HandSettings;
  setSettings: React.Dispatch<React.SetStateAction<HandSettings>>;
  syncHands?: boolean;
  setSyncHands?: (sync: boolean) => void;
  disabled?: boolean;
  hideHeader?: boolean;
}

export default function HandSettingsForm({
  hand, settings, setSettings, syncHands, setSyncHands, disabled, hideHeader
}: HandSettingsFormProps) {
  return (
    <div className="space-y-6">
      {!hideHeader && (
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-widest text-white/60">{hand} Hand</h3>
          {hand === 'Left' && setSyncHands && (
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
}
