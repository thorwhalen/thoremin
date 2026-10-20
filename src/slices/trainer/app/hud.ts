/**
 * The Trainer's HUD in the hot store (#163 §5; the Trainer slice's since #600 S16d): its per-device
 * pref (`trainerHud`, read and written through the SDK's controls host) and the snapshot of what the
 * trainer is saying, kept as a TRANSIENT (`trainerHudSnapshot`) that `store-controls` emits to the
 * slice's overlay element. The snapshot is written when the trainer's store changes, never per tick
 * (it was a resource the overlay read each tick while the element was core's).
 */
import { useSyncExternalStore } from 'react';
import { controls } from '@thoremin/sdk-ui/host';
import { TrainerHudParamsSchema, TRAINER_HUD_PREF, defaultTrainerHud, type TrainerHudParams } from '../schema';
import type { TrainerHudSnapshot } from '../lib/hud';
import { useTrainer } from './store';

/** The transient field (and port) carrying the snapshot. */
export const TRAINER_HUD_SNAPSHOT = 'trainerHudSnapshot';

/** The HUD pref now (the pref, or its default before the store has one). */
export function trainerHud(): TrainerHudParams {
  return (controls().get()[TRAINER_HUD_PREF] as TrainerHudParams | undefined) ?? defaultTrainerHud();
}

/** Patch the HUD pref (`setTrainerHud({ show: true })`); an invalid result is ignored. */
export function setTrainerHud(patch: Partial<TrainerHudParams>): void {
  const r = TrainerHudParamsSchema.safeParse({ ...trainerHud(), ...patch });
  if (r.success) controls().setPref(TRAINER_HUD_PREF, r.data);
}

/** A React hook over the HUD pref. */
export function useTrainerHud(): TrainerHudParams {
  return useSyncExternalStore((l) => controls().subscribe(l), trainerHud, trainerHud);
}

/** What the trainer is saying, for the overlay. Null unless a routine is running (or in the beat
 *  between cues). */
export function trainerHudSnapshot(s: ReturnType<typeof useTrainer.getState> = useTrainer.getState()): TrainerHudSnapshot | null {
  if (s.status !== 'running' && s.status !== 'between') return null;
  const cue = s.index >= 0 ? s.routine[s.index] : undefined;
  if (!cue) return null;
  const guidance = s.status === 'running' && s.say && s.say !== cue.instruction ? s.say : null;
  return {
    status: s.status,
    cueName: cue.name,
    index: s.index + 1,
    total: s.routine.length,
    // The beat shows what the runner just said for THIS cue-end — nothing after a skip.
    say: s.status === 'between' ? s.lastEndSay ?? '' : cue.instruction,
    guidance,
    coverage: s.coverage,
  };
}

const sameSnapshot = (a: TrainerHudSnapshot | null, b: TrainerHudSnapshot | null): boolean =>
  a === b ||
  (a !== null && b !== null && a.status === b.status && a.cueName === b.cueName && a.index === b.index && a.total === b.total && a.say === b.say && a.guidance === b.guidance && a.coverage === b.coverage);

/** Keep the snapshot transient in step with the trainer's store (the slice's mount effect).
 *  Returns the uninstall. */
export function installTrainerHud(): () => void {
  let last: TrainerHudSnapshot | null = null;
  const write = () => {
    const next = trainerHudSnapshot();
    if (sameSnapshot(last, next)) return;
    last = next;
    controls().setTransient(TRAINER_HUD_SNAPSHOT, next);
  };
  write();
  const unsubscribe = useTrainer.subscribe(write);
  return () => {
    unsubscribe();
    controls().setTransient(TRAINER_HUD_SNAPSHOT, null);
  };
}
