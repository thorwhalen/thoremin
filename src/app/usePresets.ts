/**
 * usePresets — React glue between the async preset store (src/settings) and the
 * live zustand control store. Saving snapshots the current live state; loading
 * hydrates it. The preset store is the localStorage-backed zodal collection; the
 * live hot state stays synchronous (we never await a provider in the tick loop).
 */
import { useCallback, useEffect, useState } from 'react';
import { createPresetStore } from '@/settings/presets';
import type { PresetSummary } from '@/settings/schema';
import { useControls, toSettings } from './store';

// One localStorage-backed preset store for the app session.
const presetStore = createPresetStore();

export function usePresets() {
  const [presets, setPresets] = useState<PresetSummary[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setPresets(await presetStore.list());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (name: string) => {
      if (!name.trim()) return;
      setBusy(true);
      try {
        await presetStore.save(name, toSettings(useControls.getState()));
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const load = useCallback(async (id: string) => {
    const p = await presetStore.load(id);
    if (p) useControls.getState().applySettings(p.settings);
  }, []);

  const remove = useCallback(
    async (id: string) => {
      await presetStore.remove(id);
      await refresh();
    },
    [refresh],
  );

  return { presets, busy, save, load, remove, refresh };
}
