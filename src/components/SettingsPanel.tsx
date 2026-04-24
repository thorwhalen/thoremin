import React, { useState } from 'react';
import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { HandSettings } from '../constants';
import HandSettingsForm from './HandSettingsForm';
import PluginListPanel from './PluginListPanel';

interface SettingsPanelProps {
  onClose: () => void;
  rightSettings: HandSettings;
  setRightSettings: React.Dispatch<React.SetStateAction<HandSettings>>;
  leftSettings: HandSettings;
  setLeftSettings: React.Dispatch<React.SetStateAction<HandSettings>>;
  syncHands: boolean;
  setSyncHands: (sync: boolean) => void;
}

export default function SettingsPanel({
  onClose, rightSettings, setRightSettings, leftSettings, setLeftSettings, syncHands, setSyncHands
}: SettingsPanelProps) {
  const [tab, setTab] = useState<'synth' | 'plugins'>('synth');

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="absolute inset-y-0 right-0 w-96 bg-[#111] border-l border-white/10 z-50 shadow-2xl p-8 overflow-y-auto"
    >
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold italic tracking-tighter">SETTINGS</h2>
        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
          <X className="w-6 h-6" />
        </button>
      </div>

      <div className="flex gap-1 mb-8 bg-white/5 rounded-lg p-1">
        <button
          onClick={() => setTab('synth')}
          className={`flex-1 py-2 px-4 rounded-md text-xs font-bold uppercase tracking-widest transition-colors ${
            tab === 'synth' ? 'bg-emerald-500 text-black' : 'text-white/40 hover:text-white/60'
          }`}
        >
          Synth
        </button>
        <button
          onClick={() => setTab('plugins')}
          className={`flex-1 py-2 px-4 rounded-md text-xs font-bold uppercase tracking-widest transition-colors ${
            tab === 'plugins' ? 'bg-emerald-500 text-black' : 'text-white/40 hover:text-white/60'
          }`}
        >
          Plugins
        </button>
      </div>

      {tab === 'synth' && (
        <div className="space-y-12">
          <HandSettingsForm hand="Right" settings={rightSettings} setSettings={setRightSettings} />
          <div className="h-px bg-white/5" />
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-widest text-white/60">Left Hand</h3>
              <button
                onClick={() => setSyncHands(!syncHands)}
                className="flex items-center gap-2 group"
              >
                <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${syncHands ? 'bg-emerald-500 border-emerald-500' : 'border-white/20'}`}>
                  {syncHands && (
                    <svg className="w-3 h-3 text-black" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
                <span className="text-[10px] uppercase tracking-wider group-hover:text-white transition-colors">Sync with Right</span>
              </button>
            </div>
            <HandSettingsForm hand="Left" settings={leftSettings} setSettings={setLeftSettings} disabled={syncHands} hideHeader />
          </div>
        </div>
      )}

      {tab === 'plugins' && <PluginListPanel />}

      <button
        onClick={onClose}
        className="mt-12 w-full py-4 border border-white/10 rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-white/5 transition-colors"
      >
        Close Settings
      </button>
    </motion.div>
  );
}
