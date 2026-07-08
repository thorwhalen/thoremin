/**
 * useInstruments — the React binding for the instruments flow. The orchestration over
 * the dials and profile stores lives (framework-agnostic + unit-tested) in
 * {@link instruments}; this hook owns only the React state (the list, the selected
 * name, ready) and wires the lifecycle.
 *
 * On mount it restores the session (seed on first run, set the dirty baseline to the
 * selected instrument, keep the working layer that was already seeded synchronously
 * from the hot store — so a reload resumes unsaved edits with no debounce window).
 * `select` optimistically highlights then loads (reverting if the instrument vanished);
 * `save` overwrites a named instrument; `create` saves the current working layer as a
 * new instrument. There is no separate autosave — the hot store persists the working
 * state synchronously already.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProfileMeta } from '@zodal/dials-ui';
import {
  instruments,
  LAST_MODIFIED,
  restoreSession,
  getDefaultName,
  setDefaultName,
} from './instruments';
import { registry } from '@/app/commands/registry';
import { useToasts } from '@/app/toasts';

export interface InstrumentsApi {
  /** Named instruments (excludes the reserved LAST_MODIFIED legacy autosave). */
  list: ProfileMeta[];
  /** The selected instrument name (the overwrite target), or null. */
  selected: string | null;
  /** False until the first seed/restore has run (drives a loading state). */
  ready: boolean;
  /** Load an instrument and make it the clean baseline (play it; re-selecting reverts). */
  select: (name: string) => void;
  /** Overwrite a named instrument with the current working layer. */
  save: (name: string) => Promise<void>;
  /** Save the current working layer as a NEW named instrument and select it. */
  create: (name: string) => Promise<void>;
  /** The default instrument (loaded on a fresh session), or null. */
  defaultName: string | null;
  /** Toggle an instrument as the per-browser default (clicking the current one clears it). */
  setDefault: (name: string) => void;
  /** Re-read the named-instrument list. */
  refresh: () => void;
}

export function useInstruments(): InstrumentsApi {
  const [list, setList] = useState<ProfileMeta[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [defaultName, setDefaultState] = useState<string | null>(null);

  // Track the current selection without making `select` depend on it (so the click
  // handlers stay stable), for reverting an optimistic pick that fails to load.
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;

  const refresh = useCallback(() => {
    void instruments.list().then((l) => setList(l.filter((p) => p.name !== LAST_MODIFIED)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sel = await restoreSession();
      if (cancelled) return;
      setSelected(sel);
      setDefaultState(getDefaultName());
      refresh();
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  // The DISCRETE instrument actions now go through the command registry (#87
  // Phase 1) — the single write path shared with the palette/hotkeys/AI. The
  // command owns the mutation (dials layer + persisted selection); the hook keeps
  // only the React bookkeeping (the optimistic highlight, the revert, the list
  // refresh) and surfaces a failure as a toast.
  const select = useCallback(
    (name: string) => {
      const prev = selectedRef.current;
      setSelected(name); // optimistic highlight (tw-frontend-ux #1)
      void registry.dispatch('instrument.load', { name }).then((result) => {
        if (result.ok) return; // the command persisted the selection
        // The instrument vanished (e.g. removed in another tab) — undo the pick.
        setSelected(prev);
        refresh();
        useToasts.getState().push(result.error.message, 5000, 'error');
      });
    },
    [refresh],
  );

  const save = useCallback(
    async (name: string) => {
      const result = await registry.dispatch('instrument.save', { name });
      if (!result.ok) useToasts.getState().push(result.error.message, 5000, 'error');
      refresh();
    },
    [refresh],
  );

  const create = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const result = await registry.dispatch('instrument.create', { name: trimmed });
      if (!result.ok) {
        useToasts.getState().push(result.error.message, 5000, 'error');
        return;
      }
      setSelected(trimmed);
      refresh();
    },
    [refresh],
  );

  const setDefault = useCallback((name: string) => {
    const next = getDefaultName() === name ? '' : name; // clicking the current default clears it
    setDefaultName(next);
    setDefaultState(next || null);
  }, []);

  return { list, selected, ready, select, save, create, defaultName, setDefault, refresh };
}
