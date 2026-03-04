import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { PluginId, PluginStatus, PluginDefinition, PluginInstance, PluginContext as PlugCtx, SetupDialogProps } from './types';
import { pluginRegistry } from './registry';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { AnimatePresence, motion } from 'motion/react';

interface PluginState {
  status: PluginStatus;
  instance: PluginInstance | null;
  error: string | null;
}

interface PluginManagerContextValue {
  plugins: Map<PluginId, PluginState>;
  togglePlugin: (id: PluginId) => void;
  getPluginSettings: <T>(id: PluginId) => T;
  updatePluginSettings: <T>(id: PluginId, patch: Partial<T>) => void;
  audioContextRef: React.RefObject<AudioContext | null>;
  masterGainRef: React.RefObject<GainNode | null>;
}

const PluginManagerContext = createContext<PluginManagerContextValue>(null!);

export function usePluginManager() {
  return useContext(PluginManagerContext);
}

interface PluginProviderProps {
  children: React.ReactNode;
}

export function PluginProvider({ children }: PluginProviderProps) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const [enabledIds, setEnabledIds] = useLocalStorage<string[]>('thoremin:plugins:enabled', []);
  const [pluginStates, setPluginStates] = useState<Map<PluginId, PluginState>>(() => {
    const map = new Map<PluginId, PluginState>();
    for (const def of pluginRegistry) {
      map.set(def.id, { status: 'disabled', instance: null, error: null });
    }
    return map;
  });

  // Setup dialog state
  const [setupDialogPluginId, setSetupDialogPluginId] = useState<PluginId | null>(null);

  // Settings stored per-plugin as reactive state
  const [pluginSettings, setPluginSettings] = useState<Map<PluginId, Record<string, unknown>>>(() => {
    const map = new Map<PluginId, Record<string, unknown>>();
    for (const def of pluginRegistry) {
      const key = `thoremin:plugin:${def.id}:settings`;
      try {
        const stored = localStorage.getItem(key);
        map.set(def.id, stored ? JSON.parse(stored) : { ...def.defaultSettings });
      } catch {
        map.set(def.id, { ...def.defaultSettings });
      }
    }
    return map;
  });

  const getPluginSettings = useCallback(<T,>(id: PluginId): T => {
    const def = pluginRegistry.find(p => p.id === id);
    return (pluginSettings.get(id) ?? def?.defaultSettings ?? {}) as T;
  }, [pluginSettings]);

  const updatePluginSettings = useCallback(<T,>(id: PluginId, patch: Partial<T>) => {
    setPluginSettings(prev => {
      const current = prev.get(id) ?? {};
      const updated = { ...current, ...patch };
      const next = new Map(prev);
      next.set(id, updated as Record<string, unknown>);
      try {
        localStorage.setItem(`thoremin:plugin:${id}:settings`, JSON.stringify(updated));
      } catch { /* ignore */ }
      return next;
    });
  }, []);

  const activatePlugin = useCallback(async (def: PluginDefinition<any>) => {
    if (!audioContextRef.current || !masterGainRef.current) {
      setPluginStates(prev => {
        const next = new Map(prev);
        next.set(def.id, { status: 'error', instance: null, error: 'Audio engine not initialized. Click "Initialize Audio Engine" first.' });
        return next;
      });
      return;
    }

    setPluginStates(prev => {
      const next = new Map(prev);
      next.set(def.id, { status: 'activating', instance: null, error: null });
      return next;
    });

    try {
      const ctx: PlugCtx<any> = {
        audioContext: audioContextRef.current,
        masterGain: masterGainRef.current,
        getSettings: () => getPluginSettings(def.id),
        updateSettings: (patch: any) => {
          updatePluginSettings(def.id, patch);
        },
      };

      const instance = await def.activate(ctx);

      setPluginStates(prev => {
        const next = new Map(prev);
        next.set(def.id, { status: 'active', instance, error: null });
        return next;
      });
      setEnabledIds(prev => prev.includes(def.id) ? prev : [...prev, def.id]);
    } catch (e: any) {
      setPluginStates(prev => {
        const next = new Map(prev);
        next.set(def.id, { status: 'error', instance: null, error: e.message || 'Activation failed' });
        return next;
      });
      setEnabledIds(prev => prev.filter(id => id !== def.id));
    }
  }, [audioContextRef, masterGainRef, getPluginSettings, updatePluginSettings, setEnabledIds]);

  const deactivatePlugin = useCallback(async (id: PluginId) => {
    const state = pluginStates.get(id);
    if (state?.instance) {
      await state.instance.deactivate();
    }
    setPluginStates(prev => {
      const next = new Map(prev);
      next.set(id, { status: 'disabled', instance: null, error: null });
      return next;
    });
    setEnabledIds(prev => prev.filter(eid => eid !== id));
  }, [pluginStates, setEnabledIds]);

  const togglePlugin = useCallback((id: PluginId) => {
    const state = pluginStates.get(id);
    const def = pluginRegistry.find(p => p.id === id);
    if (!def) return;

    if (state?.status === 'active' || state?.status === 'activating') {
      deactivatePlugin(id);
    } else {
      // Check if setup dialog needed
      if (def.SetupDialog) {
        // Check if prerequisite already met (e.g., API key already stored)
        const apiKey = localStorage.getItem(`thoremin:plugin:${id}:apiKey`);
        if (apiKey) {
          activatePlugin(def);
        } else {
          setSetupDialogPluginId(id);
        }
      } else {
        activatePlugin(def);
      }
    }
  }, [pluginStates, activatePlugin, deactivatePlugin]);

  // Auto-activate previously enabled plugins on mount (after audio init)
  const autoActivatedRef = useRef(false);
  useEffect(() => {
    if (autoActivatedRef.current) return;
    if (!audioContextRef.current || !masterGainRef.current) return;
    autoActivatedRef.current = true;

    for (const id of enabledIds) {
      const def = pluginRegistry.find(p => p.id === id);
      if (def) {
        const apiKey = localStorage.getItem(`thoremin:plugin:${id}:apiKey`);
        if (!def.SetupDialog || apiKey) {
          activatePlugin(def);
        }
      }
    }
  }, [enabledIds, activatePlugin, audioContextRef, masterGainRef]);

  const value: PluginManagerContextValue = {
    plugins: pluginStates,
    togglePlugin,
    getPluginSettings,
    updatePluginSettings,
    audioContextRef,
    masterGainRef,
  };

  // Get setup dialog component if needed
  const setupDef = setupDialogPluginId ? pluginRegistry.find(p => p.id === setupDialogPluginId) : null;
  const SetupDialogComponent = setupDef?.SetupDialog as React.ComponentType<SetupDialogProps<any>> | undefined;

  return (
    <PluginManagerContext.Provider value={value}>
      {children}

      {/* Render overlay panels from active plugins */}
      {Array.from(pluginStates.entries()).map(([id, state]) => {
        if (state.status === 'active' && state.instance?.OverlayPanel) {
          const Panel = state.instance.OverlayPanel;
          return <Panel key={id} />;
        }
        return null;
      })}

      {/* Setup dialog */}
      <AnimatePresence>
        {setupDialogPluginId && SetupDialogComponent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[60] flex items-center justify-center p-6 bg-black/80 backdrop-blur-xl"
          >
            <SetupDialogComponent
              settings={getPluginSettings(setupDialogPluginId)}
              updateSettings={(patch) => updatePluginSettings(setupDialogPluginId!, patch)}
              onSetupComplete={() => {
                const def = pluginRegistry.find(p => p.id === setupDialogPluginId);
                setSetupDialogPluginId(null);
                if (def) activatePlugin(def);
              }}
              onCancel={() => {
                setSetupDialogPluginId(null);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </PluginManagerContext.Provider>
  );
}
