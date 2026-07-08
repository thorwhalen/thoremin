/**
 * Instrument commands (#87 Phase 1) — load / save / create a named instrument as
 * `acture` commands, so the settings panel's DISCRETE instrument actions go
 * through the one dispatch surface (alongside the palette + future hotkeys/AI)
 * instead of calling the orchestration directly.
 *
 * The #87 design lists "apply / save / load an instrument or preset" as commands
 * (a param-mutation of the whole dials layer), distinct from the per-tick / audio
 * path which is never a command. Handlers reach state ONLY through the dials
 * layer's orchestration (`@/app/dials/instruments`), which writes the dials store
 * (`setLayer` / `markSaved`) — so the import firewall holds. The React-only
 * bookkeeping (the optimistic highlight + list refresh) stays in the
 * `useInstruments` hook, which dispatches these.
 */
import { z } from 'zod';
import { defineCommand, ok, err } from 'acture';
import { selectInstrument, commitToInstrument, setSelectedName } from '@/app/dials/instruments';

/** Load a saved instrument as the current sound and make it the clean baseline. */
export const loadInstrumentCmd = defineCommand({
  id: 'instrument.load',
  title: 'Load instrument',
  description: 'Load a saved instrument as the current sound.',
  category: 'Instruments',
  params: z.object({ name: z.string().min(1).describe('The instrument name to load.') }),
  execute: async ({ name }) => {
    const layer = await selectInstrument(name);
    if (!layer) return err('instrument_not_found', `No instrument named "${name}".`, { name });
    setSelectedName(name); // persist the selection only once the load succeeded
    return ok({ name });
  },
});

/** Overwrite a saved instrument with the current working layer (clears dirty). */
export const saveInstrumentCmd = defineCommand({
  id: 'instrument.save',
  title: 'Save instrument',
  description: 'Overwrite a saved instrument with the current settings.',
  category: 'Instruments',
  params: z.object({ name: z.string().min(1).describe('The instrument name to overwrite.') }),
  execute: async ({ name }) => {
    await commitToInstrument(name);
    return ok({ name });
  },
});

/** Save the current working layer as a NEW named instrument and select it. */
export const createInstrumentCmd = defineCommand({
  id: 'instrument.create',
  title: 'Create instrument',
  description: 'Save the current settings as a new named instrument.',
  category: 'Instruments',
  params: z.object({ name: z.string().min(1).describe('The new instrument name.') }),
  execute: async ({ name }) => {
    const trimmed = name.trim();
    if (!trimmed) return err('empty_name', 'An instrument name is required.', { name });
    await commitToInstrument(trimmed); // save the working layer under the new name
    setSelectedName(trimmed);
    return ok({ name: trimmed });
  },
});

/** All instrument commands, registered together. */
export const INSTRUMENT_COMMANDS = [loadInstrumentCmd, saveInstrumentCmd, createInstrumentCmd] as const;
