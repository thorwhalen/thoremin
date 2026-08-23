/**
 * The trainer HUD resource (#163 §5) — the overlay's per-tick read of what the trainer
 * is saying, derived from the trainer store.
 *
 * Installed by `useEngine` as `ctx.resources.trainerHud`, next to the tag HUD's
 * resource. Synchronous and allocation-light: it reads the zustand store's current
 * state (no subscription, no await) and returns null whenever no routine is running,
 * so the overlay element is a no-op the rest of the time.
 */
import type { TrainerHudSnapshot } from '@/enroll/hud';
import { useTrainer } from './store';

/** The overlay's read. Null unless a routine is running (or in the beat between cues). */
export function trainerHudResource(): TrainerHudSnapshot | null {
  const s = useTrainer.getState();
  if (s.status !== 'running' && s.status !== 'between') return null;
  const cue = s.index >= 0 ? s.routine[s.index] : undefined;
  if (!cue) return null;
  const lastEnd = s.status === 'between' ? [...s.transcript].reverse().find((l) => l.kind === 'end') : undefined;
  const guidance = s.status === 'running' && s.say && s.say !== cue.instruction ? s.say : null;
  return {
    status: s.status,
    cueName: cue.name,
    index: s.index + 1,
    total: s.routine.length,
    say: s.status === 'between' ? lastEnd?.say ?? '…' : cue.instruction,
    guidance,
    coverage: s.coverage,
  };
}
