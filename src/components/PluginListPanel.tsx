import React from 'react';
import { usePluginManager } from '../plugins/PluginProvider';
import { pluginRegistry } from '../plugins/registry';

export default function PluginListPanel() {
  const { plugins, togglePlugin } = usePluginManager();

  return (
    <div className="space-y-4">
      <p className="text-[10px] uppercase tracking-widest text-white/40 mb-4">Available Plugins</p>
      {pluginRegistry.map(def => {
        const state = plugins.get(def.id);
        const isOn = state?.status === 'active' || state?.status === 'activating';
        const Icon = def.icon;

        return (
          <div key={def.id} className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isOn ? 'bg-emerald-500' : 'bg-white/10'}`}>
                  <Icon className={`w-4 h-4 ${isOn ? 'text-black' : 'text-white/40'}`} />
                </div>
                <div>
                  <p className="text-sm font-bold">{def.name}</p>
                  <p className="text-[10px] text-white/40">{def.description}</p>
                </div>
              </div>
              <button
                onClick={() => togglePlugin(def.id)}
                className={`relative w-10 h-6 rounded-full transition-colors ${isOn ? 'bg-emerald-500' : 'bg-white/20'}`}
              >
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${isOn ? 'left-5' : 'left-1'}`} />
              </button>
            </div>

            {state?.status === 'error' && state.error && (
              <p className="text-[10px] text-red-400">{state.error}</p>
            )}

            {state?.status === 'activating' && (
              <p className="text-[10px] text-emerald-500/60">Activating...</p>
            )}

            {state?.status === 'active' && state.instance?.SettingsPanel && (
              <div className="pt-3 border-t border-white/5">
                {React.createElement(state.instance.SettingsPanel)}
              </div>
            )}
          </div>
        );
      })}

      {pluginRegistry.length === 0 && (
        <p className="text-xs text-white/30 text-center py-8">No plugins available</p>
      )}
    </div>
  );
}
