/**
 * usePresets — React glue between the async preset store (src/settings) and the
 * settings panel. Saving snapshots the current live state (toSettings of the hot
 * store, which the dials→hot sync keeps current); loading re-seeds the dials store
 * (the panel's source of truth) via loadSettingsIntoDials, which then syncs into the
 * hot store — so the panel reflects the loaded preset and a later edit can't re-derive
 * stale values over it. The preset store is the localStorage-backed zodal collection;
 * the live hot state stays synchronous (we never await a provider in the tick loop).
 */
import { useCallback, useEffect, useState } from 'react';
import { createPresetStore } from '@/settings/presets';
import type { PresetSummary } from '@/settings/schema';
import { useControls, toSettings } from './store';
import { loadSettingsIntoDials } from './dials/settingsStore';

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
    if (p) loadSettingsIntoDials(p.settings);
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
